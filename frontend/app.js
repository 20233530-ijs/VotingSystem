// ===== STATE =====
let contract = null;
let currentAccount = null;
let isOwner = false;
let voteStatus = -1;
let candidates = [];
let pollInterval = null;
let countdownInterval = null;
let selectedCandidateId = null;
let confirmedCandidateId = null;
let pendingTxHash = null;

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

async function getSignerContract() {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, signer);
}

// ===== METAMASK CONNECTION =====
async function connectWallet() {
  if (currentAccount) return; // already connected

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
      await updateWalletUI();
      await refreshStatus();
    } else {
      currentAccount = accounts[0].toLowerCase();
      const ok = await checkNetwork();
      if (!ok) return;
      await updateWalletUI();
      await refreshStatus();
    }
  });
  window.ethereum.on('chainChanged', () => { window.location.reload(); });
}

async function updateWalletUI() {
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

// ===== DATA =====
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
  } catch (e) {
    showToast('후보자 정보를 불러오지 못했습니다. 새로고침해주세요.', 'error');
    candidates = [];
  }
}

// ===== POLLING =====
async function refreshStatus() {
  try {
    const status = Number(await contract.getVoteStatus());
    voteStatus = status;
    updateStatusBadge(status);

    if (status >= 1) {
      const [st, et] = await contract.getElectionPeriod();
      document.getElementById('startTimeDisplay').textContent = formatTimestamp(Number(st));
      document.getElementById('endTimeDisplay').textContent = formatTimestamp(Number(et));
      document.getElementById('electionInfo').classList.remove('hidden');
    }

    if (status === 2 || status === 3) {
      try {
        const total = Number(await contract.getTotalVotes());
        document.getElementById('totalVotesDisplay').textContent = `총 투표수: ${total}표`;
      } catch (e) { /* silent */ }
    } else {
      document.getElementById('totalVotesDisplay').textContent = '';
    }

    await renderByStatus(status);
  } catch (e) {
    console.error('Status refresh error:', e);
  }
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(refreshStatus, 30000);
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
  clearCountdown();
  if (status === 0) renderNotInitialized();
  else if (status === 1) await renderPending();
  else if (status === 2) await renderActive();
  else if (status === 3) await renderEnded();
}

// ===== SCR states =====
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
    ? `<div class="voted-banner"><span class="icon">✅</span><span class="text">${votedCandidate.name}에게 투표하셨습니다.</span></div>`
    : '';

  document.getElementById('statusContent').innerHTML = `
    <div class="card">
      <div class="live-header">
        <div class="live-badge"><span class="live-dot"></span>&nbsp;🔴 LIVE&nbsp; 실시간 득표 현황</div>
        <span class="time-remaining" id="activeTimeRemaining"></span>
      </div>
      ${votedBanner}
      <div id="liveChartArea" style="background:#f8fafc;border-radius:10px;padding:40px 20px;text-align:center;color:#9ca3af;margin-bottom:4px;">
        📊 실시간 득표 차트 (Phase 3 구현)
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

  updateActiveTimeRemaining(endMs);
  startActiveTimer(endMs);
}

async function renderEnded() {
  document.getElementById('statusContent').innerHTML = `
    <div class="card">
      <h2 style="text-align:center;border:none;font-size:1.3rem;">🏆 최종 투표 결과</h2>
      <div id="endedBarChartArea" style="background:#f8fafc;border-radius:10px;padding:40px 20px;text-align:center;color:#9ca3af;margin:16px 0;">
        📊 최종 결과 차트 (Phase 3 구현)
      </div>
      <div class="candidates-grid" id="endedCandidateGrid"></div>
    </div>`;

  await renderFinalResults();
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
      <img class="candidate-img" src="${escHtml(c.imageUrl || '')}" alt="${escHtml(c.name)}">
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
      <img class="candidate-img" src="${escHtml(c.imageUrl || '')}" alt="${escHtml(c.name)}">
      <div class="candidate-name">${escHtml(c.name)}</div>
    </div>`).join('');
}

async function renderFinalResults() {
  const grid = document.getElementById('endedCandidateGrid');
  if (!grid) return;
  if (!candidates.length) { grid.innerHTML = '<p style="color:#9ca3af;text-align:center;">후보자 정보가 없습니다.</p>'; return; }
  try {
    const counts = await contract.getAllVoteCounts();
    const totalVotes = counts.reduce((s, c) => s + Number(c), 0);
    grid.innerHTML = candidates.map((c, i) => {
      const count = Number(counts[i] || 0);
      const pct = totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(1) : '0.0';
      return `
        <div class="candidate-card">
          <div class="candidate-number">기호 ${c.onChainId}번</div>
          <img class="candidate-img" src="${escHtml(c.imageUrl || '')}" alt="${escHtml(c.name)}">
          <div class="candidate-name">${escHtml(c.name)}</div>
          <div class="candidate-vote-count">${count}표 (${pct}%)</div>
        </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<p style="color:#9ca3af;text-align:center;">득표수를 불러올 수 없습니다.</p>';
  }
}

// ===== CANDIDATE SELECTION =====
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
  img.src = candidate.imageUrl || '';
  img.style.display = candidate.imageUrl ? 'block' : 'none';
  document.getElementById('confirmCandidateName').textContent = candidate.name;
  confirmedCandidateId = selectedCandidateId;
  showModal('modalConfirm');
}

// ===== VOTE SUBMISSION (SCR-008 → SCR-009) =====
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
    showVoteComplete(receipt, candidate);
    selectedCandidateId = null;
    await loadElectionData();
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
  const row = document.getElementById('txHashRow');
  row.classList.remove('hidden');
  document.getElementById('txHashDisplay').textContent = hash.slice(0, 10) + '...' + hash.slice(-8);
  document.getElementById('txEtherscanLink').href = 'https://sepolia.etherscan.io/tx/' + hash;
}

function handleVoteError(err) {
  document.getElementById('txSpinner').style.display = 'none';
  const errEl = document.getElementById('txError');
  errEl.classList.remove('hidden');
  document.getElementById('txRetryContainer').classList.remove('hidden');

  if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
    errEl.textContent = 'MetaMask에서 트랜잭션을 거부했습니다.';
  } else if (err.message && err.message.includes('Already voted')) {
    errEl.textContent = '이 지갑 주소로 이미 투표하셨습니다.';
  } else if (err.message && err.message.includes('insufficient funds')) {
    errEl.textContent = 'Sepolia ETH가 부족합니다. 파우셋에서 충전 후 시도해주세요.';
  } else if (err.message && err.message.includes('Election is not active')) {
    errEl.textContent = '현재 투표 기간이 아닙니다.';
  } else {
    errEl.textContent = '오류: ' + (err.reason || err.message || '알 수 없는 오류가 발생했습니다.');
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
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' +
         d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function pad(n) { return String(n).padStart(2, '0'); }
function setEl(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
