// ===== STATE =====
let adminAccount = null;
let adminApiKey = null;
let adminSigner = null;
let adminContract = null;
let adminCandidates = [];
let isAuthVerified = false;

// ===== INIT =====
window.addEventListener('DOMContentLoaded', async () => {
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', async (accounts) => {
      if (!accounts || accounts.length === 0) {
        adminAccount = null;
        showOwnerWarning();
      } else {
        await connectAdminWallet(true);
      }
    });
    window.ethereum.on('chainChanged', () => window.location.reload());

    // Auto-connect if already authorized
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        await connectAdminWallet(true);
        return;
      }
    } catch (e) { /* silent */ }
  }
  showOwnerWarning();
});

// ===== WALLET =====
async function connectAdminWallet(silent) {
  silent = !!silent;
  if (!window.ethereum) {
    showToast('MetaMask를 먼저 설치해주세요.', 'error');
    showOwnerWarning();
    return;
  }
  try {
    let accounts;
    if (silent) {
      accounts = await window.ethereum.request({ method: 'eth_accounts' });
    } else {
      accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    }
    if (!accounts || accounts.length === 0) { showOwnerWarning(); return; }

    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId !== '0xaa36a7') {
      if (!silent) showToast('Sepolia 테스트넷으로 변경해주세요.', 'warning');
      showOwnerWarning();
      return;
    }

    const rpc = new ethers.JsonRpcProvider(CONFIG.SEPOLIA_RPC);
    const readContract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, rpc);
    const ownerAddr = await readContract.owner();
    const connectedAddr = accounts[0].toLowerCase();

    if (ownerAddr.toLowerCase() !== connectedAddr) {
      if (!silent) showToast('이 지갑은 Owner가 아닙니다.', 'error');
      showOwnerWarning();
      return;
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    adminSigner = await provider.getSigner();
    adminAccount = connectedAddr;
    adminContract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, adminSigner);

    document.getElementById('ownerAddressDisplay').textContent =
      adminAccount.slice(0, 6) + '...' + adminAccount.slice(-4);
    document.getElementById('notOwnerWarning').classList.add('hidden');
    document.getElementById('adminContent').classList.remove('hidden');

    await loadAdminCandidates();
    await checkElectionEditable();
  } catch (err) {
    if (!silent) showToast('지갑 연결 중 오류가 발생했습니다.', 'error');
    showOwnerWarning();
  }
}

function showOwnerWarning() {
  document.getElementById('notOwnerWarning').classList.remove('hidden');
  document.getElementById('adminContent').classList.add('hidden');
  document.getElementById('ownerAddressDisplay').textContent = '';
}

async function checkElectionEditable() {
  try {
    const rpc = new ethers.JsonRpcProvider(CONFIG.SEPOLIA_RPC);
    const c = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, rpc);
    const status = Number(await c.getVoteStatus());
    if (status >= 2) {
      document.getElementById('saveElectionBtn').disabled = true;
      document.getElementById('addCandidateBtn').disabled = true;
      showToast('투표가 이미 시작되었습니다. 후보자와 기간은 변경할 수 없습니다.', 'warning');
    }
  } catch (e) { /* silent */ }
}

// ===== API KEY =====
async function verifyApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key) { showAuthStatus('API Key를 입력해주세요.', false); return; }

  try {
    // Send empty title → 401 if key wrong, 400 if key OK (title validation fails)
    const res = await fetch(`${CONFIG.BACKEND_URL}/api/admin/election`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
      body: JSON.stringify({ title: '' }),
    });
    if (res.status === 401) {
      adminApiKey = null;
      isAuthVerified = false;
      showAuthStatus('❌ 키가 올바르지 않습니다. 서버 .env를 확인해주세요.', false);
    } else {
      adminApiKey = key;
      isAuthVerified = true;
      showAuthStatus('✅ 인증되었습니다.', true);
    }
  } catch (e) {
    showToast('서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해주세요.', 'error');
  }
}

function showAuthStatus(msg, ok) {
  const el = document.getElementById('authStatus');
  el.textContent = msg;
  el.className = 'auth-status ' + (ok ? 'success' : 'error');
}

// ===== CANDIDATES =====
async function loadAdminCandidates() {
  try {
    const res = await fetch(`${CONFIG.BACKEND_URL}/api/candidates`);
    if (!res.ok) throw new Error();
    adminCandidates = await res.json();
  } catch (e) {
    adminCandidates = [];
  }
  renderAdminCandidates();
}

function renderAdminCandidates() {
  const count = adminCandidates.length;
  const badge = document.getElementById('candidatesCountBadge');
  const hint  = document.getElementById('minCandidatesHint');
  const elHint = document.getElementById('candidateCountForElection');

  badge.textContent = count + '명';
  badge.className = 'candidates-count-badge ' + (count >= 2 ? 'ok' : 'warn');

  hint.className = 'min-candidates-hint ' + (count >= 2 ? 'ok' : 'warn');
  hint.textContent = count >= 2
    ? '✅ 후보자 ' + count + '명 등록됨 — 투표 기간 설정 가능'
    : 'ℹ 후보자를 최소 2명 이상 등록해야 투표 기간을 설정할 수 있습니다.';

  if (elHint) {
    elHint.className = 'min-candidates-hint ' + (count >= 2 ? 'ok' : 'warn');
    elHint.textContent = count >= 2
      ? '✅ 후보자 ' + count + '명 등록 완료 — 아래에서 투표 기간을 설정할 수 있습니다.'
      : '⚠ 후보자를 최소 2명 등록한 뒤 투표 기간을 설정하세요. (현재 ' + count + '명)';
  }

  const list = document.getElementById('candidatesList');
  if (!count) {
    list.innerHTML = '<p style="color:#9ca3af;font-size:0.9rem;padding:8px 0;">등록된 후보자가 없습니다.</p>';
    return;
  }
  list.innerHTML = adminCandidates.map(c => `
    <div class="candidate-item">
      <img src="${escHtml(c.imageUrl || '')}" alt="${escHtml(c.name)}"
           onerror="this.style.display='none';this.onerror=null;">
      <div class="candidate-item-info">
        <div class="candidate-item-name">${escHtml(c.name)}</div>
        <div class="candidate-item-id">온체인 ID: ${c.onChainId}</div>
      </div>
    </div>`).join('');
}

async function addCandidate() {
  const name     = document.getElementById('candidateName').value.trim();
  const imageUrl = document.getElementById('candidateImageUrl').value.trim();
  const msgEl    = document.getElementById('candidateAddMessage');
  msgEl.textContent = '';

  if (!name) { showToast('후보자 이름을 입력해주세요.', 'warning'); return; }
  if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    showToast('올바른 이미지 URL(http/https)을 입력해주세요.', 'warning');
    return;
  }
  if (!isAuthVerified || !adminApiKey) {
    showToast('먼저 API Key를 인증해주세요.', 'warning');
    return;
  }
  if (!adminContract) {
    showToast('MetaMask를 연결해주세요.', 'warning');
    return;
  }

  showAdminTx('후보자 추가 처리 중');
  setAdminTxStep(1, 'active');

  try {
    const tx = await adminContract.addCandidate();
    setAdminTxStep(1, 'done');
    setAdminTxStep(2, 'active');
    updateAdminTxHash(tx.hash);

    const receipt = await tx.wait();
    setAdminTxStep(2, 'done');
    setAdminTxStep(3, 'active');

    // Parse CandidateAdded event from receipt logs
    const iface = adminContract.interface;
    let onChainId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'CandidateAdded') {
          onChainId = Number(parsed.args.candidateId);
          break;
        }
      } catch (e) { /* skip unparseable logs */ }
    }
    if (onChainId === null) throw new Error('이벤트 로그에서 candidateId를 읽을 수 없습니다.');

    // Save metadata to backend
    const backendRes = await fetch(`${CONFIG.BACKEND_URL}/api/admin/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminApiKey },
      body: JSON.stringify({ onChainId, name, imageUrl }),
    });
    if (!backendRes.ok) throw new Error('서버 저장 실패 (status: ' + backendRes.status + ')');

    setAdminTxStep(3, 'done');
    hideModal('adminModalTx');
    showToast('"' + name + '" 후보자가 등록되었습니다. (온체인 ID: ' + onChainId + ')', 'success');
    document.getElementById('candidateName').value = '';
    document.getElementById('candidateImageUrl').value = '';
    document.getElementById('imagePreview').style.display = 'none';
    await loadAdminCandidates();
  } catch (err) {
    showAdminTxError(err);
  }
}

// ===== ELECTION SETUP =====
async function saveElection() {
  const title    = document.getElementById('electionTitle').value.trim();
  const startVal = document.getElementById('startTime').value;
  const endVal   = document.getElementById('endTime').value;
  const msgEl    = document.getElementById('electionSetMessage');
  msgEl.textContent = '';

  if (!title) { showToast('투표 제목을 입력해주세요.', 'warning'); return; }
  if (!startVal || !endVal) { showToast('시작·종료 일시를 모두 입력해주세요.', 'warning'); return; }
  if (!isAuthVerified || !adminApiKey) { showToast('먼저 API Key를 인증해주세요.', 'warning'); return; }
  if (adminCandidates.length < 2) {
    showToast('후보자를 최소 2명 이상 등록한 뒤 투표 기간을 설정해주세요.', 'warning');
    return;
  }

  const nowTs   = Math.floor(Date.now() / 1000);
  const startTs = Math.floor(new Date(startVal).getTime() / 1000);
  const endTs   = Math.floor(new Date(endVal).getTime() / 1000);

  if (endTs <= startTs) { showToast('종료 시간은 시작 시간 이후여야 합니다.', 'warning'); return; }
  if (startTs <= nowTs) { showToast('시작 시간은 현재 시간 이후여야 합니다.', 'warning'); return; }

  showAdminTx('투표 설정 저장 중');
  setAdminTxStep(1, 'active');

  try {
    // PRD: server save BEFORE contract call
    const titleRes = await fetch(`${CONFIG.BACKEND_URL}/api/admin/election`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminApiKey },
      body: JSON.stringify({ title }),
    });
    if (!titleRes.ok) throw new Error('제목 서버 저장 실패');

    const tx = await adminContract.setElection(startTs, endTs);
    setAdminTxStep(1, 'done');
    setAdminTxStep(2, 'active');
    updateAdminTxHash(tx.hash);

    await tx.wait();
    setAdminTxStep(2, 'done');
    setAdminTxStep(3, 'done');

    hideModal('adminModalTx');
    showToast('투표 설정이 완료되었습니다.', 'success');
    msgEl.innerHTML = '<span style="color:#16a34a;font-weight:600;">✅ 투표 설정 완료. 투표가 시작 일시에 자동으로 활성화됩니다.</span>';
  } catch (err) {
    showAdminTxError(err);
  }
}

// ===== ADMIN TX MODAL =====
function showAdminTx(title) {
  document.getElementById('adminTxTitle').textContent = title;
  [1, 2, 3].forEach(i => setAdminTxStep(i, 'pending'));
  document.getElementById('adminTxError').classList.add('hidden');
  document.getElementById('adminTxRetry').classList.add('hidden');
  document.getElementById('adminTxHashRow').classList.add('hidden');
  document.getElementById('adminTxSpinner').style.display = '';
  showModal('adminModalTx');
}

function setAdminTxStep(step, state) {
  const el = document.getElementById('adminTxStep' + step);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state === 'active' || state === 'done') el.classList.add(state);
  const icon = el.querySelector('.tx-step-icon');
  if (state === 'active') icon.textContent = '⟳';
  else if (state === 'done') icon.textContent = '✅';
  else icon.textContent = '○';
}

function updateAdminTxHash(hash) {
  document.getElementById('adminTxHashRow').classList.remove('hidden');
  document.getElementById('adminTxHashDisplay').textContent = hash.slice(0, 10) + '...' + hash.slice(-8);
  document.getElementById('adminTxEtherscanLink').href = 'https://sepolia.etherscan.io/tx/' + hash;
}

function showAdminTxError(err) {
  document.getElementById('adminTxSpinner').style.display = 'none';
  const errEl = document.getElementById('adminTxError');
  errEl.classList.remove('hidden');
  document.getElementById('adminTxRetry').classList.remove('hidden');

  if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
    errEl.textContent = 'MetaMask에서 트랜잭션을 거부했습니다.';
  } else if (err.message && err.message.includes('Election already started')) {
    errEl.textContent = '투표가 이미 시작되어 변경할 수 없습니다.';
  } else if (err.message && err.message.includes('Need at least 2 candidates')) {
    errEl.textContent = '후보자를 최소 2명 이상 등록해야 합니다.';
  } else if (err.message && err.message.includes('Invalid time range')) {
    errEl.textContent = '종료 시간은 시작 시간 이후여야 합니다.';
  } else if (err.message && err.message.includes('서버 저장 실패') || err.message && err.message.includes('제목 서버 저장')) {
    errEl.textContent = err.message;
  } else {
    errEl.textContent = '오류: ' + (err.reason || err.message || '알 수 없는 오류');
  }
}

// ===== IMAGE PREVIEW =====
function previewImage() {
  const url = document.getElementById('candidateImageUrl').value.trim();
  const preview = document.getElementById('imagePreview');
  if (url.startsWith('http://') || url.startsWith('https://')) {
    preview.src = url;
    preview.style.display = 'block';
    preview.onerror = () => { preview.style.display = 'none'; preview.onerror = null; };
  } else {
    preview.style.display = 'none';
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
    '<button class="toast-close" onclick="this.parentElement.remove()">×</button>';
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 3000);
}

// ===== UTIL =====
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
