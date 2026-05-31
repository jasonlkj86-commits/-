// app.js — 대시보드 메인 로직

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('ko-KR'); }
function fmtRevenue(n) { return n == null ? '—' : Number(n).toLocaleString('ko-KR') + '원'; }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const STATUS_MAP = {
  new: ['신규주문', 'status-new'],
  pending: ['발송대기', 'status-pending'],
  shipped: ['발송완료', 'status-shipped'],
  cancel: ['취소', 'status-cancel'],
  return: ['반품', 'status-return'],
};
function statusBadge(s) {
  const [label, cls] = STATUS_MAP[s] || ['—', ''];
  return `<span class="status-badge ${cls}">${label}</span>`;
}

// ── 차트 ──────────────────────────────────────────────────────────────────────

let chart = null;
let chartCache = null;
let currentMetric = 'revenue';

function renderChart(naverDaily, coupangDaily) {
  chartCache = { naverDaily, coupangDaily };
  const allDates = [...new Set([...naverDaily.map(d => d.date), ...coupangDaily.map(d => d.date)])].sort();
  const nm = Object.fromEntries(naverDaily.map(d => [d.date, d]));
  const cm = Object.fromEntries(coupangDaily.map(d => [d.date, d]));

  const labels = allDates.map(d => d.slice(5));
  const nData = allDates.map(d => nm[d]?.[currentMetric] || 0);
  const cData = allDates.map(d => cm[d]?.[currentMetric] || 0);
  const isRevenue = currentMetric === 'revenue';

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('salesChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '스마트스토어', data: nData, backgroundColor: 'rgba(3,199,90,.7)', borderRadius: 4, stack: 'a' },
        { label: '쿠팡', data: cData, backgroundColor: 'rgba(232,52,60,.65)', borderRadius: 4, stack: 'a' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 12 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => isRevenue
              ? `${ctx.dataset.label}: ${Number(ctx.parsed.y).toLocaleString()}원`
              : `${ctx.dataset.label}: ${ctx.parsed.y}건`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { ticks: { font: { size: 11 }, callback: v => isRevenue ? (v >= 10000 ? `${(v / 10000).toFixed(0)}만` : v) : v } },
      },
    },
  });
}

function switchMetric(metric) {
  currentMetric = metric;
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.metric === metric));
  if (chartCache) renderChart(chartCache.naverDaily, chartCache.coupangDaily);
}

// ── 주문 테이블 ───────────────────────────────────────────────────────────────

let allOrders = [];

function renderOrders(orders) {
  const tbody = document.getElementById('ordersTableBody');
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">주문이 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><span class="badge badge-${o.channel}">${o.channel === 'naver' ? 'N' : 'C'}</span></td>
      <td style="font-family:monospace;font-size:12px">${o.id}</td>
      <td>${o.productName}</td>
      <td style="text-align:center">${o.quantity}</td>
      <td style="text-align:right">${fmt(o.amount)}원</td>
      <td>${statusBadge(o.status)}</td>
      <td style="color:var(--text-sub)">${fmtDate(o.orderedAt)}</td>
    </tr>
  `).join('');
}

function filterOrders() {
  const ch = document.getElementById('channelFilter').value;
  const st = document.getElementById('statusFilter').value;
  renderOrders(allOrders.filter(o =>
    (ch === 'all' || o.channel === ch) && (st === 'all' || o.status === st)
  ));
}

// ── 데이터 적용 ───────────────────────────────────────────────────────────────

function applyData(naver, coupang, isDemo = false) {
  const n = naver || {};
  const c = coupang || {};

  document.getElementById('totalOrders').textContent = fmt((n.newOrders || 0) + (c.newOrders || 0));
  document.getElementById('totalRevenue').textContent = fmt((n.revenue || 0) + (c.revenue || 0));
  document.getElementById('newOrders').textContent = fmt((n.newOrders || 0) + (c.newOrders || 0));
  document.getElementById('pendingShip').textContent = fmt((n.pendingShip || 0) + (c.pendingShip || 0));
  document.getElementById('cancelReq').textContent = fmt((n.cancelReq || 0) + (c.cancelReq || 0));
  document.getElementById('returnReq').textContent = fmt((n.returnReq || 0) + (c.returnReq || 0));

  const setChannel = (prefix, data, demo) => {
    document.getElementById(`${prefix}New`).textContent = fmt(data.newOrders);
    document.getElementById(`${prefix}Confirm`).textContent = fmt(data.newOrders);
    document.getElementById(`${prefix}Ship`).textContent = fmt(data.pendingShip);
    document.getElementById(`${prefix}Cancel`).textContent = fmt(data.cancelReq);
    document.getElementById(`${prefix}Return`).textContent = fmt(data.returnReq);
    document.getElementById(`${prefix}Revenue`).textContent = fmtRevenue(data.revenue);
    const el = document.getElementById(`${prefix}Status`);
    if (data.error) { el.textContent = '오류'; el.className = 'channel-status'; }
    else { el.textContent = demo ? '데모' : '연결됨'; el.className = `channel-status ${demo ? 'demo' : 'connected'}`; }
  };
  setChannel('naver', n, isDemo);
  setChannel('coupang', c, isDemo);

  const toDaily = arr => (arr || []).map(d => ({
    date: d.date || d.settlementDate || '',
    revenue: d.revenue || d.salesAmount || 0,
    orders: d.orders || d.orderCount || 0,
  }));
  renderChart(toDaily(n.daily), toDaily(c.daily));

  allOrders = [...(n.orders || []), ...(c.orders || [])].sort((a, b) => new Date(b.orderedAt) - new Date(a.orderedAt));
  filterOrders();

  document.getElementById('updatedAt').textContent =
    'updated: ' + new Date().toLocaleString('ko-KR', { hour12: false }).replace(/\. /g, '-').replace('.', '');
}

// ── 데이터 로드 ───────────────────────────────────────────────────────────────

let isDemo = false;

async function refresh() {
  const btn = document.getElementById('refreshBtn');
  btn.textContent = '로딩 중...';
  btn.disabled = true;

  try {
    if (isDemo) {
      const { getDemoData } = await import('./api.js');
      const d = getDemoData();
      applyData(d.naver, d.coupang, true);
    } else {
      const { fetchAll } = await import('./api.js');
      const { naver, coupang } = await fetchAll();
      applyData(naver, coupang, false);
    }
  } catch (e) {
    console.error('로드 실패:', e);
    alert(`데이터 로드 실패: ${e.message}`);
  } finally {
    btn.textContent = '새로고침';
    btn.disabled = false;
  }
}

// ── 초기화 ────────────────────────────────────────────────────────────────────

function init() {
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('ko-KR');

  document.getElementById('refreshBtn').addEventListener('click', refresh);

  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMetric(btn.dataset.metric));
  });

  document.getElementById('channelFilter').addEventListener('change', filterOrders);
  document.getElementById('statusFilter').addEventListener('change', filterOrders);

  // 설정 버튼 → 데모/실제 전환
  document.getElementById('settingsBtn').addEventListener('click', () => {
    isDemo = !isDemo;
    document.getElementById('settingsBtn').textContent = isDemo ? '📊 실제 데이터' : '⚙️ 데모 보기';
    refresh();
  });

  setInterval(refresh, 5 * 60 * 1000);
  refresh();
}

document.addEventListener('DOMContentLoaded', init);
