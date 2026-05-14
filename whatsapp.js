'use strict';

const firebaseConfig = {
  apiKey: "AIzaSyASa8uMK4O1U_bQC5Ykl-OflJttFSJFNnM",
  authDomain: "orange-proof.firebaseapp.com",
  databaseURL: "https://orange-proof-default-rtdb.firebaseio.com",
  projectId: "orange-proof",
  storageBucket: "orange-proof.firebasestorage.app",
  messagingSenderId: "619099154724",
  appId: "1:619099154724:web:e61ff7ce22e29be929ebb1"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

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
  return res.json();
}

const el = {
    deviceList: document.getElementById('device-list'),
    qrModal: document.getElementById('qr-modal'),
    qr: document.getElementById('wa-qr'),
    statusBadge: document.getElementById('wa-status-badge'),
    loading: document.getElementById('loading'),
    instructions: document.getElementById('wa-instructions'),
    btnOpenConnect: document.getElementById('btn-open-connect')
};

let statusInterval = null;
let currentConnectingDeviceId = null;

async function loadDevices() {
    try {
        const devices = await apiFetch('/whatsapp/list');
        renderDeviceList(devices);
    } catch (err) {
        console.error('Error loading devices:', err);
    }
}

function renderDeviceList(devices) {
    const ids = Object.keys(devices);
    if (ids.length === 0) {
        el.deviceList.innerHTML = `
            <div style="text-align: center; color: #999; padding: 30px; background: #f9f9f9; border-radius: 16px;">
                <span class="material-symbols-outlined" style="font-size: 48px; display: block; margin-bottom: 10px;">no_devices</span>
                Nenhum aparelho conectado.
            </div>`;
        return;
    }

    el.deviceList.innerHTML = ids.map(id => {
        const dev = devices[id];
        const isConnected = dev.status === 'connected';
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px; background: #fff; border: 1px solid #eee; border-radius: 16px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 40px; height: 40px; border-radius: 10px; background: ${isConnected ? '#dcfce7' : '#fee2e2'}; color: ${isConnected ? '#16a34a' : '#dc2626'}; display: flex; align-items: center; justify-content: center;">
                        <span class="material-symbols-outlined">${isConnected ? 'smartphone' : 'phonelink_erase'}</span>
                    </div>
                    <div>
                        <div style="font-weight: 600; color: #333;">${dev.name || 'Dispositivo'}</div>
                        <div style="font-size: 12px; color: ${isConnected ? '#16a34a' : '#dc2626'};">${isConnected ? 'Conectado' : 'Desconectado/QR'}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    ${!isConnected ? `<button onclick="reconnectDevice('${id}')" class="btn btn-ghost btn-icon-sm" title="Ver QR"><span class="material-symbols-outlined">qr_code</span></button>` : ''}
                    <button onclick="disconnectDevice('${id}')" class="btn btn-ghost btn-icon-sm" style="color: #dc2626;" title="Remover"><span class="material-symbols-outlined">delete</span></button>
                </div>
            </div>`;
    }).join('');
}

async function reconnectDevice(id) {
    currentConnectingDeviceId = id;
    openQrModal();
    startPollingStatus();
}

async function disconnectDevice(id) {
    if (!confirm('Deseja realmente remover este dispositivo?')) return;
    try {
        await apiFetch(`/whatsapp/disconnect/${id}`, { method: 'POST' });
        loadDevices();
    } catch (err) {
        alert('Erro ao desconectar: ' + err.message);
    }
}

async function updateStatus() {
    if (!currentConnectingDeviceId) return;
    try {
        const data = await apiFetch(`/whatsapp/status/${currentConnectingDeviceId}`);
        
        if (data.status === 'qr' && data.qr) {
            el.qr.src = data.qr;
            el.qr.style.display = 'block';
            el.loading.style.display = 'none';
            el.instructions.textContent = 'Aponte a câmera do WhatsApp para o código QR acima.';
            setStatusBadge('connecting', 'Aguardando Escaneamento');
        } else if (data.status === 'connected') {
            el.qr.style.display = 'none';
            el.loading.style.display = 'none';
            el.instructions.textContent = 'Conectado com sucesso!';
            setStatusBadge('connected', 'Conectado');
            setTimeout(() => {
                closeQrModal();
                loadDevices();
            }, 2000);
            stopPollingStatus();
        }
    } catch (err) {
        console.error('Error fetching status:', err);
    }
}

function setStatusBadge(type, text) {
    el.statusBadge.className = `status-badge status-${type}`;
    const icon = type === 'connected' ? 'link' : (type === 'connecting' ? 'sync' : 'link_off');
    el.statusBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">${icon}</span>${text}`;
}

function openQrModal() {
    el.qrModal.style.display = 'flex';
    el.qr.style.display = 'none';
    el.loading.style.display = 'block';
    el.instructions.textContent = 'Iniciando conexão...';
    setStatusBadge('connecting', 'Conectando...');
}

window.closeQrModal = function() {
    el.qrModal.style.display = 'none';
    stopPollingStatus();
    currentConnectingDeviceId = null;
    loadDevices();
};

function startPollingStatus() {
    if (statusInterval) clearInterval(statusInterval);
    statusInterval = setInterval(updateStatus, 3000);
}

function stopPollingStatus() {
    if (statusInterval) clearInterval(statusInterval);
    statusInterval = null;
}

el.btnOpenConnect.addEventListener('click', async () => {
    try {
        const res = await apiFetch('/whatsapp/connect', { method: 'POST' });
        currentConnectingDeviceId = res.deviceId;
        openQrModal();
        startPollingStatus();
    } catch (err) {
        alert('Erro ao iniciar conexão: ' + err.message);
    }
});

firebase.auth().onAuthStateChanged((user) => {
    if (!user) {
        location.href = 'index.html';
    } else {
        loadDevices();
        // Periodically refresh device list
        setInterval(loadDevices, 10000);
    }
});

window.reconnectDevice = reconnectDevice;
window.disconnectDevice = disconnectDevice;
