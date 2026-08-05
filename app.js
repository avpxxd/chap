// Import Firebase SDK Modules from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  initializeAppCheck, 
  ReCaptchaV3Provider 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  getDatabase, 
  ref, 
  set, 
  push, 
  onValue, 
  onChildAdded, 
  onChildChanged,
  onChildRemoved,
  remove, 
  serverTimestamp, 
  onDisconnect, 
  get 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyD4V61nnTkvE1kDC08eACZsedX8GrC73DM",
  authDomain: "chatapp-f1f3f.firebaseapp.com",
  databaseURL: "https://chatapp-f1f3f-default-rtdb.firebaseio.com",
  projectId: "chatapp-f1f3f",
  storageBucket: "chatapp-f1f3f.firebasestorage.app",
  messagingSenderId: "519762777434",
  appId: "1:519762777434:web:8ed9ca727ab52f13dacf63",
  measurementId: "G-181SGZDMGT"
};

// Initialize Firebase App & Realtime Database
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Initialize Firebase App Check with reCAPTCHA v3 to Block CLI / Script / Bot API Requests
let appCheck = null;
try {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('6LeEKnYtAAAAAO1dir_infKo91ANyvTUOUKNdN6R'),
    isTokenAutoRefreshEnabled: true
  });
  console.log("Firebase App Check initialized successfully.");
} catch (e) {
  console.warn("App Check Note:", e);
}

// Public Default Channels with FontAwesome Icons
const PUBLIC_ROOMS = [
  { id: "general", name: "#general", desc: "General discussion channel for everyone", iconClass: "fa-solid fa-hashtag" },
  { id: "tech-lounge", name: "#tech-lounge", desc: "Tech news, coding tips, and gadget talk", iconClass: "fa-solid fa-laptop-code" },
  { id: "gaming", name: "#gaming", desc: "Gamers hangout, squad up, and clips", iconClass: "fa-solid fa-gamepad" },
  { id: "music-vibes", name: "#music-vibes", desc: "Share music recs and playlist vibes", iconClass: "fa-solid fa-music" },
  { id: "random", name: "#random", desc: "Memes, random thoughts, and fun", iconClass: "fa-solid fa-dice" }
];

// Application State
let currentUser = null;
let currentNickname = localStorage.getItem("chapp_nickname") || localStorage.getItem("pulsechat_nickname") || "";
let currentRoom = PUBLIC_ROOMS[0];
let privateRooms = JSON.parse(localStorage.getItem("chapp_private_rooms") || localStorage.getItem("pulsechat_private_rooms") || "[]");
let soundMuted = (localStorage.getItem("chapp_sound_muted") || localStorage.getItem("pulsechat_sound_muted")) === "true";
let activeImageAttachment = null;
let activeRoomMessageUnsubscribe = null;
let currentTypingListener = null;
let activePresenceListener = null;
let typingTimeout = null;
let searchFilterQuery = "";
let unreadCounts = {};
let backgroundRoomListeners = {};
let activeContextMenu = null;
let currentRoomMessagesSnapshot = {};
let activeReplyTarget = null;
const linkMetadataCache = {};

// Rate Limiter & CAPTCHA Bot Protection Parameters
let userSendTimestamps = [];
const RATE_LIMIT_COUNT = 10;          // Max 10 messages in 4 seconds
const RATE_LIMIT_WINDOW_MS = 4000;
const BURST_LIMIT_COUNT = 3;           // Max 3 messages in 2 seconds
const BURST_LIMIT_WINDOW_MS = 2000;

// Slowmode Punishment Parameters (5 minutes punishment, 1 msg/min restriction)
const SLOWMODE_PUNISHMENT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const SLOWMODE_COOLDOWN_MS = 60 * 1000;                // 1 msg per 60s
let slowmodeUntil = parseInt(sessionStorage.getItem("chapp_slowmode_until") || "0", 10);
let lastSentTimestamp = parseInt(sessionStorage.getItem("chapp_last_sent_time") || "0", 10);

let isCaptchaVerified = (sessionStorage.getItem("chapp_captcha_verified") || sessionStorage.getItem("pulsechat_captcha_verified")) === "true";
let turnstileWidgetId = null;

// Helper: Validate Database Keys to Prevent Path Traversal & Global Data Deletion Wipes
function isValidKey(key) {
  if (key === null || key === undefined) return false;
  const str = String(key).trim();
  if (!str) return false;
  if (/[/.\#$\[\]]/.test(str) || str === '..' || str === '.') return false;
  return true;
}

// Zalgo Glitch Character Sanitizer Utility
function stripZalgo(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, '');
}

// Check if URL is an image/GIF link
function isMediaUrl(url) {
  if (!url) return false;
  if (/\.(gif|jpe?g|png|webp|svg)(\?.*)?$/i.test(url)) return true;
  if (/media\.giphy\.com|i\.giphy\.com|tenor\.com\/view|i\.imgur\.com/i.test(url)) return true;
  return false;
}

function getDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch (e) {
    return 'Website';
  }
}

// Slowmode Punishment Helpers & UI Timer
function triggerSlowmodePunishment(reason = "spamming") {
  const now = Date.now();
  slowmodeUntil = Math.max(slowmodeUntil, now + SLOWMODE_PUNISHMENT_DURATION_MS);
  sessionStorage.setItem("chapp_slowmode_until", slowmodeUntil.toString());

  const remainingMin = Math.ceil((slowmodeUntil - now) / 60000);
  showToast(`🚨 Slowmode Punishment: Forced 1 msg/min for ${remainingMin}m due to ${reason}!`, 5000, "fa-solid fa-hourglass-half");
  playSound('delete');
  updateSlowmodeUI();
}

function isUserInSlowmode() {
  return Date.now() < slowmodeUntil;
}

function updateSlowmodeUI() {
  const now = Date.now();
  const banner = document.getElementById("slowmodeBanner");
  const timerText = document.getElementById("slowmodeTimerText");

  if (!banner || !timerText) return;

  if (now < slowmodeUntil) {
    banner.classList.remove("hidden");
    const remainingSec = Math.ceil((slowmodeUntil - now) / 1000);
    const min = Math.floor(remainingSec / 60).toString().padStart(2, '0');
    const sec = (remainingSec % 60).toString().padStart(2, '0');
    timerText.textContent = `${min}:${sec}`;
  } else {
    banner.classList.add("hidden");
  }
}

// Fetch Rich Link Preview OpenGraph Metadata
function fetchLinkPreview(url, previewContainer) {
  if (linkMetadataCache[url]) {
    renderLinkPreviewCard(linkMetadataCache[url], previewContainer);
    return;
  }

  const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}`;
  fetch(apiUrl)
    .then(res => res.json())
    .then(res => {
      if (res.status === "success" && res.data) {
        const domain = getDomain(url);
        const data = {
          url: url,
          title: res.data.title || "",
          description: res.data.description || "",
          image: res.data.image?.url || res.data.logo?.url || "",
          publisher: res.data.publisher || domain,
          logo: res.data.logo?.url || `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
        };
        linkMetadataCache[url] = data;
        renderLinkPreviewCard(data, previewContainer);
      } else {
        renderFallbackPreview(url, previewContainer);
      }
    })
    .catch(() => {
      renderFallbackPreview(url, previewContainer);
    });
}

function renderLinkPreviewCard(data, container) {
  if (!data || (!data.title && !data.description && !data.image)) return;
  container.innerHTML = "";

  const card = document.createElement("a");
  card.className = "link-preview-card";
  card.href = data.url;
  card.target = "_blank";
  card.rel = "noopener noreferrer";

  if (data.image && (data.image.startsWith("http://") || data.image.startsWith("https://"))) {
    const img = document.createElement("img");
    img.className = "link-preview-image";
    img.src = data.image;
    img.alt = "Link preview";
    img.loading = "lazy";
    card.appendChild(img);
  }

  const content = document.createElement("div");
  content.className = "link-preview-content";

  const header = document.createElement("div");
  header.className = "link-preview-header";

  if (data.logo) {
    const favicon = document.createElement("img");
    favicon.className = "link-preview-favicon";
    favicon.src = data.logo;
    favicon.alt = "Favicon";
    header.appendChild(favicon);
  }

  const domainSpan = document.createElement("span");
  domainSpan.className = "link-preview-domain";
  domainSpan.textContent = data.publisher || getDomain(data.url);
  header.appendChild(domainSpan);

  content.appendChild(header);

  if (data.title) {
    const titleEl = document.createElement("div");
    titleEl.className = "link-preview-title";
    titleEl.textContent = stripZalgo(data.title);
    content.appendChild(titleEl);
  }

  if (data.description) {
    const descEl = document.createElement("div");
    descEl.className = "link-preview-desc";
    descEl.textContent = stripZalgo(data.description);
    content.appendChild(descEl);
  }

  card.appendChild(content);
  container.appendChild(card);
}

function renderFallbackPreview(url, container) {
  const domain = getDomain(url);
  const data = {
    url: url,
    title: domain,
    description: url,
    image: "",
    publisher: domain,
    logo: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  };
  renderLinkPreviewCard(data, container);
}

// CAPTCHA Human Verification Rendering
function renderCaptchaWidget() {
  const container = document.getElementById("turnstileWidget");
  if (!container) return;

  container.innerHTML = "";

  if (window.turnstile) {
    try {
      turnstileWidgetId = window.turnstile.render("#turnstileWidget", {
        sitekey: "1x00000000000000000000AA",
        theme: "dark",
        callback: function(token) {
          isCaptchaVerified = true;
          sessionStorage.setItem("chapp_captcha_verified", "true");
          showToast("Human verification successful!", 3000, "fa-solid fa-shield-cat");
          const verifyBtn = document.getElementById("verifyCaptchaBtn");
          if (verifyBtn) {
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = `Enter Chapp <i class="fa-solid fa-rocket"></i>`;
          }
        },
        "error-callback": function() {
          showToast("Verification error. Please retry.", 3000, "fa-solid fa-circle-exclamation");
        }
      });
    } catch (e) {
      console.log("Turnstile note:", e);
      isCaptchaVerified = true;
    }
  } else {
    isCaptchaVerified = true;
  }
}

function promptCaptcha() {
  isCaptchaVerified = false;
  sessionStorage.removeItem("chapp_captcha_verified");
  const verifyBtn = document.getElementById("verifyCaptchaBtn");
  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.textContent = "Complete Verification to Enter";
  }
  elements.captchaModal.classList.remove("hidden");
  setTimeout(renderCaptchaWidget, 100);
}

// Sound Synthesizer via Web Audio API
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (soundMuted || audioCtx.state === 'suspended') {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (soundMuted) return;
  }

  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'send') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'receive') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'join') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'delete') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    }
  } catch (e) {
    console.error("Audio playback error:", e);
  }
}

// DOM Elements
const elements = {
  publicRoomsList: document.getElementById("publicRoomsList"),
  privateRoomsList: document.getElementById("privateRoomsList"),
  currentUserName: document.getElementById("currentUserName"),
  currentUserIdSub: document.getElementById("currentUserIdSub"),
  currentUserAvatar: document.getElementById("currentUserAvatar"),
  activeRoomTitle: document.getElementById("activeRoomTitle"),
  activeRoomBadge: document.getElementById("activeRoomBadge"),
  activeRoomDesc: document.getElementById("activeRoomDesc"),
  messagesContainer: document.getElementById("messagesContainer"),
  chatForm: document.getElementById("chatForm"),
  messageInput: document.getElementById("messageInput"),
  imageInput: document.getElementById("imageInput"),
  attachmentPreviewBar: document.getElementById("attachmentPreviewBar"),
  previewImage: document.getElementById("previewImage"),
  removeAttachmentBtn: document.getElementById("removeAttachmentBtn"),
  replyPreviewBar: document.getElementById("replyPreviewBar"),
  replyToSender: document.getElementById("replyToSender"),
  replyToText: document.getElementById("replyToText"),
  cancelReplyBtn: document.getElementById("cancelReplyBtn"),
  typingIndicator: document.getElementById("typingIndicator"),
  typingText: document.getElementById("typingText"),
  membersList: document.getElementById("membersList"),
  onlineCountBadge: document.getElementById("onlineCountBadge"),
  roomCodeBanner: document.getElementById("roomCodeBanner"),
  displayRoomCode: document.getElementById("displayRoomCode"),
  copyRoomCodeBtn: document.getElementById("copyRoomCodeBtn"),
  shareRoomBtn: document.getElementById("shareRoomBtn"),
  toastContainer: document.getElementById("toastContainer"),
  audioToggleBtn: document.getElementById("audioToggleBtn"),
  soundOnIcon: document.getElementById("soundOnIcon"),
  soundOffIcon: document.getElementById("soundOffIcon"),
  // CAPTCHA
  captchaModal: document.getElementById("captchaModal"),
  verifyCaptchaBtn: document.getElementById("verifyCaptchaBtn"),
  // Modals & Inputs
  createRoomModal: document.getElementById("createRoomModal"),
  openCreateRoomModalBtn: document.getElementById("openCreateRoomModalBtn"),
  closeCreateModalBtn: document.getElementById("closeCreateModalBtn"),
  cancelCreateModalBtn: document.getElementById("cancelCreateModalBtn"),
  confirmCreateRoomBtn: document.getElementById("confirmCreateRoomBtn"),
  newRoomName: document.getElementById("newRoomName"),
  newRoomCode: document.getElementById("newRoomCode"),
  genRandomCodeBtn: document.getElementById("genRandomCodeBtn"),
  joinRoomModal: document.getElementById("joinRoomModal"),
  openJoinRoomModalBtn: document.getElementById("openJoinRoomModalBtn"),
  closeJoinModalBtn: document.getElementById("closeJoinModalBtn"),
  cancelJoinModalBtn: document.getElementById("cancelJoinModalBtn"),
  confirmJoinRoomBtn: document.getElementById("confirmJoinRoomBtn"),
  joinRoomCodeInput: document.getElementById("joinRoomCodeInput"),
  editNameModal: document.getElementById("editNameModal"),
  editNameBtn: document.getElementById("editNameBtn"),
  closeNameModalBtn: document.getElementById("closeNameModalBtn"),
  cancelNameModalBtn: document.getElementById("cancelNameModalBtn"),
  saveNicknameBtn: document.getElementById("saveNicknameBtn"),
  nicknameInput: document.getElementById("nicknameInput"),
  // Search
  searchInput: document.getElementById("searchInput"),
  clearSearchBtn: document.getElementById("clearSearchBtn"),
  searchBar: document.getElementById("searchBar"),
  searchQueryText: document.getElementById("searchQueryText"),
  closeSearchBannerBtn: document.getElementById("closeSearchBannerBtn"),
  // Mobile
  mobileMenuBtn: document.getElementById("mobileMenuBtn"),
  closeSidebarBtn: document.getElementById("closeSidebarBtn"),
  sidebar: document.getElementById("sidebar"),
  sidebarBackdrop: document.getElementById("sidebarBackdrop"),
  toggleUsersBtn: document.getElementById("toggleUsersBtn"),
  membersDrawer: document.getElementById("membersDrawer")
};

// Generate Random 6-char Room Code
function generateRandomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "ROOM-";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Show Toast Notification with FontAwesome Icons
function showToast(message, duration = 3000, iconClass = "fa-solid fa-circle-info") {
  const toast = document.createElement("div");
  toast.className = "toast";
  
  const icon = document.createElement("i");
  icon.className = iconClass;
  
  const textSpan = document.createElement("span");
  textSpan.textContent = stripZalgo(message);

  toast.appendChild(icon);
  toast.appendChild(textSpan);
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Format Timestamps
function formatTime(timestamp) {
  if (!timestamp) return "Just now";
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Initialize Application
async function initApp() {
  updateSoundUI();
  renderPublicRooms();
  renderPrivateRooms();
  setupEventListeners();

  // Start Slowmode UI countdown loop
  setInterval(updateSlowmodeUI, 1000);
  updateSlowmodeUI();

  // Check CAPTCHA verification
  if (!isCaptchaVerified) {
    promptCaptcha();
  }

  // Anonymous Authentication
  try {
    const userCredential = await signInAnonymously(auth);
    currentUser = userCredential.user;
    
    if (!currentNickname || !stripZalgo(currentNickname).trim()) {
      currentNickname = "Guest-" + currentUser.uid.substring(0, 4);
      localStorage.setItem("chapp_nickname", currentNickname);
    }
    
    updateUserUI();
    setupPresence();
    subscribeAllBackgroundRoomNotifications();
    
    // Check URL parameters for private room code
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get("room");
    if (roomParam && isValidKey(roomParam)) {
      joinRoomByCode(roomParam.trim().toUpperCase());
    } else {
      switchRoom(PUBLIC_ROOMS[0]);
    }
  } catch (error) {
    console.error("Firebase Auth Error:", error);
    showToast("Authentication error. Refreshing...", 3000, "fa-solid fa-triangle-exclamation");
  }
}

// Setup Background Notifications for Unread Badges across Channels
function subscribeAllBackgroundRoomNotifications() {
  const allRooms = [...PUBLIC_ROOMS, ...privateRooms];
  allRooms.forEach(room => subscribeRoomBackground(room));
}

function subscribeRoomBackground(room) {
  if (!isValidKey(room.id) || backgroundRoomListeners[room.id]) return;

  const messagesRef = ref(db, `messages/${room.id}`);
  let isInitialSync = true;

  get(messagesRef).then(() => {
    isInitialSync = false;
  }).catch(() => {
    isInitialSync = false;
  });

  const unsubscribe = onChildAdded(messagesRef, (snapshot) => {
    if (isInitialSync) return;
    const msg = snapshot.val();
    if (!msg) return;

    if (room.id !== currentRoom.id && msg.senderId !== currentUser?.uid) {
      unreadCounts[room.id] = (unreadCounts[room.id] || 0) + 1;
      renderPublicRooms();
      renderPrivateRooms();
      playSound('receive');
      showToast(`${room.name}: ${msg.senderName || 'Someone'}: "${msg.text || 'Image attachment'}"`, 3000, "fa-solid fa-comment-dots");
    }
  });

  backgroundRoomListeners[room.id] = unsubscribe;
}

// Setup User Online Presence with RTDB
function setupPresence() {
  if (!currentUser || !isValidKey(currentUser.uid)) return;
  const userStatusRef = ref(db, `status/${currentUser.uid}`);
  const connectedRef = ref(db, ".info/connected");

  const myStatus = {
    name: stripZalgo(currentNickname).trim() || "Anonymous",
    uid: currentUser.uid,
    state: "online",
    roomId: currentRoom.id,
    lastSeen: serverTimestamp()
  };

  onValue(connectedRef, (snapshot) => {
    if (snapshot.val() === false) return;

    onDisconnect(userStatusRef).set({
      name: stripZalgo(currentNickname).trim() || "Anonymous",
      uid: currentUser.uid,
      state: "offline",
      roomId: currentRoom.id,
      lastSeen: serverTimestamp()
    }).then(() => {
      set(userStatusRef, myStatus);
    });
  });
}

function updatePresenceRoom(roomId) {
  if (!currentUser || !isValidKey(currentUser.uid) || !isValidKey(roomId)) return;
  set(ref(db, `status/${currentUser.uid}/roomId`), roomId);
}

// Listen to Active Members in Current Room (DOM Nodes - 100% XSS Immune)
function listenToRoomMembers(roomId) {
  if (!isValidKey(roomId)) return;
  if (activePresenceListener) activePresenceListener();
  
  const statusRef = ref(db, "status");
  activePresenceListener = onValue(statusRef, (snapshot) => {
    const data = snapshot.val() || {};
    elements.membersList.innerHTML = "";
    let onlineCount = 0;

    Object.values(data).forEach(user => {
      if (user.roomId === roomId && user.state === "online") {
        onlineCount++;
        const item = document.createElement("div");
        item.className = "member-item";
        
        const rawName = stripZalgo(user.name).trim() || "Anonymous User";
        const initial = (rawName.charAt(0) || "G").toUpperCase();

        const avatarWrapper = document.createElement("div");
        avatarWrapper.className = "member-avatar-wrapper";

        const avatar = document.createElement("div");
        avatar.className = "member-avatar";
        avatar.textContent = initial;

        const dot = document.createElement("div");
        dot.className = "member-status-dot";

        avatarWrapper.appendChild(avatar);
        avatarWrapper.appendChild(dot);

        const nameSpan = document.createElement("span");
        nameSpan.className = "member-name";
        nameSpan.textContent = rawName;

        item.appendChild(avatarWrapper);
        item.appendChild(nameSpan);
        elements.membersList.appendChild(item);
      }
    });

    elements.onlineCountBadge.textContent = onlineCount;
  });
}

// Update User UI (DOM Nodes - 100% XSS Immune)
function updateUserUI() {
  if (!currentUser) return;
  const cleanNick = stripZalgo(currentNickname).trim() || "Guest";
  elements.currentUserName.textContent = cleanNick;
  elements.currentUserAvatar.textContent = (cleanNick.charAt(0) || "G").toUpperCase();
  elements.currentUserIdSub.textContent = `ID: ${currentUser.uid.substring(0, 8)}`;
}

// Render Public Channels List
function renderPublicRooms() {
  elements.publicRoomsList.innerHTML = "";
  PUBLIC_ROOMS.forEach(room => {
    const item = document.createElement("div");
    item.className = `room-item ${room.id === currentRoom.id ? 'active' : ''}`;
    item.onclick = () => switchRoom(room);
    
    const unread = unreadCounts[room.id] || 0;
    
    const nameDiv = document.createElement("div");
    nameDiv.className = "room-item-name";

    const iconSpan = document.createElement("i");
    iconSpan.className = room.iconClass;

    const titleSpan = document.createElement("span");
    titleSpan.textContent = room.name;

    nameDiv.appendChild(iconSpan);
    nameDiv.appendChild(titleSpan);
    item.appendChild(nameDiv);

    if (unread > 0) {
      const badge = document.createElement("span");
      badge.className = "unread-badge";
      badge.textContent = unread;
      item.appendChild(badge);
    }

    elements.publicRoomsList.appendChild(item);
  });
}

// Render Private Rooms List
function renderPrivateRooms() {
  elements.privateRoomsList.innerHTML = "";
  if (privateRooms.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-rooms-hint";
    hint.textContent = "No private rooms joined yet.";
    elements.privateRoomsList.appendChild(hint);
    return;
  }

  privateRooms.forEach(room => {
    const item = document.createElement("div");
    item.className = `room-item ${room.id === currentRoom.id ? 'active' : ''}`;
    item.onclick = () => switchRoom(room);
    
    const unread = unreadCounts[room.id] || 0;
    
    const nameDiv = document.createElement("div");
    nameDiv.className = "room-item-name";

    const iconSpan = document.createElement("i");
    iconSpan.className = "fa-solid fa-lock";

    const titleSpan = document.createElement("span");
    titleSpan.textContent = room.name;

    nameDiv.appendChild(iconSpan);
    nameDiv.appendChild(titleSpan);
    item.appendChild(nameDiv);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "room-actions";

    if (unread > 0) {
      const badge = document.createElement("span");
      badge.className = "unread-badge";
      badge.textContent = unread;
      actionsDiv.appendChild(badge);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "delete-room-btn";
    delBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i>`;
    delBtn.title = "Delete Private Room";
    delBtn.onclick = (e) => window.deletePrivateRoom(room.id, e);
    actionsDiv.appendChild(delBtn);

    item.appendChild(actionsDiv);
    elements.privateRoomsList.appendChild(item);
  });
}

// Delete Private Room Function
window.deletePrivateRoom = async function(roomId, event) {
  if (event) event.stopPropagation();

  if (!isValidKey(roomId)) {
    console.error("Invalid room ID format for deletion:", roomId);
    return;
  }

  if (PUBLIC_ROOMS.some(p => p.id === roomId)) {
    showToast("Public channels cannot be deleted!", 3000, "fa-solid fa-ban");
    return;
  }

  if (!confirm(`Are you sure you want to delete and leave room ${roomId}?`)) {
    return;
  }

  privateRooms = privateRooms.filter(r => r.id !== roomId);
  localStorage.setItem("chapp_private_rooms", JSON.stringify(privateRooms));

  try {
    await remove(ref(db, `private_rooms/${roomId}`));
    await remove(ref(db, `messages/${roomId}`));
  } catch (err) {
    console.log("Room DB remove info:", err);
  }

  showToast(`Deleted private room ${roomId}`, 3000, "fa-solid fa-trash-can");
  playSound('delete');

  if (currentRoom.id === roomId) {
    switchRoom(PUBLIC_ROOMS[0]);
  } else {
    renderPrivateRooms();
  }
};

// Switch Active Chat Room
function switchRoom(room) {
  if (!room || !isValidKey(room.id)) return;
  currentRoom = room;
  unreadCounts[room.id] = 0;
  window.cancelReply();
  renderPublicRooms();
  renderPrivateRooms();
  dismissContextMenu();
  
  elements.activeRoomTitle.textContent = room.name;
  elements.activeRoomDesc.textContent = room.desc || "Private chat room";
  elements.activeRoomBadge.textContent = room.isPrivate ? "Private Code" : "Public";
  elements.activeRoomBadge.className = `badge ${room.isPrivate ? 'private' : ''}`;
  elements.messageInput.placeholder = `Type a message in ${room.name}...`;

  if (room.isPrivate) {
    elements.roomCodeBanner.classList.remove("hidden");
    elements.displayRoomCode.textContent = room.code || room.id;
  } else {
    elements.roomCodeBanner.classList.add("hidden");
  }

  updatePresenceRoom(room.id);
  listenToRoomMembers(room.id);
  loadRoomMessages(room.id);
  listenToTyping(room.id);
  playSound('join');
}

// Load Messages for Active Room
function loadRoomMessages(roomId) {
  if (!isValidKey(roomId)) return;
  if (activeRoomMessageUnsubscribe) activeRoomMessageUnsubscribe();
  elements.messagesContainer.innerHTML = "";

  const messagesRef = ref(db, `messages/${roomId}`);

  activeRoomMessageUnsubscribe = onValue(messagesRef, (snapshot) => {
    if (currentRoom.id !== roomId) return;

    const messages = snapshot.val() || {};
    currentRoomMessagesSnapshot = messages;
    elements.messagesContainer.innerHTML = "";

    if (Object.keys(messages).length === 0) {
      const welcomeCard = document.createElement("div");
      welcomeCard.className = "welcome-message-card";
      
      const icon = document.createElement("div");
      icon.className = "welcome-icon";
      icon.innerHTML = `<i class="${currentRoom.iconClass || 'fa-solid fa-comments'}"></i>`;

      const h2 = document.createElement("h2");
      h2.textContent = `Welcome to ${currentRoom.name}`;

      const p = document.createElement("p");
      p.textContent = "No messages here yet. Right-click any message for reactions, reply, copy, and options!";

      welcomeCard.appendChild(icon);
      welcomeCard.appendChild(h2);
      welcomeCard.appendChild(p);
      elements.messagesContainer.appendChild(welcomeCard);
      return;
    }

    let hasMatchedSearch = false;
    Object.entries(messages).forEach(([msgId, msg]) => {
      if (!msg || typeof msg !== 'object') return;
      const sender = stripZalgo(msg.senderName).trim();
      if (!sender) return;

      if (searchFilterQuery) {
        const text = (msg.text || "").toLowerCase();
        const author = sender.toLowerCase();
        if (!text.includes(searchFilterQuery) && !author.includes(searchFilterQuery)) {
          return;
        }
        hasMatchedSearch = true;
      }
      renderSingleMessage(msgId, msg);
    });

    if (searchFilterQuery && !hasMatchedSearch) {
      const empty = document.createElement("div");
      empty.className = "empty-rooms-hint";
      empty.style.textAlign = "center";
      empty.style.padding = "40px";
      empty.textContent = `No messages matched "${searchFilterQuery}".`;
      elements.messagesContainer.appendChild(empty);
    } else {
      elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }
  });
}

// Render Single Message in Stream (With Reply Quote & Graceful Deleted Message Handling)
function renderSingleMessage(msgId, msg) {
  const isOutgoing = msg.senderId === currentUser?.uid;
  const item = document.createElement("div");
  item.className = `message-item ${isOutgoing ? 'outgoing' : ''}`;
  item.id = `msg-${msgId}`;

  // 1. Avatar
  const rawSender = stripZalgo(msg.senderName).trim() || "User";
  const initial = (rawSender.charAt(0) || "U").toUpperCase();
  
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = initial;

  // 2. Msg Body Container
  const body = document.createElement("div");
  body.className = "msg-body";

  // 3. Header
  const header = document.createElement("div");
  header.className = "msg-header";

  const author = document.createElement("span");
  author.className = "msg-author";
  author.textContent = rawSender;

  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatTime(msg.timestamp);

  header.appendChild(author);
  header.appendChild(time);

  // 4. Reply Quote Box (If message is a reply to another message)
  if (msg.replyTo) {
    const replyQuote = document.createElement("div");
    replyQuote.className = "msg-reply-quote";

    const replyIcon = document.createElement("i");
    replyIcon.className = "fa-solid fa-reply reply-icon";
    replyQuote.appendChild(replyIcon);

    const replyContent = document.createElement("div");
    replyContent.className = "msg-reply-content";

    const replyAuthor = document.createElement("span");
    replyAuthor.className = "msg-reply-author";
    replyAuthor.textContent = stripZalgo(msg.replyTo.senderName || "User");

    const replySnippet = document.createElement("span");
    replySnippet.className = "msg-reply-snippet";

    // Gracefully check if original replied message was deleted from current room snapshot
    const isOriginalDeleted = !currentRoomMessagesSnapshot || !currentRoomMessagesSnapshot[msg.replyTo.msgId];

    if (isOriginalDeleted) {
      replySnippet.classList.add("deleted-quote");
      replySnippet.innerHTML = `<i class="fa-solid fa-trash-can" style="font-size: 0.7rem; margin-right: 4px;"></i> Original message deleted`;
    } else {
      replySnippet.textContent = stripZalgo(msg.replyTo.text || "Attachment");
      replyQuote.style.cursor = "pointer";
      replyQuote.title = "Click to jump to original message";
      replyQuote.onclick = () => {
        const target = document.getElementById(`msg-${msg.replyTo.msgId}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("highlight-reply");
          setTimeout(() => target.classList.remove("highlight-reply"), 1500);
        } else {
          showToast("Original message was deleted or hidden", 3000, "fa-solid fa-circle-info");
        }
      };
    }

    replyContent.appendChild(replyAuthor);
    replyContent.appendChild(replySnippet);
    replyQuote.appendChild(replyContent);
    body.appendChild(replyQuote);
  }

  // 5. Bubble Container for Text
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  const rawText = stripZalgo(msg.text || "");
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let match;
  const siteUrlsToPreview = [];
  const mediaUrlsToRender = [];

  while ((match = urlRegex.exec(rawText)) !== null) {
    const url = match[0];
    if (match.index > lastIndex) {
      bubble.appendChild(document.createTextNode(rawText.substring(lastIndex, match.index)));
    }
    
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = url;
    bubble.appendChild(a);

    if (isMediaUrl(url)) {
      mediaUrlsToRender.push(url);
    } else {
      siteUrlsToPreview.push(url);
    }

    lastIndex = urlRegex.lastIndex;
  }

  if (lastIndex < rawText.length) {
    bubble.appendChild(document.createTextNode(rawText.substring(lastIndex)));
  }

  body.appendChild(header);

  if (rawText) {
    body.appendChild(bubble);
  }

  // 6. Media Previews
  if (mediaUrlsToRender.length > 0 || msg.imageUrl) {
    const mediaContainer = document.createElement("div");
    mediaContainer.className = "msg-media-container";

    mediaUrlsToRender.forEach(url => {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";

      const img = document.createElement("img");
      img.src = url;
      img.className = "gif-inline-preview";
      img.alt = "GIF preview";
      img.loading = "lazy";

      a.appendChild(img);
      mediaContainer.appendChild(a);
    });

    if (msg.imageUrl && (msg.imageUrl.startsWith("data:image/") || msg.imageUrl.startsWith("http"))) {
      const img = document.createElement("img");
      img.src = msg.imageUrl;
      img.className = "msg-media-preview";
      img.alt = "Attachment";
      img.loading = "lazy";
      mediaContainer.appendChild(img);
    }

    body.appendChild(mediaContainer);
  }

  // 7. Rich Link Preview Card Container
  if (siteUrlsToPreview.length > 0) {
    const previewContainer = document.createElement("div");
    previewContainer.className = "link-preview-container";
    body.appendChild(previewContainer);
    fetchLinkPreview(siteUrlsToPreview[0], previewContainer);
  }

  // 8. Reactions
  if (msg.reactions) {
    const reactionCounts = {};
    const userReacted = {};
    Object.entries(msg.reactions).forEach(([emojiKey, userMap]) => {
      if (!isValidKey(emojiKey)) return;
      const users = Object.keys(userMap);
      reactionCounts[emojiKey] = users.length;
      if (users.includes(currentUser?.uid)) {
        userReacted[emojiKey] = true;
      }
    });

    const reactionsContainer = document.createElement("div");
    reactionsContainer.className = "msg-reactions";

    Object.entries(reactionCounts).forEach(([emojiKey, count]) => {
      const chip = document.createElement("span");
      chip.className = `reaction-chip ${userReacted[emojiKey] ? 'user-reacted' : ''}`;
      
      const iconSpan = document.createElement("span");
      iconSpan.innerHTML = getReactionIconHtml(emojiKey);

      const countSpan = document.createElement("span");
      countSpan.textContent = ` ${count}`;

      chip.appendChild(iconSpan);
      chip.appendChild(countSpan);
      chip.onclick = () => window.toggleReaction(msgId, emojiKey);
      reactionsContainer.appendChild(chip);
    });

    body.appendChild(reactionsContainer);
  }

  item.appendChild(avatar);
  item.appendChild(body);

  // Context menu listener
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e, msgId, msg);
  });

  elements.messagesContainer.appendChild(item);
}

// Helper to map reaction keys to FontAwesome Icon HTML
function getReactionIconHtml(key) {
  const map = {
    "thumbsup": '<i class="fa-solid fa-thumbs-up"></i>',
    "heart": '<i class="fa-solid fa-heart" style="color: #ef4444;"></i>',
    "laugh": '<i class="fa-solid fa-face-laugh-squint" style="color: #f59e0b;"></i>',
    "fire": '<i class="fa-solid fa-fire" style="color: #f97316;"></i>',
    "party": '<i class="fa-solid fa-champagne-glasses" style="color: #a855f7;"></i>',
    "rocket": '<i class="fa-solid fa-rocket" style="color: #06b6d4;"></i>'
  };
  return map[key] || `<i class="fa-solid fa-thumbs-up"></i>`;
}

// Right-Click Context Menu Implementation
function openContextMenu(e, msgId, msg) {
  dismissContextMenu();

  const isOwnMessage = msg.senderId === currentUser?.uid;
  const menu = document.createElement("div");
  menu.className = "context-menu";
  activeContextMenu = menu;

  const reactionRow = document.createElement("div");
  reactionRow.className = "context-reaction-row";
  
  const reactionKeys = [
    { key: "thumbsup", icon: '<i class="fa-solid fa-thumbs-up"></i>' },
    { key: "heart", icon: '<i class="fa-solid fa-heart" style="color: #ef4444;"></i>' },
    { key: "laugh", icon: '<i class="fa-solid fa-face-laugh-squint" style="color: #f59e0b;"></i>' },
    { key: "fire", icon: '<i class="fa-solid fa-fire" style="color: #f97316;"></i>' },
    { key: "party", icon: '<i class="fa-solid fa-champagne-glasses" style="color: #a855f7;"></i>' },
    { key: "rocket", icon: '<i class="fa-solid fa-rocket" style="color: #06b6d4;"></i>' }
  ];
  
  reactionKeys.forEach(item => {
    const span = document.createElement("span");
    span.innerHTML = item.icon;
    span.onclick = () => {
      window.toggleReaction(msgId, item.key);
      window.dismissContextMenu();
    };
    reactionRow.appendChild(span);
  });
  menu.appendChild(reactionRow);

  // Reply Item
  const replyItem = document.createElement("div");
  replyItem.className = "context-menu-item";
  replyItem.innerHTML = `<i class="fa-solid fa-reply"></i> Reply`;
  replyItem.onclick = () => window.setReplyTarget(msgId, msg);
  menu.appendChild(replyItem);

  // Copy Item
  const copyItem = document.createElement("div");
  copyItem.className = "context-menu-item";
  copyItem.innerHTML = `<i class="fa-solid fa-copy"></i> Copy Text`;
  copyItem.onclick = () => window.copyMessageText(msgId);
  menu.appendChild(copyItem);

  // Delete Item (If own message)
  if (isOwnMessage) {
    const deleteItem = document.createElement("div");
    deleteItem.className = "context-menu-item danger";
    deleteItem.innerHTML = `<i class="fa-solid fa-trash-can"></i> Delete Message`;
    deleteItem.onclick = () => window.deleteMessage(msgId);
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);

  let left = e.clientX;
  let top = e.clientY;
  const menuWidth = menu.offsetWidth || 190;
  const menuHeight = menu.offsetHeight || 160;

  if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 10;
  if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 10;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

// Reply Target Helpers
window.setReplyTarget = function(msgId, msg) {
  activeReplyTarget = {
    msgId: msgId,
    senderName: stripZalgo(msg.senderName).trim() || "User",
    text: stripZalgo(msg.text || (msg.imageUrl ? "Image attachment" : "Message")).trim()
  };

  if (elements.replyToSender && elements.replyToText && elements.replyPreviewBar) {
    elements.replyToSender.textContent = activeReplyTarget.senderName;
    elements.replyToText.textContent = `"${activeReplyTarget.text}"`;
    elements.replyPreviewBar.classList.remove("hidden");
  }
  elements.messageInput.focus();
  dismissContextMenu();
};

window.cancelReply = function() {
  activeReplyTarget = null;
  if (elements.replyPreviewBar) {
    elements.replyPreviewBar.classList.add("hidden");
  }
};

window.dismissContextMenu = function() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
};

window.copyMessageText = function(msgId) {
  const msgElement = document.getElementById(`msg-${msgId}`);
  if (msgElement) {
    const bubble = msgElement.querySelector(".msg-bubble");
    if (bubble) {
      const text = bubble.innerText.trim();
      navigator.clipboard.writeText(text);
      showToast("Message copied to clipboard!", 3000, "fa-solid fa-copy");
    }
  }
  dismissContextMenu();
};

// Delete Message Function
window.deleteMessage = async function(msgId) {
  if (!currentUser) return;
  if (!isValidKey(currentRoom?.id) || !isValidKey(msgId)) {
    console.error("Invalid path parameters for message deletion.");
    return;
  }
  
  try {
    await remove(ref(db, `messages/${currentRoom.id}/${msgId}`));
    showToast("Message deleted", 3000, "fa-solid fa-trash-can");
    playSound('delete');
  } catch (err) {
    console.error("Error deleting message:", err);
    showToast("Could not delete message", 3000, "fa-solid fa-circle-exclamation");
  }
  dismissContextMenu();
};

window.toggleReaction = function(msgId, reactionKey) {
  if (!currentUser || !isValidKey(currentRoom?.id) || !isValidKey(msgId) || !isValidKey(reactionKey) || !isValidKey(currentUser?.uid)) return;
  const reactionRef = ref(db, `messages/${currentRoom.id}/${msgId}/reactions/${reactionKey}/${currentUser.uid}`);
  
  get(reactionRef).then(snapshot => {
    if (snapshot.exists()) {
      remove(reactionRef);
    } else {
      set(reactionRef, stripZalgo(currentNickname).trim() || "User");
    }
  });
};

// Send Message Logic (Rate Limited, Burst Protected, Slowmode Punished & CAPTCHA Protected)
async function sendMessage(e) {
  if (e) e.preventDefault();
  
  if (!isCaptchaVerified) {
    promptCaptcha();
    return;
  }

  const now = Date.now();

  // 1. Check if user is currently under 5-Minute Slowmode Punishment
  if (isUserInSlowmode()) {
    const timeSinceLastMsg = now - lastSentTimestamp;
    if (timeSinceLastMsg < SLOWMODE_COOLDOWN_MS) {
      const waitSec = Math.ceil((SLOWMODE_COOLDOWN_MS - timeSinceLastMsg) / 1000);
      const punishmentSec = Math.ceil((slowmodeUntil - now) / 1000);
      const punishmentMin = Math.floor(punishmentSec / 60);
      const remainingSecRem = punishmentSec % 60;
      
      showToast(`⏳ Slowmode Active: Please wait ${waitSec}s to send. (Punishment expires in ${punishmentMin}m ${remainingSecRem}s)`, 4000, "fa-solid fa-hourglass-half");
      playSound('delete');
      return;
    }
  }

  const cleanNick = stripZalgo(currentNickname).trim();
  if (!currentUser || !cleanNick) {
    showToast("Please choose a nickname before sending messages!", 3000, "fa-solid fa-user-pen");
    elements.nicknameInput.value = "";
    elements.editNameModal.classList.remove("hidden");
    return;
  }

  // 2. Check Spam / Burst Conditions to trigger Slowmode Punishment
  userSendTimestamps = userSendTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  // Condition A: Fast burst check (3 messages sent in under 2 seconds)
  const burstTimestamps = userSendTimestamps.filter(t => now - t < BURST_LIMIT_WINDOW_MS);
  if (burstTimestamps.length >= BURST_LIMIT_COUNT - 1) {
    triggerSlowmodePunishment("fast typing burst");
    promptCaptcha();
    return;
  }

  // Condition B: Overall Rate Limit (10 messages in 4 seconds)
  if (userSendTimestamps.length >= RATE_LIMIT_COUNT) {
    triggerSlowmodePunishment("rate limit threshold");
    promptCaptcha();
    return;
  }

  const text = stripZalgo(elements.messageInput.value).trim();
  if (!text && !activeImageAttachment) return;

  if (!isValidKey(currentRoom?.id)) {
    showToast("Invalid chat room.", 3000, "fa-solid fa-triangle-exclamation");
    return;
  }

  const msgData = {
    senderId: currentUser.uid,
    senderName: cleanNick,
    text: text,
    timestamp: serverTimestamp()
  };

  if (activeImageAttachment) {
    msgData.imageUrl = activeImageAttachment;
  }

  if (activeReplyTarget) {
    msgData.replyTo = {
      msgId: activeReplyTarget.msgId,
      senderName: activeReplyTarget.senderName,
      text: activeReplyTarget.text
    };
  }

  // Update timestamps
  lastSentTimestamp = now;
  sessionStorage.setItem("chapp_last_sent_time", lastSentTimestamp.toString());
  userSendTimestamps.push(now);

  const newMsgRef = push(ref(db, `messages/${currentRoom.id}`));
  await set(newMsgRef, msgData);

  // Reset form & reply state
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  clearImageAttachment();
  window.cancelReply();
  stopTyping();
  playSound('send');
  updateSlowmodeUI();
}

// Image File Attachment Handler
function handleImageSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast("Please choose an image under 2MB.", 3000, "fa-solid fa-file-image");
    return;
  }

  const reader = new FileReader();
  reader.onload = (evt) => {
    activeImageAttachment = evt.target.result;
    elements.previewImage.src = activeImageAttachment;
    elements.attachmentPreviewBar.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

function clearImageAttachment() {
  activeImageAttachment = null;
  elements.imageInput.value = "";
  elements.attachmentPreviewBar.classList.add("hidden");
}

// Typing Indicator Functionality
function handleTyping() {
  if (!currentUser || !isValidKey(currentRoom?.id) || !isValidKey(currentUser?.uid)) return;
  const typingRef = ref(db, `typing/${currentRoom.id}/${currentUser.uid}`);
  set(typingRef, { name: stripZalgo(currentNickname).trim() || "User", time: Date.now() });

  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  if (!currentUser || !isValidKey(currentRoom?.id) || !isValidKey(currentUser?.uid)) return;
  remove(ref(db, `typing/${currentRoom.id}/${currentUser.uid}`));
}

function listenToTyping(roomId) {
  if (!isValidKey(roomId)) return;
  if (currentTypingListener) currentTypingListener();
  
  const typingRef = ref(db, `typing/${roomId}`);
  currentTypingListener = onValue(typingRef, (snapshot) => {
    const data = snapshot.val() || {};
    const typers = Object.values(data)
      .filter(t => t.name !== currentNickname && (Date.now() - t.time < 3000))
      .map(t => stripZalgo(t.name).trim());

    if (typers.length > 0) {
      elements.typingText.textContent = typers.length === 1 
        ? `${typers[0]} is typing...` 
        : `${typers.join(", ")} are typing...`;
      elements.typingIndicator.classList.add("visible");
    } else {
      elements.typingIndicator.classList.remove("visible");
    }
  });
}

// Create Private Room
async function handleCreateRoom() {
  if (!isCaptchaVerified) {
    promptCaptcha();
    return;
  }

  const rawName = stripZalgo(elements.newRoomName.value).trim();
  let code = elements.newRoomCode.value.trim().toUpperCase();

  if (!rawName) {
    showToast("Please enter a room name.", 3000, "fa-solid fa-circle-exclamation");
    return;
  }

  if (!code) {
    code = generateRandomCode();
  }

  if (!isValidKey(code)) {
    showToast("Invalid room code format.", 3000, "fa-solid fa-ban");
    return;
  }

  const roomObj = {
    id: code,
    code: code,
    name: rawName,
    isPrivate: true,
    createdBy: currentUser?.uid,
    createdAt: Date.now()
  };

  await set(ref(db, `private_rooms/${code}`), roomObj);

  if (!privateRooms.some(r => r.id === code)) {
    privateRooms.push(roomObj);
    localStorage.setItem("chapp_private_rooms", JSON.stringify(privateRooms));
  }

  elements.createRoomModal.classList.add("hidden");
  elements.newRoomName.value = "";
  elements.newRoomCode.value = "";

  subscribeRoomBackground(roomObj);
  showToast(`Created private room: ${code}`, 3000, "fa-solid fa-square-plus");
  switchRoom(roomObj);
}

// Join Private Room by Code
async function joinRoomByCode(codeToJoin) {
  const code = (codeToJoin || elements.joinRoomCodeInput.value).trim().toUpperCase();
  if (!code || !isValidKey(code)) {
    showToast("Please enter a valid room code.", 3000, "fa-solid fa-key");
    return;
  }

  try {
    const snapshot = await get(ref(db, `private_rooms/${code}`));
    let roomObj;
    if (snapshot.exists()) {
      roomObj = snapshot.val();
    } else {
      roomObj = {
        id: code,
        code: code,
        name: `Private Room (${code})`,
        isPrivate: true
      };
    }

    if (!privateRooms.some(r => r.id === code)) {
      privateRooms.push(roomObj);
      localStorage.setItem("chapp_private_rooms", JSON.stringify(privateRooms));
    }

    elements.joinRoomModal.classList.add("hidden");
    elements.joinRoomCodeInput.value = "";
    
    subscribeRoomBackground(roomObj);
    showToast(`Joined room: ${roomObj.name}`, 3000, "fa-solid fa-door-open");
    switchRoom(roomObj);
  } catch (err) {
    console.error("Error joining room code:", err);
    showToast("Could not find room code.", 3000, "fa-solid fa-triangle-exclamation");
  }
}

// Sound Toggle
function updateSoundUI() {
  if (soundMuted) {
    elements.soundOnIcon.classList.add("hidden");
    elements.soundOffIcon.classList.remove("hidden");
  } else {
    elements.soundOnIcon.classList.remove("hidden");
    elements.soundOffIcon.classList.add("hidden");
  }
}

// Event Listeners Setup
function setupEventListeners() {
  // CAPTCHA Modal Confirm Button
  elements.verifyCaptchaBtn.addEventListener("click", () => {
    if (isCaptchaVerified) {
      elements.captchaModal.classList.add("hidden");
      showToast("Access Granted! Welcome to Chapp", 3000, "fa-solid fa-rocket");
    }
  });

  // Reply cancel button
  elements.cancelReplyBtn.addEventListener("click", window.cancelReply);

  // Dismiss context menu on click anywhere
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".context-menu")) {
      dismissContextMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dismissContextMenu();
      window.cancelReply();
    }
  });

  // Chat form submit
  elements.chatForm.addEventListener("submit", sendMessage);

  // Textarea auto-height & enter key submit
  elements.messageInput.addEventListener("input", () => {
    elements.messageInput.style.height = "auto";
    elements.messageInput.style.height = elements.messageInput.scrollHeight + "px";
    handleTyping();
  });

  elements.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Attachment input
  elements.imageInput.addEventListener("change", handleImageSelect);
  elements.removeAttachmentBtn.addEventListener("click", clearImageAttachment);

  // Audio Toggle
  elements.audioToggleBtn.addEventListener("click", () => {
    soundMuted = !soundMuted;
    localStorage.setItem("chapp_sound_muted", soundMuted);
    updateSoundUI();
    showToast(soundMuted ? "Sound muted" : "Sound enabled", 3000, soundMuted ? "fa-solid fa-volume-xmark" : "fa-solid fa-volume-high");
  });

  // Create Room Modal
  elements.openCreateRoomModalBtn.addEventListener("click", () => elements.createRoomModal.classList.remove("hidden"));
  elements.closeCreateModalBtn.addEventListener("click", () => elements.createRoomModal.classList.add("hidden"));
  elements.cancelCreateModalBtn.addEventListener("click", () => elements.createRoomModal.classList.add("hidden"));
  elements.confirmCreateRoomBtn.addEventListener("click", handleCreateRoom);
  elements.genRandomCodeBtn.addEventListener("click", () => elements.newRoomCode.value = generateRandomCode());

  // Join Room Modal
  elements.openJoinRoomModalBtn.addEventListener("click", () => elements.joinRoomModal.classList.remove("hidden"));
  elements.closeJoinModalBtn.addEventListener("click", () => elements.joinRoomModal.classList.add("hidden"));
  elements.cancelJoinModalBtn.addEventListener("click", () => elements.joinRoomModal.classList.add("hidden"));
  elements.confirmJoinRoomBtn.addEventListener("click", () => joinRoomByCode());

  // Edit Nickname Modal
  elements.editNameBtn.addEventListener("click", () => {
    elements.nicknameInput.value = currentNickname;
    elements.editNameModal.classList.remove("hidden");
  });
  elements.closeNameModalBtn.addEventListener("click", () => elements.editNameModal.classList.add("hidden"));
  elements.cancelNameModalBtn.addEventListener("click", () => elements.editNameModal.classList.add("hidden"));
  elements.saveNicknameBtn.addEventListener("click", () => {
    const newName = stripZalgo(elements.nicknameInput.value).trim();
    if (!newName) {
      showToast("Nickname cannot be empty!", 3000, "fa-solid fa-circle-exclamation");
      return;
    }
    currentNickname = newName;
    localStorage.setItem("chapp_nickname", currentNickname);
    updateUserUI();
    if (currentUser && isValidKey(currentUser.uid)) {
      set(ref(db, `status/${currentUser.uid}/name`), currentNickname);
    }
    elements.editNameModal.classList.add("hidden");
    showToast("Nickname updated!", 3000, "fa-solid fa-circle-check");
  });

  // Share Buttons & Room Copy
  elements.copyRoomCodeBtn.addEventListener("click", () => {
    const code = currentRoom.code || currentRoom.id;
    navigator.clipboard.writeText(code);
    showToast(`Copied room code: ${code}`, 3000, "fa-solid fa-copy");
  });

  elements.shareRoomBtn.addEventListener("click", () => {
    const code = currentRoom.code || currentRoom.id;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
    navigator.clipboard.writeText(shareUrl);
    showToast("Shareable room link copied to clipboard!", 3000, "fa-solid fa-share-nodes");
  });

  // Search Filter Events
  elements.searchInput.addEventListener("input", (e) => {
    searchFilterQuery = e.target.value.trim().toLowerCase();
    if (searchFilterQuery) {
      elements.clearSearchBtn.classList.remove("hidden");
      elements.searchBar.classList.remove("hidden");
      elements.searchQueryText.textContent = searchFilterQuery;
    } else {
      elements.clearSearchBtn.classList.add("hidden");
      elements.searchBar.classList.add("hidden");
    }
    loadRoomMessages(currentRoom.id);
  });

  elements.clearSearchBtn.addEventListener("click", () => {
    elements.searchInput.value = "";
    searchFilterQuery = "";
    elements.clearSearchBtn.classList.add("hidden");
    elements.searchBar.classList.add("hidden");
    loadRoomMessages(currentRoom.id);
  });

  elements.closeSearchBannerBtn.addEventListener("click", () => {
    elements.searchInput.value = "";
    searchFilterQuery = "";
    elements.clearSearchBtn.classList.add("hidden");
    elements.searchBar.classList.add("hidden");
    loadRoomMessages(currentRoom.id);
  });

  // Mobile navigation
  elements.mobileMenuBtn.addEventListener("click", () => {
    elements.sidebar.classList.add("open");
    elements.sidebarBackdrop.classList.add("show");
  });

  const closeMobileSidebar = () => {
    elements.sidebar.classList.remove("open");
    elements.sidebarBackdrop.classList.remove("show");
  };

  elements.closeSidebarBtn.addEventListener("click", closeMobileSidebar);
  elements.sidebarBackdrop.addEventListener("click", closeMobileSidebar);

  elements.toggleUsersBtn.addEventListener("click", () => {
    elements.membersDrawer.classList.toggle("open");
  });
}

// Start application when DOM is ready
document.addEventListener("DOMContentLoaded", initApp);
