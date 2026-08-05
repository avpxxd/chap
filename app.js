// Import Firebase SDK Modules from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
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

// Public Default Channels
const PUBLIC_ROOMS = [
  { id: "general", name: "#general", desc: "General discussion channel for everyone", icon: "💬" },
  { id: "tech-lounge", name: "#tech-lounge", desc: "Tech news, coding tips, and gadget talk", icon: "💻" },
  { id: "gaming", name: "#gaming", desc: "Gamers hangout, squad up, and clips", icon: "🎮" },
  { id: "music-vibes", name: "#music-vibes", desc: "Share music recs and playlist vibes", icon: "🎵" },
  { id: "random", name: "#random", desc: "Memes, random thoughts, and fun", icon: "🎲" }
];

// Application State
let currentUser = null;
let currentNickname = localStorage.getItem("pulsechat_nickname") || "";
let currentRoom = PUBLIC_ROOMS[0];
let privateRooms = JSON.parse(localStorage.getItem("pulsechat_private_rooms") || "[]");
let soundMuted = localStorage.getItem("pulsechat_sound_muted") === "true";
let activeImageAttachment = null;
let activeRoomMessageUnsubscribe = null;
let currentTypingListener = null;
let activePresenceListener = null;
let typingTimeout = null;
let searchFilterQuery = "";
let unreadCounts = {};
let backgroundRoomListeners = {};
let activeContextMenu = null;

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
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'join') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
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

// Zalgo Glitch Character Sanitizer Utility
function stripZalgo(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, '');
}

// Generate Random 6-char Room Code
function generateRandomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "ROOM-";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Show Toast Notification (Safe against XSS by using textContent nodes)
function showToast(message, duration = 3000) {
  const toast = document.createElement("div");
  toast.className = "toast";
  
  const icon = document.createElement("span");
  icon.textContent = "✨";
  
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

  // Anonymous Authentication
  try {
    const userCredential = await signInAnonymously(auth);
    currentUser = userCredential.user;
    
    if (!currentNickname) {
      currentNickname = "Guest-" + currentUser.uid.substring(0, 4);
      localStorage.setItem("pulsechat_nickname", currentNickname);
    }
    
    updateUserUI();
    setupPresence();
    subscribeAllBackgroundRoomNotifications();
    
    // Check URL parameters for private room code
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get("room");
    if (roomParam) {
      joinRoomByCode(roomParam.trim().toUpperCase());
    } else {
      switchRoom(PUBLIC_ROOMS[0]);
    }
  } catch (error) {
    console.error("Firebase Auth Error:", error);
    showToast("Authentication error. Refreshing...");
  }
}

// Setup Background Notifications for Unread Badges across Channels
function subscribeAllBackgroundRoomNotifications() {
  const allRooms = [...PUBLIC_ROOMS, ...privateRooms];
  allRooms.forEach(room => subscribeRoomBackground(room));
}

function subscribeRoomBackground(room) {
  if (backgroundRoomListeners[room.id]) return;

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
      showToast(`💬 ${room.name}: ${msg.senderName || 'Someone'}: "${msg.text || 'Image attachment'}"`);
    }
  });

  backgroundRoomListeners[room.id] = unsubscribe;
}

// Setup User Online Presence with RTDB
function setupPresence() {
  if (!currentUser) return;
  const userStatusRef = ref(db, `status/${currentUser.uid}`);
  const connectedRef = ref(db, ".info/connected");

  const myStatus = {
    name: currentNickname,
    uid: currentUser.uid,
    state: "online",
    roomId: currentRoom.id,
    lastSeen: serverTimestamp()
  };

  onValue(connectedRef, (snapshot) => {
    if (snapshot.val() === false) return;

    onDisconnect(userStatusRef).set({
      name: currentNickname,
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
  if (!currentUser) return;
  set(ref(db, `status/${currentUser.uid}/roomId`), roomId);
}

// Listen to Active Members in Current Room (DOM Nodes - 100% XSS Immune)
function listenToRoomMembers(roomId) {
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
        
        const rawName = user.name || "Anonymous User";
        const cleanName = stripZalgo(rawName);
        const initial = (cleanName.charAt(0) || "G").toUpperCase();

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
        nameSpan.textContent = cleanName;

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
  const cleanNick = stripZalgo(currentNickname);
  elements.currentUserName.textContent = cleanNick;
  elements.currentUserAvatar.textContent = (cleanNick.charAt(0) || "G").toUpperCase();
  elements.currentUserIdSub.textContent = `ID: ${currentUser.uid.substring(0, 8)}`;
}

// Render Public Channels List (DOM Nodes - 100% XSS Immune)
function renderPublicRooms() {
  elements.publicRoomsList.innerHTML = "";
  PUBLIC_ROOMS.forEach(room => {
    const item = document.createElement("div");
    item.className = `room-item ${room.id === currentRoom.id ? 'active' : ''}`;
    item.onclick = () => switchRoom(room);
    
    const unread = unreadCounts[room.id] || 0;
    
    const nameDiv = document.createElement("div");
    nameDiv.className = "room-item-name";

    const iconSpan = document.createElement("span");
    iconSpan.textContent = room.icon;

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

// Render Private Rooms List (DOM Nodes - 100% XSS Immune)
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

    const iconSpan = document.createElement("span");
    iconSpan.textContent = "🔒";

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
    delBtn.textContent = "🗑️";
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
  
  if (!confirm(`Are you sure you want to delete and leave room ${roomId}?`)) {
    return;
  }

  privateRooms = privateRooms.filter(r => r.id !== roomId);
  localStorage.setItem("pulsechat_private_rooms", JSON.stringify(privateRooms));

  try {
    await remove(ref(db, `private_rooms/${roomId}`));
    await remove(ref(db, `messages/${roomId}`));
  } catch (err) {
    console.log("Room DB remove info:", err);
  }

  showToast(`Deleted private room ${roomId}`);
  playSound('delete');

  if (currentRoom.id === roomId) {
    switchRoom(PUBLIC_ROOMS[0]);
  } else {
    renderPrivateRooms();
  }
};

// Switch Active Chat Room
function switchRoom(room) {
  currentRoom = room;
  unreadCounts[room.id] = 0;
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
  if (activeRoomMessageUnsubscribe) activeRoomMessageUnsubscribe();
  elements.messagesContainer.innerHTML = "";

  const messagesRef = ref(db, `messages/${roomId}`);

  activeRoomMessageUnsubscribe = onValue(messagesRef, (snapshot) => {
    if (currentRoom.id !== roomId) return;

    const messages = snapshot.val();
    elements.messagesContainer.innerHTML = "";

    if (!messages) {
      const welcomeCard = document.createElement("div");
      welcomeCard.className = "welcome-message-card";
      
      const icon = document.createElement("div");
      icon.className = "welcome-icon";
      icon.textContent = currentRoom.icon || '💬';

      const h2 = document.createElement("h2");
      h2.textContent = `Welcome to ${currentRoom.name}`;

      const p = document.createElement("p");
      p.textContent = "No messages here yet. Right-click any message for reactions, copy, and options!";

      welcomeCard.appendChild(icon);
      welcomeCard.appendChild(h2);
      welcomeCard.appendChild(p);
      elements.messagesContainer.appendChild(welcomeCard);
      return;
    }

    let hasMatchedSearch = false;
    Object.entries(messages).forEach(([msgId, msg]) => {
      if (searchFilterQuery) {
        const text = (msg.text || "").toLowerCase();
        const author = (msg.senderName || "").toLowerCase();
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

// Render Single Message in Stream (100% DOM Construction - Zero XSS Risk)
function renderSingleMessage(msgId, msg) {
  const isOutgoing = msg.senderId === currentUser?.uid;
  const item = document.createElement("div");
  item.className = `message-item ${isOutgoing ? 'outgoing' : ''}`;
  item.id = `msg-${msgId}`;

  // 1. Avatar (textContent DOM node - safe against unclosed tag parsing)
  const rawSender = msg.senderName || "User";
  const cleanSender = stripZalgo(rawSender);
  const initial = (cleanSender.charAt(0) || "U").toUpperCase();
  
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = initial;

  // 2. Msg Body Container
  const body = document.createElement("div");
  body.className = "msg-body";

  // 3. Header (Author + Time textNodes)
  const header = document.createElement("div");
  header.className = "msg-header";

  const author = document.createElement("span");
  author.className = "msg-author";
  author.textContent = cleanSender; // 100% plain text node! Zero XSS!

  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatTime(msg.timestamp);

  header.appendChild(author);
  header.appendChild(time);

  // 4. Bubble Container (Text + Safe Links + Media)
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  const rawText = stripZalgo(msg.text || "");
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(rawText)) !== null) {
    if (match.index > lastIndex) {
      bubble.appendChild(document.createTextNode(rawText.substring(lastIndex, match.index)));
    }
    
    const a = document.createElement("a");
    a.href = match[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.color = "#818cf8";
    a.style.textDecoration = "underline";
    a.textContent = match[0]; // Pure text content!
    bubble.appendChild(a);

    lastIndex = urlRegex.lastIndex;
  }

  if (lastIndex < rawText.length) {
    bubble.appendChild(document.createTextNode(rawText.substring(lastIndex)));
  }

  if (msg.imageUrl && (msg.imageUrl.startsWith("data:image/") || msg.imageUrl.startsWith("http"))) {
    const img = document.createElement("img");
    img.src = msg.imageUrl;
    img.className = "msg-media-preview";
    img.alt = "Attachment";
    img.loading = "lazy";
    bubble.appendChild(img);
  }

  body.appendChild(header);
  body.appendChild(bubble);

  // 5. Reactions (textContent DOM nodes)
  if (msg.reactions) {
    const reactionCounts = {};
    const userReacted = {};
    Object.entries(msg.reactions).forEach(([emoji, userMap]) => {
      const users = Object.keys(userMap);
      reactionCounts[emoji] = users.length;
      if (users.includes(currentUser?.uid)) {
        userReacted[emoji] = true;
      }
    });

    const reactionsContainer = document.createElement("div");
    reactionsContainer.className = "msg-reactions";

    Object.entries(reactionCounts).forEach(([emoji, count]) => {
      const chip = document.createElement("span");
      chip.className = `reaction-chip ${userReacted[emoji] ? 'user-reacted' : ''}`;
      chip.textContent = `${emoji} ${count}`;
      chip.onclick = () => window.toggleReaction(msgId, emoji);
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

// Right-Click Context Menu Implementation (DOM Nodes)
function openContextMenu(e, msgId, msg) {
  dismissContextMenu();

  const isOwnMessage = msg.senderId === currentUser?.uid;
  const menu = document.createElement("div");
  menu.className = "context-menu";
  activeContextMenu = menu;

  const reactionRow = document.createElement("div");
  reactionRow.className = "context-reaction-row";
  const emojis = ["👍", "❤️", "😂", "🔥", "🎉", "🚀"];
  
  emojis.forEach(emoji => {
    const span = document.createElement("span");
    span.textContent = emoji;
    span.onclick = () => {
      window.toggleReaction(msgId, emoji);
      window.dismissContextMenu();
    };
    reactionRow.appendChild(span);
  });
  menu.appendChild(reactionRow);

  const copyItem = document.createElement("div");
  copyItem.className = "context-menu-item";
  copyItem.innerHTML = `<span>📋</span> Copy Text`;
  copyItem.onclick = () => window.copyMessageText(msgId);
  menu.appendChild(copyItem);

  if (isOwnMessage) {
    const deleteItem = document.createElement("div");
    deleteItem.className = "context-menu-item danger";
    deleteItem.innerHTML = `<span>🗑️</span> Delete Message`;
    deleteItem.onclick = () => window.deleteMessage(msgId);
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);

  let left = e.clientX;
  let top = e.clientY;
  const menuWidth = menu.offsetWidth || 190;
  const menuHeight = menu.offsetHeight || 140;

  if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 10;
  if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 10;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

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
      showToast("Message copied to clipboard!");
    }
  }
  dismissContextMenu();
};

// Delete Message Function
window.deleteMessage = async function(msgId) {
  if (!currentUser) return;
  
  try {
    await remove(ref(db, `messages/${currentRoom.id}/${msgId}`));
    showToast("Message deleted");
    playSound('delete');
  } catch (err) {
    console.error("Error deleting message:", err);
    showToast("Could not delete message");
  }
  dismissContextMenu();
};

window.toggleReaction = function(msgId, emoji) {
  if (!currentUser) return;
  const reactionRef = ref(db, `messages/${currentRoom.id}/${msgId}/reactions/${emoji}/${currentUser.uid}`);
  
  get(reactionRef).then(snapshot => {
    if (snapshot.exists()) {
      remove(reactionRef);
    } else {
      set(reactionRef, currentNickname);
    }
  });
};

// Send Message Logic
async function sendMessage(e) {
  if (e) e.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text && !activeImageAttachment) return;
  if (!currentUser) return;

  const msgData = {
    senderId: currentUser.uid,
    senderName: currentNickname,
    text: text,
    timestamp: serverTimestamp()
  };

  if (activeImageAttachment) {
    msgData.imageUrl = activeImageAttachment;
  }

  const newMsgRef = push(ref(db, `messages/${currentRoom.id}`));
  await set(newMsgRef, msgData);

  // Reset form
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  clearImageAttachment();
  stopTyping();
  playSound('send');
}

// Image File Attachment Handler
function handleImageSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast("Please choose an image under 2MB.");
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

// Typing Indicator Functionality (DOM Nodes - Safe against XSS)
function handleTyping() {
  if (!currentUser) return;
  const typingRef = ref(db, `typing/${currentRoom.id}/${currentUser.uid}`);
  set(typingRef, { name: currentNickname, time: Date.now() });

  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  if (!currentUser) return;
  remove(ref(db, `typing/${currentRoom.id}/${currentUser.uid}`));
}

function listenToTyping(roomId) {
  if (currentTypingListener) currentTypingListener();
  
  const typingRef = ref(db, `typing/${roomId}`);
  currentTypingListener = onValue(typingRef, (snapshot) => {
    const data = snapshot.val() || {};
    const typers = Object.values(data)
      .filter(t => t.name !== currentNickname && (Date.now() - t.time < 3000))
      .map(t => stripZalgo(t.name));

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

// Create Private Room (XSS Protected)
async function handleCreateRoom() {
  const name = elements.newRoomName.value.trim();
  let code = elements.newRoomCode.value.trim().toUpperCase();

  if (!name) {
    showToast("Please enter a room name.");
    return;
  }

  if (!code) {
    code = generateRandomCode();
  }

  const roomObj = {
    id: code,
    code: code,
    name: name,
    isPrivate: true,
    createdBy: currentUser?.uid,
    createdAt: Date.now()
  };

  await set(ref(db, `private_rooms/${code}`), roomObj);

  if (!privateRooms.some(r => r.id === code)) {
    privateRooms.push(roomObj);
    localStorage.setItem("pulsechat_private_rooms", JSON.stringify(privateRooms));
  }

  elements.createRoomModal.classList.add("hidden");
  elements.newRoomName.value = "";
  elements.newRoomCode.value = "";

  subscribeRoomBackground(roomObj);
  showToast(`Created private room: ${code}`);
  switchRoom(roomObj);
}

// Join Private Room by Code (XSS Protected)
async function joinRoomByCode(codeToJoin) {
  const code = (codeToJoin || elements.joinRoomCodeInput.value).trim().toUpperCase();
  if (!code) {
    showToast("Please enter a room code.");
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
      localStorage.setItem("pulsechat_private_rooms", JSON.stringify(privateRooms));
    }

    elements.joinRoomModal.classList.add("hidden");
    elements.joinRoomCodeInput.value = "";
    
    subscribeRoomBackground(roomObj);
    showToast(`Joined room: ${roomObj.name}`);
    switchRoom(roomObj);
  } catch (err) {
    console.error("Error joining room code:", err);
    showToast("Could not find room code.");
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
  // Dismiss context menu on click anywhere
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".context-menu")) {
      dismissContextMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dismissContextMenu();
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
    localStorage.setItem("pulsechat_sound_muted", soundMuted);
    updateSoundUI();
    showToast(soundMuted ? "Sound muted" : "Sound enabled");
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
    const newName = elements.nicknameInput.value.trim();
    if (newName) {
      currentNickname = newName;
      localStorage.setItem("pulsechat_nickname", currentNickname);
      updateUserUI();
      if (currentUser) {
        set(ref(db, `status/${currentUser.uid}/name`), currentNickname);
      }
      elements.editNameModal.classList.add("hidden");
      showToast("Nickname updated!");
    }
  });

  // Share Buttons & Room Copy
  elements.copyRoomCodeBtn.addEventListener("click", () => {
    const code = currentRoom.code || currentRoom.id;
    navigator.clipboard.writeText(code);
    showToast(`Copied room code: ${code}`);
  });

  elements.shareRoomBtn.addEventListener("click", () => {
    const code = currentRoom.code || currentRoom.id;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
    navigator.clipboard.writeText(shareUrl);
    showToast("Shareable room link copied to clipboard!");
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
