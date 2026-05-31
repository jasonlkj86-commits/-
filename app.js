// app.js — 대시보드 메인 로직

const STORAGE_KEY = 'dashboard_api_keys';

// ── 설정 로드/저장 ───────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// ── 숫자 포맷 ────────────────────────────────────────────────────────────────

function fmt(n) { return n == null || n === '—' ? '—' : Number(n).toLocaleString('ko-KR'); }
function fmtRevenue(n) { return n == null ? '—' : Number(n).toLocaleString('ko-KR') + '원'; }

// ── 날짜 포맷 ────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── 상태 뱃지 ────────────────────────────────────────────────────────────────

const STATUS_MAP = {
  new: ['신규주문', 'status-new'],
  pending: ['발송대기', 'status-pending'],
  shipped: ['발송완료', 'status-shipped'],
  cancel: ['취소', 'status-cancel'],
  return: ['반품', 'status-return'],
};

function statusBadge(status) {
  const [label, cls] = STATUS_MAP[status] || ['—', ''];
  return `<span class="status-badge ${cls}">${label}</span>`;
}

// ── 차트 ─────────────────────────────────────────────────────────────────────

let chart = null;
let currentMetric = 'revenue';
let chartDataCache = null;

function buildChartData(naverDaily, coupangDaily, metric) {
  const allDates = [...new Set([...naverDaily.map(d => d.date), ...coupangDaily.map(d => d.date)])].sort();
  const naverMap = Object.fromEntries(naverDaily.map(d => [d.date, d]));
  const coupangMap = Object.fromEntries(coupangDaily.map(d => [d.date, d]));

  return {
    labels: allDates.map(d => d.slice(5)),
    naver: allDates.map(d => naverMap[d]?.[metric] || 0),
    coupang: allDates.map(d => coupangMap[d]?.[metric] || 0),
  };
}

function renderChart(naverDaily, coupangDaily) {
  chartDataCache = { naverDaily, coupangDaily };
  const ctx = document.getElementById('salesChart').getContext('2d');
  const { labels, naver, coupang } = buildChartData(naverDaily, coupangDaily, currentMetric);

  const isRevenue = currentMetric === 'revenue';
  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '스마트스토어',
          data: naver,
          backgroundColor: 'rgba(3,199,90,.7)',
          borderRadius: 4,
          stack: 'a',
        },
        {
          label: '쿠팡',
          data: coupang,
          backgroundColor: 'rgba(232,52,60,.65)',
          borderRadius: 4,
          stack: 'a',
        },
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
        y: {
          ticks: {
            font: { size: 11 },
            callback: v => isRevenue ? (v >= 10000 ? `${(v / 10000).toFixed(0)}만` : v) : v,
          },
        },
      },
    },
  };

  if (chart) { chart.destroy(); }
  chart = new Chart(ctx, config);
}

function switchMetric(metric) {
  currentMetric = metric;
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.metric === metric));
  if (chartDataCache) {
    const { naverDaily, coupangDaily } = chartDataCache;
    const { labels, naver, coupang } = buildChartData(naverDaily, coupangDaily, metric);
    chart.data.labels = labels;
    chart.data.datasets[0].data = naver;
    chart.data.datasets[1].data = coupang;
    const isRevenue = metric === 'revenue';
    chart.options.scales.y.ticks.callback = v =>
      isRevenue ? (v >= 10000 ? `${(v / 10000).toFixed(0)}만` : v) : v;
    chart.options.plugins.tooltip.callbacks.label = ctx =>
      isRevenue
        ? `${ctx.dataset.label}: ${Number(ctx.parsed.y).toLocaleString()}원`
        : `${ctx.dataset.label}: ${ctx.parsed.y}건`;
    chart.update();
  }
}

// ── 주문 테이블 ──────────────────────────────────────────────────────────────

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
    (ch === 'all' || o.channel === ch) &&
    (st === 'all' || o.status === st)
  ));
}

// ── 대시보드 업데이트 ────────────────────────────────────────────────────────

function applyData(naverData, coupangData, isDemo = false) {
  const totalOrders = (naverData.newOrders || 0) + (coupangData.newOrders || 0);
  const totalRevenue = (naverData.revenue || 0) + (coupangData.revenue || 0);
  const newOrders = (naverData.newOrders || 0) + (coupangData.newOrders || 0);
  const pendingShip = (naverData.pendingShip || 0) + (coupangData.pendingShip || 0);
  const cancelReq = (naverData.cancelReq || 0) + (coupangData.cancelReq || 0);
  const returnReq = (naverData.returnReq || 0) + (coupangData.returnReq || 0);

  document.getElementById('totalOrders').textContent = fmt(totalOrders);
  document.getElementById('totalRevenue').textContent = fmt(totalRevenue);
  document.getElementById('newOrders').textContent = fmt(newOrders);
  document.getElementById('pendingShip').textContent = fmt(pendingShip);
  document.getElementById('cancelReq').textContent = fmt(cancelReq);
  document.getElementById('returnReq').textContent = fmt(returnReq);

  // 스마트스토어
  document.getElementById('naverNew').textContent = fmt(naverData.newOrders);
  document.getElementById('naverConfirm').textContent = fmt(naverData.newOrders);
  document.getElementById('naverShip').textContent = fmt(naverData.pendingShip);
  document.getElementById('naverCancel').textContent = fmt(naverData.cancelReq);
  document.getElementById('naverReturn').textContent = fmt(naverData.returnReq);
  document.getElementById('naverRevenue').textContent = fmtRevenue(naverData.revenue);
  const ns = document.getElementById('naverStatus');
  ns.textContent = isDemo ? '데모' : '연결됨';
  ns.className = `channel-status ${isDemo ? 'demo' : 'connected'}`;

  // 쿠팡
  document.getElementById('coupangNew').textContent = fmt(coupangData.newOrders);
  document.getElementById('coupangConfirm').textContent = fmt(coupangData.newOrders);
  document.getElementById('coupangShip').textContent = fmt(coupangData.pendingShip);
  document.getElementById('coupangCancel').textContent = fmt(coupangData.cancelReq);
  document.getElementById('coupangReturn').textContent = fmt(coupangData.returnReq);
  document.getElementById('coupangRevenue').textContent = fmtRevenue(coupangData.revenue);
  const cs = document.getElementById('coupangStatus');
  cs.textContent = isDemo ? '데모' : '연결됨';
  cs.className = `channel-status ${isDemo ? 'demo' : 'connected'}`;

  // 차트
  const naverDaily = (naverData.daily || []).map(d => ({
    date: d.date || d.settlementDate || Object.keys(d)[0],
    revenue: d.revenue || d.salesAmount || 0,
    orders: d.orders || d.orderCount || 0,
  }));
  const coupangDaily = (coupangData.daily || []).map(d => ({
    date: d.date || d.settlementDate || Object.keys(d)[0],
    revenue: d.revenue || d.salesAmount || 0,
    orders: d.orders || d.orderCount || 0,
  }));
  renderChart(naverDaily, coupangDaily);

  // 주문 목록
  allOrders = [...(naverData.orders || []), ...(coupangData.orders || [])].sort(
    (a, b) => new Date(b.orderedAt) - new Date(a.orderedAt)
  );
  filterOrders();

  document.getElementById('updatedAt').textContent =
    'updated: ' + new Date().toLocaleString('ko-KR', { hour12: false }).replace(/\./g, '-').replace(/ /g, ' ');
}

// ── API 호출 (동적 import) ────────────────────────────────────────────────────

async function fetchAll(cfg) {
  const { fetchNaverData, fetchCoupangData } = await import('./api.js');

  const results = await Promise.allSettled([
    cfg.naverClientId && cfg.naverClientSecret
      ? fetchNaverData(cfg.naverClientId, cfg.naverClientSecret)
      : Promise.reject('스마트스토어 키 없음'),
    cfg.coupangAccessKey && cfg.coupangSecretKey && cfg.coupangVendorId
      ? fetchCoupangData(cfg.coupangAccessKey, cfg.coupangSecretKey, cfg.coupangVendorId)
      : Promise.reject('쿠팡 키 없음'),
  ]);

  const naverData = results[0].status === 'fulfilled' ? results[0].value : null;
  const coupangData = results[1].status === 'fulfilled' ? results[1].value : null;

  if (!naverData && !coupangData) throw new Error('API 연결 실패');
  return { naverData, coupangData };
}

async function loadDemoData() {
  const { getDemoData } = await import('./api.js');
  return getDemoData();
}

// ── 이벤트 ───────────────────────────────────────────────────────────────────

async function refresh() {
  const btn = document.getElementById('refreshBtn');
  btn.textContent = '로딩 중...';
  btn.disabled = true;

  try {
    const cfg = loadConfig();
    if (cfg._demo) {
      const demo = await loadDemoData();
      applyData(demo.naver, demo.coupang, true);
    } else {
      const { naverData, coupangData } = await fetchAll(cfg);
      const empty = { newOrders: 0, pendingShip: 0, cancelReq: 0, returnReq: 0, revenue: 0, daily: [], orders: [] };
      applyData(naverData || empty, coupangData || empty, false);
    }
  } catch (e) {
    console.error(e);
    alert(`데이터 로드 실패: ${e.message}\n\n설정에서 API 키를 확인하거나 데모 데이터를 사용해 주세요.`);
  } finally {
    btn.textContent = '새로고침';
    btn.disabled = false;
  }
}

// ── 초기화 ───────────────────────────────────────────────────────────────────

function init() {
  // 오늘 날짜
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('ko-KR');

  // 설정 모달
  const modal = document.getElementById('settingsModal');
  document.getElementById('settingsBtn').addEventListener('click', () => {
    const cfg = loadConfig();
    document.getElementById('naverClientId').value = cfg.naverClientId || '';
    document.getElementById('naverClientSecret').value = cfg.naverClientSecret || '';
    document.getElementById('coupangAccessKey').value = cfg.coupangAccessKey || '';
    document.getElementById('coupangSecretKey').value = cfg.coupangSecretKey || '';
    document.getElementById('coupangVendorId').value = cfg.coupangVendorId || '';
    modal.classList.add('open');
  });
  document.getElementById('modalClose').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  document.getElementById('saveSettings').addEventListener('click', () => {
    const cfg = {
      naverClientId: document.getElementById('naverClientId').value.trim(),
      naverClientSecret: document.getElementById('naverClientSecret').value.trim(),
      coupangAccessKey: document.getElementById('coupangAccessKey').value.trim(),
      coupangSecretKey: document.getElementById('coupangSecretKey').value.trim(),
      coupangVendorId: document.getElementById('coupangVendorId').value.trim(),
      _demo: false,
    };
    saveConfig(cfg);
    modal.classList.remove('open');
    refresh();
  });

  document.getElementById('useDemoData').addEventListener('click', () => {
    saveConfig({ _demo: true });
    modal.classList.remove('open');
    refresh();
  });

  // 새로고침
  document.getElementById('refreshBtn').addEventListener('click', refresh);

  // 차트 토글
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMetric(btn.dataset.metric));
  });

  // 필터
  document.getElementById('channelFilter').addEventListener('change', filterOrders);
  document.getElementById('statusFilter').addEventListener('change', filterOrders);

  // 자동 새로고침 5분
  setInterval(refresh, 5 * 60 * 1000);

  // 최초 로드: 키 있으면 API, 없으면 데모
  const cfg = loadConfig();
  const hasKeys = cfg.naverClientId || cfg.coupangAccessKey;
  if (!hasKeys && !cfg._demo) {
    // 처음 방문 → 데모 데이터 자동 표시
    saveConfig({ _demo: true });
  }
  refresh();
}

document.addEventListener('DOMContentLoaded', init);
