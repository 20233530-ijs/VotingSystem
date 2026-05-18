// ===== CONSTANTS =====
const CANDIDATE_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4'];
const PLACEHOLDER = 'placeholder.png';

// ===== STATE =====
let contract = null;
let currentAccount = null;
let isOwner = false;
let voteStatus = -1;
let currentRenderedStatus = -1; // Track rendered status for partial updates
let candidates = [];
let pollInterval = null;
let countdownInterval = null;
let selectedCandidateId = null;
let confirmedCandidateId = null;
let pendingTxHash = null;
let networkErrorShown = false;

// Chart instances
let liveChartInstance = null;
let resultBarInstance = null;
let resultDonutInstance = null;

// ===== INIT =====
window.addEventListener('DOMContentLoaded', async () => {
  initReadContract();
  updateEtherscanLink();
  setupMetaMaskEvents();
  await loadElectionData();
  await refreshStatus();
  startPolling();

  // Auto-connect if MetaMask already authorized
  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        currentAccount = accounts[0].toLowerCase();
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId === '0xaa36a7') {
          await updateWalletUI();
          currentRenderedStatus = -1; // Force re-render with wallet info
          await refreshStatus();
        }
      }
    } catch (e) { /* silent */ }
  }
});

function initReadContract() {
  const rpc = new ethers.JsonRpcProvider(CONFIG.SEPOLIA_RPC);
  contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, rpc);
}

// MetaMask 연결 시 BrowserProvider 우선, 미연결 시 fallback RPC 사용
function rebuildContract() {
  const provider = (currentAccount && window.ethereum)
    ? new ethers.BrowserProvider(window.ethereum)
    : new ethers.JsonRpcProvider(CONFIG.SEPOLIA_RPC);
  contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, provider);
}

async function getSignerContract() {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, signer);
}

// ===== METAMASK CONNECTION =====
async function connectWallet() {
  if (currentAccount) return;

  if (!window.ethereum) {
    document.getElementById('connectModalDesc').textContent =
      'MetaMask 익스텐션이 설치되어 있지 않습니다.';
    document.getElementById('connectModalActions').innerHTML =
      '<div class="install-link"><a href="https://metamask.io/download/" target="_blank">공식 사이트에서 설치하기 ↗</a></div>';
    showModal('modalConnect');
    return;
  }

  document.getElementById('connectModalDesc').textContent =
    '투표에 참여하려면 MetaMask 지갑 연결이 필요합니다.';
  document.getElementById('connectModalActions').innerHTML =
    '<button class="btn-primary" style="width:100%;" onclick="doConnectWallet()">MetaMask로 연결하기</button>' +
    '<div class="install-link"><a href="https://metamask.io/download/" target="_blank">MetaMask가 없으신가요? 공식 사이트에서 설치하기 ↗</a></div>';
  showModal('modalConnect');
}

async function doConnectWallet() {
  hideModal('modalConnect');
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) return;
    currentAccount = accounts[0].toLowerCase();
    const ok = await checkNetwork();
    if (!ok) return;
    await updateWalletUI();
    currentRenderedStatus = -1; // Force re-render with wallet state
    await refreshStatus();
  } catch (err) {
    if (err.code === 4001) {
      showToast('지갑 연결을 거부했습니다. 투표 참여를 위해 연결이 필요합니다.', 'error');
    } else {
      showToast('지갑 연결 중 오류가 발생했습니다.', 'error');
    }
  }
}

async function checkNetwork() {
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (chainId !== '0xaa36a7') {
    showModal('modalNetwork');
    return false;
  }
  hideModal('modalNetwork');
  return true;
}

async function switchToSepolia() {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0xaa36a7' }],
    });
    hideModal('modalNetwork');
    await updateWalletUI();
    currentRenderedStatus = -1;
    await refreshStatus();
  } catch (err) {
    if (err.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0xaa36a7',
            chainName: 'Sepolia Test Network',
            nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://rpc.sepolia.org'],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
          }],
        });
        hideModal('modalNetwork');
        await updateWalletUI();
        currentRenderedStatus = -1;
        await refreshStatus();
      } catch (addErr) {
        showToast('Sepolia 네트워크 추가에 실패했습니다.', 'error');
      }
    } else {
      showToast('Sepolia로 전환에 실패했습니다.', 'error');
    }
  }
}

function setupMetaMaskEvents() {
  if (!window.ethereum) return;
  window.ethereum.on('accountsChanged', async (accounts) => {
    if (!accounts || accounts.length === 0) {
      currentAccount = null;
      isOwner = false;
    } else {
      currentAccount = accounts[0].toLowerCase();
      const ok = await checkNetwork();
      if (!ok) { await updateWalletUI(); return; }
    }
    await updateWalletUI();
    currentRenderedStatus = -1; // Force full re-render on account change
    await refreshStatus();
  });
  window.ethereum.on('chainChanged', () => { window.location.reload(); });
}

async function updateWalletUI() {
  rebuildContract(); // 지갑 상태가 바뀔 때마다 provider 교체
  const btn = document.getElementById('connectWalletBtn');
  const adminLink = document.getElementById('adminLink');

  if (!currentAccount) {
    btn.textContent = '지갑 연결';
    adminLink.classList.add('hidden');
    isOwner = false;
    return;
  }

  btn.textContent = currentAccount.slice(0, 6) + '...' + currentAccount.slice(-4);

  try {
    const ownerAddr = await contract.owner();
    isOwner = ownerAddr.toLowerCase() === currentAccount;
    if (isOwner) adminLink.classList.remove('hidden');
    else adminLink.classList.add('hidden');
  } catch (e) {
    isOwner = false;
    adminLink.classList.add('hidden');
  }
}

// ===== DATA LOADING =====
async function loadElectionData() {
  try {
    const res = await fetch(`${CONFIG.BACKEND_URL}/api/election`);
    if (!res.ok) throw new Error('서버 오류');
    const data = await res.json();
    if (data.title) {
      document.getElementById('electionTitle').textContent = data.title;
      document.getElementById('electionInfo').classList.remove('hidden');
    }
    candidates = data.candidates || [];
    networkErrorShown = false;
  } catch (e) {
    showToast('후보자 정보를 불러오지 못했습니다. 새로고침해주세요.', 'error');
    candidates = [];
  }
}

// ===== POLLING & STATUS =====
async function refreshStatus() {
  try {
    const newStatus = Number(await contract.getVoteStatus());
    const statusChanged = newStatus !== currentRenderedStatus;
    voteStatus = newStatus;
    networkErrorShown = false;

    updateStatusBadge(newStatus);

    if (newStatus >= 1) {
      const [st, et] = await contract.getElectionPeriod();
      setEl('startTimeDisplay', formatTimestamp(Number(st)));
      setEl('endTimeDisplay', formatTimestamp(Number(et)));
      document.getElementById('electionInfo').classList.remove('hidden');
    }

    if (newStatus === 2 || newStatus === 3) {
      try {
        const total = Number(await contract.getTotalVotes());
        setEl('totalVotesDisplay', `총 투표수: ${total}표`);
      } catch (e) { /* silent */ }
    } else {
      setEl('totalVotesDisplay', '');
    }

    if (statusChanged) {
      currentRenderedStatus = newStatus;
      clearCountdown();
      destroyAllCharts();
      await renderByStatus(newStatus);
    } else if (newStatus === 2) {
      // Partial update: only refresh chart data
      await refreshLiveChart();
    }

    // Stop polling when election ended (final data, no changes)
    if (newStatus === 3 && pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  } catch (e) {
    console.error('Status refresh error:', e);
    if (!networkErrorShown) {
      networkErrorShown = true;
      showToast('네트워크 연결을 확인해주세요.', 'error');
    }
  }
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(refreshStatus, 30000);
}

function destroyAllCharts() {
  if (liveChartInstance)  { liveChartInstance.destroy();  liveChartInstance = null; }
  if (resultBarInstance)  { resultBarInstance.destroy();  resultBarInstance = null; }
  if (resultDonutInstance){ resultDonutInstance.destroy(); resultDonutInstance = null; }
}

// ===== STATUS BADGE =====
function updateStatusBadge(status) {
  const badge = document.getElementById('statusBadge');
  const map = {
    0: { cls: 'badge-not-initialized', html: '준비 중' },
    1: { cls: 'badge-pending',         html: '대기 중' },
    2: { cls: 'badge-active',          html: '<span class="live-dot"></span>진행 중' },
    3: { cls: 'badge-ended',           html: '종료' },
  };
  const info = map[status] || map[0];
  badge.className = 'badge ' + info.cls;
  badge.innerHTML = info.html;
}

// ===== RENDER ROUTER =====
async function renderByStatus(status) {
  if (status === 0)      renderNotInitialized();
  else if (status === 1) await renderPending();
  else if (status === 2) await renderActive();
  else if (status === 3) await renderEnded();
}

// ===== SCR: NOT_INITIALIZED =====
function renderNotInitialized() {
  const adminBtn = isOwner
    ? '<p style="margin-top:20px;"><a href="admin.html" class="btn-primary" style="text-decoration:none;display:inline-block;">관리자 대시보드로 이동</a></p>'
    : '';
  document.getElementById('statusContent').innerHTML = `
    <div class="card">
      <div class="preparing-card">
        <div class="icon">🗳</div>
        <h2>관리자가 투표를 준비 중입니다.</h2>
        <p>잠시 후 다시 확인해주세요.</p>
        ${adminBtn}
      </div>
    </div>`;
}

// ===== SCR-005: PENDING =====
async function renderPending() {
  const [st, et] = await contract.getElectionPeriod();
  const startMs = Number(st) * 1000;

  document.getElementById('statusContent').innerHTML = `
    <div class="card">
      <div class="countdown-section">
        <p class="countdown-title">⏳ 투표 시작까지</p>
        <div class="countdown-boxes">
          <div class="countdown-box"><span class="count" id="cdDays">00</span><span class="label">일</span></div>
          <div class="countdown-box"><span class="count" id="cdHours">00</span><span class="label">시간</span></div>
          <div class="countdown-box"><span class="count" id="cdMinutes">00</span><span class="label">분</span></div>
          <div class="countdown-box"><span class="count" id="cdSeconds">00</span><span class="label">초</span></div>
        </div>
        <p class="election-period-text">투표 기간: ${formatTimestamp(Number(st))} ~ ${formatTimestamp(Number(et))}</p>
      </div>
    </div>
    <div class="card">
      <h2>후보자 소개 <small style="font-size:0.8rem;color:#9ca3af;font-weight:normal;">(득표수는 투표 시작 후 공개)</small></h2>
      <div class="candidates-grid" id="pendingCandidatesGrid"></div>
    </div>`;

  renderCandidateCards('pendingCandidatesGrid');
  startCountdown(startMs);
}

// ===== SCR-006: ACTIVE (LIVE CHART) =====
async function renderActive() {
  const [, et] = await contract.getElectionPeriod();
  const endMs = Number(et) * 1000;

  let alreadyVoted = false;
  let voterChoiceId = 0;
  if (currentAccount) {
    try {
      alreadyVoted = await contract.hasVotedAddress(currentAccount);
      if (alreadyVoted) voterChoiceId = Number(await contract.getVoterChoice(currentAccount));
    } catch (e) { /* silent */ }
  }

  const votedCandidate = candidates.find(c => c.onChainId === voterChoiceId);
  const votedBanner = (alreadyVoted && votedCandidate)
    ? `<div class="voted-banner"><span class="icon">✅</span><span class="text">${escHtml(votedCandidate.name)}에게 투표하셨습니다.</span></div>`
    : '';

  const chartH = Math.max(200, candidates.length * 72);

  document.getElementById('statusContent').innerHTML = `
    <div class="card">
      <div class="live-header">
        <div class="live-badge"><span class="live-dot"></span>&nbsp;🔴 LIVE&nbsp; 실시간 득표 현황</div>
        <span class="time-remaining" id="activeTimeRemaining"></span>
      </div>
      ${votedBanner}
      <div class="live-chart-wrapper" style="height:${chartH}px;">
        <canvas id="liveChart"></canvas>
      </div>
    </div>

    <div class="card ${alreadyVoted ? 'hidden' : ''}" id="votingSection">
      <p class="section-title">후보자를 선택하여 투표해 주세요</p>
      <div class="candidates-grid" id="candidateSelectGrid"></div>
      <div class="vote-btn-container">
        <button class="btn-danger btn-lg" id="voteBtn" onclick="showConfirmModal()" disabled>투표하기</button>
      </div>
    </div>

    ${alreadyVoted ? `
    <div class="card" style="text-align:center;padding:20px 24px;">
      <p style="color:#9ca3af;font-size:0.9rem;">투표 완료 — 최종 결과는 종료 후 확인할 수 있습니다.</p>
    </div>` : ''}`;

  if (!alreadyVoted) renderSelectableCandidates('candidateSelectGrid');

  await initLiveChart(voterChoiceId);
  updateActiveTimeRemaining(endMs);
  startActiveTimer(endMs);
}

// ===== LIVE CHART =====
async function initLiveChart(voterChoiceId) {
  const canvas = document.getElementById('liveChart');
  if (!canvas || !candidates.length) return;

  let counts = new Array(candidates.length).fill(0);
  try {
    const raw = await contract.getAllVoteCounts();
    counts = raw.map(Number);
  } catch (e) { /* use zeros */ }

  const labels = candidates.map(c =>
    c.name + (voterChoiceId && c.onChainId === voterChoiceId ? ' ✓' : ''));
  const colors = getCandidateColors(voterChoiceId);

  liveChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      layout: { padding: { right: 100 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.x;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
              return `${val}표 (${pct}%)`;
            }
          }
        },
        datalabels: {
          anchor: 'end',
          align: 'right',
          clamp: false,
          display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
          formatter: (value, ctx) => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
            return `${value}표 (${pct}%)`;
          },
          color: '#374151',
          font: { size: 11, weight: '600' },
        }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { stepSize: 1 } },
        y: { grid: { display: false } }
      }
    },
    plugins: [ChartDataLabels]
  });
}

async function refreshLiveChart() {
  if (!liveChartInstance) return;
  try {
    const raw = await contract.getAllVoteCounts();
    const counts = raw.map(Number);

    let voterChoiceId = 0;
    if (currentAccount) {
      try {
        const voted = await contract.hasVotedAddress(currentAccount);
        if (voted) voterChoiceId = Number(await contract.getVoterChoice(currentAccount));
      } catch (e) { /* silent */ }
    }

    liveChartInstance.data.datasets[0].data = counts;
    liveChartInstance.data.datasets[0].backgroundColor = getCandidateColors(voterChoiceId);
    liveChartInstance.data.labels = candidates.map(c =>
      c.name + (voterChoiceId && c.onChainId === voterChoiceId ? ' ✓' : ''));
    liveChartInstance.update('active');

    const total = counts.reduce((a, b) => a + b, 0);
    setEl('totalVotesDisplay', `총 투표수: ${total}표`);
  } catch (e) {
    console.error('Live chart refresh error:', e);
  }
}

function getCandidateColors(voterChoiceId) {
  return candidates.map((c, i) =>
    (voterChoiceId && c.onChainId === voterChoiceId)
      ? '#f59e0b'
      : CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]);
}

// ===== SCR-010: ENDED (FINAL RESULTS) =====
async function renderEnded() {
  let counts = [];
  let totalVotes = 0;
  let st = 0, et = 0;

  try {
    const raw = await contract.getAllVoteCounts();
    counts = raw.map(Number);
    totalVotes = counts.reduce((a, b) => a + b, 0);
    const period = await contract.getElectionPeriod();
    st = Number(period[0]);
    et = Number(period[1]);
  } catch (e) {
    showToast('결과를 불러오지 못했습니다.', 'error');
    counts = new Array(candidates.length).fill(0);
  }

  // Reload election title if needed
  try {
    const res = await fetch(`${CONFIG.BACKEND_URL}/api/election`);
    if (res.ok) {
      const data = await res.json();
      if (data.title) setEl('electionTitle', data.title);
    }
  } catch(e) { /* silent */ }

  const rankedData = calculateRanks(candidates, counts);
  const contractShort = CONFIG.CONTRACT_ADDRESS.slice(0, 6) + '...' + CONFIG.CONTRACT_ADDRESS.slice(-4);
  const barH = Math.max(220, rankedData.length * 72);

  let electionInfoHtml = '';
  if (st > 0) {
    electionInfoHtml = `<p class="result-subtitle">투표 기간: ${formatTimestamp(st)} ~ ${formatTimestamp(et)}</p>`;
  }

  document.getElementById('statusContent').innerHTML = `
    <div class="card">
      <div class="result-header">
        <h2 class="result-title">🏆 최종 투표 결과</h2>
        ${electionInfoHtml}
        <p class="result-total">총 투표수: <strong>${totalVotes}표</strong></p>
      </div>

      ${totalVotes === 0 ? `<div class="no-votes-msg">투표 참여자가 없습니다.</div>` : `
      <div class="result-bar-container" style="height:${barH}px;">
        <canvas id="resultBarChart"></canvas>
      </div>

      <div class="rank-donut-row">
        <div class="rank-cards-wrapper" id="rankCardsContainer"></div>
        <div class="result-donut-container">
          <canvas id="resultDonutChart"></canvas>
        </div>
      </div>
      `}

      <div class="result-footer">
        컨트랙트:&nbsp;
        <a href="https://sepolia.etherscan.io/address/${CONFIG.CONTRACT_ADDRESS}" target="_blank">
          ${contractShort} ↗ Etherscan
        </a>
      </div>
    </div>`;

  if (totalVotes > 0) {
    renderRankCards(rankedData, totalVotes);
    await initResultCharts(rankedData, totalVotes);
    // Trigger countup after charts are initialized
    setTimeout(() => {
      document.querySelectorAll('.count-up').forEach(el => {
        const target = parseInt(el.dataset.target || '0', 10);
        animateCountUp(el, target);
      });
    }, 200);
  }
}

function calculateRanks(cands, counts) {
  const data = cands.map((c, i) => ({
    onChainId: c.onChainId,
    name: c.name,
    imageUrl: c.imageUrl,
    count: counts[i] || 0,
    colorIndex: i,
  }));
  data.sort((a, b) => b.count - a.count);

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      data[i].rank = 1;
    } else if (data[i].count === data[i - 1].count) {
      data[i].rank = data[i - 1].rank;
    } else {
      data[i].rank = i + 1;
    }
  }
  return data;
}

function renderRankCards(rankedData, totalVotes) {
  const container = document.getElementById('rankCardsContainer');
  if (!container) return;

  // Group consecutive same-rank items
  const groups = [];
  rankedData.forEach(c => {
    const last = groups[groups.length - 1];
    if (last && last[0].rank === c.rank) last.push(c);
    else groups.push([c]);
  });

  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  container.innerHTML = groups.map(group => {
    const rank = group[0].rank;
    const isTie = group.length > 1;
    const isWinner = rank === 1;
    const medal = medals[rank] || rank + '위';
    const rankClass = rank <= 3 ? 'rank-' + rank : 'rank-other';
    const imgSize = rank === 1 ? 'rank-img-large' : 'rank-img-medium';

    return group.map(c => {
      const pct = totalVotes > 0 ? ((c.count / totalVotes) * 100).toFixed(1) : '0.0';
      const electedBadge = isWinner
        ? `<div class="rank-elected">${isTie ? '★ 공동 당선' : '★ 당선'}</div>`
        : '';
      return `
        <div class="rank-card ${rankClass}">
          <div class="rank-badge-label">${medal}</div>
          <img class="rank-img ${imgSize}" src="${escHtml(c.imageUrl || PLACEHOLDER)}" alt="${escHtml(c.name)}"
               onerror="this.src='${PLACEHOLDER}';this.onerror=null;">
          <div class="rank-info">
            <div class="rank-name">${escHtml(c.name)} ${isTie ? '<small>(공동)</small>' : ''}</div>
            <div class="rank-votes count-up" data-target="${c.count}">0표</div>
            <div class="rank-pct">(${pct}%)</div>
            ${electedBadge}
          </div>
        </div>`;
    }).join('');
  }).join('');
}

async function initResultCharts(rankedData, totalVotes) {
  // Bar chart uses rankedData sorted by votes (already sorted)
  const labels = rankedData.map(c => c.name);
  const data   = rankedData.map(c => c.count);
  const colors = rankedData.map(c => CANDIDATE_COLORS[c.colorIndex % CANDIDATE_COLORS.length]);
  const pcts   = rankedData.map(c =>
    totalVotes > 0 ? ((c.count / totalVotes) * 100).toFixed(1) : '0.0');

  // ── Bar chart ──
  const barCanvas = document.getElementById('resultBarChart');
  if (barCanvas) {
    resultBarInstance = new Chart(barCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 6 }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1000 },
        layout: { padding: { right: 110 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: 'end',
            align: 'right',
            clamp: false,
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
            formatter: (value, ctx) => `${value}표 (${pcts[ctx.dataIndex]}%)`,
            color: '#374151',
            font: { size: 12, weight: '600' },
          }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: '#f3f4f6' } },
          y: { grid: { display: false } }
        }
      },
      plugins: [ChartDataLabels]
    });
  }

  // ── Donut chart ──
  const donutCanvas = document.getElementById('resultDonutChart');
  if (donutCanvas) {
    resultDonutInstance = new Chart(donutCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#fff',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 16 } },
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
            formatter: (value, ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '';
            },
            color: 'white',
            font: { weight: 'bold', size: 12 },
          }
        }
      },
      plugins: [ChartDataLabels]
    });
  }
}

// ===== COUNTUP ANIMATION =====
function animateCountUp(el, target, duration) {
  duration = duration || 1500;
  if (target === 0) { el.textContent = '0표'; return; }
  const start = performance.now();
  function step(ts) {
    const elapsed = ts - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.floor(eased * target).toLocaleString() + '표';
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = target.toLocaleString() + '표';
  }
  requestAnimationFrame(step);
}

// ===== CANDIDATE RENDERING =====
function renderCandidateCards(containerId) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  if (!candidates.length) {
    grid.innerHTML = '<p style="color:#9ca3af;font-size:0.9rem;">등록된 후보자가 없습니다.</p>';
    return;
  }
  grid.innerHTML = candidates.map(c => `
    <div class="candidate-card">
      <div class="candidate-number">기호 ${c.onChainId}번</div>
      <img class="candidate-img" src="${escHtml(c.imageUrl || PLACEHOLDER)}" alt="${escHtml(c.name)}"
           onerror="this.src='${PLACEHOLDER}';this.onerror=null;">
      <div class="candidate-name">${escHtml(c.name)}</div>
    </div>`).join('');
}

function renderSelectableCandidates(containerId) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  if (!candidates.length) {
    grid.innerHTML = '<p style="color:#9ca3af;font-size:0.9rem;">등록된 후보자가 없습니다.</p>';
    return;
  }
  grid.innerHTML = candidates.map(c => `
    <div class="candidate-card clickable" id="ccard-${c.onChainId}"
         onclick="selectCandidate(${c.onChainId})">
      <div class="candidate-number">기호 ${c.onChainId}번</div>
      <img class="candidate-img" src="${escHtml(c.imageUrl || PLACEHOLDER)}" alt="${escHtml(c.name)}"
           onerror="this.src='${PLACEHOLDER}';this.onerror=null;">
      <div class="candidate-name">${escHtml(c.name)}</div>
    </div>`).join('');
}

// ===== SELECTION =====
function selectCandidate(id) {
  selectedCandidateId = id;
  document.querySelectorAll('.candidate-card.clickable').forEach(card => {
    card.classList.remove('selected');
    const icon = card.querySelector('.candidate-selected-icon');
    if (icon) icon.remove();
  });
  const selected = document.getElementById('ccard-' + id);
  if (selected) {
    selected.classList.add('selected');
    selected.insertAdjacentHTML('beforeend', '<div class="candidate-selected-icon">◉ 선택됨</div>');
  }
  const voteBtn = document.getElementById('voteBtn');
  if (voteBtn) voteBtn.disabled = false;
}

// ===== CONFIRM MODAL (SCR-007) =====
function showConfirmModal() {
  if (!selectedCandidateId) {
    showToast('투표할 후보자를 선택해주세요.', 'warning');
    return;
  }
  if (!currentAccount) {
    connectWallet();
    return;
  }
  const candidate = candidates.find(c => c.onChainId === selectedCandidateId);
  if (!candidate) return;

  const img = document.getElementById('confirmCandidateImg');
  img.src = candidate.imageUrl || PLACEHOLDER;
  img.setAttribute('onerror', `this.src='${PLACEHOLDER}';this.onerror=null;`);
  img.style.display = 'block';
  document.getElementById('confirmCandidateName').textContent = candidate.name;
  confirmedCandidateId = selectedCandidateId;
  showModal('modalConfirm');
}

// ===== VOTE SUBMISSION (SCR-008) =====
async function submitVote() {
  hideModal('modalConfirm');
  resetTxModal();
  showModal('modalTx');
  setTxStep(1, 'active');

  try {
    const sc = await getSignerContract();
    const tx = await sc.vote(confirmedCandidateId);

    setTxStep(1, 'done');
    setTxStep(2, 'active');
    updateTxHash(tx.hash);

    const receipt = await tx.wait();
    setTxStep(2, 'done');
    setTxStep(3, 'done');

    hideModal('modalTx');
    const candidate = candidates.find(c => c.onChainId === confirmedCandidateId);
    selectedCandidateId = null;
    showVoteComplete(receipt, candidate);
  } catch (err) {
    handleVoteError(err);
  }
}

function setTxStep(step, state) {
  const el = document.getElementById('txStep' + step);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state === 'active' || state === 'done') el.classList.add(state);
  const icon = el.querySelector('.tx-step-icon');
  if (state === 'active') icon.textContent = '⟳';
  else if (state === 'done') icon.textContent = '✅';
  else icon.textContent = '○';
}

function updateTxHash(hash) {
  pendingTxHash = hash;
  document.getElementById('txHashRow').classList.remove('hidden');
  document.getElementById('txHashDisplay').textContent = hash.slice(0, 10) + '...' + hash.slice(-8);
  document.getElementById('txEtherscanLink').href = 'https://sepolia.etherscan.io/tx/' + hash;
}

// ===== ERROR HANDLING (9 cases) =====
function handleVoteError(err) {
  document.getElementById('txSpinner').style.display = 'none';
  const errEl = document.getElementById('txError');
  errEl.classList.remove('hidden');
  document.getElementById('txRetryContainer').classList.remove('hidden');

  const msg = err.message || '';
  const reason = err.reason || '';

  if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
    // Case 5: 트랜잭션 거부
    errEl.textContent = 'MetaMask에서 트랜잭션을 거부했습니다.';
  } else if (msg.includes('Already voted') || reason.includes('Already voted')) {
    // Case 3: 이미 투표 완료
    errEl.textContent = '이 지갑 주소로 이미 투표하셨습니다.';
  } else if (msg.includes('Election is not active') || reason.includes('Election is not active')) {
    // Case 4: 투표 기간 아님
    errEl.textContent = '현재 투표 기간이 아닙니다.';
  } else if (msg.includes('insufficient funds') || msg.includes('INSUFFICIENT_FUNDS')) {
    // Case 6: Sepolia ETH 부족
    errEl.textContent = 'Sepolia ETH가 부족합니다. 파우셋에서 충전 후 시도해주세요.';
  } else if (msg.includes('Invalid candidate') || reason.includes('Invalid candidate')) {
    errEl.textContent = '유효하지 않은 후보자입니다.';
  } else if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
    // Case 8: 네트워크 오류
    errEl.textContent = '네트워크 연결을 확인해주세요.';
  } else if (reason) {
    // Case 9: 컨트랙트 revert → 파싱
    errEl.textContent = '컨트랙트 오류: ' + reason;
  } else {
    errEl.textContent = '오류: ' + (msg || '알 수 없는 오류가 발생했습니다.');
  }
}

function resetTxModal() {
  [1, 2, 3].forEach(i => setTxStep(i, 'pending'));
  document.getElementById('txError').classList.add('hidden');
  document.getElementById('txRetryContainer').classList.add('hidden');
  document.getElementById('txSpinner').style.display = '';
  document.getElementById('txHashRow').classList.add('hidden');
}

function closeTxAndReset() {
  hideModal('modalTx');
  resetTxModal();
}

function copyTxHash() {
  if (!pendingTxHash) return;
  navigator.clipboard.writeText(pendingTxHash)
    .then(() => showToast('복사되었습니다.', 'success'))
    .catch(() => showToast('복사에 실패했습니다.', 'error'));
}

// ===== VOTE COMPLETE (SCR-009) =====
function showVoteComplete(receipt, candidate) {
  // Reset rendered status so next refreshStatus() does full re-render
  currentRenderedStatus = -1;
  liveChartInstance = null;

  const txHash = receipt.hash || '';
  const blockNum = receipt.blockNumber || '';
  document.getElementById('statusContent').innerHTML = `
    <div class="card">
      <div class="vote-complete">
        <div class="checkmark-circle">✓</div>
        <h2>✅ 투표 완료</h2>
        <p style="color:#6b7280;margin-bottom:20px;">투표가 성공적으로 완료되었습니다.</p>
        <div style="background:#f8fafc;border-radius:10px;padding:14px 24px;display:inline-block;text-align:left;min-width:260px;margin-bottom:12px;">
          <div class="detail">선택 후보자: <strong>${escHtml(candidate ? candidate.name : '')}</strong></div>
          <div class="detail">블록 번호: <strong>#${Number(blockNum).toLocaleString()}</strong></div>
        </div>
        <br>
        <a class="etherscan-link" href="https://sepolia.etherscan.io/tx/${txHash}" target="_blank">
          트랜잭션 상세 보기 ↗
        </a>
        <div style="margin-top:24px;">
          <button class="btn-primary btn-lg" onclick="refreshStatus()">실시간 득표 현황 보기</button>
        </div>
        <p style="color:#9ca3af;font-size:0.85rem;margin-top:16px;">최종 결과는 투표 종료 후 확인할 수 있습니다.</p>
      </div>
    </div>`;
}

// ===== COUNTDOWN =====
function startCountdown(targetMs) {
  clearCountdown();
  tick();
  countdownInterval = setInterval(tick, 1000);

  function tick() {
    const diff = targetMs - Date.now();
    if (diff <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      refreshStatus();
      return;
    }
    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000) / 60000);
    const secs  = Math.floor((diff % 60000) / 1000);
    setEl('cdDays', pad(days));
    setEl('cdHours', pad(hours));
    setEl('cdMinutes', pad(mins));
    setEl('cdSeconds', pad(secs));
  }
}

function startActiveTimer(endMs) {
  clearCountdown();
  updateActiveTimeRemaining(endMs);
  countdownInterval = setInterval(() => {
    if (Date.now() >= endMs) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      refreshStatus();
      return;
    }
    updateActiveTimeRemaining(endMs);
  }, 1000);
}

function updateActiveTimeRemaining(endMs) {
  const el = document.getElementById('activeTimeRemaining');
  if (!el) return;
  const diff = endMs - Date.now();
  if (diff <= 0) { el.textContent = '종료됨'; return; }
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  const secs  = Math.floor((diff % 60000) / 1000);
  el.textContent = `종료까지: ${days > 0 ? days + '일 ' : ''}${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function clearCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

// ===== UTILS =====
function formatTimestamp(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function pad(n) { return String(n).padStart(2, '0'); }
function setEl(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateEtherscanLink() {
  const addr = CONFIG.CONTRACT_ADDRESS;
  const link = document.getElementById('etherscanLink');
  if (link) {
    link.textContent = addr.slice(0, 6) + '...' + addr.slice(-4);
    link.href = 'https://sepolia.etherscan.io/address/' + addr;
  }
}

// ===== MODAL =====
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

// ===== TOAST =====
function showToast(message, type) {
  type = type || 'info';
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.innerHTML =
    '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span>' +
    '<span class="toast-message">' + message + '</span>' +
    '<button class="toast-close" onclick="removeToast(this.parentElement)">×</button>';
  container.appendChild(toast);
  setTimeout(() => removeToast(toast), 3000);
}

function removeToast(toast) {
  if (!toast || !toast.parentElement) return;
  toast.classList.add('removing');
  setTimeout(() => { if (toast.parentElement) toast.parentElement.removeChild(toast); }, 300);
}
