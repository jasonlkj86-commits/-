// Cloudflare Worker — 주문 대시보드 백엔드
// 필요한 Secrets: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
//                 COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY, COUPANG_VENDOR_ID

const ALLOWED_ORIGIN = 'https://jasonlkj86-commits.github.io';
const NAVER_TOKEN_URL = 'https://api.commerce.naver.com/external/v1/oauth2/token';
const NAVER_BASE = 'https://api.commerce.naver.com/external/v1';
const COUPANG_BASE = 'https://api-gateway.coupang.com';

let naverTokenCache = { token: null, expiry: 0 };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function cors(origin) {
  const allow = origin === ALLOWED_ORIGIN ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(data, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });
}

// ── 네이버 인증 ──────────────────────────────────────────────────────────────

async function getNaverToken(clientId, clientSecret) {
  if (naverTokenCache.token && Date.now() < naverTokenCache.expiry) {
    return naverTokenCache.token;
  }
  const timestamp = Date.now().toString();
  const message = `${clientId}_${timestamp}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(clientSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const sign = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const password = btoa(`${message}:${sign}`);

  const res = await fetch(NAVER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${password}`,
    },
    body: 'grant_type=client_credentials&type=SELF',
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`네이버 토큰 오류 ${res.status}: ${err}`);
  }
  const data = await res.json();
  naverTokenCache = { token: data.access_token, expiry: Date.now() + (data.expires_in - 60) * 1000 };
  return naverTokenCache.token;
}

async function naverGet(path, token) {
  const res = await fetch(`${NAVER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`네이버 API 오류 ${res.status}: ${path}`);
  return res.json();
}

// ── 쿠팡 인증 ───────────────────────────────────────────────────────────────

async function coupangGet(path, accessKey, secretKey) {
  const now = new Date();
  const datetime = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const [pathname, qs = ''] = path.split('?');
  const message = `${datetime}GET${pathname}${qs}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  const authorization = `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;

  const res = await fetch(`${COUPANG_BASE}${path}`, {
    headers: { Authorization: authorization, 'Content-Type': 'application/json;charset=UTF-8' },
  });
  if (!res.ok) throw new Error(`쿠팡 API 오류 ${res.status}: ${path}`);
  return res.json();
}

// ── 데이터 수집 ──────────────────────────────────────────────────────────────

async function getNaverData(env) {
  const token = await getNaverToken(env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET);
  const today = todayStr();
  const s30 = daysAgoStr(29);

  const [newRes, shipRes, dailyRes] = await Promise.all([
    naverGet(`/pay-order/seller/orders?orderStatusType=PAYED&startDate=${today}&endDate=${today}&page=1&pageSize=100`, token),
    naverGet(`/pay-order/seller/orders?orderStatusType=DELIVERING&startDate=${today}&endDate=${today}&page=1&pageSize=1`, token),
    naverGet(`/pay-order/seller/revenue-history?startDate=${s30}&endDate=${today}`, token),
  ]);

  const orders = newRes.contents || [];
  const revenue = orders.reduce((s, o) => s + (o.generalPaymentAmount || 0), 0);

  return {
    channel: 'naver',
    newOrders: newRes.totalCount || 0,
    pendingShip: shipRes.totalCount || 0,
    cancelReq: 0,
    returnReq: 0,
    revenue,
    daily: (dailyRes.revenueHistories || []).map(d => ({
      date: d.revenueDate,
      revenue: d.totalPaymentAmount || 0,
      orders: d.totalOrderCount || 0,
    })),
    orders: orders.slice(0, 50).map(o => ({
      channel: 'naver',
      id: o.productOrderId,
      productName: o.productName,
      quantity: o.quantity,
      amount: o.generalPaymentAmount,
      status: 'new',
      orderedAt: o.paymentDate,
    })),
  };
}

async function getCoupangData(env) {
  const { COUPANG_ACCESS_KEY: ak, COUPANG_SECRET_KEY: sk, COUPANG_VENDOR_ID: vid } = env;
  const today = todayStr();

  const [newRes, shipRes] = await Promise.all([
    coupangGet(`/v2/providers/seller_api/apis/api/v1/vendor/${vid}/ordersheets?status=ACCEPT&searchStartDateTime=${today}T00:00:00&searchEndDateTime=${today}T23:59:59`, ak, sk),
    coupangGet(`/v2/providers/seller_api/apis/api/v1/vendor/${vid}/ordersheets?status=DEPARTURE_READY&searchStartDateTime=${today}T00:00:00&searchEndDateTime=${today}T23:59:59`, ak, sk),
  ]);

  const orders = newRes.data || [];
  const revenue = orders.reduce((s, o) => s + (o.salesAmount || 0), 0);

  return {
    channel: 'coupang',
    newOrders: orders.length,
    pendingShip: (shipRes.data || []).length,
    cancelReq: 0,
    returnReq: 0,
    revenue,
    daily: [],
    orders: orders.slice(0, 50).map(o => ({
      channel: 'coupang',
      id: o.orderId,
      productName: o.orderItems?.[0]?.productName || '—',
      quantity: o.orderItems?.[0]?.quantity || 1,
      amount: o.salesAmount,
      status: 'new',
      orderedAt: o.orderedAt,
    })),
  };
}

// ── 라우터 ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (origin !== ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      if (url.pathname === '/naver') {
        return json(await getNaverData(env), origin);
      }
      if (url.pathname === '/coupang') {
        return json(await getCoupangData(env), origin);
      }
      if (url.pathname === '/all') {
        const [n, c] = await Promise.allSettled([getNaverData(env), getCoupangData(env)]);
        return json({
          naver: n.status === 'fulfilled' ? n.value : { error: n.reason?.message },
          coupang: c.status === 'fulfilled' ? c.value : { error: c.reason?.message },
        }, origin);
      }
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return json({ error: e.message }, origin, 500);
    }
  },
};
