/**
 * api.js — 스마트스토어 & 쿠팡 파트너스 API 호출 모듈
 *
 * 두 API 모두 서버사이드 CORS 정책으로 인해 브라우저에서 직접 호출이
 * 불가능합니다. 프록시 서버 URL을 설정하거나 데모 데이터를 사용하세요.
 *
 * PROXY_BASE: 직접 운영하는 CORS 프록시 서버 URL (선택)
 *   예: "https://my-proxy.example.com/proxy?url="
 */

const PROXY_BASE = 'https://order-proxy.jasonlkj86.workers.dev/?url=';

// ── 날짜 헬퍼 ──────────────────────────────────────────────────────────────

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days + 1);
  return { startDate: toDateStr(start), endDate: toDateStr(end) };
}

// ── 스마트스토어 API ────────────────────────────────────────────────────────

const NAVER_AUTH_URL = 'https://api.commerce.naver.com/external/v1/oauth2/token';
const NAVER_BASE = 'https://api.commerce.naver.com/external/v1';

let naverToken = null;
let naverTokenExpiry = 0;

async function naverGetToken(clientId, clientSecret) {
  if (naverToken && Date.now() < naverTokenExpiry) return naverToken;

  const timestamp = Date.now().toString();
  const raw = `${clientId}_${timestamp}:${clientSecret}`;
  const password = btoa(unescape(encodeURIComponent(raw)));

  const body = new URLSearchParams();
  body.append('grant_type', 'client_credentials');
  body.append('type', 'SELF');
  body.append('account_id', clientId);

  const res = await fetch(proxyUrl(NAVER_AUTH_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${password}`,
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`네이버 토큰 오류: ${res.status} - ${errText}`);
  }
  const data = await res.json();
  naverToken = data.access_token;
  naverTokenExpiry = Date.now() + data.expires_in * 1000 - 60000;
  return naverToken;
}

async function naverRequest(path, clientId, clientSecret) {
  const token = await naverGetToken(clientId, clientSecret);
  const res = await fetch(proxyUrl(`${NAVER_BASE}${path}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`네이버 API 오류: ${res.status} ${path}`);
  return res.json();
}

export async function fetchNaverData(clientId, clientSecret) {
  const { startDate, endDate } = dateRange(1);

  const [orderSummary, deliveryWaiting] = await Promise.all([
    naverRequest(
      `/pay-order/seller/orders?orderStatusType=PAYED&startDate=${startDate}&endDate=${endDate}&page=1&pageSize=1`,
      clientId, clientSecret
    ),
    naverRequest(
      `/pay-order/seller/orders?orderStatusType=DELIVERING&startDate=${startDate}&endDate=${endDate}&page=1&pageSize=1`,
      clientId, clientSecret
    ),
  ]);

  // 매출 집계 (최대 100건)
  const revenueRes = await naverRequest(
    `/pay-order/seller/orders?orderStatusType=PAYED&startDate=${startDate}&endDate=${endDate}&page=1&pageSize=100`,
    clientId, clientSecret
  );
  const revenue = (revenueRes.contents || []).reduce(
    (sum, o) => sum + (o.generalPaymentAmount || 0), 0
  );

  // 30일 일별 매출
  const { startDate: s30, endDate: e30 } = dateRange(30);
  const dailyRes = await naverRequest(
    `/pay-order/seller/revenue-history?startDate=${s30}&endDate=${e30}`,
    clientId, clientSecret
  );

  return {
    channel: 'naver',
    newOrders: orderSummary.totalCount || 0,
    pendingShip: deliveryWaiting.totalCount || 0,
    cancelReq: 0,
    returnReq: 0,
    revenue,
    daily: dailyRes.revenueHistories || [],
    orders: (revenueRes.contents || []).slice(0, 50).map(o => ({
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

// ── 쿠팡 파트너스 API ───────────────────────────────────────────────────────

const COUPANG_BASE = 'https://api-gateway.coupang.com';

function coupangHmac(method, path, secretKey, datetime) {
  // HMAC-SHA256 서명 (SubtleCrypto 사용)
  // path에서 query string 분리
  const [pathname, qs = ''] = path.split('?');
  const message = `${datetime}${method}${pathname}${qs}`;

  return crypto.subtle
    .importKey('raw', new TextEncoder().encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then(key => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
    .then(sig => Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join(''));
}

async function coupangRequest(path, accessKey, secretKey) {
  const method = 'GET';
  const datetime = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const signature = await coupangHmac(method, path, secretKey, datetime);
  const authorization = `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;

  const res = await fetch(proxyUrl(`${COUPANG_BASE}${path}`), {
    headers: { Authorization: authorization, 'Content-Type': 'application/json;charset=UTF-8' },
  });
  if (!res.ok) throw new Error(`쿠팡 API 오류: ${res.status} ${path}`);
  return res.json();
}

export async function fetchCoupangData(accessKey, secretKey, vendorId) {
  const today = toDateStr(new Date());
  const s30 = toDateStr(new Date(Date.now() - 29 * 86400000));

  const [newOrders, deliveryWaiting, cancelOrders, returnOrders, revenue] = await Promise.all([
    coupangRequest(`/v2/providers/seller_api/apis/api/v1/vendor/${vendorId}/ordersheets?status=ACCEPT&searchStartDateTime=${today}T00:00:00&searchEndDateTime=${today}T23:59:59`, accessKey, secretKey),
    coupangRequest(`/v2/providers/seller_api/apis/api/v1/vendor/${vendorId}/ordersheets?status=DEPARTURE_READY&searchStartDateTime=${today}T00:00:00&searchEndDateTime=${today}T23:59:59`, accessKey, secretKey),
    coupangRequest(`/v2/providers/seller_api/apis/api/v1/vendor/${vendorId}/cancel-returns/orders?status=CANCEL_REQUEST&searchStartDateTime=${today}T00:00:00&searchEndDateTime=${today}T23:59:59`, accessKey, secretKey),
    coupangRequest(`/v2/providers/seller_api/apis/api/v1/vendor/${vendorId}/cancel-returns/orders?status=RETURN_REQUEST&searchStartDateTime=${today}T00:00:00&searchEndDateTime=${today}T23:59:59`, accessKey, secretKey),
    coupangRequest(`/v2/providers/seller_api/apis/api/v1/vendor/${vendorId}/revenue?startDate=${s30}&endDate=${today}`, accessKey, secretKey),
  ]);

  const todayRevenue = (newOrders.data || []).reduce((sum, o) => sum + (o.orderedAt ? o.salesAmount || 0 : 0), 0);

  return {
    channel: 'coupang',
    newOrders: newOrders.data?.length || 0,
    pendingShip: deliveryWaiting.data?.length || 0,
    cancelReq: cancelOrders.data?.length || 0,
    returnReq: returnOrders.data?.length || 0,
    revenue: todayRevenue,
    daily: revenue.data || [],
    orders: (newOrders.data || []).slice(0, 50).map(o => ({
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

// ── 데모 데이터 ─────────────────────────────────────────────────────────────

export function getDemoData() {
  const now = new Date();
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - 29 + i);
    return toDateStr(d);
  });

  const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const naverDaily = days.map(date => ({ date, revenue: rnd(30000, 300000), orders: rnd(1, 15) }));
  const coupangDaily = days.map(date => ({ date, revenue: rnd(20000, 200000), orders: rnd(0, 10) }));

  const products = ['프리미엄 텀블러 500ml', '무선 충전패드 15W', '캠핑 접이식 의자', '노트북 파우치 15인치', '주방 실리콘 뒤집개 세트'];
  const makeOrders = (channel, count) =>
    Array.from({ length: count }, (_, i) => {
      const d = new Date(now);
      d.setHours(rnd(0, 23), rnd(0, 59));
      const statuses = ['new', 'pending', 'shipped', 'cancel', 'return'];
      return {
        channel,
        id: `${channel === 'naver' ? 'N' : 'C'}${2024000000 + i}`,
        productName: products[rnd(0, products.length - 1)],
        quantity: rnd(1, 3),
        amount: rnd(1, 5) * 10000 + rnd(0, 9) * 1000,
        status: statuses[rnd(0, 4)],
        orderedAt: d.toISOString(),
      };
    });

  return {
    naver: {
      channel: 'naver',
      newOrders: 19,
      pendingShip: 17,
      cancelReq: 0,
      returnReq: 0,
      revenue: 685000,
      daily: naverDaily,
      orders: makeOrders('naver', 20),
    },
    coupang: {
      channel: 'coupang',
      newOrders: 7,
      pendingShip: 7,
      cancelReq: 0,
      returnReq: 0,
      revenue: 173000,
      daily: coupangDaily,
      orders: makeOrders('coupang', 10),
    },
  };
}

function proxyUrl(url) {
  return PROXY_BASE ? `${PROXY_BASE}${encodeURIComponent(url)}` : url;
}
