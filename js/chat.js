/**
 * PulseChat - Main Application Controller
 * 100% Free Architecture (Firestore + Canvas Image Compressor + Data URL File Transfer)
 */

import {
  initFirebase,
  getStoredConfig,
  saveConfig,
  clearConfig,
  isFirebaseConnected,
  db,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from './firebase-config.js';

// ==========================================
// App State
// ==========================================
let currentRoomId = 'general';
let currentRoomName = 'General Lounge';
let currentUser = {
  id: 'user_' + Math.random().toString(36).substring(2, 9),
  name: 'Guest_' + Math.floor(1000 + Math.random() * 9000),
  avatar: '⚡'
};
let selectedAttachment = null; // { name, size, type, dataUrl }
let isRecordingVoice = false;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingSeconds = 0;
let firestoreUnsubscribe = null;
let broadcastChannel = null;

const LOCAL_MESSAGES_KEY_PREFIX = 'pulse_messages_';

const defaultRooms = [
  { id: 'general', name: 'General Lounge', icon: '💬' },
  { id: 'tech-talk', name: 'Tech & Code', icon: '💻' },
  { id: 'random-fun', name: 'Random & Memes', icon: '🎉' },
  { id: 'media-share', name: 'Free File Share', icon: '📁' }
];

// DOM Elements
const DOM = {
  sidebar: document.getElementById('sidebar'),
  openSidebarBtn: document.getElementById('open-sidebar-btn'),
  closeSidebarBtn: document.getElementById('close-sidebar-btn'),
  currentUserAvatar: document.getElementById('current-user-avatar'),
  currentUserName: document.getElementById('current-user-name'),
  userProfileTrigger: document.getElementById('user-profile-trigger'),
  backendStatusBadge: document.getElementById('backend-status-badge'),
  createRoomBtn: document.getElementById('create-room-btn'),
  setupGuideBtn: document.getElementById('setup-guide-btn'),
  joinRoomInput: document.getElementById('join-room-input'),
  joinRoomBtn: document.getElementById('join-room-btn'),
  roomList: document.getElementById('room-list'),
  roomCount: document.getElementById('room-count'),
  openConfigBtn: document.getElementById('open-config-btn'),
  toggleThemeBtn: document.getElementById('toggle-theme-btn'),
  themeIcon: document.getElementById('theme-icon'),
  themeLabel: document.getElementById('theme-label'),

  currentRoomIcon: document.getElementById('current-room-icon'),
  currentRoomName: document.getElementById('current-room-name'),
  activeMembersCount: document.getElementById('active-members-count'),
  roomIdTag: document.getElementById('room-id-tag'),
  shareRoomBtn: document.getElementById('share-room-btn'),
  messagesContainer: document.getElementById('messages-container'),
  dragOverlay: document.getElementById('drag-overlay'),

  fileInput: document.getElementById('file-input'),
  attachFileBtn: document.getElementById('attach-file-btn'),
  attachmentPreviewBar: document.getElementById('attachment-preview-bar'),
  previewFileName: document.getElementById('preview-file-name'),
  previewFileSize: document.getElementById('preview-file-size'),
  cancelAttachmentBtn: document.getElementById('cancel-attachment-btn'),

  recordVoiceBtn: document.getElementById('record-voice-btn'),
  voiceRecordingBar: document.getElementById('voice-recording-bar'),
  recordingTime: document.getElementById('recording-time'),
  cancelRecordingBtn: document.getElementById('cancel-recording-btn'),
  stopSendRecordingBtn: document.getElementById('stop-send-recording-btn'),

  messageInput: document.getElementById('message-input'),
  emojiPickerBtn: document.getElementById('emoji-picker-btn'),
  emojiPopover: document.getElementById('emoji-popover'),
  sendBtn: document.getElementById('send-btn'),

  setupGuideModal: document.getElementById('setup-guide-modal'),
  configModal: document.getElementById('config-modal'),
  shareModal: document.getElementById('share-modal'),
  profileModal: document.getElementById('profile-modal'),
  lightboxModal: document.getElementById('lightbox-modal'),
  guideToConfigBtn: document.getElementById('guide-to-config-btn'),
  firebaseConfigForm: document.getElementById('firebase-config-form'),
  resetConfigBtn: document.getElementById('reset-config-btn'),
  shareModalRoomName: document.getElementById('share-modal-room-name'),
  shareLinkInput: document.getElementById('share-link-input'),
  copyShareLinkBtn: document.getElementById('copy-share-link-btn'),
  profileForm: document.getElementById('profile-form'),
  profileNameInput: document.getElementById('profile-name-input'),
  avatarSelectGrid: document.getElementById('avatar-select-grid'),
  lightboxImg: document.getElementById('lightbox-img'),
  lightboxDownloadBtn: document.getElementById('lightbox-download-btn'),
  toastContainer: document.getElementById('toast-container')
};

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  loadUserProfile();
  setupBroadcastChannel();
  setupEventListeners();

  const connected = await initFirebase();
  updateBackendStatusUI(connected);

  parseUrlHashRoom();
  renderRoomList();
  switchRoom(currentRoomId);
});

// Profile Management
function loadUserProfile() {
  const saved = localStorage.getItem('pulse_user_profile');
  if (saved) {
    try { currentUser = { ...currentUser, ...JSON.parse(saved) }; } catch (e) {}
  }
  updateUserProfileUI();
}

function saveUserProfile() {
  localStorage.setItem('pulse_user_profile', JSON.stringify(currentUser));
  updateUserProfileUI();
}

function updateUserProfileUI() {
  DOM.currentUserAvatar.textContent = currentUser.avatar;
  DOM.currentUserName.textContent = currentUser.name;
}

// Room & Link Logic
function parseUrlHashRoom() {
  const hash = window.location.hash;
  if (hash && hash.includes('room=')) {
    const match = hash.match(/room=([^&]+)/);
    if (match && match[1]) {
      currentRoomId = decodeURIComponent(match[1]);
      currentRoomName = formatRoomTitle(currentRoomId);
    }
  }
}

function formatRoomTitle(id) {
  const found = defaultRooms.find(r => r.id === id);
  if (found) return found.name;
  return id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function switchRoom(roomId) {
  currentRoomId = roomId;
  currentRoomName = formatRoomTitle(roomId);
  window.location.hash = `room=${encodeURIComponent(roomId)}`;

  const found = defaultRooms.find(r => r.id === roomId);
  DOM.currentRoomIcon.textContent = found ? found.icon : '💬';
  DOM.currentRoomName.textContent = currentRoomName;
  DOM.roomIdTag.textContent = `ID: ${roomId}`;

  renderRoomList();

  if (firestoreUnsubscribe) {
    firestoreUnsubscribe();
    firestoreUnsubscribe = null;
  }

  if (isFirebaseConnected && db) {
    subscribeFirebaseMessages(roomId);
  } else {
    loadLocalDemoMessages(roomId);
  }
}

function renderRoomList() {
  DOM.roomList.innerHTML = '';
  let roomsToRender = [...defaultRooms];
  if (!roomsToRender.some(r => r.id === currentRoomId)) {
    roomsToRender.push({ id: currentRoomId, name: currentRoomName, icon: '🌟' });
  }

  DOM.roomCount.textContent = roomsToRender.length;

  roomsToRender.forEach(room => {
    const item = document.createElement('div');
    item.className = `room-item ${room.id === currentRoomId ? 'active' : ''}`;
    item.innerHTML = `
      <div class="room-item-icon">${room.icon}</div>
      <div class="room-item-details">
        <div class="room-item-name">${room.name}</div>
        <div class="room-item-meta">Click to join</div>
      </div>
    `;
    item.addEventListener('click', () => switchRoom(room.id));
    DOM.roomList.appendChild(item);
  });
}

// Messaging Operations
function subscribeFirebaseMessages(roomId) {
  try {
    const q = query(
      collection(db, 'rooms', roomId, 'messages'),
      orderBy('timestamp', 'asc')
    );

    firestoreUnsubscribe = onSnapshot(q, (snapshot) => {
      const messages = [];
      snapshot.forEach(docSnap => {
        messages.push({ id: docSnap.id, ...docSnap.data() });
      });
      renderMessages(messages);
    }, (err) => {
      console.warn('Firestore subscription note:', err);
      loadLocalDemoMessages(roomId);
    });
  } catch (e) {
    loadLocalDemoMessages(roomId);
  }
}

function loadLocalDemoMessages(roomId) {
  const raw = localStorage.getItem(LOCAL_MESSAGES_KEY_PREFIX + roomId);
  let messages = [];
  if (raw) {
    try { messages = JSON.parse(raw); } catch (e) {}
  } else {
    messages = [
      {
        id: 'msg_welcome',
        author: { id: 'sys', name: 'PulseBot', avatar: '🤖' },
        text: `Welcome to ${currentRoomName}! Share this room link with your friends to chat and send files 100% free!`,
        timestamp: Date.now()
      }
    ];
    saveLocalDemoMessages(roomId, messages);
  }
  renderMessages(messages);
}

function saveLocalDemoMessages(roomId, messages) {
  localStorage.setItem(LOCAL_MESSAGES_KEY_PREFIX + roomId, JSON.stringify(messages));
}

function setupBroadcastChannel() {
  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel('pulsechat_sync_channel');
    broadcastChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'NEW_MESSAGE' && event.data.roomId === currentRoomId) {
        if (!isFirebaseConnected) {
          loadLocalDemoMessages(currentRoomId);
        }
      }
    };
  }
}

async function sendMessage(text = '', attachment = null) {
  if (!text.trim() && !attachment) return;

  const msgPayload = {
    author: {
      id: currentUser.id,
      name: currentUser.name,
      avatar: currentUser.avatar
    },
    text: text.trim(),
    attachment: attachment || null,
    timestamp: isFirebaseConnected ? serverTimestamp() : Date.now()
  };

  if (isFirebaseConnected && db) {
    try {
      await addDoc(collection(db, 'rooms', currentRoomId, 'messages'), msgPayload);
    } catch (err) {
      console.error('Firestore send error:', err);
      showToast('Error sending message. Check file size.', 'danger');
    }
  } else {
    const raw = localStorage.getItem(LOCAL_MESSAGES_KEY_PREFIX + currentRoomId);
    let messages = [];
    if (raw) { try { messages = JSON.parse(raw); } catch (e) {} }
    msgPayload.id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    msgPayload.timestamp = Date.now();
    messages.push(msgPayload);
    saveLocalDemoMessages(currentRoomId, messages);
    renderMessages(messages);

    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'NEW_MESSAGE', roomId: currentRoomId });
    }
  }

  DOM.messageInput.value = '';
  DOM.messageInput.style.height = 'auto';
  clearSelectedAttachment();
}

// 100% Free File Handling (Client-Side Compression + Data URL)
async function handleFileSelect(file) {
  if (!file) return;

  // Max raw file limit for free Firestore doc (~800KB)
  if (file.size > 10 * 1024 * 1024) {
    showToast('Please select a file under 10MB', 'warning');
    return;
  }

  showToast('Optimizing & preparing file...', 'info');

  if (file.type.startsWith('image/')) {
    // Compress image client-side via HTML5 Canvas
    const compressedDataUrl = await compressImageFile(file, 1000, 0.75);
    setSelectedAttachment(file.name, file.size, file.type, compressedDataUrl);
  } else {
    // Read directly as Data URL for docs/audio
    const reader = new FileReader();
    reader.onload = (e) => {
      setSelectedAttachment(file.name, file.size, file.type, e.target.result);
    };
    reader.readAsDataURL(file);
  }
}

function compressImageFile(file, maxDimension = 1000, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target.result;
    };
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Output lightweight WebP / JPEG data URL
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

function setSelectedAttachment(name, size, type, dataUrl) {
  selectedAttachment = {
    name: name,
    size: size,
    type: type || 'application/octet-stream',
    url: dataUrl
  };

  DOM.previewFileName.textContent = name;
  DOM.previewFileSize.textContent = formatBytes(size);
  DOM.attachmentPreviewBar.classList.remove('hidden');
  showToast('File attached! Ready to send.', 'success');
}

function clearSelectedAttachment() {
  selectedAttachment = null;
  DOM.fileInput.value = '';
  DOM.attachmentPreviewBar.classList.add('hidden');
}

// Voice Note Recorder (Free Web Audio)
async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = (e) => {
        setSelectedAttachment(`Voice_Note_${Date.now()}.webm`, audioBlob.size, 'audio/webm', e.target.result);
      };
      reader.readAsDataURL(audioBlob);
    };

    mediaRecorder.start();
    isRecordingVoice = true;
    recordingSeconds = 0;
    DOM.voiceRecordingBar.classList.remove('hidden');
    DOM.recordVoiceBtn.classList.add('active');

    recordingTimer = setInterval(() => {
      recordingSeconds++;
      const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
      const secs = String(recordingSeconds % 60).padStart(2, '0');
      DOM.recordingTime.textContent = `${mins}:${secs}`;
    }, 1000);
  } catch (err) {
    showToast('Microphone access needed for voice notes', 'warning');
  }
}

function stopVoiceRecording(send = true) {
  if (!mediaRecorder || !isRecordingVoice) return;
  clearInterval(recordingTimer);
  isRecordingVoice = false;
  DOM.voiceRecordingBar.classList.add('hidden');
  DOM.recordVoiceBtn.classList.remove('active');

  if (send) {
    mediaRecorder.stop();
  } else {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
    audioChunks = [];
  }
}

// Render Message Stream
function renderMessages(messages) {
  DOM.messagesContainer.innerHTML = '';

  if (messages.length === 0) {
    DOM.messagesContainer.innerHTML = `
      <div class="system-notice">
        <i class="fa-solid fa-comments"></i> No messages yet. Start the conversation!
      </div>
    `;
    return;
  }

  messages.forEach(msg => {
    const isSentByMe = msg.author.id === currentUser.id;
    const msgEl = document.createElement('div');
    msgEl.className = `message-item ${isSentByMe ? 'sent' : 'received'}`;

    let timeStr = 'Just now';
    if (msg.timestamp) {
      const date = typeof msg.timestamp === 'number' ? new Date(msg.timestamp) : msg.timestamp.toDate ? msg.timestamp.toDate() : new Date();
      timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    let attachmentHtml = '';
    if (msg.attachment) {
      const att = msg.attachment;
      if (att.type.startsWith('image/')) {
        attachmentHtml = `
          <div class="media-attachment">
            <div class="attachment-img-wrapper" data-src="${att.url}">
              <img src="${att.url}" alt="${att.name}" loading="lazy">
            </div>
          </div>
        `;
      } else if (att.type.startsWith('audio/')) {
        attachmentHtml = `
          <div class="media-attachment">
            <div class="audio-card">
              <audio src="${att.url}" controls style="max-width: 240px; height: 32px;"></audio>
            </div>
          </div>
        `;
      } else {
        attachmentHtml = `
          <div class="media-attachment">
            <div class="doc-card">
              <i class="fa-solid fa-file-lines doc-icon"></i>
              <div class="doc-info">
                <div class="doc-name">${att.name}</div>
                <div class="doc-size">${formatBytes(att.size)}</div>
              </div>
              <a href="${att.url}" download="${att.name}" class="doc-download-btn" title="Download File">
                <i class="fa-solid fa-download"></i>
              </a>
            </div>
          </div>
        `;
      }
    }

    msgEl.innerHTML = `
      <div class="message-avatar" style="background: ${isSentByMe ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.1)'}">
        ${msg.author.avatar || '⚡'}
      </div>
      <div class="message-content">
        <div class="message-author">
          <span>${msg.author.name || 'Anonymous'}</span>
          <span class="message-time">${timeStr}</span>
        </div>
        ${msg.text ? `<div class="message-bubble">${escapeHtml(msg.text)}</div>` : ''}
        ${attachmentHtml}
      </div>
    `;

    const imgWrapper = msgEl.querySelector('.attachment-img-wrapper');
    if (imgWrapper) {
      imgWrapper.addEventListener('click', () => openLightbox(imgWrapper.getAttribute('data-src')));
    }

    DOM.messagesContainer.appendChild(msgEl);
  });

  DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
}

// Event Listeners
function setupEventListeners() {
  DOM.openSidebarBtn.addEventListener('click', () => DOM.sidebar.classList.add('open'));
  DOM.closeSidebarBtn.addEventListener('click', () => DOM.sidebar.classList.remove('open'));

  DOM.userProfileTrigger.addEventListener('click', () => {
    DOM.profileNameInput.value = currentUser.name;
    openModal('profile-modal');
  });

  DOM.profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    currentUser.name = DOM.profileNameInput.value.trim() || currentUser.name;
    saveUserProfile();
    closeModal('profile-modal');
    showToast('Profile updated!', 'success');
  });

  DOM.avatarSelectGrid.querySelectorAll('.avatar-option').forEach(el => {
    el.addEventListener('click', () => {
      DOM.avatarSelectGrid.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
      el.classList.add('selected');
      currentUser.avatar = el.textContent;
    });
  });

  DOM.sendBtn.addEventListener('click', () => sendMessage(DOM.messageInput.value, selectedAttachment));
  DOM.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(DOM.messageInput.value, selectedAttachment);
    }
  });

  DOM.messageInput.addEventListener('input', () => {
    DOM.messageInput.style.height = 'auto';
    DOM.messageInput.style.height = Math.min(DOM.messageInput.scrollHeight, 120) + 'px';
  });

  DOM.attachFileBtn.addEventListener('click', () => DOM.fileInput.click());
  DOM.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
  });
  DOM.cancelAttachmentBtn.addEventListener('click', clearSelectedAttachment);

  window.addEventListener('dragover', (e) => { e.preventDefault(); DOM.dragOverlay.classList.add('active'); });
  DOM.dragOverlay.addEventListener('dragleave', () => DOM.dragOverlay.classList.remove('active'));
  DOM.dragOverlay.addEventListener('drop', (e) => {
    e.preventDefault();
    DOM.dragOverlay.classList.remove('active');
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
  });

  DOM.recordVoiceBtn.addEventListener('click', () => isRecordingVoice ? stopVoiceRecording(true) : startVoiceRecording());
  DOM.cancelRecordingBtn.addEventListener('click', () => stopVoiceRecording(false));
  DOM.stopSendRecordingBtn.addEventListener('click', () => stopVoiceRecording(true));

  DOM.createRoomBtn.addEventListener('click', () => {
    const roomName = prompt('Enter new chat room name:');
    if (roomName && roomName.trim()) {
      const slug = roomName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.floor(100 + Math.random() * 900);
      switchRoom(slug);
      showToast(`Created room: ${roomName}`, 'success');
    }
  });

  DOM.joinRoomBtn.addEventListener('click', () => {
    const val = DOM.joinRoomInput.value.trim();
    if (val) {
      let roomId = val;
      if (val.includes('#room=')) roomId = val.split('#room=')[1];
      switchRoom(roomId);
      DOM.joinRoomInput.value = '';
    }
  });

  DOM.shareRoomBtn.addEventListener('click', () => {
    const fullUrl = `${window.location.origin}${window.location.pathname}#room=${encodeURIComponent(currentRoomId)}`;
    DOM.shareModalRoomName.textContent = currentRoomName;
    DOM.shareLinkInput.value = fullUrl;
    openModal('share-modal');
  });

  DOM.copyShareLinkBtn.addEventListener('click', () => {
    DOM.shareLinkInput.select();
    navigator.clipboard.writeText(DOM.shareLinkInput.value);
    showToast('Shareable room link copied to clipboard!', 'success');
  });

  DOM.setupGuideBtn.addEventListener('click', () => openModal('setup-guide-modal'));
  DOM.openConfigBtn.addEventListener('click', () => { fillConfigFormValues(); openModal('config-modal'); });
  DOM.guideToConfigBtn.addEventListener('click', () => { closeModal('setup-guide-modal'); fillConfigFormValues(); openModal('config-modal'); });

  DOM.firebaseConfigForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const config = {
      apiKey: document.getElementById('cfg-apiKey').value.trim(),
      authDomain: document.getElementById('cfg-authDomain').value.trim(),
      projectId: document.getElementById('cfg-projectId').value.trim(),
      messagingSenderId: document.getElementById('cfg-messagingSenderId').value.trim(),
      appId: document.getElementById('cfg-appId').value.trim()
    };

    saveConfig(config);
    const connected = await initFirebase(config);
    updateBackendStatusUI(connected);
    closeModal('config-modal');

    if (connected) {
      showToast('Connected to Firebase (100% Free Spark Tier)!', 'success');
      switchRoom(currentRoomId);
    } else {
      showToast('Firebase connection failed. Check API Key.', 'danger');
    }
  });

  DOM.resetConfigBtn.addEventListener('click', () => {
    clearConfig();
    updateBackendStatusUI(false);
    closeModal('config-modal');
    showToast('Reset to Demo Mode', 'info');
    switchRoom(currentRoomId);
  });

  DOM.emojiPickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    DOM.emojiPopover.classList.toggle('hidden');
  });
  document.addEventListener('click', () => DOM.emojiPopover.classList.add('hidden'));

  DOM.emojiPopover.querySelectorAll('.emoji-grid span').forEach(emojiSpan => {
    emojiSpan.addEventListener('click', () => {
      DOM.messageInput.value += emojiSpan.textContent;
      DOM.emojiPopover.classList.add('hidden');
    });
  });

  DOM.toggleThemeBtn.addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark-theme');
    if (isDark) {
      document.body.classList.replace('dark-theme', 'light-theme');
      DOM.themeIcon.className = 'fa-solid fa-sun';
      DOM.themeLabel.textContent = 'Light Mode';
    } else {
      document.body.classList.replace('light-theme', 'dark-theme');
      DOM.themeIcon.className = 'fa-solid fa-moon';
      DOM.themeLabel.textContent = 'Dark Mode';
    }
  });

  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-close');
      if (targetId) closeModal(targetId);
    });
  });
}

function updateBackendStatusUI(connected) {
  if (connected) {
    DOM.backendStatusBadge.className = 'badge badge-pulse';
    DOM.backendStatusBadge.innerHTML = '<i class="fa-solid fa-circle text-success"></i> Free Firestore Connected';
  } else {
    DOM.backendStatusBadge.className = 'badge badge-pulse';
    DOM.backendStatusBadge.innerHTML = '<i class="fa-solid fa-circle text-orange"></i> Demo Mode';
  }
}

function fillConfigFormValues() {
  const cfg = getStoredConfig() || {};
  document.getElementById('cfg-apiKey').value = cfg.apiKey || '';
  document.getElementById('cfg-authDomain').value = cfg.authDomain || '';
  document.getElementById('cfg-projectId').value = cfg.projectId || '';
  document.getElementById('cfg-messagingSenderId').value = cfg.messagingSenderId || '';
  document.getElementById('cfg-appId').value = cfg.appId || '';
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
}

function openLightbox(imgSrc) {
  DOM.lightboxImg.src = imgSrc;
  DOM.lightboxDownloadBtn.href = imgSrc;
  openModal('lightbox-modal');
}

function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'warning') icon = 'fa-triangle-exclamation';
  if (type === 'danger') icon = 'fa-circle-xmark';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${msg}</span>`;
  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}
