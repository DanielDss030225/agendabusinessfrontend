/* ============================================================
   AgBizu v2 – Pure HTML/JS/CSS – app.js
   Firebase Realtime Database (Namespace/Legacy Mode - file://)
   ============================================================ */
'use strict';

// ======================== FIREBASE SETUP ========================
const firebaseConfig = {
  apiKey: "AIzaSyASa8uMK4O1U_bQC5Ykl-OflJttFSJFNnM",
  authDomain: "orange-proof.firebaseapp.com",
  databaseURL: "https://orange-proof-default-rtdb.firebaseio.com",
  projectId: "orange-proof",
  storageBucket: "orange-proof.firebasestorage.app",
  messagingSenderId: "619099154724",
  appId: "1:619099154724:web:e61ff7ce22e29be929ebb1"
};

// Inicializa o Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

// ======================== BACKEND API SETUP ========================
const API_BASE = 'https://agendabusinessbackend.onrender.com/api';

async function apiFetch(path, options = {}) {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error('Not authenticated');

  const token = await user.getIdToken();
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP error! status: ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ======================== STATE ========================
const S = {
  currentUser: null,
  userScale: null,
  events: [],
  transactions: [],
  soundsEnabled: true,
  currentDate: new Date(),
  selectedDate: null,
  viewMode: 'month',
  customSeq: [],
  editingEventId: null,
  forceScale: false,
  lastRenderedYear: null,
  lastModalClose: 0,
  financeType: 'income',
  editingTransactionId: null,
  editingOccurrenceDate: null,
  showGlobalFinance: localStorage.getItem('agbizu_show_global_finance') !== 'false',
  sessionStartTime: Date.now(),
  company: {},
  profFilter: localStorage.getItem('agbizu_prof_filter') || '',
  authType: 'admin', // or 'seller'
  isSellerMode: false,
  currentProfessionalId: null
};

// Conflict Prevention Utility
S.checkConflicts = function(profId, date, startTime, durationMin, excludeId = null) {
  if (!profId) return false; // If no prof, no conflict check possible or needed here
  
  const newStart = new Date(`${date}T${startTime}:00`);
  const newEnd = new Date(newStart.getTime() + (durationMin * 60000));

  // Check Events (Tarefas)
  for (const ev of S.events) {
    if (ev.id === excludeId) continue;
    if (ev.professionalId !== profId) continue;
    if (ev.date !== date) continue;
    if (!ev.time) continue;

    const evStart = new Date(`${ev.date}T${ev.time}:00`);
    const evDur = parseInt(ev.duration) || 30; // Fallback to 30min
    const evEnd = new Date(evStart.getTime() + (evDur * 60000));

    // Overlap condition: (StartA < EndB) && (EndA > StartB)
    if (newStart < evEnd && newEnd > evStart) {
      return { type: 'Tarefa', title: ev.title, time: ev.time };
    }
  }

  // Check Transactions (Agendamentos)
  for (const tr of S.transactions) {
    if (tr.id === excludeId) continue;
    if (tr.professionalId !== profId) continue;
    if (tr.date !== date) continue;
    if (!tr.time) continue;

    const trStart = new Date(`${tr.date}T${tr.time}:00`);
    const trDur = parseInt(tr.duration) || 30;
    const trEnd = new Date(trStart.getTime() + (trDur * 60000));

    if (newStart < trEnd && newEnd > trStart) {
      return { type: 'Agendamento', title: tr.desc, time: tr.time };
    }
  }

  return null;
};

// ======================== STATS TRACKING ========================

// Convert YYYY-MM-DD to DD/MM/YYYY
function fmtDate(s) {
  if (!s || !s.includes('-')) return s || '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

// Convert DD/MM/YYYY to YYYY-MM-DD
function parseDate(s) {
  if (!s || !s.includes('/')) return s || '';
  const [d, m, y] = s.split('/');
  return `${y}-${m}-${d}`;
}

// Input mask helper
function applyMask(id, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    if (type === 'date') {
      if (v.length > 8) v = v.slice(0, 8);
      if (v.length > 4) v = v.replace(/^(\d{2})(\d{2})(\d{4}).*/, '$1/$2/$3');
      else if (v.length > 2) v = v.replace(/^(\d{2})(\d{2}).*/, '$1/$2');
    } else if (type === 'time') {
      if (v.length > 4) v = v.slice(0, 4);
      if (v.length > 2) v = v.replace(/^(\d{2})(\d{2}).*/, '$1:$2');
    }
    e.target.value = v;
    if (type === 'date' && id === 'evt-date') updateWorkBadge(v);
  });
}

async function trackAction(actionName) {
  if (!S.currentUser) return;
  try {
    await apiFetch('/track', {
      method: 'POST',
      body: JSON.stringify({ actionName })
    });
  } catch (e) { console.error("Track error:", e); }
}

function updateTimeSpent() {
  if (!S.currentUser || document.hidden) return;
  const now = Date.now();
  const diff = Math.floor((now - S.sessionStartTime) / 1000);
  S.sessionStartTime = now;
  if (diff <= 0) return;
  try {
    db.ref(`users/${S.currentUser}/stats/timeSpent`).transaction(c => (c || 0) + diff);
  } catch (e) { }
}
setInterval(updateTimeSpent, 30000); // Update every 30s
window.addEventListener('beforeunload', updateTimeSpent);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') S.sessionStartTime = Date.now();
  else updateTimeSpent();
});

// ======================== AUDIO ========================
const audio = {};
function loadAudio() {
  try {
    audio.click = new Audio('click.mp3');
    audio.modal = audio.click;
    audio.click.preload = 'auto';
  } catch (e) { }
}
function play(key) {
  if (!S.soundsEnabled) return;
  try { const a = audio[key]; if (a) { a.currentTime = 0; a.play().catch(() => { }); } } catch (e) { }
}

// Global click listener for sounds and modal blocking
let mouseDownTarget = null;
document.addEventListener('mousedown', (e) => { mouseDownTarget = e.target; });

document.addEventListener('click', (e) => {
  const activeModal = document.querySelector('.modal-overlay:not(.hidden)');

  // Se houver modal aberto
  if (activeModal) {
    const sheet = activeModal.querySelector('.modal-sheet');
    // Se o clique (tanto o mousedown quanto o mouseup/click target) for fora do "papel" do modal
    if (sheet && !sheet.contains(e.target) && !sheet.contains(mouseDownTarget)) {
      // Ignorar se o clique for dentro do calendário do Flatpickr
      if (e.target.closest('.flatpickr-calendar')) return;

      e.preventDefault();
      e.stopPropagation();
      play('click');
      if (activeModal.id === 'modal-scale') {
        window.dismissScaleModal();
      } else {
        closeModal(activeModal.id);
      }
      return;
    }
  }

  // Prevenção de cliques duplos/fantasmas (cooldown após fechar modais)
  if (Date.now() - S.lastModalClose < 300) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Som de clique global (caso não tenha sido capturado pelo modal acima)
  if (e.target.closest('button, a, .day-cell, .mini-month, .lp-flag-btn, .chip, #fab-wrapper, [role="button"]')) {
    play('click');
  }
}, true);

// ======================== OVERLAY CARREGAMENTO ========================
function showLoading(msgKey = 'loading_wait') {
  const msg = typeof i18n !== 'undefined' ? i18n.t(msgKey) : msgKey;
  let el = document.getElementById('firebase-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'firebase-loading';
    el.style.cssText = `position:fixed;inset:0;background:#ffffff;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;gap:14px;font-family:var(--font);`;
    el.innerHTML = `<img src="fadeprogress.svg" class="imgGif"> <p id="fb-load-msg" style="color:#374151;font-size:.95rem; margin-top:10px;">${msg}</p>`;
    document.body.appendChild(el);
  } else {
    document.getElementById('fb-load-msg').textContent = msg;
    el.style.display = 'flex';
  }
}
function hideLoading() {
  const el = document.getElementById('firebase-loading');
  if (el) el.style.display = 'none';
}

function userRef(path = '') {
  return db.ref(`users/${S.currentUser}${path ? '/' + path : ''}`);
}

async function syncAllData() {
  try {
    console.log("[DEBUG] Syncing all data from backend...");
    const data = await apiFetch('/sync');

    S.events = data.events || [];
    S.transactions = (data.transactions || []).map(t => ({
      ...t,
      amount: parseFloat(t.amount) || 0,
      checked: t.checked || false
    }));
    S.entities = data.entities || {};
    S.company = data.company || {};

    if (data.profile) {
      S.userScale = data.profile.scale;
      S.soundsEnabled = data.profile.sounds;
    }

    // Refresh UI
    updateProfSelectors();
    if (S.viewMode === 'business') renderBusinessTab();
    if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
    S.lastRenderedYear = null;
    refreshCalendar();
    updateSoundIcon();
  } catch (err) {
    console.error("Sync error:", err);
  }
}

async function saveProfile() {
  if (!S.currentUser) return;
  try {
    await apiFetch('/profile', {
      method: 'PUT',
      body: JSON.stringify({
        scale: S.userScale || null,
        sounds: S.soundsEnabled
      })
    });
  } catch (e) { console.error(e); }
}

function startRealtimeSync() {
  console.log("[DEBUG] Remote sync started (Backend API)");
  syncAllData();
  // We can poll every 30 seconds for external changes, 
  // or just rely on manual sync after operations.
  if (window._syncInterval) clearInterval(window._syncInterval);
  window._syncInterval = setInterval(syncAllData, 60000);
}

// Inicia o carregamento logo ao carregar o script (apenas se já tiver idioma definido)
if (localStorage.getItem('agbizu_lang')) {
  showLoading();
}

// ======================== AUTH LOGIC (Unified with ViewGo) ========================
let isLoginMode = true;
let currentAuthStep = 1;

window.setAuthType = function(type) {
  S.authType = type;
  document.getElementById('mode-admin').classList.toggle('active', type === 'admin');
  document.getElementById('mode-seller').classList.toggle('active', type === 'seller');
  
  const titleEl = $('auth-section-title');
  const businessGrp = $('group-business-code');
  const emailLbl = document.querySelector('#group-email-step1 .field-label');
  const emailInp = $('inp-email');

  if (type === 'seller') {
    if (titleEl) titleEl.textContent = 'Acesso Vendedor';
    if (businessGrp) businessGrp.classList.remove('hidden');
    if (emailLbl) emailLbl.textContent = 'Usuário / Email';
    if (emailInp) emailInp.placeholder = 'Seu usuário';
    hide('btn-toggle-mode');
    hide('forgot-pass-wrap');
    hide('auth-steps-indicator');
  } else {
    if (titleEl) titleEl.textContent = isLoginMode ? 'Acesso à Conta' : 'Criar Nova Conta';
    if (businessGrp) businessGrp.classList.add('hidden');
    if (emailLbl) emailLbl.textContent = 'E-mail';
    if (emailInp) emailInp.placeholder = 'seu@email.com';
    show('btn-toggle-mode');
    show('forgot-pass-wrap');
    if (!isLoginMode) show('auth-steps-indicator');
  }
  
  // Reset fields
  $('inp-business-code').value = '';
  $('inp-email').value = '';
  $('inp-pass').value = '';
  currentAuthStep = 1;
  goToAuthStep(1);
};

window.resetAuthUI = function () {
  isLoginMode = true;
  currentAuthStep = 1;

  // Resetar inputs
  const inputs = document.querySelectorAll('.login-footer input');
  inputs.forEach(i => i.value = '');

  // Resetar erro
  const errEl = $('login-error');
  if (errEl) errEl.textContent = '';

  // Resetar Hero (Logo/Titulo) e liberar o lock de foco para a próxima sessão
  const screen = $('login-screen');
  if (screen) {
    screen.classList.remove('focused');
    if (typeof screen._resetFocusLock === 'function') screen._resetFocusLock();
  }

  // Aplicar estado visual (Forçar login mode)
  // Como toggleAuthMode inverte, vamos setar isLoginMode false e chamar toggle
  isLoginMode = false;
  toggleAuthMode();
};

window.toggleAuthMode = function () {
  isLoginMode = !isLoginMode;
  currentAuthStep = 1;
  goToAuthStep(1);

  const groupName = $('group-name');
  const groupConfirm = $('group-confirm');
  const emailGroup = $('group-email-step1');
  const passGroup = $('group-password');
  const btnSubmit = $('btn-login-submit');
  const btnNext = $('btn-auth-next');
  const btnToggle = $('txt-toggle');
  const forgotBtn = $('btn-forgot-pass');
  const stepsIndicator = $('auth-steps-indicator');
  const step3 = $('step-3');
  const step4 = $('step-4');
  const titleEl = $('auth-section-title');

  if (isLoginMode) {
    if (titleEl) {
      titleEl.setAttribute('data-i18n', 'login_header_access');
      titleEl.textContent = typeof i18n !== 'undefined' ? i18n.t('login_header_access') : 'Acesso à Conta';
    }

    // Login 2 steps: Email -> Password
    groupName.classList.add('hidden');
    groupConfirm.classList.add('hidden');
    emailGroup.classList.remove('hidden');
    passGroup.classList.remove('hidden');
    stepsIndicator.classList.add('hidden');
    step3.classList.add('hidden');
    if (step4) step4.classList.add('hidden');

    // Move Email to Step 1, Password to Step 2
    $('step-1').appendChild(emailGroup);
    $('step-2').appendChild(passGroup);

    btnSubmit.classList.add('hidden');
    btnNext.classList.remove('hidden');
    btnToggle.innerHTML = i18n.t('login_no_account') || 'Não tem uma conta? <span style="color: var(--primary);">Cadastre-se grátis.</span>';
    if (forgotBtn) forgotBtn.closest('#forgot-pass-wrap')?.classList.remove('hidden');
    $('login-form')?.classList.remove('register-mode');
  } else {
    if (titleEl) {
      titleEl.setAttribute('data-i18n', 'login_header_register');
      titleEl.textContent = typeof i18n !== 'undefined' ? i18n.t('login_header_register') : 'Criar Nova Conta';
    }

    // Register 4 steps: Name -> Email -> Password -> Confirm
    groupName.classList.remove('hidden');
    groupConfirm.classList.remove('hidden');
    emailGroup.classList.remove('hidden');
    passGroup.classList.remove('hidden');
    stepsIndicator.classList.remove('hidden');
    step3.classList.remove('hidden');
    if (step4) step4.classList.remove('hidden');

    // Move Name to Step 1, Email to Step 2, Password to Step 3, Confirm to Step 4
    $('step-1').appendChild(groupName);
    $('step-2').appendChild(emailGroup);
    $('step-3').appendChild(passGroup);
    $('step-4').appendChild(groupConfirm);

    btnSubmit.classList.add('hidden');
    btnNext.classList.remove('hidden');
    btnToggle.innerHTML = i18n.t('login_have_account') || 'Já tem uma conta? <span style="color: var(--primary);">Fazer login</span>';
    if (forgotBtn) forgotBtn.closest('#forgot-pass-wrap')?.classList.add('hidden');
    $('login-form')?.classList.add('register-mode');
  }
  updateStepDots();
  $('login-error').textContent = '';
};

window.nextAuthStep = async function () {
  const maxSteps = isLoginMode ? 2 : 4;
  const errEl = $('login-error');
  errEl.textContent = '';

  // Regex para validação de e-mail real
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (currentAuthStep === 1) {
    if (isLoginMode) {
      if (!emailRegex.test($('inp-email').value)) {
        errEl.textContent = i18n.t('err_invalid_email');
        return;
      }
    } else {
      if ($('inp-name').value.trim().length < 3) {
        errEl.textContent = i18n.t('err_short_name');
        return;
      }
    }
  } else if (currentAuthStep === 2) {
    if (!isLoginMode) {
      if (!emailRegex.test($('inp-email').value)) {
        errEl.textContent = i18n.t('err_invalid_email');
        return;
      }
    }
  } else if (currentAuthStep === 3 && !isLoginMode) {
    if ($('inp-pass').value.length < 6) {
      errEl.textContent = i18n.t('login_err_pass');
      return;
    }
  }

  if (currentAuthStep < maxSteps) {
    currentAuthStep++;
    goToAuthStep(currentAuthStep);
  }
};

window.prevAuthStep = function () {
  if (currentAuthStep > 1) {
    currentAuthStep--;
    goToAuthStep(currentAuthStep);
  }
};

function goToAuthStep(step) {
  const wrapper = $('auth-step-wrapper');
  wrapper.style.transform = `translateX(-${(step - 1) * 100}%)`;

  const maxSteps = isLoginMode ? 2 : 4;
  const btnNext = $('btn-auth-next');
  const btnSubmit = $('btn-login-submit');
  const btnBack = $('btn-auth-back');

  btnBack.classList.toggle('hidden', step === 1);

  if (step === maxSteps) {
    btnNext.classList.add('hidden');
    btnSubmit.classList.remove('hidden');
    btnSubmit.querySelector('#txt-login-btn').textContent = isLoginMode ? i18n.t('login_btn') : i18n.t('login_btn_create');
  } else {
    btnNext.classList.remove('hidden');
    btnSubmit.classList.add('hidden');
  }

  updateStepDots();
}

function updateStepDots() {
  const dots = document.querySelectorAll('.step-dot');
  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === currentAuthStep - 1);
    dot.classList.toggle('hidden', isLoginMode); // Hide dots in login mode if simplified
  });
}

let _recoveryCountdownTimer = null;

window.toggleRecovery = function (show) {
  const loginForm = $('login-form');
  const recoveryEl = $('recovery-area');
  const formState = $('recovery-form-state');
  const successState = $('recovery-success-state');

  if (show) {
    if (loginForm) loginForm.classList.add('hidden');
    if (recoveryEl) recoveryEl.classList.remove('hidden');
    // Always start at form state
    if (formState) formState.classList.remove('hidden');
    if (successState) successState.classList.add('hidden');
    const inp = $('inp-recovery-email');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 120); }
  } else {
    if (loginForm) loginForm.classList.remove('hidden');
    if (recoveryEl) recoveryEl.classList.add('hidden');
    // Clear countdown
    if (_recoveryCountdownTimer) { clearInterval(_recoveryCountdownTimer); _recoveryCountdownTimer = null; }
  }
  const errEl = $('login-error');
  const recErr = $('recovery-error');
  if (errEl) errEl.textContent = '';
  if (recErr) recErr.textContent = '';
};

function _startResendCountdown(seconds = 60) {
  const countdownWrap = $('recovery-countdown-wrap');
  const resendWrap = $('recovery-resend-wrap');
  const countdownNum = $('recovery-countdown');

  if (countdownWrap) countdownWrap.classList.remove('hidden');
  if (resendWrap) resendWrap.classList.add('hidden');
  if (countdownNum) countdownNum.textContent = seconds;

  if (_recoveryCountdownTimer) clearInterval(_recoveryCountdownTimer);
  let remaining = seconds;
  _recoveryCountdownTimer = setInterval(() => {
    remaining--;
    if (countdownNum) countdownNum.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(_recoveryCountdownTimer);
      _recoveryCountdownTimer = null;
      if (countdownWrap) countdownWrap.classList.add('hidden');
      if (resendWrap) resendWrap.classList.remove('hidden');
    }
  }, 1000);
}

async function sendRecoveryEmail() {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const email = ($('inp-recovery-email')?.value || '').trim();
  const errEl = $('recovery-error');
  const btn = $('btn-send-recovery');

  if (errEl) errEl.textContent = '';

  if (!email) {
    if (errEl) errEl.textContent = i18n.t('err_fill_all');
    return;
  }
  if (!emailRegex.test(email)) {
    if (errEl) errEl.textContent = i18n.t('err_invalid_email');
    return;
  }

  // Loading state on button
  if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
  showLoading('loading_connecting');

  try {
    await firebase.auth().sendPasswordResetEmail(email);
    hideLoading();

    // Show success state
    const formState = $('recovery-form-state');
    const successState = $('recovery-success-state');
    if (formState) formState.classList.add('hidden');
    if (successState) successState.classList.remove('hidden');

    // Show masked email in subtitle
    const sentTo = $('recovery-sent-to');
    if (sentTo) {
      const masked = email.replace(/(.{2}).+(@.+)/, '$1***$2');
      sentTo.textContent = masked;
    }

    // Restart animation by re-cloning the ripple
    const ripple = document.querySelector('.recovery-success-ripple');
    if (ripple) {
      ripple.style.animation = 'none';
      ripple.offsetHeight; // reflow
      ripple.style.animation = '';
    }

    _startResendCountdown(60);
  } catch (error) {
    hideLoading();
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    let msg = error.message || i18n.t('login_err_conn');
    if (error.code === 'auth/user-not-found') msg = i18n.t('recovery_err_not_found') || 'Nenhuma conta encontrada com este e-mail.';
    if (error.code === 'auth/invalid-email') msg = i18n.t('err_invalid_email');
    if (error.code === 'auth/too-many-requests') msg = i18n.t('recovery_err_too_many') || 'Muitas tentativas. Aguarde alguns minutos.';
    if (errEl) errEl.textContent = msg;
  }
}

window.resendRecoveryEmail = async function () {
  const btn = $('btn-resend-recovery');
  if (btn) { btn.disabled = true; }
  await sendRecoveryEmail();
  if (btn) { btn.disabled = false; }
};


// Global Auth State Observer
firebase.auth().onAuthStateChanged(async (user) => {
  if (user) {
    console.log("User logged in:", user.uid);
    S.currentUser = user.uid;
    S.isSellerMode = false;
    localStorage.removeItem('agbizu_seller_mode');
    localStorage.setItem('agbizu_session', user.uid);

    if (user.email === 'maispraticodesenvolvimento@gmail.com') {
      const btn = document.getElementById('btn-admin-panel');
      if (btn) {
        btn.classList.remove('hidden');
        btn.onclick = () => window.location.href = 'adm.html';
      }
    }
    initApp();
  } else {
    const isSeller = localStorage.getItem('agbizu_seller_mode') === 'true';
    if (isSeller) {
      console.log("Professional session detected.");
      S.isSellerMode = true;
      S.currentUser = localStorage.getItem('agbizu_session');
      S.currentProfessionalId = localStorage.getItem('agbizu_prof_id');
      S.profFilter = S.currentProfessionalId;
      initApp();
    } else {
      console.log("No user session.");
      logout(true); // silent logout
    }
  }
});

window.setFPValue = function (id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (id.includes('date')) el.value = fmtDate(val);
  else el.value = val;
};

async function initApp() {
  try {
    console.log("[DEBUG] Início do initApp");
    // O cabeçalho deve ser mostrado sempre para que o menu (hambúrguer) esteja visível
    show('scale-bar');

    await syncAllData();

    if (S.isSellerMode) {
      // Disable professional selection for seller
      const headerSelect = $('header-prof-filter');
      if (headerSelect) {
        headerSelect.value = S.currentProfessionalId;
        headerSelect.disabled = true;
        headerSelect.style.opacity = '0.6';
      }
      // Hide admin settings from menu
      document.querySelectorAll('.menu-item').forEach(item => {
         const onclick = item.getAttribute('onclick') || '';
         if (onclick.includes('business-settings') || onclick.includes('units')) {
           item.classList.add('hidden');
         }
      });
      // Hide whatsapp management
      const waLink = document.querySelector('a[href="whatsapp.html"]');
      if (waLink) waLink.closest('.menu-item')?.classList.add('hidden');
      
      const setupBtn = document.getElementById('btn-admin-setup');
      if (setupBtn) setupBtn.classList.add('hidden');
    }

    if (S.userScale) {
      if ($('scale-display')) $('scale-display').textContent = S.userScale.display;
      S.forceScale = false;
    }
    else {
      S.forceScale = true;
    }

    S.currentDate = new Date();
    setView('week');

    // Inicia intervalo de sync após carga inicial
    if (window._syncInterval) clearInterval(window._syncInterval);
    window._syncInterval = setInterval(syncAllData, 60000);

    hide('login-screen');
    show('app-screen');
    if ($('app-screen')) $('app-screen').style.display = 'flex';
    if (typeof window.showAgentFab === 'function') window.showAgentFab();

    if (typeof i18n !== 'undefined') i18n.applyToDOM();
    updateSoundIcon();
    runOnboardingFlow();

    // Setup Custom Input Masks (No Popups)
    applyMask('evt-date', 'date');
    applyMask('evt-end-date', 'date');
    applyMask('trans-date', 'date');
    applyMask('evt-time', 'time');
    applyMask('evt-end-time', 'time');

    // Inicializa estado do sidebar no Desktop
    if (localStorage.getItem('agbizu_sidebar_collapsed') === 'true' && window.innerWidth >= 900) {
      document.getElementById('side-menu')?.classList.add('collapsed');
      const sideBtnIcon = document.querySelector('#btn-collapse-sidebar span');
      if (sideBtnIcon) sideBtnIcon.style.transform = 'rotate(180deg)';
    }

    // Pequeno delay para não sobrepor outras modais iniciais
    setTimeout(() => {
      showPromotionalToasts();
    }, 1500);

    hideLoading();
    console.log("[DEBUG] initApp finalizado com sucesso");
  } catch (err) {
    console.error("Critical error in initApp:", err);
    hideLoading();
  }
}

// ======================== LOGIN FOCUS BEHAVIOR (Mobile) ========================
// Quando um input da tela de login recebe foco em telas pequenas (<= 640px),
// a classe 'focused' é adicionada ao #login-screen para mover o formulário ao topo,
// ocultando o hero e evitando que o teclado virtual sobreponha os campos.
(function setupLoginFocusBehavior() {
  const loginScreen = document.getElementById('login-screen');
  if (!loginScreen) return;

  // Uma vez que o usuário focar num input pela primeira vez em mobile,
  // o estado "focused" fica permanente até o próximo logout/reset.
  let loginFocusLocked = false;

  function onLoginInputFocus() {
    if (window.innerWidth > 640) return;
    if (!loginFocusLocked) {
      loginFocusLocked = true;
    }
    loginScreen.classList.add('focused');
  }

  // Delega apenas o focusin — o focusout não remove mais a classe após o primeiro foco.
  loginScreen.addEventListener('focusin', (e) => {
    if (e.target.matches('input')) onLoginInputFocus();
  });

  // Expõe reset para ser chamado pelo resetAuthUI ao fazer logout
  loginScreen._resetFocusLock = () => { loginFocusLocked = false; };
})();

// Update the form submission
document.getElementById('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const email = $('inp-email').value;
  const pass = $('inp-pass').value;
  const name = $('inp-name').value;
  const confirm = $('inp-confirm').value;
  const errEl = $('login-error');

  errEl.textContent = '';
  
  if (S.authType === 'seller') {
    const businessCode = $('inp-business-code').value.trim();
    const username = $('inp-email').value.trim(); 
    const passValue = $('inp-pass').value;

    if (!businessCode || !username || !passValue) {
       if (currentAuthStep === 1 && (businessCode && username)) {
          nextAuthStep();
          return;
       }
       errEl.textContent = i18n.t('err_fill_all');
       return;
    }

    showLoading('loading_connecting');
    try {
      const resp = await fetch(`${API_BASE}/auth/seller/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessCode, username, password: passValue })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erro no login');

      S.isSellerMode = true;
      S.currentUser = data.adminUid;
      S.currentProfessionalId = data.professionalId;
      S.profFilter = data.professionalId;
      S.authType = 'seller';

      localStorage.setItem('agbizu_session', data.adminUid);
      localStorage.setItem('agbizu_seller_mode', 'true');
      localStorage.setItem('agbizu_prof_id', data.professionalId);
      initApp();
    } catch (err) {
      hideLoading();
      errEl.textContent = err.message;
    }
    return;
  }

  const maxSteps = isLoginMode ? 2 : 4;
  if (currentAuthStep < maxSteps) {
    nextAuthStep();
    return;
  }

  if (isLoginMode) {
    if (!email || !pass) {
      errEl.textContent = i18n.t('err_fill_all');
      return;
    }
    if (!emailRegex.test(email)) {
      errEl.textContent = i18n.t('err_invalid_email');
      return;
    }
    showLoading('loading_connecting');
    try {
      await firebase.auth().signInWithEmailAndPassword(email, pass);
    } catch (err) {
      hideLoading();
      errEl.textContent = i18n.t('login_err_wrong') || "E-mail ou senha incorretos.";
      console.error(err);
    }
  } else {
    if (!name || !email || !pass || !confirm) {
      errEl.textContent = i18n.t('err_fill_all');
      return;
    }
    if (!emailRegex.test(email)) {
      errEl.textContent = i18n.t('err_invalid_email');
      return;
    }
    if (pass !== confirm) {
      errEl.textContent = i18n.t('err_pass_mismatch');
      return;
    }
    if (pass.length < 6) {
      errEl.textContent = i18n.t('login_err_pass');
      return;
    }

    showLoading('loading_connecting');
    try {
      const result = await firebase.auth().createUserWithEmailAndPassword(email, pass);
      await result.user.updateProfile({ displayName: name });
    } catch (err) {
      hideLoading();
      if (err.code === 'auth/email-already-in-use') {
        errEl.textContent = i18n.t('err_email_exists');
        // Retroceder para a aba de e-mail automaticamente
        currentAuthStep = 2;
        goToAuthStep(2);
      } else {
        errEl.textContent = i18n.t('login_err_conn');
      }
      console.error(err);
    }
  }
};

async function logout(silent = false) {
  if (!silent) {
    closeModal('modal-logout');
    showLoading('loading_wait');
  }

  try {
    await firebase.auth().signOut();
  } catch (e) {
    console.error("Logout error:", e);
  }

  S.currentUser = null; S.userScale = null; S.events = []; S.transactions = []; S.customSeq = [];
  localStorage.removeItem('agbizu_session');

  if (!silent) {
    refreshCalendar();
    resetAuthUI();
    show('login-screen');
    hide('app-screen');
    if (typeof window.hideAgentFab === 'function') window.hideAgentFab();
    hideLoading();
  } else {
    // Mesmo em boot silencioso, precisamos estar no modo login e sem loader
    resetAuthUI();
    show('login-screen');
    hide('app-screen');
    hideLoading();
  }
}

// ======================== HOLIDAYS ========================
function isHoliday(date) {
  const holidays = typeof i18n !== 'undefined' ? i18n.t('holidays') : {};
  return holidays[toDateStr(date)] || null;
}

/** Returns the daily Bible messages for the current language */
function getMensagensDoDia() {
  if (typeof i18n !== 'undefined') {
    const msgs = i18n.t('daily_messages');
    if (Array.isArray(msgs)) return msgs;
  }
  // Fallback hardcoded PT (shouldn't reach here if i18n loaded)
  return [
    { dia: 1, versiculo: 'João 3:16', mensagem: 'Porque Deus amou o mundo de tal maneira que deu o seu Filho unigênito...', reflexao: 'O amor de Deus é a base do evangelho.' },
    { dia: 2, versiculo: 'Salmos 23:1', mensagem: 'O Senhor é o meu pastor; nada me faltará.', reflexao: 'Deus cuida de nós em todos os momentos.' },
  ];
}

// ======================== SCALE LOGIC ========================
function isDayOff(date, scale) {
  if (!scale) return null;
  if (typeof scale === 'object' && scale.sequence) {
    const ref2 = new Date(scale.referenceDate);
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const start = new Date(ref2.getFullYear(), ref2.getMonth(), ref2.getDate());
    const delta = Math.round((target - start) / 86400000);
    const seq = scale.sequence;
    const idx = ((delta % seq.length) + seq.length) % seq.length;
    return seq[idx] === 0;
  }
  return null;
}
function getWorkStatus(date, scale) {
  if (!scale) return null;
  const off = isDayOff(date, scale);
  return off === null ? null : { isOff: off };
}

// ======================== DATE HELPERS ========================
function toDateStr(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function normalizeDate(d) {
  const p = typeof d === 'string' ? new Date(d + 'T12:00:00') : new Date(d);
  return new Date(p.getFullYear(), p.getMonth(), p.getDate());
}
function getDaysInMonth(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days = [];
  // Mês anterior (padding)
  for (let i = first.getDay() - 1; i >= 0; i--) days.push({ date: new Date(year, month, -i), cur: false });
  // Mês atual
  for (let d = 1; d <= last.getDate(); d++) days.push({ date: new Date(year, month, d), cur: true });
  // Mês posterior (padding)
  let nextDay = 1;
  while (days.length < 42) {
    days.push({ date: new Date(year, month + 1, nextDay++), cur: false });
  }
  return days;
}
function fmtMonthYear(date) {
  const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

// ======================== EVENTS ========================
function getEventsForDate(d) {
  const targetDate = normalizeDate(d);
  const targetStr = toDateStr(targetDate);
  let result = [];

  S.events.forEach(e => {
    const start = normalizeDate(e.date);
    const end = e.endDate ? normalizeDate(e.endDate) : start;

    if (!e.recurrence || e.recurrence === 'none' || e.recurrence === 'periodo') {
      if (targetDate >= start && targetDate <= end) {
        let finalItem = { ...e, isIgnored: !!(e.excludedDates && e.excludedDates[targetStr]), occurrenceDate: targetStr };
        if (e.overrides && e.overrides[targetStr]) finalItem = { ...finalItem, ...e.overrides[targetStr] };
        result.push(finalItem);
      }
      return;
    }

    if (targetDate < start) return;
    if (e.endDate && targetDate > end) return;

    let isOccurrence = false;
    if (e.recurrence === 'daily') isOccurrence = true;
    else if (e.recurrence === 'weekly') {
      const diffDays = Math.round((targetDate - start) / 86400000);
      isOccurrence = diffDays % 7 === 0;
    }
    else if (e.recurrence === 'monthly') isOccurrence = targetDate.getDate() === start.getDate();
    else if (e.recurrence === 'yearly') isOccurrence = targetDate.getDate() === start.getDate() && targetDate.getMonth() === start.getMonth();

    if (isOccurrence) {
      let finalItem = { ...e, isIgnored: !!(e.excludedDates && e.excludedDates[targetStr]), occurrenceDate: targetStr };
      if (e.overrides && e.overrides[targetStr]) finalItem = { ...finalItem, ...e.overrides[targetStr] };
      result.push(finalItem);
    }
  });

  if (S.profFilter) {
    result = result.filter(e => String(e.professionalId || '') === String(S.profFilter));
  }
  return result;
}

function getTransactionsForDate(d) {
  const targetDate = normalizeDate(d);
  const targetStr = toDateStr(targetDate);
  let result = [];

  S.transactions.forEach(t => {
    const start = normalizeDate(t.date);
    if (targetDate < start) return;

    if (t.date === targetStr) {
      let finalItem = { ...t, isIgnored: !!(t.excludedDates && t.excludedDates[targetStr]), occurrenceDate: targetStr, currentInstallment: 1 };
      if (t.overrides && t.overrides[targetStr]) finalItem = { ...finalItem, ...t.overrides[targetStr] };
      result.push(finalItem);
      return;
    }

    if (!t.recurrence || t.recurrence === 'none') return;
    let isOccurrence = false;
    let currentInstallment = 0;

    if (t.recurrence === 'daily') {
      isOccurrence = true;
      currentInstallment = Math.round((targetDate - start) / 86400000) + 1;
    }
    else if (t.recurrence === 'weekly') {
      const diffDays = Math.round((targetDate - start) / 86400000);
      isOccurrence = diffDays % 7 === 0;
      currentInstallment = Math.floor(diffDays / 7) + 1;
    }
    else if (t.recurrence === 'monthly') {
      isOccurrence = targetDate.getDate() === start.getDate();
      if (isOccurrence) currentInstallment = (targetDate.getFullYear() - start.getFullYear()) * 12 + (targetDate.getMonth() - start.getMonth()) + 1;
    }
    else if (t.recurrence === 'yearly') {
      isOccurrence = targetDate.getDate() === start.getDate() && targetDate.getMonth() === start.getMonth();
      if (isOccurrence) currentInstallment = targetDate.getFullYear() - start.getFullYear() + 1;
    }

    if (t.installments > 0 && (currentInstallment > t.installments || currentInstallment < 1)) isOccurrence = false;

    if (isOccurrence) {
      let finalItem = { ...t, isIgnored: !!(t.excludedDates && t.excludedDates[targetStr]), occurrenceDate: targetStr, currentInstallment };
      if (t.overrides && t.overrides[targetStr]) finalItem = { ...finalItem, ...t.overrides[targetStr] };
      result.push(finalItem);
    }
  });

  if (S.profFilter) {
    result = result.filter(t => String(t.professionalId || '') === String(S.profFilter));
  }
  return result;
}

function updateProfSelectors() {
  if (!S.entities) return;
  const profs = Object.values(S.entities?.professional || {});
  const headerSelect = $('header-prof-filter');
  const evtSelect = $('evt-professional');
  const transSelect = $('trans-professional');

  const t = (k) => typeof i18n !== 'undefined' ? (i18n.t(k) || k) : k;

  let options = `<option value="">${t('all_professionals')}</option>` +
    profs.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  if (S.isSellerMode) {
     // If seller, they should only see themselves in the "All" context of selectors if we allow it, 
     // but mostly we want to lock them.
     const me = profs.find(p => p.id === S.currentProfessionalId);
     if (me) {
        options = `<option value="${me.id}">${me.name}</option>`;
     }
  }

  if (headerSelect) {
    headerSelect.innerHTML = options;
    headerSelect.value = S.profFilter;
    if (S.isSellerMode) {
      headerSelect.disabled = true;
    }
    headerSelect.style.borderColor = S.profFilter ? 'var(--primary)' : 'var(--border)';
    headerSelect.style.color = S.profFilter ? 'var(--primary)' : 'var(--text2)';

    headerSelect.onchange = (e) => {
      S.profFilter = e.target.value;
      localStorage.setItem('agbizu_prof_filter', S.profFilter);
      headerSelect.style.borderColor = S.profFilter ? 'var(--primary)' : 'var(--border)';
      headerSelect.style.color = S.profFilter ? 'var(--primary)' : 'var(--text2)';
      refreshCalendar();
      play('click');
    };
  }
  
  const selLabel = `- ${t('btn_select') || 'SELECIONE'} -`;
  const formOptions = S.isSellerMode ? options : (`<option value="">${selLabel}</option>` + profs.map(p => `<option value="${p.id}">${p.name}</option>`).join(''));
  
  if (evtSelect) {
    evtSelect.innerHTML = formOptions;
    if (S.isSellerMode) {
      evtSelect.value = S.currentProfessionalId;
      evtSelect.disabled = true;
    }
  }
  if (transSelect) {
    transSelect.innerHTML = formOptions;
     if (S.isSellerMode) {
      transSelect.value = S.currentProfessionalId;
      transSelect.disabled = true;
    }
  }
}

async function addEvent(data) {
  try {
    const res = await apiFetch('/events', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    S.events.push(res);
    syncAllData();
  } catch (err) { console.error(err); }
}

async function updateEvent(id, data) {
  try {
    await apiFetch(`/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    syncAllData();
  } catch (err) { console.error(err); }
}

async function deleteEvent(id) {
  try {
    await apiFetch(`/events/${id}`, { method: 'DELETE' });
    syncAllData();
  } catch (err) { console.error(err); }
}

// Removido generateRecurring pois agora é virtual.
function uid() { return Date.now() + '-' + Math.random().toString(36).slice(2, 9); }

// ======================== DOM & RENDERING ========================
window.goToViewGo = () => { window.location.href = 'https://www.viewgo.com.br/login'; };
window.closeAnyModal = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeModal(m.id));

function $(id) { return document.getElementById(id); }
function show(id) {
  const el = $(id);
  if (el) {
    el.classList.remove('hidden');
    if (el.classList.contains('form-error')) el.style.display = 'block';
  }
}
function hide(id) { const el = $(id); if (el) el.classList.add('hidden'); }
const catColor = (cat) => ({ evento: '#3b82f6', aniversario: '#ec4899', trabalho: '#22c55e', pessoal: '#a855f7', saude: '#ef4444', estudo: '#f59e0b' })[cat] || '#3b82f6';

let lastModalOpen = 0;
function openModal(id) {
  const now = Date.now();
  if (now - lastModalOpen < 400) return;
  lastModalOpen = now;

  // Garantir que nenhum outro modal esteja aberto antes de abrir o novo
  window.closeAnyModal();

  // Limpar os toasts (removendo visíveis) para não conflitar com modals de inicialização
  const toastContainer = document.getElementById('toast-container');
  if (toastContainer) toastContainer.innerHTML = '';

  const el = $(id);
  if (el) {
    el.classList.remove('hidden');
    play('modal');
    if (typeof window.hideAgentFab === 'function') window.hideAgentFab();
    trackAction('open_modal_' + id);
  }
}

function closeModal(id) {
  console.log("debug: fechou side-menu");
  const el = $(id); if (!el) return;

  const sheet = el.querySelector('.modal-sheet');
  if (sheet) {
    sheet.style.transform = 'translateY(0)'; // Reseta para a próxima abertura
    sheet.style.transition = '';
  }
  el.classList.add('hidden');
  S.lastModalClose = Date.now();

  // Show FAB only if NO other modal is open
  setTimeout(() => {
    const anyActiveModal = document.querySelector('.modal-overlay:not(.hidden)');
    const sideMenuOpen = document.getElementById('side-menu')?.classList.contains('active');
    if (!anyActiveModal && !sideMenuOpen && typeof window.showAgentFab === 'function') {
      window.showAgentFab();
    }
  }, 100);
}

function toggleSideMenu(open) {
  const menu = $('side-menu');
  const overlay = $('side-menu-overlay');
  const session = localStorage.getItem('agbizu_session');

  if (open) {
    menu.classList.add('active');
    overlay.classList.remove('hidden');
    if (session && typeof window.hideAgentFab === 'function') window.hideAgentFab();
    play('modal');
  } else {
    menu.classList.remove('active');
    overlay.classList.add('hidden');
    const content = document.querySelector('.side-menu-content');
    if (content) {
      setTimeout(() => { content.scrollTop = 0; }, 300);
    }
    if (session && typeof window.showAgentFab === 'function') window.showAgentFab();
  }
}

window.closeAnyModal = () => {
  toggleSideMenu(false);
  ['modal-day', 'modal-event', 'modal-search', 'modal-scale', 'modal-logout', 'modal-onboarding-sound', 'modal-bible', 'modal-lang', 'modal-finances', 'modal-transaction', 'modal-confirm', 'modal-recurrence-choice'].forEach(closeModal);
};

window.showRecurrenceChoiceModal = function (onOnlyThis, onAll, hideOnlyThis = false) {
  play('click');
  if (typeof i18n !== 'undefined') i18n.applyToDOM();

  const btnOnlyThis = $('btn-save-recurring-instance');
  if (btnOnlyThis) {
    if (hideOnlyThis) btnOnlyThis.classList.add('hidden');
    else btnOnlyThis.classList.remove('hidden');
  }

  $('btn-save-recurring-all').onclick = () => {
    closeModal('modal-recurrence-choice');
    onAll();
  };
  $('btn-save-recurring-instance').onclick = () => {
    closeModal('modal-recurrence-choice');
    onOnlyThis();
  };
  $('btn-cancel-recurring-choice').onclick = () => {
    closeModal('modal-recurrence-choice');
  };

  openModal('modal-recurrence-choice');
};

window.showConfirmModal = function (titleKey, descKey, onConfirm) {
  play('click');
  const t = (k) => typeof i18n !== 'undefined' ? (i18n.t(k) || k) : k;
  if ($('confirm-title')) $('confirm-title').textContent = t(titleKey);
  if ($('confirm-desc')) $('confirm-desc').textContent = t(descKey);

  if ($('btn-agree-confirm')) {
    let confirmed = false;
    $('btn-agree-confirm').onclick = async (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (confirmed) return;
      confirmed = true;
      closeModal('modal-confirm');
      if (onConfirm) await onConfirm();
    };
  }

  if ($('btn-cancel-confirm')) {
    $('btn-cancel-confirm').onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      closeModal('modal-confirm');
    };
  }

  openModal('modal-confirm');
};

function refreshCalendar() {
  if (S.viewMode === 'month') {
    renderMonthView();
    updateGlobalFinanceSummary();
  } else if (S.viewMode === 'week') {
    renderWeekView();
  } else if (S.viewMode === 'year') {
    renderYearView();
  } else if (S.viewMode === 'ai') {
    // AI view logic if needed, currently just Hello World
  }
}

function updateGlobalFinanceSummary() {
  const m = S.currentDate.getMonth();
  const y = S.currentDate.getFullYear();

  // Para o resumo global, precisamos considerar as recorrentes no mês
  let totalInc = 0, totalExp = 0;

  // Opção simplificada: iterar todos os dias do mês
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(y, m, i);
    const trs = getTransactionsForDate(d);
    trs.forEach(t => {
      if (t.isIgnored) return;
      if (t.type === 'income') totalInc += t.amount;
      else totalExp += t.amount;
    });
  }

  const incomeEl = $('glb-total-income');
  const expenseEl = $('glb-total-expenses');
  const balanceEl = $('glb-total-balance');

  if (incomeEl) incomeEl.textContent = formatVal(totalInc);
  if (expenseEl) expenseEl.textContent = formatVal(totalExp);
  if (balanceEl) balanceEl.textContent = formatVal(totalInc - totalExp);

  // Também atualiza o modal (caso esteja aberto)
  const finIncEl = $('fin-total-income');
  const finExpEl = $('fin-total-expenses');
  const finBalEl = $('fin-total-balance');

  if (finIncEl) finIncEl.textContent = formatVal(totalInc);
  if (finExpEl) finExpEl.textContent = formatVal(totalExp);
  if (finBalEl) finBalEl.textContent = formatVal(totalInc - totalExp);
}

function renderMonthView() {
  const y = S.currentDate.getFullYear();
  // Se mudou o ano, regera os 12 slides
  if (S.lastRenderedYear !== y) {
    initMonthSwiper(y);
    S.lastRenderedYear = y;
  }

  const m = S.currentDate.getMonth();
  const wrapper = $('month-slides-wrapper');
  if (wrapper) {
    wrapper.style.transform = `translateX(-${m * 100}%)`;
    $('month-title').textContent = fmtMonthYear(S.currentDate);
  }
}

function initMonthSwiper(year) {
  const wrapper = $('month-slides-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = '';

  // Render weekday headers with i18n
  const wdEl = $('cal-weekdays');
  if (wdEl) {
    const wd = typeof i18n !== 'undefined' ? i18n.t('weekdays') : ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    wdEl.innerHTML = wd.map(d => `<div>${d}</div>`).join('');
  }

  const dayMore = typeof i18n !== 'undefined' ? i18n.t('day_more') : 'mais';

  for (let m = 0; m < 12; m++) {
    const slide = document.createElement('div');
    slide.className = 'month-slide';
    const date = new Date(year, m, 1);
    const days = getDaysInMonth(year, m);
    const today = toDateStr(new Date());

    days.forEach(({ date: d, cur }) => {
      const ds = toDateStr(d);
      const ws = getWorkStatus(d, S.userScale);
      const evs = getEventsForDate(d);
      const trs = getTransactionsForDate(d);
      const cell = document.createElement('div');
      cell.className = 'day-cell' + (!cur ? ' other-month' : '') + (ds === today ? ' today' : '') + (cur && ws ? (ws.isOff ? ' off-day' : ' work-day') : '');

      let pillsHtml = '';
      const allItems = [
        ...evs.filter(e => !e.isIgnored).map(ev => ({ type: 'event', title: ev.title, time: ev.time, color: catColor(ev.category) })),
        ...trs.filter(t => !t.isIgnored).map(t => ({ type: 'finance', title: t.desc, amount: t.amount, color: t.type === 'income' ? '#16a34a' : '#dc2626' }))
      ];

      pillsHtml = allItems.slice(0, 2).map(item => {
        const text = item.type === 'event'
          ? (item.time ? item.time + ' ' : '') + item.title
          : (item.type === 'finance' ? (item.color === '#16a34a' ? '+' : '-') + ' ' + formatVal(item.amount) + ' ' + item.title : '');
        return `<div class="day-event-pill" style="background:${item.color}">${text}</div>`;
      }).join('');

      cell.innerHTML = `
        <div class="day-num"><span>${d.getDate()}</span>${(isHoliday(d) && cur ? '<span class="day-holiday-badge">F</span>' : '')}</div>
        ${(isHoliday(d) && cur ? `<div class="day-holiday-name">${isHoliday(d)}</div>` : '')}
        <div class="day-events-wrap">
          ${pillsHtml}
          ${(allItems.length > 2 ? `<div class="day-more">+${allItems.length - 2} ${dayMore}</div>` : '')}
        </div>
        ${(cur && ws && S.userScale ? `<div class="day-work-label ${ws.isOff ? 'off' : 'work'}">${i18n.t(ws.isOff ? 'badge_off' : 'badge_work')}</div><div class="day-work-dot ${ws.isOff ? 'off' : 'work'}"> </div>` : '')}
      `;
      cell.onclick = (e) => { e.stopPropagation(); play('click'); openDayModal(d); };
      slide.appendChild(cell);
    });
    wrapper.appendChild(slide);
  }
}

function renderYearView() {
  const year = S.currentDate.getFullYear();
  $('year-title').textContent = String(year);
  const grid = $('year-grid');
  const summaryContainer = $('year-summary-container');
  grid.innerHTML = '';

  const today = toDateStr(new Date());
  const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
  const wdMini = typeof i18n !== 'undefined' ? i18n.t('weekdays_mini') : ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

  let annualIncome = 0;
  let annualExpense = 0;
  const monthlyData = [];

  // 1. Calculate Monthly & Annual Totals
  for (let m = 0; m < 12; m++) {
    let mIncome = 0;
    let mExpense = 0;
    const daysInMonth = new Date(year, m + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, m, day);
      const trs = getTransactionsForDate(d);
      trs.forEach(tr => {
        if (tr.isIgnored) return;
        if (tr.type === 'income') mIncome += tr.amount;
        else mExpense += tr.amount;
      });
    }

    annualIncome += mIncome;
    annualExpense += mExpense;
    monthlyData.push({ m, mIncome, mExpense, mBalance: mIncome - mExpense });
  }

  // 2. Render Year Summary Top Section
  if (summaryContainer) {
    const maxVal = Math.max(...monthlyData.map(d => Math.max(d.mIncome, d.mExpense, 100)));

    let chartHtml = monthlyData.map(d => {
      const incH = (d.mIncome / maxVal) * 100;
      const expH = (d.mExpense / maxVal) * 100;
      const mName = new Date(year, d.m, 1).toLocaleDateString(locale, { month: 'short' }).substring(0, 1);

      return `
        <div class="chart-column">
          <div class="chart-bars">
            <div class="chart-bar income" style="height: ${incH}%"></div>
            <div class="chart-bar expense" style="height: ${expH}%"></div>
          </div>
          <span class="chart-label">${mName}</span>
        </div>
      `;
    }).join('');

    summaryContainer.innerHTML = `
   

      <div class="year-chart-wrapper">
      
        <div class="year-chart-header">
          <div class="year-chart-title">${t('finance_title')} (${year})</div>
          
          <div class="year-chart-legend">
            <div class="legend-item"><div class="legend-dot income"></div><span>${t('finance_type_income')}</span></div>
            <div class="legend-item"><div class="legend-dot expense"></div><span>${t('finance_type_expense')}</span></div>
          </div>
        </div>
        <div class="year-chart-container">
          ${chartHtml}
        </div>
           <div class="year-summary-cards" style="margin-top: 20px;">
        <div class="year-summary-card income">
          <div class="label">${t('finance_income')}</div>
          <div class="value" style="font-size: 1.1rem;  line-height: 1;">${formatVal(annualIncome)}</div>
        </div>
        <div class="year-summary-card expense">
          <div class="label">${t('finance_expenses')}</div>
          <div class="value" style="font-size: 1.1rem;  line-height: 1;">${formatVal(annualExpense)}</div>
        </div>
        <div class="year-summary-card balance">
          <div class="label">${t('finance_balance')}</div>
          <div class="value" style="font-size: 1.1rem;  line-height: 1;">${formatVal(annualIncome - annualExpense)}</div>
        </div>
      </div>
      </div>
    `;
  }

  // 3. Render Month Cards
  for (let m = 0; m < 12; m++) {
    const monthDate = new Date(year, m, 1);
    const mData = monthlyData[m];
    const card = document.createElement('div');
    card.className = 'mini-month';

    let html = `<div class="mini-month-title">${monthDate.toLocaleDateString(locale, { month: 'long' })}</div><div class="mini-grid">`;
    wdMini.forEach(d => html += `<div class="mini-day-hdr">${d}</div>`);

    getDaysInMonth(year, m).forEach(({ date, cur }) => {
      const ds = toDateStr(date);
      const ws = getWorkStatus(date, S.userScale);
      let cls = 'mini-day' + (!cur ? ' other' : (ds === today ? ' today' : (isHoliday(date) ? ' holiday' : (ws ? (ws.isOff ? ' off-day' : ' work-day') : ''))));
      if (cur && getEventsForDate(date).filter(e => !e.isIgnored).length > 0) cls += ' has-event';
      html += `<div class="${cls}">${cur ? date.getDate() : ''}</div>`;
    });

    html += `</div>`; // Fechar mini-grid

    // Monthly Summary Pills
    html += `
      <div class="mini-month-fin">
        <div class="mini-fin-item inc">
          <span class="material-symbols-outlined" style="font-size: 10px;">arrow_upward</span>
          ${mData.mIncome > 0 ? (mData.mIncome >= 1000 ? (mData.mIncome / 1000).toFixed(1) + 'k' : mData.mIncome.toFixed(0)) : '0'}
        </div>
        <div class="mini-fin-item exp">
          <span class="material-symbols-outlined" style="font-size: 10px;">arrow_downward</span>
          ${mData.mExpense > 0 ? (mData.mExpense >= 1000 ? (mData.mExpense / 1000).toFixed(1) + 'k' : mData.mExpense.toFixed(0)) : '0'}
        </div>
        <div class="mini-fin-item bal" style="color: ${mData.mBalance >= 0 ? 'var(--green)' : 'var(--danger)'}">
          ${mData.mBalance >= 0 ? '+' : ''}${mData.mBalance !== 0 ? (Math.abs(mData.mBalance) >= 1000 ? (Math.abs(mData.mBalance) / 1000).toFixed(1) + 'k' : Math.abs(mData.mBalance).toFixed(0)) : '0'}
        </div>
      </div>
    `;

    card.innerHTML = html;
    card.onclick = () => { play('click'); S.currentDate = monthDate; setView('month'); };
    grid.appendChild(card);
  }
}

function setView(mode) {
  S.viewMode = mode;
  // Update view containers visibility
  $('view-month').classList.toggle('active', mode === 'month');
  $('view-week').classList.toggle('active', mode === 'week');
  $('view-year').classList.toggle('active', mode === 'year');
  $('view-business').classList.toggle('active', mode === 'business');

  if (mode === 'business') {
    const vBiz = $('view-business');
    if (vBiz) vBiz.style.display = 'flex';
    renderBusinessTab();
  } else {
    const vBiz = $('view-business');
    if (vBiz) vBiz.style.display = 'none';
  }

  $('viewAI').classList.toggle('active', mode === 'ai');

  // Update button active state
  $('btn-view-month').classList.toggle('active', mode === 'month');
  $('btn-view-week').classList.toggle('active', mode === 'week');
  $('btn-view-year').classList.toggle('active', mode === 'year');
  const btnBiz = $('btn-view-business');
  if (btnBiz) btnBiz.classList.toggle('active', mode === 'business');
  $('btn-view-ai').classList.toggle('active', mode === 'ai');

  refreshCalendar();
}

function renderWeekView() {
  const d = new Date(S.currentDate);
  const day = d.getDay();
  const diff = d.getDate() - day;
  const startOfWeek = new Date(d.setDate(diff));
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
  const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
  const monthNames = typeof i18n !== 'undefined' ? i18n.t('months') : ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const title = `${startOfWeek.getDate()} ${monthNames[startOfWeek.getMonth()]} - ${endOfWeek.getDate()} de ${monthNames[endOfWeek.getMonth()]}`;
  $('week-title').textContent = title;

  const header = $('week-grid-header');
  const grid = $('week-grid');
  header.innerHTML = '';
  grid.innerHTML = '';
  header.style.display = 'flex';
  header.style.flexDirection = 'row';
  grid.style.display = 'flex';
  grid.style.flexDirection = 'row';
  grid.style.overflowY = 'auto';
  grid.style.position = 'relative';

  const wd = typeof i18n !== 'undefined' ? i18n.t('weekdays') : ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const today = toDateStr(new Date());

  // Weekly Finance Summary
  let weekInc = 0, weekExp = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const trs = getTransactionsForDate(d).filter(t => !t.isIgnored);
    trs.forEach(t => { if (t.type === 'income') weekInc += t.amount; else weekExp += t.amount; });
  }
  const sumDiv = $('week-finance-summary');
  if (sumDiv) {
    sumDiv.onclick = () => openFinances();
    sumDiv.innerHTML = `
      <div style="background: #eef2ff; padding: 8px; border-radius: 12px; text-align: center; border: 1px solid #c7d2fe;">
        <div style="font-size: 0.9rem; color: #4338ca; text-transform: uppercase;">${t('finance_income')}</div>
        <div style="font-size: 1.1rem; color: #1e1b4b; line-height: 1; ">${formatVal(weekInc)}</div>
      </div>
      <div style="background: #fff1f2; padding: 8px; border-radius: 12px; text-align: center; border: 1px solid #fecdd3;">
        <div style="font-size: 0.9rem; color: #be123c; text-transform: uppercase;">${t('finance_expenses')}</div>
        <div style="font-size: 1.1rem; color: #4c0519; line-height: 1; ">${formatVal(weekExp)}</div>
      </div>
      <div style="background: #f0fdf4; padding: 8px; border-radius: 12px; text-align: center; border: 1px solid #bbf7d0;">
        <div style="font-size: 0.9rem; color: #15803d; text-transform: uppercase;">${t('finance_balance')}</div>
        <div style="font-size: 1.1rem; color: #052e16; line-height: 1; ">${formatVal(weekInc - weekExp)}</div>
      </div>
    `;
  }

  // Time labels column
  const timeColumn = document.createElement('div');
  timeColumn.style = 'width: 50px; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--border); position: sticky; left: 0; z-index: 10;';

  // Header spacer for time column
  const spacer = document.createElement('div');
  spacer.style = 'width: 50px; flex-shrink: 0; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);';
  header.appendChild(spacer);

  const SLOT_H = 40; // 30 min = 40px

  // Calculate hour range from company settings
  let startH = 8;
  let endH = 18;
  const cHours = S.company?.hours || {};
  const allHours = Object.values(cHours);
  if (allHours.length > 0) {
    let min = 24, max = 0;
    allHours.forEach(h => {
      if (h.start) {
        const s = parseInt(h.start.split(':')[0]);
        if (s < min) min = s;
      }
      if (h.end) {
        const e = parseInt(h.end.split(':')[0]);
        if (e > max) max = e;
      }
    });
    if (max > min) {
      startH = min;
      endH = max + 1; // +1 to show the last hour slot fully
    }
  }
  if (endH > 24) endH = 24;

  for (let h = startH; h < endH; h++) {
    for (let m of [0, 30]) {
      const lbl = document.createElement('div');
      lbl.style = `height: ${SLOT_H}px; border-bottom: 1px solid var(--border-lt); position: relative;`;
      lbl.innerHTML = `<span style="position: absolute; top: 0; left: 50%; transform: translate(-50%, -50%); font-size: 0.65rem; color: var(--text3); background: var(--surface); padding: 0 4px; z-index: 2; white-space: nowrap;">${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}</span>`;
      timeColumn.appendChild(lbl);
    }
  }
  grid.appendChild(timeColumn);

  // Days columns
  for (let i = 0; i < 7; i++) {
    const cur = new Date(startOfWeek);
    cur.setDate(startOfWeek.getDate() + i);
    const ds = toDateStr(cur);
    const isToday = ds === today;

    // Header Day
    const hCol = document.createElement('div');
    hCol.style = `flex: 1; padding: 10px; text-align: center; border-right: 1px solid var(--border); background: ${isToday ? 'var(--primary-lt)' : 'var(--surface)'}; color: ${isToday ? 'var(--primary)' : 'var(--text2)'}; cursor: pointer;`;
    hCol.onclick = () => { play('click'); openDayModal(cur); };
    hCol.innerHTML = `<div style="font-size:0.7rem;">${wd[i]}</div><div style="">${cur.getDate()}</div>`;
    header.appendChild(hCol);
    // Grid Column
    const col = document.createElement('div');
    col.style = `flex: 1; position: relative; min-width: 100px; border-right: 1px solid var(--border); background: ${isToday ? 'rgba(124, 58, 237, 0.02)' : 'transparent'};`;
    col.onclick = () => openDayModal(cur);

    // Grid Lines
    for (let h = startH; h < endH; h++) {
      for (let m of [0, 30]) {
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const line = document.createElement('div');
        line.className = 'week-time-slot';
        line.style = `height: ${SLOT_H}px; border-bottom: 1px solid var(--border-lt); border-right: 1px solid var(--border-lt); opacity: 0.8; cursor: pointer; position: relative;`;
        line.onclick = (e) => {
          e.stopPropagation();
          window.openQuickAdd(cur, timeStr);
        };

        line.innerHTML = `<span class="slot-plus material-symbols-outlined">add</span>`;
        col.appendChild(line);
      }
    }

    // Items
    const evs = getEventsForDate(cur).filter(e => !e.isIgnored);
    const trs = getTransactionsForDate(cur).filter(t => !t.isIgnored);

    [...evs, ...trs].forEach(item => {
      const time = item.time || "08:00";
      const [hh, mm] = time.split(':').map(Number);

      // Skip if outside visible range
      if (hh < startH || hh >= endH) return;

      const top = ((hh - startH) * 2 * SLOT_H) + (mm >= 30 ? SLOT_H : 0) + (mm % 30 / 30 * SLOT_H);

      // Calculate Duration
      let duration = 30; // default
      if (item.duration) duration = item.duration;
      else if (item.services && item.services.length > 0) {
        duration = item.services.reduce((acc, sid) => {
          const s = (S.entities?.product || {})[sid];
          return acc + (s?.duration || 30);
        }, 0);
      }

      const height = (duration / 30) * SLOT_H;
      const color = item.category ? catColor(item.category) : (item.type === 'income' ? '#16a34a' : '#dc2626');

      const endMinsTotal = hh * 60 + mm + duration;
      const endHH = Math.floor(endMinsTotal / 60);
      const endMM = endMinsTotal % 60;
      const endTimeStr = `${String(endHH).padStart(2, '0')}:${String(endMM).padStart(2, '0')}`;

      const card = document.createElement('div');
      card.style = `position: absolute; top: ${top}px; left: 4px; right: 4px; height: ${height}px; background: ${color}; color: white; border-radius: 1px; padding: 4px; font-size: 0.7rem; overflow: hidden; z-index: 5; box-shadow: 0 2px 4px rgba(0,0,0,0.1); cursor: pointer; border-left: 3px solid rgba(0,0,0,0.2);`;
      card.innerHTML = `
            <div style="font-weight: 700;">${time} - ${endTimeStr}</div>
            <div style="white-space: nowrap; text-overflow: ellipsis; overflow: hidden; opacity: 0.9;">${item.title || item.desc}</div>
        `;
      card.onclick = (e) => {
        e.stopPropagation();
        if (item.category) openEventForm(item, cur);
        else window.openTransactionForm(cur, item);
      };
      col.appendChild(card);
    });
    grid.appendChild(col);
  }
}

function renderBusinessTab() {
  const container = $('business-list');
  const parent = $('business-content');
  if (!container || !parent) return;

  parent.style.position = 'relative';
  parent.style.overflow = 'hidden';
  parent.style.display = 'flex';
  parent.style.flexDirection = 'column';
  parent.style.height = '100%';

  container.style.overflowY = 'auto';
  container.style.flex = '1';
  container.innerHTML = '';

  const type = S.businessTab || 'professional';

  // Sincroniza o visual das abas superiores
  document.querySelectorAll('.business-tab-btn').forEach(b => {
    const isActive = b.dataset.tab === type;
    b.classList.toggle('active', isActive);
    b.classList.toggle('solid', isActive);
    if (isActive) {
      b.style.backgroundColor = '#7c3aed';
      b.style.color = '#ffffff';
      b.style.borderColor = '#7c3aed';
    } else {
      b.style.backgroundColor = 'transparent';
      b.style.color = 'var(--text2)';
      b.style.borderColor = 'var(--border)';
    }
  });
  const buttonflut = document.getElementById("btn-fixed-add-business");
  if (type === 'config') {

    renderCompanySettings(container);
    buttonflut.style.display = "none";
    return;
  } else {


  }

  const itemsObj = S.entities ? (S.entities[type] || {}) : {};
  const items = Object.values(itemsObj);

  // Remove botões de adicionar anteriores para evitar duplicidade
  const oldBtn = document.getElementById('btn-fixed-add-business');
  if (oldBtn) oldBtn.remove();
  if ($('btn-add-business-entity')) $('btn-add-business-entity').style.display = 'none';

  // Labels
  let addLabel = 'Profissional';
  if (type === 'unit') addLabel = 'Unidade';
  if (type === 'product') addLabel = 'Produto/Serv.';
  if (type === 'client') addLabel = 'Cliente';
  if (type === 'supplier') addLabel = 'Fornecedor';

  // Cria o botão fixo na base
  const addBtn = document.createElement('button');
  addBtn.id = 'btn-fixed-add-business';
  addBtn.className = 'btn btn-primary';
  addBtn.style = 'position: absolute; bottom: 20px; left: 20px; right: 20px; height: 52px; border-radius: 16px; gap: 10px; font-weight: 600; z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.2); justify-content: center;';
  addBtn.innerHTML = `
    <span class="material-symbols-outlined">add_circle</span>
    Adicionar ${addLabel}
  `;

  // For unit tab, use the dedicated unit modal
  addBtn.onclick = () => {
    if (typeof play === 'function') play('click');
    if (type === 'unit') {
      window.openUnitModal();
    } else if (window.openEntityModal) {
      window.openEntityModal(type);
    } else {
      console.error('Função openEntityModal não encontrada!');
    }
  };

  parent.appendChild(addBtn);

  // Espaçamento no fundo da lista para não cobrir itens
  container.style.paddingBottom = '80px';

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:40px; text-align:center; color:var(--text3);">Nenhum ${addLabel.toLowerCase()} encontrado.</div>`;
    return;
  }

  items.sort((a, b) => {
    const da = a.createdAt || '';
    const db = b.createdAt || '';
    return db.localeCompare(da);
  }).forEach(item => {
    const card = document.createElement('div');
    card.className = 'business-card';
    card.style = 'background:var(--surface); padding:16px; border-radius:16px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; transition: transform 0.2s; margin-bottom:12px; cursor:pointer;';

    let icon = 'person';
    if (type === 'unit') icon = 'location_on';
    if (type === 'product') icon = 'inventory_2';
    if (type === 'client') icon = 'person_add';
    if (type === 'supplier') icon = 'local_shipping';

    // For unit tab, use unit modal on click
    if (type === 'unit') {
      card.onclick = () => window.openUnitModal(item);
    } else {
      card.onclick = () => window.openEntityModal(type, item);
    }

    const photoHtml = item.photo ?
      `<img src="${item.photo}" style="width:40px; height:40px; border-radius:12px; object-fit:cover;">` :
      `<div style="background:var(--primary-lt); color:var(--primary); width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center;">
          <span class="material-symbols-outlined">${icon}</span>
        </div>`;

    // Build subtitle for each type
    let subtitle = '';
    if (type === 'unit') {
      const parts = [item.phone, item.street ? `${item.street}${item.city ? ', ' + item.city : ''}` : ''].filter(Boolean);
      subtitle = parts.join(' • ');
    } else if (type === 'professional') {
      const unitName = _getUnitName(item.unitId);
      const parts = [item.field1 || '', unitName ? `📍 ${unitName}` : ''].filter(Boolean);
      subtitle = parts.join(' • ');
    } else {
      subtitle = `${item.field1 || ''} ${item.field1 && item.field2 ? '•' : ''} ${item.field2 || ''}`;
    }

    const deleteAction = type === 'unit'
      ? `window.deleteUnit('${item.id}')`
      : `deleteEntity('${type}', '${item.id}')`;

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        ${photoHtml}
        <div>
          <div style="font-weight:600; color:var(--text);">${item.name}</div>
          <div style="font-size:0.8rem; color:var(--text3);">${subtitle}</div>
        </div>
      </div>
      <button class="btn btn-ghost btn-icon-sm" onclick="event.stopPropagation(); ${deleteAction}">
        <span class="material-symbols-outlined" style="color:var(--danger); font-size:20px;">delete</span>
      </button>
    `;
    container.appendChild(card);
  });
}

async function deleteEntity(type, id) {
  if (!confirm('Deseja realmente excluir este registro?')) return;
  try {
    showLoading('loading_saving');
    await apiFetch(`/entities/${type}/${id}`, { method: 'DELETE' });
    syncAllData();
    hideLoading();
  } catch (err) {
    hideLoading();
    console.error(err);
    alert('Erro ao excluir registro.');
  }
}

// ===================== UNIT HELPERS =====================
function _getUnitName(unitId) {
  if (!unitId) return '';
  const units = Object.values(S.entities?.unit || {});
  const u = units.find(u => u.id === unitId);
  return u ? u.name : '';
}

function _populateUnitSelect(selectEl, selectedId) {
  if (!selectEl) return;
  const units = Object.values(S.entities?.unit || {});
  selectEl.innerHTML = `<option value="">— Sem unidade —</option>`
    + units.map(u => `<option value="${u.id}" ${u.id === selectedId ? 'selected' : ''}>${u.name}</option>`).join('');
}

window.openUnitModal = (data = null) => {
  const isEdit = !!data;
  const titleEl = $('unit-modal-title');
  if (titleEl) titleEl.textContent = isEdit ? 'Editar Unidade' : 'Nova Unidade';

  $('unit-id').value = data ? data.id : '';
  $('unit-name').value = data ? data.name : '';
  $('unit-phone').value = data ? (data.phone || '') : '';
  $('unit-cnpj').value = data ? (data.cnpj || '') : '';
  $('unit-email').value = data ? (data.email || '') : '';
  $('unit-street').value = data ? (data.street || '') : '';
  $('unit-neighborhood').value = data ? (data.neighborhood || '') : '';
  $('unit-zip').value = data ? (data.zip || '') : '';
  $('unit-city').value = data ? (data.city || '') : '';
  $('unit-state').value = data ? (data.state || '') : '';
  $('unit-notes').value = data ? (data.notes || '') : '';

  const delBtn = $('btn-delete-unit');
  if (delBtn) delBtn.classList.toggle('hidden', !isEdit);
  if (delBtn && isEdit) {
    delBtn.onclick = () => window.deleteUnit(data.id);
  }

  openModal('modal-unit');
};

window.deleteUnit = async (id) => {
  if (!confirm('Deseja realmente excluir esta unidade? Os profissionais vinculados perderão o vínculo.')) return;
  try {
    showLoading('loading_saving');
    await apiFetch(`/entities/unit/${id}`, { method: 'DELETE' });
    syncAllData();
    closeModal('modal-unit');
    hideLoading();
  } catch (err) {
    hideLoading();
    console.error(err);
    alert('Erro ao excluir unidade.');
  }
};

function renderServiceSelection(context, current = []) {
  const container = $(`${context}-services-list`);
  if (!container) return;
  const services = Object.values(S.entities?.product || {});
  const t = (k) => typeof i18n !== 'undefined' ? (i18n.t(k) || k) : k;

  if (services.length === 0) {
    container.innerHTML = `<span style="font-size:0.8rem; opacity:0.5;">${t('no_services_found')}</span>`;
    return;
  }
  const inputClass = `service-chip-input-${context}`;
  container.innerHTML = services.map(s => {
    const checked = current.includes(s.id);
    return `
        <label style="display: flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid ${checked ? 'var(--primary)' : 'var(--border)'}; border-radius: 20px; cursor: pointer; font-size: 0.8rem; background: ${checked ? 'var(--primary-lt)' : 'var(--surface)'}; color: ${checked ? 'var(--primary)' : 'var(--text2)'}; transition: all 0.2s; white-space: nowrap;">
            <input type="checkbox" class="${inputClass}" value="${s.id}" ${checked ? 'checked' : ''} style="display:none;" 
                onchange="this.parentElement.style.background=this.checked?'var(--primary-lt)':'var(--surface)'; this.parentElement.style.color=this.checked?'var(--primary)':'var(--text2)'; this.parentElement.style.borderColor=this.checked?'var(--primary)':'var(--border)'; this.nextElementSibling.textContent=this.checked?'check_circle':'add_circle'; if('${context}'==='trans') window.updateTotalFromServices();">
            <span class="material-symbols-outlined" style="font-size: 16px;">${checked ? 'check_circle' : 'add_circle'}</span>
            ${s.name}
        </label>
    `;
  }).join('');
}

window.updateTotalFromServices = () => {
  const checks = document.querySelectorAll('.service-chip-input-trans:checked');
  let total = 0;
  checks.forEach(c => {
    const s = S.entities?.product?.[c.value];
    if (s && s.field1) {
      const price = parseFloat(String(s.field1).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
      total += price;
    }
  });
  const amountInput = $('trans-amount');
  if (amountInput) {
    amountInput.value = total.toFixed(2);
  }
}

function renderCompanySettings(container) {
  const c = S.company || {};
  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

  container.innerHTML = `
        <div style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">
            <div style="background: var(--primary-lt); padding: 16px; border-radius: 12px; border: 1px dashed var(--primary); display: flex; flex-direction: column; gap: 4px;">
                <label class="field-label" style="color: var(--primary); margin: 0; font-weight: 700;">Código da Empresa (Business ID)</label>
                <div style="font-family: monospace; font-size: 1.1rem; color: var(--text); display: flex; justify-content: space-between; align-items: center;">
                    <span id="cfg-business-code">${S.currentUser}</span>
                    <button class="btn btn-ghost btn-icon-sm" onclick="navigator.clipboard.writeText('${S.currentUser}'); alert('Código copiado!')">
                        <span class="material-symbols-outlined" style="font-size: 18px;">content_copy</span>
                    </button>
                </div>
                <p style="font-size: 0.75rem; color: var(--primary); margin-top: 4px; opacity: 0.8;">Passe este código para seus vendedores utilizarem no login.</p>
            </div>

            <div class="field-group">
                <label class="field-label">${t('label_company_logo')}</label>
                <input type="text" id="cfg-logo" class="field-input" value="${c.logo || ''}">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="field-group">
                    <label class="field-label">${t('label_cnpj')}</label>
                    <input type="text" id="cfg-cnpj" class="field-input" value="${c.cnpj || ''}">
                </div>
                <div class="field-group">
                    <label class="field-label">${t('label_phone')}</label>
                    <input type="text" id="cfg-phone" class="field-input" value="${c.phone || ''}">
                </div>
            </div>
            <div class="field-group">
                <label class="field-label">${t('label_pix')}</label>
                <input type="text" id="cfg-pix" class="field-input" value="${c.pix || ''}">
            </div>
            
            <label class="field-label">${t('label_opening_hours')}</label>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <input type="time" id="cfg-open" class="field-input" value="${c.open || '08:00'}">
                <span style="align-self: center;">às</span>
                <input type="time" id="cfg-close" class="field-input" value="${c.close || '18:00'}">
            </div>
            <label class="field-label">${t('label_rest_interval')}</label>
            <div style="display: flex; gap: 8px;">
                <input type="time" id="cfg-lunch-start" class="field-input" value="${c.lunchStart || '12:00'}">
                <span style="align-self: center;">às</span>
                <input type="time" id="cfg-lunch-end" class="field-input" value="${c.lunchEnd || '13:00'}">
            </div>

            <button class="btn btn-primary btn-full" onclick="saveCompanySettings()" style="margin-top: 20px;">
                Salvar Configurações
            </button>
        </div>
    `;
}

window.saveCompanySettings = async () => {
  showLoading('loading_saving');
  const data = {
    logo: $('cfg-logo').value,
    cnpj: $('cfg-cnpj').value,
    phone: $('cfg-phone').value,
    pix: $('cfg-pix').value,
    open: $('cfg-open').value,
    close: $('cfg-close').value,
    lunchStart: $('cfg-lunch-start').value,
    lunchEnd: $('cfg-lunch-end').value,
    updatedAt: new Date().toISOString()
  };
  try {
    await apiFetch('/company', { method: 'PUT', body: JSON.stringify(data) });
    syncAllData();
    hideLoading();
    play('click');
  } catch (err) {
    hideLoading();
    alert('Erro ao salvar.');
  }
}

window.openEntityModal = (type, data = null) => {
  S.currentEntityType = type;
  S.editingEntityId = data ? data.id : null;

  const title = $('entity-modal-title');
  const labelL1 = $('ent-f1-label');
  const labelL2 = $('ent-f2-label');

  // Preencher ou limpar campos
  $('ent-name').value = data ? data.name : '';
  $('ent-f1').value = data ? (data.field1 || '') : '';
  $('ent-f2').value = data ? (data.field2 || '') : '';

  // Reset extended
  $('ent-photo').value = data ? (data.photo || '') : '';
  $('ent-duration').value = data ? (data.duration || '') : '';
  $('ent-work-start').value = data ? (data.workStart || '08:00') : '08:00';
  $('ent-work-end').value = data ? (data.workEnd || '18:00') : '18:00';
  $('ent-rest-start').value = data ? (data.restStart || '12:00') : '12:00';
  $('ent-rest-end').value = data ? (data.restEnd || '13:00') : '13:00';
  
  // Credentials
  if ($('ent-username')) $('ent-username').value = data ? (data.username || '') : '';
  if ($('ent-password')) $('ent-password').value = data ? (data.password || '') : '';

  const isEdit = !!data;
  const ext = $('ent-extended-fields');
  const durGroup = $('ent-duration-group');
  const schedGroup = $('ent-professional-schedule');

  ext.classList.remove('hidden');
  durGroup.classList.add('hidden');
  schedGroup.classList.add('hidden');

  if (type === 'professional') {
    if (title) title.textContent = isEdit ? 'Editar Profissional' : 'Adicionar Profissional';
    if (labelL1) labelL1.textContent = 'Especialidade / Cargo';
    if (labelL2) labelL2.textContent = 'Telefone / Contato';
    schedGroup.classList.remove('hidden');
    // Populate unit selector
    _populateUnitSelect($('ent-unit'), data ? (data.unitId || '') : '');
    renderServiceSelection('ent', data ? (data.services || []) : []);
  } else if (type === 'product') {
    if (title) title.textContent = isEdit ? 'Editar Produto/Serv.' : 'Adicionar Produto/Serv.';
    if (labelL1) labelL1.textContent = 'Preço / Valor';
    if (labelL2) labelL2.textContent = 'Descrição Curta';
    durGroup.classList.remove('hidden');
  } else if (type === 'client') {
    if (title) title.textContent = isEdit ? 'Editar Cliente' : 'Adicionar Cliente';
    if (labelL1) labelL1.textContent = 'Telefone';
    if (labelL2) labelL2.textContent = 'Observação';
  } else if (type === 'supplier') {
    if (title) title.textContent = isEdit ? 'Editar Fornecedor' : 'Adicionar Fornecedor';
    if (labelL1) labelL1.textContent = 'Telefone';
    if (labelL2) labelL2.textContent = 'Empresa/Produto';
  }

  openModal('modal-entity');
};

// Listener para o formulário de entidades
document.addEventListener('DOMContentLoaded', () => {
  const entityForm = $('entity-form');
  if (entityForm) {
    entityForm.onsubmit = async (e) => {
      e.preventDefault();
      const name = $('ent-name').value;
      const f1 = $('ent-f1').value;
      const f2 = $('ent-f2').value;
      const type = S.currentEntityType;

      if (!name) return alert('Por favor, insira o nome.');

      showLoading('loading_saving');
      const id = S.editingEntityId || uid();

      const selectedServices = [];
      document.querySelectorAll('.service-chip-input-ent:checked').forEach(c => selectedServices.push(c.value));

      const data = {
        id,
        type,
        name,
        field1: f1,
        field2: f2,
        photo: $('ent-photo').value,
        duration: parseInt($('ent-duration').value) || 30,
        workStart: $('ent-work-start').value,
        workEnd: $('ent-work-end').value,
        restStart: $('ent-rest-start').value,
        restEnd: $('ent-rest-end').value,
        username: type === 'professional' ? ($('ent-username')?.value.trim() || '') : undefined,
        password: type === 'professional' ? ($('ent-password')?.value.trim() || '') : undefined,
        services: selectedServices,
        unitId: type === 'professional' ? ($('ent-unit')?.value || '') : undefined,
        createdAt: S.editingEntityId && S.entities[type] && S.entities[type][id] ? S.entities[type][id].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      try {
        await apiFetch(`/entities/${type}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        syncAllData();
        hideLoading();
        closeModal('modal-entity');
        play('click');
      } catch (err) {
        hideLoading();
        console.error(err);
        alert('Erro ao salvar o cadastro.');
      }
    };
  }

  // Listener for unit form
  const unitForm = $('unit-form');
  if (unitForm) {
    unitForm.onsubmit = async (e) => {
      e.preventDefault();
      const name = $('unit-name').value.trim();
      if (!name) return alert('Por favor, insira o nome da unidade.');

      showLoading('loading_saving');
      const id = $('unit-id').value || uid();
      const data = {
        id,
        type: 'unit',
        name,
        phone: $('unit-phone').value.trim(),
        cnpj: $('unit-cnpj').value.trim(),
        email: $('unit-email').value.trim(),
        street: $('unit-street').value.trim(),
        neighborhood: $('unit-neighborhood').value.trim(),
        zip: $('unit-zip').value.trim(),
        city: $('unit-city').value.trim(),
        state: $('unit-state').value.trim().toUpperCase(),
        notes: $('unit-notes').value.trim(),
        createdAt: $('unit-id').value && S.entities?.unit?.[$('unit-id').value]
          ? S.entities.unit[$('unit-id').value].createdAt
          : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      try {
        await apiFetch(`/entities/unit/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        syncAllData();
        hideLoading();
        closeModal('modal-unit');
        play('click');
      } catch (err) {
        hideLoading();
        console.error(err);
        alert('Erro ao salvar a unidade.');
      }
    };
  }
});


function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, len = 20) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

// ======================== MODALS & ACTIONS ========================
function buildEventItem(ev, withActions = true, showDate = false, contextDate = null) {
  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
  const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
  const wrap = document.createElement('div');
  wrap.className = 'event-item';
  if (ev.isIgnored) wrap.style.opacity = '0.5';

  let dateHtml = '';
  if (showDate && ev.date) {
    const d = new Date(ev.date + 'T12:00:00');
    const formattedDate = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
    dateHtml = `
      <div style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--primary);  background: var(--primary-lt); padding: 2px 8px; border-radius: 12px; flex-shrink: 0;">
        <span class="material-symbols-outlined" style="font-size:14px;">calendar_today</span>
        ${formattedDate}
      </div>`;
  }

  wrap.innerHTML = `
    <div class="event-stripe" style="background:${catColor(ev.category)}"></div>
    <div class="event-body">
      <div style="display:flex; align-items:center; justify-content: space-between; gap: 8px;">
        <div class="event-title" style="${ev.isIgnored ? 'text-decoration: line-through;' : ''}">${escHtml(ev.title)}</div>
        ${dateHtml}
      </div>
      <div class="event-meta">
        ${ev.time ? `
          <span class="material-symbols-outlined" style="font-size:16px;">schedule</span>
          <span>${ev.time}${ev.endTime ? ' - ' + ev.endTime : ''}</span>
        ` : ''}
        ${ev.category ? `<span style="opacity:0.8;">• ${(typeof i18n !== 'undefined' ? i18n.t('cat_' + ev.category.toLowerCase().replace('é', 'e')) : ev.category) || ev.category}</span>` : ''}
        ${ev.recurrence && ev.recurrence !== 'none' ? '<span class="material-symbols-outlined" style="font-size:16px;">sync</span>' : ''}
        ${ev.createdAt ? `<span style="opacity:0.8; margin-left: 4px;">• ${typeof i18n !== 'undefined' ? i18n.t('launched_on') : 'Lançado em'} ${new Date(ev.createdAt).toLocaleDateString(locale)}</span>` : ''}
      </div>
      ${ev.description ? `<div class="event-description">${escHtml(ev.description)}</div>` : ''}
      ${ev.isIgnored ? `
        <div style="display:flex; align-items:center; gap:4px; color:var(--danger); font-size:0.65rem;  margin-top:4px;">
          <span class="material-symbols-outlined" style="font-size:12px;">event_busy</span>
          <span>${t('ignored_instance_badge')}</span>
        </div>` : ''}
    </div>
    ${withActions ? `
    <div class="event-actions">
      <button class="btn btn-ghost btn-icon-sm" onclick="event.stopPropagation(); editEvent('${ev.id}', ${contextDate ? `'${contextDate.toISOString().split('T')[0]}'` : 'null'})">
        <span class="material-symbols-outlined" style="font-size:20px;">edit</span>
      </button>
      <button class="btn btn-ghost btn-icon-sm" onclick="event.stopPropagation(); delEvent('${ev.id}', ${contextDate ? `'${contextDate.toISOString().split('T')[0]}'` : 'null'})">
        <span class="material-symbols-outlined" style="font-size:20px; color:var(--danger);">delete</span>
      </button>
    </div>` : ''}
  `;

  wrap.onclick = (e) => {
    if (withActions) {
      S.editingEventId = ev.id;
      openEventForm(ev, contextDate);
    } else {
      if (document.getElementById('modal-search')) closeModal('modal-search');
      if (document.getElementById('modal-day')) closeModal('modal-day');
      openEventForm(ev);
    }
  };

  return wrap;
}

function openDayModal(d) {
  S.selectedDate = d;
  const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
  $('day-modal-title').textContent = d.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  $('day-modal-weekday').textContent = d.toLocaleDateString(locale, { weekday: 'long' });

  const ws = getWorkStatus(d, S.userScale);
  const statusEl = $('day-work-status');
  statusEl.innerHTML = '';
  if (ws && S.userScale) {
    statusEl.innerHTML = `
      <div class="work-badge-large ${ws.isOff ? 'off' : 'work'}">
        <span class="material-symbols-outlined">${ws.isOff ? 'home' : 'work'}</span>
        ${ws.isOff ? (typeof i18n !== 'undefined' ? i18n.t('tutorial_off_dot') : 'Folga') : (typeof i18n !== 'undefined' ? i18n.t('tutorial_work_dot') : 'Trabalho')}
      </div>
    `;
  }

  // Eventos
  const evs = getEventsForDate(d);
  const evList = $('day-events-list');
  evList.innerHTML = evs.length ? '' : `<p class="empty-state">${typeof i18n !== 'undefined' ? i18n.t('search_no_results') : 'Sem tarefas'}</p>`;
  evs.forEach(ev => {
    evList.appendChild(buildEventItem(ev, true, true, d));
  });

  // Finanças
  const trs = getTransactionsForDate(d);
  const trList = $('day-finance-list');
  trList.innerHTML = trs.length ? '' : `<p class="empty-state">${typeof i18n !== 'undefined' ? i18n.t('finance_empty') : 'Sem agendamentos'}</p>`;
  trs.forEach(t => {
    const isChecked = !!t.checked;
    const color = t.type === 'income' ? '#16a34a' : '#dc2626';
    const bgColor = t.type === 'income' ? '#dcfce7' : '#fee2e2';

    const div = document.createElement('div');
    div.className = 'finance-item' + (isChecked ? ' checked' : '');
    div.style = `
      display:flex; 
      align-items:center; 
      gap:12px; 
      padding: 12px 16px; 
      background: var(--surface); 
      border: 1px solid var(--border); 
      border-radius: 16px; 
      margin-bottom: 8px; 
      cursor:pointer; 
      opacity: ${t.isIgnored ? '0.4' : (isChecked ? '0.7' : '1')}; 
      box-shadow: 0 2px 8px rgba(0,0,0,0.02);
      transition: all 0.2s;
    `;

    div.innerHTML = `
      <button class="btn btn-ghost btn-icon-sm" onclick="window.toggleTransactionStatus('${t.id}', event, '${t.occurrenceDate}')" style="color: ${isChecked ? 'var(--primary)' : 'var(--text3)'}; padding: 0; width: 32px; height: 32px; flex-shrink: 0;">
        <span class="material-symbols-outlined" style="font-size:24px; font-variation-settings: 'FILL' ${isChecked ? 1 : 0}">${isChecked ? 'check_circle' : 'radio_button_unchecked'}</span>
      </button>
      
      <div style="background:${bgColor}; color:${color}; width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink: 0;">
        <span class="material-symbols-outlined" style="font-size:20px;">${t.type === 'income' ? 'trending_up' : 'trending_down'}</span>
      </div>
      
      <div style="flex:1; overflow: hidden;">
        <div >
          ${truncate(t.desc)} ${t.installments > 0 ? `<span style="font-size:0.75rem; color:var(--text3);  margin-left:4px;">(${t.currentInstallment}/${t.installments})</span>` : ''}
        </div>
        <div style="font-size:0.75rem; color:var(--text3); ">${t.type === 'income' ? (typeof i18n !== 'undefined' ? i18n.t('finance_type_income') : 'Agendamento') : (typeof i18n !== 'undefined' ? i18n.t('finance_type_expense') : 'Despesa')}${t.createdAt ? ` • ${typeof i18n !== 'undefined' ? i18n.t('launched_on') : 'Lançado em'} ${new Date(t.createdAt).toLocaleDateString(typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR')}` : ''}</div>
      </div>
      
      <div style="text-align:right; flex-shrink: 0;">
        <div style="font-size:1rem; color:${color}; text-decoration: ${(isChecked || t.isIgnored) ? 'line-through' : 'none'};">
          ${t.type === 'income' ? '+' : '-'} ${formatVal(t.amount)}
        </div>
        ${t.isIgnored ? `
          <div style="display:flex; align-items:center; gap:4px; color:var(--danger); font-size:0.7rem; margin-top:4px; justify-content: flex-end;">
            <span class="material-symbols-outlined" style="font-size:14px;">event_busy</span>
            <span data-i18n="ignored_instance_badge">${typeof i18n !== 'undefined' ? i18n.t('ignored_instance_badge') : 'DESCONSIDERADO'}</span>
          </div>
        ` : ''}
      </div>
    `;
    div.onclick = (e) => {
      if (e.target.closest('button')) return;
      closeModal('modal-day');
      window.openTransactionForm(d, t);
    };
    trList.appendChild(div);
  });

  openModal('modal-day');
  trackAction('view_day_details');
}

window.editEvent = (id) => { closeModal('modal-day'); openEventForm(S.events.find(e => e.id === id)); };
window.delEvent = async (id) => {
  showLoading('loading_deleting');
  await deleteEvent(id);
  S.events = S.events.filter(e => e.id !== id);
  S.lastRenderedYear = null;
  refreshCalendar();
  hideLoading();
};

function openEventForm(evt, clickedDate = null) {
  // Garantir que nenhum outro modal esteja aberto
  window.closeAnyModal();

  const isNew = !evt || !evt.id;
  S.editingEventId = isNew ? null : evt.id;
  S.editingOccurrenceDate = clickedDate ? toDateStr(clickedDate) : (evt?.date ? evt.date : toDateStr(new Date()));
  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

  $('event-modal-title').textContent = evt ? t('edit_event') : t('new_event');
  $('evt-title').value = evt?.title || '';
  $('evt-desc').value = evt?.description || '';
  const displayDate = clickedDate || (evt?.date ? new Date(evt.date + 'T12:00:00') : (S.selectedDate || new Date()));
  setFPValue('evt-date', toDateStr(displayDate));
  setFPValue('evt-time', evt?.time || '');
  setFPValue('evt-end-date', evt?.endDate || toDateStr(displayDate));
  setFPValue('evt-end-time', evt?.endTime || '');
  $('evt-recurrence').value = evt?.recurrence || 'none';
  if ($('evt-payment')) $('evt-payment').value = evt?.paymentMethod || 'none';
  if ($('evt-professional')) $('evt-professional').value = evt?.professionalId || '';

  updateProfSelectors();
  renderServiceSelection('evt', evt?.services || []);


  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === (evt?.category || 'evento')));

  const endRow = $('evt-end-row');
  if (endRow) endRow.classList.toggle('hidden', $('evt-recurrence').value !== 'periodo');

  if (evt) show('btn-delete-event'); else hide('btn-delete-event');
  updateWorkBadge($('evt-date').value);

  const recArea = $('event-recurring-options');
  const btnIgnore = $('btn-ignore-event-instance');

  if (evt && recArea && btnIgnore) {
    recArea.classList.remove('hidden');
    const isIgnored = evt.excludedDates && evt.excludedDates[S.editingOccurrenceDate];
    const recType = (evt.recurrence && evt.recurrence !== 'none') ? evt.recurrence : 'daily';
    const i18nKey = (isIgnored ? 'consider_instance_' : 'ignore_instance_') + recType;

    const span = btnIgnore.querySelector('[data-i18n]');
    if (span) {
      span.setAttribute('data-i18n', i18nKey);
      if (typeof i18n !== 'undefined') span.innerHTML = i18n.t(i18nKey);
    }
    if (typeof i18n !== 'undefined') i18n.applyToDOM();

    btnIgnore.style.color = isIgnored ? 'var(--primary)' : 'var(--danger)';
    btnIgnore.style.borderColor = isIgnored ? 'var(--primary-lt)' : 'var(--danger-lt)';
    const icon = btnIgnore.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = isIgnored ? 'event_available' : 'event_busy';
  } else {
    // Modo Novo ou elementos não encontrados
    if (recArea) recArea.classList.add('hidden');
  }

  openModal('modal-event');
}

function updateWorkBadge(ds) {
  if (ds && ds.includes('/')) ds = parseDate(ds);
  const ws = getWorkStatus(new Date(ds + 'T12:00:00'), S.userScale);
  const b = $('event-work-badge');
  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
  if (ws && S.userScale) {
    b.className = 'work-badge ' + (ws.isOff ? 'off' : 'work');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">${ws.isOff ? 'home' : 'work'}</span> ${ws.isOff ? t('badge_off') : t('badge_work')}`;
    b.classList.remove('hidden');
  } else b.classList.add('hidden');
}

let isSavingEvent = false;
async function saveEventForm(e) {
  e.preventDefault();
  if (isSavingEvent) return;
  const tEl = $('evt-title'), dEl = $('evt-date'), errT = $('err-title');
  const title = tEl.value.trim(), date = parseDate(dEl.value);

  // Resetar erros
  errT.classList.add('hidden');
  tEl.classList.remove('field-error');

  if (!title) {
    errT.classList.remove('hidden');
    tEl.classList.add('field-error');
    tEl.focus();
    return;
  }
  if (!date) return;

  isSavingEvent = true;
  const recValue = $('evt-recurrence').value;
  const data = {
    title,
    date,
    endDate: (recValue === 'periodo') ? (parseDate($('evt-end-date').value) || date) : (recValue === 'none' ? date : null),
    description: $('evt-desc').value.trim(),
    time: $('evt-time').value,
    endTime: $('evt-end-time').value,
    category: document.querySelector('.cat-btn.active')?.dataset.cat || 'evento',
    recurrence: recValue,
    professionalId: $('evt-professional')?.value || '',
    paymentMethod: $('evt-payment')?.value || 'none',
    services: Array.from(document.querySelectorAll('.service-chip-input-evt:checked')).map(c => c.value)
  };

  // Calculate Total Duration
  let totalDur = 30; // Default
  if (data.services.length > 0) {
    totalDur = 0;
    data.services.forEach(svcId => {
      const svc = S.entities.product?.[svcId];
      if (svc) totalDur += parseInt(svc.duration) || 30;
    });
  }
  data.duration = totalDur;

  // Conflict Check
  if (data.professionalId && data.time) {
    const conflict = S.checkConflicts(data.professionalId, data.date, data.time, data.duration, S.editingEventId);
    if (conflict) {
      isSavingEvent = false;
      return alert(`Conflito de Horário!\nO profissional já possui um(a) ${conflict.type} (${conflict.title}) às ${conflict.time}.`);
    }
  }

  const original = S.editingEventId ? S.events.find(e => e.id === S.editingEventId) : null;
  const isRecurring = original && original.recurrence && original.recurrence !== 'none';
  let shouldAsk = isRecurring;
  let hideOnlyThis = false;

  if (original) {
    const recurrenceChanged = (data.recurrence !== original.recurrence || data.endDate !== (original.endDate || null));
    const mainPropsSame = (data.title === original.title && data.description === original.description && data.time === original.time && data.category === original.category && data.date === original.date);

    if (recurrenceChanged) {
      hideOnlyThis = true;
      if (mainPropsSame) {
        shouldAsk = false;
      }
    }
  }

  const isEditingVirtual = isRecurring && S.editingOccurrenceDate !== original.date;

  const performAllSave = async () => {
    showLoading('loading_saving');
    const saveData = { ...data };
    if (isEditingVirtual && original) {
      saveData.date = original.date;
    }
    if (S.editingEventId) await updateEvent(S.editingEventId, saveData); else await addEvent(saveData);
    finishSave();
  };

  const performInstanceSave = async () => {
    try {
      showLoading('loading_saving');
      if (original) {
        const overrideData = {
          title: data.title,
          description: data.description,
          time: data.time,
          endTime: data.endTime,
          category: data.category,
          date: data.date,
          endDate: data.endDate
        };
        if (!original.overrides) original.overrides = {};
        original.overrides[S.editingOccurrenceDate] = overrideData;
        await userRef(`events/${original.id}/overrides/${S.editingOccurrenceDate}`).set(overrideData);
      }
      finishSave();
    } catch (err) {
      console.error("Erro ao salvar sobreposição:", err);
      alert(typeof i18n !== 'undefined' ? i18n.t('err_apply_override') : "Erro ao aplicar edição específica.");
      hideLoading();
      isSavingEvent = false;
    }
  };

  const finishSave = () => {
    S.lastRenderedYear = null;
    refreshCalendar();
    hideLoading();
    closeModal('modal-event');
    play('click');
    setTimeout(() => isSavingEvent = false, 500);
  };

  if (shouldAsk) {
    window.showRecurrenceChoiceModal(performInstanceSave, performAllSave, hideOnlyThis);
    isSavingEvent = false;
    return;
  }

  showLoading('loading_saving');
  if (S.editingEventId) await updateEvent(S.editingEventId, data); else await addEvent(data);
  finishSave();
}

// Limpar erro ao digitar
document.addEventListener('DOMContentLoaded', () => {
  if ($('evt-title')) {
    $('evt-title').oninput = () => {
      $('err-title').classList.add('hidden');
      $('evt-title').classList.remove('field-error');
    };
  }
});

// ======================== SCALE SETUP ========================
function openScaleModal() {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Se já tem escala, projetamos ela para os 30-31 dias do mês
  if (S.userScale && S.userScale.sequence) {
    S.customSeq = [];
    for (let i = 0; i < daysInMonth; i++) {
      const d = new Date(startOfMonth);
      d.setDate(1 + i);
      const ws = getWorkStatus(d, S.userScale);
      S.customSeq.push(ws.isOff ? 'F' : 'T');
    }
  } else {
    S.customSeq = new Array(daysInMonth).fill(null);
  }

  const errEl = $('scale-error');
  if (errEl) { errEl.textContent = ''; hide('scale-error'); }

  renderScalePreview();
  openModal('modal-scale');
}

function renderScalePreview() {
  const wrap = $('scale-weekday-grid');
  wrap.innerHTML = '';
  const dayNames = typeof i18n !== 'undefined' ? i18n.t('weekdays') : ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';

  const now = new Date();
  const currentMonthName = now.toLocaleDateString(locale, { month: 'long' });
  const todayStr = toDateStr(now);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const offset = startOfMonth.getDay();

  let html = `
    <div class="scale-month-block">
      <div class="scale-month-name" style="text-transform: capitalize;">${currentMonthName}</div>
      <div class="scale-mini-grid">
  `;

  // Headers
  dayNames.forEach(d => html += `<div class="scale-hdr">${d}</div>`);

  // Offset days
  for (let i = 0; i < offset; i++) {
    html += `<div class="scale-day" style="opacity: 0; pointer-events: none;"></div>`;
  }

  // Actual days
  for (let idx = 0; idx < S.customSeq.length; idx++) {
    const st = S.customSeq[idx];
    const date = new Date(startOfMonth);
    date.setDate(1 + idx);
    const isToday = toDateStr(date) === todayStr;

    html += `
      <div class="scale-day ${st === 'T' ? 'work-explicit' : (st === 'F' ? 'off-explicit' : '')} ${isToday ? 'scale-today-marker' : ''}" 
           onclick="toggleScaleDay(${idx})">
        ${date.getDate()}
      </div>`;
  }

  html += `</div></div>`;
  wrap.innerHTML = html;

  // Habilita o botão sempre para podermos clicar e mostrar erro
  $('btn-save-scale').disabled = false;
  // Limpa o erro se o usuário começar a interagir
  hide('scale-error');
}

window.toggleScaleDay = (idx) => { play('click'); const s = S.customSeq[idx]; S.customSeq[idx] = s === 'T' ? 'F' : (s === 'F' ? 'T' : 'T'); renderScalePreview(); };

window.modifyWeeks = (delta) => {
  play('click');
  if (delta > 0) {
    for (let i = 0; i < 7; i++) S.customSeq.push(null);
  } else {
    if (S.customSeq.length > 7) S.customSeq.splice(-7);
  }
  renderScalePreview();
};

window.applyPreset = (type) => {
  play('click');
  const presets = {
    '4_serv': 'FTFTFTFTFFF FTFTFTFTFFF'.replace(/ /g, '').split(''), // Exemplo aproximado
    '5_serv': 'FTFTFTFTFTFFF FTFTFTFTFTFFF'.replace(/ /g, '').split(''),
    'dobradinha': 'FTFTFFTTFTFTTF'.split(''),
    'admin': 'FTTTTTF'.split(''),
    '12x36': 'TF'.split(''),
    '24x72': 'TFFF'.split('')
  };

  const base = presets[type];
  if (!base) return;

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  // Preenche o mês inteiro repetindo o padrão
  S.customSeq = [];
  for (let i = 0; i < daysInMonth; i++) {
    S.customSeq.push(base[i % base.length]);
  }

  renderScalePreview();
};

async function saveScale() {
  const errEl = $('scale-error');
  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
  errEl.textContent = '';
  hide('scale-error');

  const seqFull = S.customSeq.map(s => s === 'T' ? 1 : 0);
  const incomplete = S.customSeq.some(x => x === null);
  if (incomplete) {
    errEl.textContent = t('scale_err_incomplete');
    show('scale-error');
    return;
  }

  if (seqFull.every(v => v === 0)) {
    errEl.textContent = t('scale_err_seq');
    show('scale-error');
    return;
  }

  const seq = getShortestPattern(seqFull);

  // A referência agora é o dia 1 do mês atual
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth(), 1);
  ref.setHours(0, 0, 0, 0);

  const display = seq.length <= 7 ? (seq.filter(v => v === 1).length + 'x' + seq.filter(v => v === 0).length) : (typeof i18n !== 'undefined' ? i18n.t('custom_scale') : 'Escala Custom');
  S.userScale = { sequence: seq, referenceDate: ref.getTime(), display };
  S.forceScale = false;

  showLoading('loading_saving');
  await saveProfile();
  hideLoading();

  $('scale-display').textContent = S.userScale.display;
  show('scale-bar');
  closeModal('modal-scale');
  S.lastRenderedYear = null;
  refreshCalendar();
  runOnboardingFlow();
}

window.dismissScaleModal = async () => {
  S.forceScale = false;
  if (!S.userScale || (S.userScale && typeof S.userScale === 'object' && !S.userScale.sequence)) {
    S.userScale = { dismissed: true, display: (typeof i18n !== 'undefined' && i18n.translations && i18n.translations[i18n.currentLocale] && i18n.translations[i18n.currentLocale]['no_scale'] ? i18n.t('no_scale') : 'Sem Escala') };
    showLoading('loading_saving');
    await saveProfile();
    hideLoading();
    if (document.getElementById('scale-display')) document.getElementById('scale-display').textContent = S.userScale.display;
  }
  closeModal('modal-scale');
  runOnboardingFlow();
};

window.setOnboardingSound = (enabled) => {
  S.soundsEnabled = enabled;
  updateSoundIcon();
  localStorage.setItem('agbizu_onboarding_sound', 'done');
  saveProfile();
  closeModal('modal-onboarding-sound');
  play('click');
};

// ======================== SEARCH & PAGINATION ========================
S.searchState = {
  results: [],
  page: 0,
  pageSize: 10
};

function renderSearch(query) {
  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
  const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
  const q = query.trim().toLowerCase();

  const countEl = $('events-count');
  const resultsEl = $('search-results');
  resultsEl.innerHTML = '';

  if (!q) {
    if (countEl) countEl.style.display = "none";
    return;
  }

  if (countEl) {
    countEl.style.display = "flex";
    countEl.style.gap = "5px";
  }

  const filtered = S.events.filter(ev => {
    const d = new Date(ev.date + 'T12:00:00');
    return (
      ev.title.toLowerCase().includes(q) ||
      (ev.description || '').toLowerCase().includes(q) ||
      (ev.category || '').toLowerCase().includes(q) ||
      d.toLocaleDateString(locale).includes(q)
    );
  }).sort((a, b) => a.date.localeCompare(b.date));

  if (!filtered.length) {
    if (countEl) countEl.innerHTML = `0 <span data-i18n="events_count_zero">${t('events_count_zero')}</span>`;
    resultsEl.innerHTML = `<div class="no-events">${t('search_no_results')}</div>`;
    return;
  }

  // Deduplicar mantendo ordem original
  const dedupedFull = [];
  const seen = new Set();
  filtered.forEach(ev => {
    const rootId = ev.parentEventId || ev.id;
    if (!seen.has(rootId)) {
      seen.add(rootId);
      dedupedFull.push(ev);
    }
  });

  S.searchState.results = dedupedFull;
  S.searchState.page = 0;

  if (countEl) {
    countEl.innerHTML = `${dedupedFull.length} <span data-i18n="events_count_zero">${t('events_count_zero')}</span>`;
    if (typeof i18n !== 'undefined') i18n.applyToDOM();
  }

  renderSearchPage();
}

function renderSearchPage() {
  const resultsEl = $('search-results');
  const btnMore = $('btn-load-more-search');
  if (btnMore) btnMore.remove();

  const start = S.searchState.page * S.searchState.pageSize;
  const end = start + S.searchState.pageSize;
  const items = S.searchState.results.slice(start, end);

  items.forEach(ev => {
    resultsEl.appendChild(buildEventItem(ev, false, true));
  });

  if (end < S.searchState.results.length) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'btn-load-more-search';
    loadMoreBtn.className = 'btn btn-outline btn-full';
    loadMoreBtn.style.marginTop = '16px';
    loadMoreBtn.style.marginBottom = '24px';
    loadMoreBtn.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:18px;">expand_more</span>
      <span>${typeof i18n !== 'undefined' ? i18n.t('btn_load_more') : 'Carregar Mais'}</span>
    `;
    loadMoreBtn.onclick = () => {
      S.searchState.page++;
      renderSearchPage();
    };
    resultsEl.appendChild(loadMoreBtn);
  }
}

// Mensagem Diária e Onboarding Sequencial
function runOnboardingFlow() {
  // 1. Escala Obrigatória
  if (S.forceScale) {
    setTimeout(() => { openScaleModal(); }, 400);
    return;
  }

  // 2. Mensagem Bíblica Diária
  const showedBible = checkDailyMessage();
  if (showedBible) return;

  // 3. Onboarding de Som
  checkOnboardingSound();
}

window.checkOnboardingSound = () => {
  if (!localStorage.getItem('agbizu_onboarding_sound')) {
    openModal('modal-onboarding-sound');
  }
};

function checkDailyMessage() {
  const today = toDateStr(new Date());
  const lastDate = localStorage.getItem('agbizu_last_msg_date');
  if (lastDate === today) return false;

  const dayOfMonth = new Date().getDate();
  const msgs = getMensagensDoDia();
  const msg = msgs.find(m => m.dia === dayOfMonth) || msgs[0];

  $('bible-verse-ref').textContent = msg.versiculo;
  $('bible-message').textContent = `“${msg.mensagem}”`;
  $('bible-reflection').textContent = msg.reflexao;

  openModal('modal-bible');
  localStorage.setItem('agbizu_last_msg_date', today);
  return true;
}

function updateSoundIcon() {
  const on = S.soundsEnabled;
  if ($('icon-sound-on')) $('icon-sound-on').classList.toggle('hidden', !on);
  if ($('icon-sound-off')) $('icon-sound-off').classList.toggle('hidden', on);

  if ($('shortcut-icon-sound-on')) $('shortcut-icon-sound-on').classList.toggle('hidden', !on);
  if ($('shortcut-icon-sound-off')) $('shortcut-icon-sound-off').classList.toggle('hidden', on);

  localStorage.setItem('agbizu_sounds_enabled', on);
}

document.addEventListener('DOMContentLoaded', () => {
  // Apply i18n on first load
  if (typeof i18n !== 'undefined') {
    i18n.applyToDOM();
    // Re-render calendar on lang change
    document.addEventListener('langchange', () => {
      S.lastRenderedYear = null;
      if (S.currentUser) {
        refreshCalendar();
        // FIX: Only reopen the day modal if it was already open
        const dayModal = $('modal-day');
        if (dayModal && !dayModal.classList.contains('hidden') && S.selectedDate) {
          openDayModal(S.selectedDate);
        }
      }
    });
  }

  loadAudio();

  // ---- Listeners de Teclado/Foco no Login ----
  const loginScr = $('login-screen');
  const loginInputs = [$('inp-email'), $('inp-pass'), $('inp-name'), $('inp-confirm')];
  loginInputs.forEach(inp => {
    if (inp) {
      inp.onfocus = () => loginScr.classList.add('focused');
      // Removido o loginScr.classList.remove('focused') no onblur para manter o topo oculto
    }
  });

  $('btn-new-event').onclick = () => { window.closeAnyModal(); S.selectedDate = new Date(); openEventForm(); };
  $('btn-new-transaction-side').onclick = () => { window.closeAnyModal(); window.openTransactionForm(new Date()); };

  // Botões do menu lateral: navegam para a aba correta na view de Negócios
  const goToBusinessTab = (tab) => {
    toggleSideMenu(false);
    S.businessTab = tab;
    document.querySelectorAll('.business-tab-btn').forEach(b => {
      const isActive = b.dataset.tab === tab;
      b.classList.toggle('active', isActive);
      b.classList.toggle('solid', isActive);
    });
    setView('business');
    if (typeof renderBusinessTab === 'function') renderBusinessTab();
    play('click');
  };
  if ($('btn-add-professional')) $('btn-add-professional').onclick = () => goToBusinessTab('professional');
  if ($('btn-add-product')) $('btn-add-product').onclick = () => goToBusinessTab('product');
  if ($('btn-add-client')) $('btn-add-client').onclick = () => goToBusinessTab('client');
  if ($('btn-add-supplier')) $('btn-add-supplier').onclick = () => goToBusinessTab('supplier');

  if ($('btn-close-entity')) $('btn-close-entity').onclick = () => closeModal('modal-entity');

  $('btn-add-from-day').onclick = () => { closeModal('modal-day'); openEventForm(); };
  $('btn-toggle-sound').onclick = () => { S.soundsEnabled = !S.soundsEnabled; updateSoundIcon(); saveProfile(); };
  if ($('btn-shortcut-sound')) {
    $('btn-shortcut-sound').onclick = () => { S.soundsEnabled = !S.soundsEnabled; updateSoundIcon(); saveProfile(); };
  }
  if ($('btn-logout')) $('btn-logout').onclick = () => { window.closeAnyModal(); openModal('modal-logout'); };
  if ($('btn-confirm-logout')) $('btn-confirm-logout').onclick = () => logout();
  if ($('btn-cancel-logout')) $('btn-cancel-logout').onclick = () => closeModal('modal-logout');
  if ($('btn-close-bible')) {
    $('btn-close-bible').onclick = () => {
      closeModal('modal-bible');
      runOnboardingFlow();
    };
  }

  $('btn-open-menu').onclick = () => toggleSideMenu(true);
  $('btn-close-menu').onclick = () => toggleSideMenu(false);
  if ($('btn-collapse-sidebar')) {
    $('btn-collapse-sidebar').onclick = () => window.toggleSidebar();
  }
  $('side-menu-overlay').onclick = () => toggleSideMenu(false);
  $('btn-lang-picker').onclick = () => { window.closeAnyModal(); window.openLangPicker(); };

  $('btn-scale-settings').onclick = () => openScaleModal();
  $('btn-view-month').onclick = () => setView('month');
  $('btn-view-week').onclick = () => setView('week');
  $('btn-view-year').onclick = () => setView('year');
  $('btn-view-ai').onclick = () => setView('ai');

  if ($('btn-prev-week')) $('btn-prev-week').onclick = () => { S.currentDate.setDate(S.currentDate.getDate() - 7); refreshCalendar(); };
  if ($('btn-next-week')) $('btn-next-week').onclick = () => { S.currentDate.setDate(S.currentDate.getDate() + 7); refreshCalendar(); };
  if ($('btn-today-week')) $('btn-today-week').onclick = () => { S.currentDate = new Date(); refreshCalendar(); };
  if ($('btn-view-business')) $('btn-view-business').onclick = () => { toggleSideMenu(false); setView('business'); };

  // Business Tabs - Visual Roxo (Active + Solid)
  document.querySelectorAll('.business-tab-btn').forEach(btn => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      S.businessTab = tab;

      document.querySelectorAll('.business-tab-btn').forEach(b => {
        const isActive = b.dataset.tab === tab;
        b.classList.toggle('active', isActive);
        b.classList.toggle('solid', isActive);
      });

      renderBusinessTab();
      play('click');
    };
  });

  if ($('btn-add-business-entity')) {
    $('btn-add-business-entity').onclick = () => {
      play('click');
      window.openEntityModal(S.businessTab || 'professional');
    };
  }

  $('btn-agent-side').onclick = () => { toggleSideMenu(false); setView('ai'); };

  if ($('month-title')) {
    $('month-title').style.cursor = 'pointer';
    $('month-title').onclick = () => setView('year');
  }
  if ($('btn-prev-month')) $('btn-prev-month').onclick = () => { S.currentDate.setDate(1); S.currentDate.setMonth(S.currentDate.getMonth() - 1); refreshCalendar(); };
  if ($('btn-next-month')) $('btn-next-month').onclick = () => { S.currentDate.setDate(1); S.currentDate.setMonth(S.currentDate.getMonth() + 1); refreshCalendar(); };
  if ($('btn-prev-month-abs')) $('btn-prev-month-abs').onclick = () => { S.currentDate.setDate(1); S.currentDate.setMonth(S.currentDate.getMonth() - 1); refreshCalendar(); };
  if ($('btn-next-month-abs')) $('btn-next-month-abs').onclick = () => { S.currentDate.setDate(1); S.currentDate.setMonth(S.currentDate.getMonth() + 1); refreshCalendar(); };

  if ($('btn-quick-add-event')) $('btn-quick-add-event').onclick = () => {
    closeModal('modal-quick-add');
    const { date, time } = S.quickAddData;
    openEventForm({ time }, date);
  };

  if ($('btn-quick-add-trans')) $('btn-quick-add-trans').onclick = () => {
    closeModal('modal-quick-add');
    const { date, time } = S.quickAddData;
    window.openTransactionForm(date, { time });
  };

  window.goToToday = () => {
    S.currentDate = new Date();
    // If we are in AI or Business, go to Month, otherwise stay in current view
    if (S.viewMode === 'ai' || S.viewMode === 'business') {
      setView('month');
    } else {
      refreshCalendar();
    }
    toggleSideMenu(false);
  };
  if ($('btn-today')) $('btn-today').onclick = goToToday;
  if ($('btn-go-home')) $('btn-go-home').onclick = goToToday;

  const swiper = $('month-swiper');
  const wrapper = $('month-slides-wrapper');

  if (swiper && wrapper) {
    let startX = 0, currentTranslate = 0, isDragging = false;

    swiper.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      isDragging = true;
      wrapper.style.transition = 'none';
    }, { passive: true });

    swiper.addEventListener('touchmove', e => {
      if (!isDragging) return;
      const diff = e.touches[0].clientX - startX;
      const m = S.currentDate.getMonth();
      const translate = -(m * wrapper.offsetWidth) + diff;
      wrapper.style.transform = `translateX(${translate}px)`;
    }, { passive: true });

    swiper.addEventListener('touchend', e => {
      if (!isDragging) return;
      isDragging = false;
      const diff = e.changedTouches[0].clientX - startX;
      wrapper.style.transition = '';

      if (Math.abs(diff) > swiper.offsetWidth / 5) {
        S.currentDate.setDate(1);
        if (diff > 0) S.currentDate.setMonth(S.currentDate.getMonth() - 1);
        else S.currentDate.setMonth(S.currentDate.getMonth() + 1);
      }
      refreshCalendar();
    }, { passive: true });
  }
  if ($('btn-prev-year')) $('btn-prev-year').onclick = () => { S.currentDate.setFullYear(S.currentDate.getFullYear() - 1); renderYearView(); };
  if ($('btn-next-year')) $('btn-next-year').onclick = () => { S.currentDate.setFullYear(S.currentDate.getFullYear() + 1); renderYearView(); };
  if ($('btn-back-to-month')) $('btn-back-to-month').onclick = () => setView('month');
  if ($('evt-recurrence')) {
    $('evt-recurrence').onchange = (e) => {
      const endRow = $('evt-end-row');
      if (endRow) endRow.classList.toggle('hidden', e.target.value !== 'periodo');
    };
  }
  if ($('event-form')) $('event-form').onsubmit = saveEventForm;
  if ($('btn-close-day')) $('btn-close-day').onclick = () => closeModal('modal-day');
  if ($('btn-close-event')) $('btn-close-event').onclick = () => closeModal('modal-event');
  if ($('btn-cancel-event')) $('btn-cancel-event').onclick = () => closeModal('modal-event');
  if ($('btn-delete-event')) {
    let clickedDel = false;
    $('btn-delete-event').onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (clickedDel) return;
      clickedDel = true;
      if (S.editingEventId) {
        closeModal('modal-event');
        window.showConfirmModal('confirm_delete_title', 'confirm_delete_desc', async () => {
          await window.delEvent(S.editingEventId);
        });
      }
      setTimeout(() => clickedDel = false, 500); // Libera após 500ms
    };
  }
  if ($('btn-open-scale')) $('btn-open-scale').onclick = () => { toggleSideMenu(false); openScaleModal(); };
  if ($('btn-close-scale')) $('btn-close-scale').onclick = () => closeModal('modal-scale');
  if ($('btn-save-scale')) $('btn-save-scale').onclick = () => { saveScale(); trackAction('save_scale'); };
  if ($('btn-clear-seq')) $('btn-clear-seq').onclick = () => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    S.customSeq = new Array(daysInMonth).fill(null);
    renderScalePreview();
  };

  document.querySelectorAll('.cat-btn').forEach(b => b.onclick = () => { document.querySelectorAll('.cat-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); });

  // ---- Pesquisa ----
  if ($('btn-search')) {
    $('btn-search').onclick = () => {
      window.closeAnyModal();
      if ($('btn-clear-search')) $('btn-clear-search').onclick = () => { if ($('search-input')) $('search-input').value = ''; renderSearch(''); };
      play('click'); $('search-input').value = ''; renderSearch('');
      openModal('modal-search');
      setTimeout(() => $('search-input').focus(), 400);
    };
  }
  if ($('search-input')) $('search-input').oninput = e => renderSearch(e.target.value);
  if ($('btn-close-search')) $('btn-close-search').onclick = () => closeModal('modal-search');

  // ---- Financeira ----
  if ($('btn-open-finances')) $('btn-open-finances').onclick = () => { toggleSideMenu(false); play('click'); openFinances(); };
  if ($('btn-close-finances')) $('btn-close-finances').onclick = () => closeModal('modal-finances');
  if ($('btn-add-transaction')) $('btn-add-transaction').onclick = () => { closeModal('modal-finances'); window.openTransactionForm(); };
  if ($('btn-close-transaction')) $('btn-close-transaction').onclick = () => closeModal('modal-transaction');
  if ($('btn-delete-transaction')) {
    let clickedDelTrans = false;
    $('btn-delete-transaction').onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (clickedDelTrans) return;
      clickedDelTrans = true;
      if (S.editingTransactionId) {
        // Modal de confirmação já é chamado em window.deleteTransaction
        window.deleteTransaction(S.editingTransactionId);
        closeModal('modal-transaction');
      }
      setTimeout(() => clickedDelTrans = false, 500);
    };
  }

  window.updateGlobalFinanceVisibility = function () {
    const container = $('finance-global-summary-container');
    const iconVisible = $('icon-finance-visible');
    const iconHidden = $('icon-finance-hidden');
    const shortVisible = $('shortcut-icon-finance-on');
    const shortHidden = $('shortcut-icon-finance-off');

    if (S.showGlobalFinance) {
      if (container) container.style.display = 'block';
      if ($('week-finance-summary-container')) $('week-finance-summary-container').style.display = 'block';
      if (iconVisible) iconVisible.classList.remove('hidden');
      if (iconHidden) iconHidden.classList.add('hidden');
      if (shortVisible) shortVisible.classList.remove('hidden');
      if (shortHidden) shortHidden.classList.add('hidden');
    } else {
      if (container) container.style.display = 'none';
      if ($('week-finance-summary-container')) $('week-finance-summary-container').style.display = 'none';
      if (iconVisible) iconVisible.classList.add('hidden');
      if (iconHidden) iconHidden.classList.remove('hidden');
      if (shortVisible) shortVisible.classList.add('hidden');
      if (shortHidden) shortHidden.classList.remove('hidden');
    }
    localStorage.setItem('agbizu_show_global_finance', S.showGlobalFinance);
  };

  window.updateGlobalFinanceVisibility();

  if ($('btn-toggle-global-finance')) {
    $('btn-toggle-global-finance').onclick = () => {
      S.showGlobalFinance = !S.showGlobalFinance;
      window.updateGlobalFinanceVisibility();
      play('click');
    };
  }

  if ($('btn-shortcut-finance')) {
    $('btn-shortcut-finance').onclick = () => {
      S.showGlobalFinance = !S.showGlobalFinance;
      window.updateGlobalFinanceVisibility();
      play('click');
    };
  }

  if ($('btn-close-global-finance')) {
    $('btn-close-global-finance').onclick = () => {
      S.showGlobalFinance = false;
      window.updateGlobalFinanceVisibility();
      play('click');
    };
  }
  if ($('btn-close-week-finance')) {
    $('btn-close-week-finance').onclick = () => {
      S.showGlobalFinance = false;
      window.updateGlobalFinanceVisibility();
      play('click');
    };
  }

  if ($('finance-global-summary')) {
    $('finance-global-summary').style.cursor = 'pointer';
    $('finance-global-summary').onclick = () => {
      play('click');
      openFinances();
    };
  }

  window.setTransType = (type) => {
    S.financeType = type;
    const incBtn = $('trans-type-income');
    const expBtn = $('trans-type-expense');
    if (type === 'income') {
      if (incBtn) incBtn.classList.add('active');
      if (expBtn) expBtn.classList.remove('active');
    } else {
      if (expBtn) expBtn.classList.add('active');
      if (incBtn) incBtn.classList.remove('active');
    }
  };

  if ($('trans-type-income')) $('trans-type-income').onclick = () => { window.setTransType('income'); play('click'); };
  if ($('trans-type-expense')) $('trans-type-expense').onclick = () => { window.setTransType('expense'); play('click'); };

  if ($('trans-recurrence')) {
    $('trans-recurrence').addEventListener('change', (e) => {
      const gInsts = $('group-installments');
      if (gInsts) {
        if (e.target.value === 'none') {
          gInsts.classList.add('hidden');
          $('trans-installments').value = '';
        } else {
          gInsts.classList.remove('hidden');
        }
      }
    });
  }

  if ($('transaction-form')) {
    let isSavingTrans = false;
    $('transaction-form').onsubmit = async (e) => {
      e.preventDefault();
      if (isSavingTrans) return;
      play('click');
      const transId = S.editingTransactionId || Date.now().toString();
      const transAmount = parseFloat($('trans-amount').value) || 0;
      const transDateValue = parseDate($('trans-date').value);
      const transDescValue = $('trans-desc').value || (typeof i18n !== 'undefined' ? i18n.t('default_transaction') : 'Agendamento');

      const original = S.editingTransactionId ? S.transactions.find(t => t.id === S.editingTransactionId) : null;

      const saveDataLocal = {
        id: transId,
        type: S.financeType,
        desc: transDescValue,
        amount: transAmount,
        date: transDateValue,
        time: $('trans-time')?.value || '08:00',
        professionalId: $('trans-professional')?.value || '',
        paymentMethod: $('trans-payment').value,
        services: Array.from(document.querySelectorAll('.service-chip-input-trans:checked')).map(c => c.value),
        recurrence: $('trans-recurrence')?.value || 'none',
        installments: parseInt($('trans-installments')?.value) || 0,
        createdAt: original && original.createdAt ? original.createdAt : new Date().toISOString()
      };

      // Calculate Total Duration
      let totalDur = 30; // Default
      if (saveDataLocal.services.length > 0) {
        totalDur = 0;
        saveDataLocal.services.forEach(svcId => {
          const svc = S.entities.product?.[svcId];
          if (svc) totalDur += parseInt(svc.duration) || 30;
        });
      }
      saveDataLocal.duration = totalDur;

      // Conflict Check
      if (saveDataLocal.professionalId && saveDataLocal.time) {
        const conflict = S.checkConflicts(saveDataLocal.professionalId, saveDataLocal.date, saveDataLocal.time, saveDataLocal.duration, S.editingTransactionId);
        if (conflict) {
          isSavingTrans = false;
          return alert(`Conflito de Horário!\nO profissional já possui um(a) ${conflict.type} (${conflict.title}) às ${conflict.time}.`);
        }
      }
      const isRecurring = original && original.recurrence && original.recurrence !== 'none';
      let shouldAsk = isRecurring;
      let hideOnlyThis = false;

      if (original) {
        const recurrenceChanged = (saveDataLocal.recurrence !== original.recurrence || saveDataLocal.installments !== (original.installments || 0));
        const mainPropsSame = (saveDataLocal.desc === original.desc && saveDataLocal.amount === original.amount && saveDataLocal.type === original.type && saveDataLocal.date === original.date);

        if (recurrenceChanged) {
          hideOnlyThis = true; // Não permite "Somente nesta" se a regra de repetição mudou
          if (mainPropsSame) {
            // Se alterou *apenas* a repetição/parcelas, aplica em todas direto pulando o modal
            shouldAsk = false;
          }
        }
      }

      const isEditingVirtual = isRecurring && S.editingOccurrenceDate !== original?.date;

      const finishTransSave = () => {
        S.lastRenderedYear = null;
        refreshCalendar();
        if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
        hideLoading();
        closeModal('modal-transaction');
        setTimeout(() => isSavingTrans = false, 500);
      };

      const performAllSave = async () => {
        showLoading('loading_saving');
        const finalData = { ...saveDataLocal };
        if (isEditingVirtual && original) {
          finalData.date = original.date;
        }
        const idx = S.transactions.findIndex(t => t.id === transId);
        if (idx !== -1) S.transactions[idx] = finalData; else S.transactions.push(finalData);
        if (idx !== -1) {
          await apiFetch(`/transactions/${transId}`, { method: 'PUT', body: JSON.stringify(finalData) });
        } else {
          await apiFetch('/transactions', { method: 'POST', body: JSON.stringify(finalData) });
        }
        finishTransSave();
      };

      const performInstanceSave = async () => {
        try {
          showLoading('loading_saving');
          if (original) {
            const overrideData = {
              desc: saveDataLocal.desc,
              amount: saveDataLocal.amount,
              type: saveDataLocal.type,
              date: saveDataLocal.date
            };
            if (!original.overrides) original.overrides = {};
            original.overrides[S.editingOccurrenceDate] = overrideData;
            await apiFetch(`/transactions/${original.id}/overrides/${S.editingOccurrenceDate}`, { method: 'PUT', body: JSON.stringify(overrideData) });
          }
          finishTransSave();
        } catch (err) {
          console.error("Erro ao salvar sobreposição de transação:", err);
          alert(typeof i18n !== 'undefined' ? i18n.t('err_process_transaction') : "Erro ao processar transação.");
          hideLoading();
        }
      };

      try {
        if (shouldAsk) {
          window.showRecurrenceChoiceModal(performInstanceSave, performAllSave, hideOnlyThis);
          isSavingTrans = false;
        } else {
          isSavingTrans = true;
          await performAllSave();
        }
      } catch (err) {
        hideLoading();
        console.error("Error saving transaction:", err);
        alert(typeof i18n !== 'undefined' ? i18n.t('err_save_transaction') : "Erro ao salvar transação. Verifique sua conexão.");
        isSavingTrans = false;
      }
    };
  }

  if ($('btn-add-fin-from-day')) {
    $('btn-add-fin-from-day').onclick = () => {
      console.log("[DEBUG] Botão 'Novo Agendamento' clicado");
      play('click');
      const d = S.selectedDate || new Date();
      console.log("[DEBUG] Data selecionada:", d);

      console.log("[DEBUG] Tentando fechar modal-day");
      closeModal('modal-day');

      console.log("[DEBUG] Chamando window.openTransactionForm");
      window.openTransactionForm(d);
    };
  } else {
    console.warn("[DEBUG] Elemento 'btn-add-fin-from-day' NÃO encontrado no DOM durante registro");
  }

  if ($('btn-ignore-event-instance')) {
    $('btn-ignore-event-instance').onclick = () => {
      const dateStr = parseDate($('evt-date').value);
      const eventId = S.editingEventId;
      if (eventId && dateStr) window.ignoreEventInstance(eventId, dateStr);
    };
  }

  if ($('btn-ignore-trans-instance')) {
    $('btn-ignore-trans-instance').onclick = () => {
      const dateStr = parseDate($('trans-date').value);
      const transId = S.editingTransactionId;
      if (transId && dateStr) window.ignoreTransactionInstance(transId, dateStr);
    };
  }
  document.querySelectorAll('.modal-sheet').forEach(sheet => {
    const overlay = sheet.parentElement;
    const overlayId = overlay.id;
    let startY = 0, currentY = 0, isDragging = false;

    const startDrag = (e) => {
      if (e.target.closest('button, input, select')) return;

      // Se clicou no overlay, só inicia se for NO FUNDO (área escura)
      if (e.currentTarget === overlay && e.target !== overlay) return;

      startY = e.clientY; currentY = 0;
      isDragging = true;
      sheet.style.transition = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    const onMove = (e) => {
      if (!isDragging) return;
      currentY = e.clientY - startY;
      if (currentY > 0) {
        e.preventDefault();
        sheet.style.transform = `translateY(${currentY}px)`;
      }
    };

    const onUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      if (currentY < 10 && e.target === overlay) {
        // Tratado pelo document.click global para evitar ghost clicks
      } else if (currentY > 60) { // Arraste profundo
        sheet.style.transition = 'transform 0.2s cubic-bezier(0.4, 0, 1, 1)';
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => closeModal(overlayId), 180);
      } else { // Arraste curto (volta)
        sheet.style.transition = 'transform 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
        sheet.style.transform = 'translateY(0)';
      }
      currentY = 0;
    };

    // Registrar alças: Barra cinza, Cabeçalho e o próprio Fundo (Overlay)
    const handle = sheet.querySelector('.modal-handle');
    const header = sheet.querySelector('.modal-header');

    if (handle) handle.addEventListener('pointerdown', startDrag);
    if (header) header.addEventListener('pointerdown', startDrag);
    overlay.addEventListener('pointerdown', startDrag);

    // Impedir que o toque dentro do conteúdo do modal cause conflito de scroll/drag no fundo
    sheet.addEventListener('pointerdown', (e) => {
      if (e.target !== handle && !header.contains(e.target)) e.stopPropagation();
    }, { passive: true });
  });

  // ---- Inteligência de Teclado (Mobile) ----
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const updateKeyboard = () => {
      // Diferença entre a tela total e a área visível (teclado)
      const h = window.innerHeight - vv.height;
      document.documentElement.style.setProperty('--keyboard-h', (h > 60 ? h : 0) + 'px');

      // Auto-scroll para o campo focado
      const active = document.activeElement;
      if (h > 60 && active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        setTimeout(() => active.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150);
      }
    };
    vv.addEventListener('resize', updateKeyboard);
    vv.addEventListener('scroll', updateKeyboard);
  }

  // ---- Close buttons for entity/unit modals ----
  if ($('btn-close-entity')) $('btn-close-entity').onclick = () => closeModal('modal-entity');
  if ($('btn-close-unit')) $('btn-close-unit').onclick = () => closeModal('modal-unit');
});
// ======================== FINANCE LOGIC ========================
function updateFinanceUI() {
  const m = S.currentDate.getMonth();
  const y = S.currentDate.getFullYear();
  const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
  const monthName = new Date(y, m, 1).toLocaleDateString(locale, { month: 'long' });

  if ($('finance-month-label')) {
    $('finance-month-label').textContent = (typeof i18n !== 'undefined' ? i18n.t('finance_month_summary') : 'Resumo de') + ' ' + monthName;
  }

  let totalInc = 0, totalExp = 0;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const allForMonth = [];

  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(y, m, i);
    const trs = getTransactionsForDate(d);
    trs.forEach(t => {
      if (t.isIgnored) return;
      if (t.type === 'income') totalInc += t.amount;
      else totalExp += t.amount;
      if (!allForMonth.some(x => x.id === t.id && x.occurrenceDate === t.occurrenceDate)) {
        allForMonth.push(t);
      }
    });
  }

  const finIncEl = $('fin-total-income');
  const finExpEl = $('fin-total-expenses');
  const finBalEl = $('fin-total-balance');

  if (finIncEl) finIncEl.textContent = formatVal(totalInc);
  if (finExpEl) finExpEl.textContent = formatVal(totalExp);
  if (finBalEl) finBalEl.textContent = formatVal(totalInc - totalExp);

  renderFinanceList(allForMonth);
}

function openFinances() {
  updateFinanceUI();
  openModal('modal-finances');
  trackAction('view_finances');
}

function formatVal(v) {
  const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
  const cur = locale === 'pt-BR' ? 'BRL' : 'USD';
  return v.toLocaleString(locale, { style: 'currency', currency: cur });
}

function renderFinanceList(list) {
  const container = $('finance-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = `<p style="text-align:center; opacity:0.5; margin-top:20px;" data-i18n="finance_empty">${typeof i18n !== 'undefined' ? i18n.t('finance_empty') : 'Sem transações'}</p>`;
    return;
  }

  list.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(t => {
    const isChecked = !!t.checked;
    const div = document.createElement('div');
    div.className = 'finance-item' + (isChecked ? ' checked' : '');
    div.style = `display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--surface); border:1px solid var(--border); border-radius:12px; opacity: ${isChecked ? '0.6' : '1'}; transition: all 0.2s;`;
    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <button class="btn btn-ghost btn-icon-sm" onclick="window.toggleTransactionStatus('${t.id}', event, '${t.occurrenceDate}')" style="color: ${isChecked ? 'var(--primary)' : 'var(--text3)'}; padding: 0; width: 28px; height: 28px;">
          <span class="material-symbols-outlined" style="font-size:22px; font-variation-settings: 'FILL' ${isChecked ? 1 : 0}">${isChecked ? 'check_circle' : 'radio_button_unchecked'}</span>
        </button>
        <div style="background:${t.type === 'income' ? '#dcfce7' : '#fee2e2'}; color:${t.type === 'income' ? '#166534' : '#991b1b'}; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center;">
          <span class="material-symbols-outlined" style="font-size:18px;">${t.type === 'income' ? 'trending_up' : 'trending_down'}</span>
        </div>
        <div>
          <div>${truncate(t.desc)} ${t.installments > 0 ? `<span style="font-size:0.65rem; color:var(--text3);  margin-left:4px;">(${t.currentInstallment}/${t.installments})</span>` : ''}</div>
          <div style="font-size:0.65rem; color:var(--text2);">${new Date(t.date + 'T12:00:00').toLocaleDateString(typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR')}${t.createdAt ? ` • ${typeof i18n !== 'undefined' ? i18n.t('launched_on') : 'Lançado em'} ${new Date(t.createdAt).toLocaleDateString(typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR')}` : ''}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
          <div style="font-size:0.85rem;  color:${t.type === 'income' ? '#16a34a' : '#dc2626'}; text-decoration: ${isChecked ? 'line-through' : 'none'};">
          ${t.type === 'income' ? '+' : '-'} ${formatVal(t.amount)}
        </div>
        <button class="btn btn-ghost btn-icon-sm" onclick="window.deleteTransaction('${t.id}')" style="display:none;">
          <span class="material-symbols-outlined" style="font-size:18px; color:var(--text3);">delete</span>
        </button>
      </div>
    `;
    div.onclick = (e) => {
      // Se clicou no botão de excluir, não abre o formulário
      if (e.target.closest('button')) return;
      play('click');
      closeModal('modal-finances');
      window.openTransactionForm(null, t);
    };
    container.appendChild(div);
  });
}

window.openTransactionForm = function (d = null, trans = null) {
  window.closeAnyModal();
  const form = $('transaction-form');
  if (!form) return;

  form.reset();
  S.editingTransactionId = trans ? trans.id : null;
  S.editingOccurrenceDate = d ? toDateStr(d) : (trans ? trans.date : toDateStr(new Date()));

  updateProfSelectors();
  renderServiceSelection('trans', trans?.services || []);

  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
  const titleEl = document.querySelector('#modal-transaction .modal-title');
  const btnDel = $('btn-delete-transaction');

  if (trans && trans.id) {
    // Modo Edição
    if (titleEl) titleEl.textContent = t('finance_edit') || 'Editar Agendamento';
    if (btnDel) btnDel.classList.remove('hidden');
    if ($('trans-desc')) $('trans-desc').value = trans.desc || '';
    if ($('trans-amount')) $('trans-amount').value = trans.amount || 0;
    // Se for ocorrência recorrente, d terá a data clicada
    const displayDate = d || (trans.date ? new Date(trans.date + 'T12:00:00') : new Date());
    if ($('trans-date')) setFPValue('trans-date', toDateStr(displayDate));
    if ($('trans-time')) setFPValue('trans-time', trans.time || '');

    if ($('trans-recurrence')) {
      $('trans-recurrence').value = trans.recurrence || 'none';
      if (trans.recurrence && trans.recurrence !== 'none') {
        $('group-installments')?.classList.remove('hidden');
        if ($('trans-installments')) $('trans-installments').value = trans.installments || '';
      } else {
        $('group-installments')?.classList.add('hidden');
        if ($('trans-installments')) $('trans-installments').value = '';
      }
    }
    window.setTransType(trans.type || 'income');
    if ($('trans-professional')) $('trans-professional').value = trans.professionalId || '';
    if ($('trans-payment')) $('trans-payment').value = trans.paymentMethod || 'none';

    // Mostrar botão de "Desconsiderar" para qualquer transação recorrente
    const recArea = $('trans-recurring-options');
    const btnIgnore = $('btn-ignore-trans-instance');
    if (recArea && btnIgnore) {
      recArea.classList.remove('hidden');
      // Toggle texto conforme estado e recorrência
      const isIgnored = trans.excludedDates && trans.excludedDates[$('trans-date').value];
      const recType = (trans.recurrence && trans.recurrence !== 'none') ? trans.recurrence : 'daily';
      const i18nKey = (isIgnored ? 'consider_instance_' : 'ignore_instance_') + recType;

      const span = btnIgnore.querySelector('[data-i18n]');
      if (span) {
        span.setAttribute('data-i18n', i18nKey);
        if (typeof i18n !== 'undefined') span.innerHTML = i18n.t(i18nKey);
      }
      if (typeof i18n !== 'undefined') i18n.applyToDOM();

      btnIgnore.style.color = isIgnored ? 'var(--primary)' : 'var(--danger)';
      btnIgnore.style.borderColor = isIgnored ? 'var(--primary-lt)' : 'var(--danger-lt)';
      const icon = btnIgnore.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = isIgnored ? 'event_available' : 'event_busy';
    }
  } else {
    // Modo Novo
    if (titleEl) titleEl.textContent = t('finance_add') || 'Novo Agendamento';
    if (btnDel) btnDel.classList.add('hidden');
    if ($('trans-date')) setFPValue('trans-date', toDateStr(d || new Date()));
    if ($('trans-recurrence')) $('trans-recurrence').value = 'none';
    $('group-installments')?.classList.add('hidden');
    if ($('trans-installments')) $('trans-installments').value = '';
    if ($('trans-recurring-options')) $('trans-recurring-options').classList.add('hidden');
    window.setTransType('income');
    if ($('trans-professional')) $('trans-professional').value = '';
    if ($('trans-payment')) $('trans-payment').value = 'none';
    if ($('trans-time')) setFPValue('trans-time', trans?.time || '');
    renderServiceSelection('trans', []);
  }

  openModal('modal-transaction');
};

window.deleteTransaction = function (id) {
  window.showConfirmModal('confirm_delete_title', 'confirm_delete_trans_desc', async () => {
    play('click');
    showLoading('loading_deleting');
    await apiFetch(`/transactions/${id}`, { method: 'DELETE' });
    S.transactions = S.transactions.filter(t => t.id !== id);
    S.lastRenderedYear = null;
    refreshCalendar();
    hideLoading();
    // Atualiza a UI financeira silenciosamente se o modal estiver aberto
    if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
  });
};

window.toggleTransactionStatus = async function (id, event, dateStr = null) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const t = S.transactions.find(x => x.id === id);
  if (!t) return;

  const targetDate = dateStr || t.date;
  const isRecurring = t.recurrence && t.recurrence !== 'none';

  // Determinar estado atual (prioridade no override)
  const currentChecked = (t.overrides && t.overrides[targetDate] && t.overrides[targetDate].checked !== undefined)
    ? t.overrides[targetDate].checked
    : !!t.checked;

  const newState = !currentChecked;

  try {
    if (isRecurring) {
      if (!t.overrides) t.overrides = {};
      if (!t.overrides[targetDate]) t.overrides[targetDate] = {};
      t.overrides[targetDate].checked = newState;
      await apiFetch(`/transactions/${id}/overrides/${targetDate}`, {
        method: 'PUT',
        body: JSON.stringify({ checked: newState })
      });
    } else {
      t.checked = newState;
      await apiFetch(`/transactions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ checked: newState })
      });
    }

    if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
    if (!$('modal-day').classList.contains('hidden') && S.selectedDate) openDayModal(S.selectedDate);
    // Notificamos o calendário para atualizar os dots se necessário
    S.lastRenderedYear = null;
    refreshCalendar();
  } catch (err) {
    console.error("Error toggling transaction status:", err);
  }
};

function getShortestPattern(arr) {
  const n = arr.length;
  // Patterns like 2, 3, 4, 12/36, etc.
  for (let len = 1; len <= Math.floor(n / 2); len++) {
    let match = true;
    for (let i = len; i < n; i++) {
      if (arr[i] !== arr[i % len]) { match = false; break; }
    }
    if (match) return arr.slice(0, len);
  }

  // Weekly patterns (7 or 14 days) even if n is 30/31
  for (let len of [7, 14]) {
    if (n >= len * 2) {
      let match = true;
      for (let i = len; i < n; i++) {
        if (arr[i] !== arr[i % len]) { match = false; break; }
      }
      if (match) return arr.slice(0, len);
    }
  }
  return arr;
}
window.ignoreEventInstance = async function (id, dateStr) {
  const event = S.events.find(e => e.id === id);
  if (!event) return;
  const isCurrentlyIgnored = !!(event.excludedDates && event.excludedDates[dateStr]);

  try {
    showLoading('loading_saving');
    if (!event.excludedDates) event.excludedDates = {};

    if (isCurrentlyIgnored) {
      delete event.excludedDates[dateStr];
      await apiFetch(`/events/${id}/ignore/${dateStr}`, { method: 'DELETE' });
    } else {
      event.excludedDates[dateStr] = true;
      await apiFetch(`/events/${id}/ignore/${dateStr}`, { method: 'POST' });
    }

    refreshCalendar();
    hideLoading();
    closeModal('modal-event');
  } catch (err) {
    hideLoading();
    console.error("Error toggling ignore status for event:", err);
  }
};

window.ignoreTransactionInstance = async function (id, dateStr) {
  const t = S.transactions.find(x => x.id === id);
  if (!t) return;
  const isCurrentlyIgnored = !!(t.excludedDates && t.excludedDates[dateStr]);

  try {
    showLoading('loading_saving');
    if (!t.excludedDates) t.excludedDates = {};

    if (isCurrentlyIgnored) {
      delete t.excludedDates[dateStr];
      await apiFetch(`/transactions/${id}/ignore/${dateStr}`, { method: 'DELETE' });
    } else {
      t.excludedDates[dateStr] = true;
      await apiFetch(`/transactions/${id}/ignore/${dateStr}`, { method: 'POST' });
    }

    S.lastRenderedYear = null;
    refreshCalendar();
    if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
    hideLoading();
    closeModal('modal-transaction');
  } catch (err) {
    hideLoading();
    console.error("Error toggling ignore status for transaction:", err);
  }
};
window.goToAgent = () => {
  toggleSideMenu(false);
  trackAction('open_ai_agent');
  { toggleSideMenu(false); setView('ai'); };
};

// ======================== TOAST NOTIFICATIONS ========================
function createToast(options = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.toastId = options.id;

  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

  toast.innerHTML = `
    <div class="toast-header">
      <div class="toast-icon ${options.type || ''}">
        <span class="material-symbols-outlined">${options.icon || 'info'}</span>
      </div>
      <div class="toast-content">
        <div class="toast-title">${options.title || ''}</div>
        <div class="toast-msg">${options.message || ''}</div>
      </div>
    </div>
    <div class="toast-footer">
      <label class="toast-checkbox-wrapper">
        <input type="checkbox" id="toast-dont-show-${options.id}">
        <span class="toast-checkbox-label">${t('toast_dont_show_again')}</span>
      </label>
      <div class="toast-buttons">
        ${options.secondaryBtn ? `<button class="toast-btn ghost" id="toast-btn-sec-${options.id}">${options.secondaryBtn}</button>` : ''}
        <button class="toast-btn primary" id="toast-btn-main-${options.id}">${options.primaryBtn || 'OK'}</button>
      </div>
    </div>
  `;

  container.appendChild(toast);

  // Event Listeners
  const mainBtn = toast.querySelector(`#toast-btn-main-${options.id}`);
  const secBtn = toast.querySelector(`#toast-btn-sec-${options.id}`);
  const checkbox = toast.querySelector(`#toast-dont-show-${options.id}`);

  const dismiss = () => {
    // Dispensar todos os toasts do container simultaneamente
    const allToasts = container.querySelectorAll('.toast');
    allToasts.forEach(t => {
      // Verifica o checkbox de cada toast individualmente antes de remover
      const cb = t.querySelector('input[type="checkbox"]');
      const tid = t.dataset.toastId;
      if (cb && cb.checked && tid) {
        localStorage.setItem(`agbizu_dismiss_toast_${tid}`, 'true');
      }

      t.classList.add('hiding');
      setTimeout(() => t.remove(), 250);
    });
  };

  mainBtn.onclick = () => {
    if (options.onPrimary) options.onPrimary();
    dismiss();
  };

  if (secBtn) {
    secBtn.onclick = () => {
      if (options.onSecondary) options.onSecondary();
      dismiss();
    };
  }

  // Auto-dismiss opcional? Não por enquanto, melhor deixar o usuário ver.
  return toast;
}

function showPromotionalToasts() {
  // Evitar sobreposição: não exibir toasts promocionais se algum modal estiver aberto
  if (document.querySelector('.modal-overlay:not(.hidden)')) return;
  const lp = document.getElementById('lang-picker-overlay');
  if (lp && lp.style.display !== 'none' && !lp.classList.contains('hide')) return;

  const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

  // 1. Toast da IA
  if (!localStorage.getItem('agbizu_dismiss_toast_ia')) {
    createToast({
      id: 'ia',
      type: 'ia',
      icon: 'smart_toy',
      title: t('toast_ia_title'),
      message: t('toast_ia_desc'),
      primaryBtn: t('toast_btn_open'),
      secondaryBtn: t('btn_cancel'),
      onPrimary: () => {
        setView('ai');
      }
    });
  }

  // 2. Toast da Escala (após um pequeno delay se o da IA estiver visível)
  setTimeout(() => {
    if (!localStorage.getItem('agbizu_dismiss_toast_scale')) {
      createToast({
        id: 'scale',
        type: 'tutorial',
        icon: 'calendar_month',
        title: t('toast_scale_title'),
        message: t('toast_scale_desc'),
        primaryBtn: t('toast_btn_scale'),
        secondaryBtn: t('toast_btn_ok'),
        onPrimary: () => {
          openScaleModal();
        }
      });
    }
  }, 1000);
}

// ======================== SIDEBAR COLLAPSE ========================
window.toggleSidebar = (collapsed = null) => {
  const menu = document.getElementById('side-menu');
  const btn = document.getElementById('btn-collapse-sidebar');
  if (!menu) return;

  if (collapsed === null) {
    collapsed = !menu.classList.contains('collapsed');
  }

  menu.classList.toggle('collapsed', collapsed);

  // Atualiza ícone do botão (rotação)
  if (btn) {
    const icon = btn.querySelector('span');
    if (icon) icon.style.transform = collapsed ? 'rotate(180deg)' : 'rotate(0deg)';
  }

  localStorage.setItem('agbizu_sidebar_collapsed', collapsed);

  // Forçar redimensionamento para alinhar componentes (ex: swiper)
  setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
};

window.openQuickAdd = (date, time) => {
  S.quickAddData = { date, time };
  openModal('modal-quick-add');
};

document.addEventListener('DOMContentLoaded', () => {
  if ($('btn-quick-add-event')) $('btn-quick-add-event').onclick = () => {
    closeModal('modal-quick-add');
    const { date, time } = S.quickAddData;
    openEventForm({ time }, date);
  };

  if ($('btn-quick-add-trans')) $('btn-quick-add-trans').onclick = () => {
    closeModal('modal-quick-add');
    const { date, time } = S.quickAddData;
    window.openTransactionForm(date, { time });
  };
});
