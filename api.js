// api.js — Worker 백엔드 호출 모듈

const WORKER_URL = 'https://order-proxy.jasonlkj86.workers.dev';

export async function fetchAll() {
  const res = await fetch(`${WORKER_URL}/all`);
  if (!res.ok) throw new Error(`Worker 오류: ${res.status}`);
  return res.json();
}

export async function fetchNaver() {
  const res = await fetch(`${WORKER_URL}/naver`);
  if (!res.ok) throw new Error(`네이버 오류: ${res.status}`);
  return res.json();
}

export async function fetchCoupang() {
  const res = await fetch(`${WORKER_URL}/coupang`);
  if (!res.ok) throw new Error(`쿠팡 오류: ${res.status}`);
  return res.json();
}

export function getDemoData() {
  const now = new Date();
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - 29 + i);
    return d.toISOString().slice(0, 10);
  });
  const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
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
      newOrders: 19, pendingShip: 17, cancelReq: 0, returnReq: 0, revenue: 685000,
      daily: days.map(date => ({ date, revenue: rnd(30000, 300000), orders: rnd(1, 15) })),
      orders: makeOrders('naver', 20),
    },
    coupang: {
      channel: 'coupang',
      newOrders: 7, pendingShip: 7, cancelReq: 0, returnReq: 0, revenue: 173000,
      daily: days.map(date => ({ date, revenue: rnd(20000, 200000), orders: rnd(0, 10) })),
      orders: makeOrders('coupang', 10),
    },
  };
}
