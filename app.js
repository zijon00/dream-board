import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  deleteDoc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-storage.js";

// Firebase Configuration for project dream-board-vivid
const firebaseConfig = {
  apiKey: "AIzaSyC06UG7Slxh-4Wg-dVng485XQXDxf-6vuo",
  authDomain: "dream-board-vivid.firebaseapp.com",
  projectId: "dream-board-vivid",
  storageBucket: "dream-board-vivid.firebasestorage.app",
  messagingSenderId: "1042099746530",
  appId: "1:1042099746530:web:d2f7d0015fcd60cec290bb"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Enable Firestore Offline Persistence (IndexedDB cache) with safe fallback
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  db = getFirestore(app);
}

const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

// Current User State
let currentUser = null;
let unsubscribeFirestore = null;

// Backward-compatible Dream Schema Adapter (v1.0/v1.1 <-> v1.2)
function normalizeDream(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const budgetVal = Number(raw.estimated_budget ?? raw.budget ?? 0) || 0;
  const savedVal = Number(raw.savedAmount ?? 0) || 0;
  const completedVal = Boolean(raw.is_completed ?? raw.isCompleted ?? raw.completed ?? false);
  const media = raw.primary_media || raw.activeMedia || null;
  const history = Array.isArray(raw.media_history)
    ? raw.media_history
    : (Array.isArray(raw.mediaHistory) ? raw.mediaHistory : []);

  return {
    ...raw,
    category: raw.category || "DO",
    title: raw.title || "",
    vivid_description: raw.vivid_description ?? raw.description ?? "",
    deadline: raw.deadline ?? raw.targetDate ?? raw.target_date ?? "",
    estimated_budget: budgetVal,
    budget_notes: raw.budget_notes ?? raw.budgetMemo ?? "",
    affirmation: raw.affirmation || "",
    whyNote: raw.whyNote || "",
    futureDiary: raw.futureDiary || null,
    targetYearBucket: raw.targetYearBucket || "1Y",
    savedAmount: savedVal,
    linkedFiscalYear: raw.linkedFiscalYear || "",
    linkedPin: raw.linkedPin || "",
    is_completed: completedVal,
    completed_at: raw.completed_at ?? raw.completedAt ?? null,
    primary_media: media,
    media_history: history,
  };
}

// Helper: Format Korean Won currency
function formatKoreanCurrency(amount) {
  if (!amount || isNaN(amount) || amount <= 0) return "0원";
  const num = parseInt(amount, 10);
  const eok = Math.floor(num / 100000000);
  const man = Math.floor((num % 100000000) / 10000);
  const rem = num % 10000;

  let parts = [];
  if (eok > 0) parts.push(`${eok}억`);
  if (man > 0) parts.push(`${man.toLocaleString()}만원`);
  if (rem > 0 && eok === 0 && man === 0) parts.push(`${rem.toLocaleString()}원`);
  return parts.join(" ") || `${num.toLocaleString()}원`;
}

// Helper: Calculate D-Day
function calculateDDay(deadlineStr) {
  if (!deadlineStr) return null;
  const target = new Date(deadlineStr);
  if (isNaN(target.getTime())) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  
  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return { text: "D-Day", isUrgent: true, isPassed: false };
  if (diffDays > 0) return { text: `D-${diffDays}`, isUrgent: diffDays <= 30, isPassed: false };
  return { text: `D+${Math.abs(diffDays)} (지남)`, isUrgent: false, isPassed: true };
}
// State
let dreams = [];
let activeCategory = "ALL";
let filterOnlyCompleted = false;
let currentView = "grid";
let currentManagingDreamId = null;

// Slideshow State
let slideIndex = 0;
let slideInterval = null;
let isSlidePlaying = true;

// DOM Elements
const dreamsContainer = document.getElementById("dreams-container");
const emptyState = document.getElementById("empty-state");
const catTabs = document.querySelectorAll(".cat-tab");
const filterCompletedInput = document.getElementById("filter-completed");
const viewGridBtn = document.getElementById("view-grid");
const viewListBtn = document.getElementById("view-list");

// Modal Dream
const modalDream = document.getElementById("modal-dream");
const btnAddDream = document.getElementById("btn-add-dream");
const modalClose = document.getElementById("modal-close");
const modalCancel = document.getElementById("modal-cancel");
const dreamForm = document.getElementById("dream-form");
const formDreamId = document.getElementById("form-dream-id");
const modalTitle = document.getElementById("modal-title");

// Modal Media
const modalMedia = document.getElementById("modal-media");
const mediaModalClose = document.getElementById("media-modal-close");
const mediaModalBadge = document.getElementById("media-modal-badge");
const mediaModalDreamTitle = document.getElementById("media-modal-dream-title");
const mediaTabs = document.querySelectorAll(".media-tab");
const tabContents = document.querySelectorAll(".tab-content");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const directUrlInput = document.getElementById("direct-url-input");
const btnSaveDirectUrl = document.getElementById("btn-save-direct-url");
const searchQueryInput = document.getElementById("search-query-input");
const btnSearchMedia = document.getElementById("btn-search-media");
const searchLoading = document.getElementById("search-loading");
const searchResultsGrid = document.getElementById("search-results-grid");
const btnAiGenerate = document.getElementById("btn-ai-generate");
const btnAiSynthesize = document.getElementById("btn-ai-synthesize");
const synthRefFile = document.getElementById("synth-ref-file");
const synthCustomPrompt = document.getElementById("synth-custom-prompt");
const aiLoading = document.getElementById("ai-loading");
const mediaHistoryGrid = document.getElementById("media-history-grid");

// Slideshow Elements
const modalSlideshow = document.getElementById("modal-slideshow");
const btnSlideshow = document.getElementById("btn-slideshow");
const slideClose = document.getElementById("slide-close");
const slidePlayPause = document.getElementById("slide-play-pause");
const slidePrev = document.getElementById("slide-prev");
const slideNext = document.getElementById("slide-next");
const slideMediaContainer = document.getElementById("slide-media-container");
const slideTitle = document.getElementById("slide-title");
const slideVividDesc = document.getElementById("slide-vivid-desc");
const slideAffirmationBox = document.getElementById("slide-affirmation-box");
const slideCatBadge = document.getElementById("slide-cat-badge");
const slideCounter = document.getElementById("slide-counter");

// Auth Elements
const btnLogin = document.getElementById("btn-login");
const btnLogout = document.getElementById("btn-logout");
const userProfile = document.getElementById("user-profile");
const userAvatar = document.getElementById("user-avatar");
const userName = document.getElementById("user-name");

// Budget Planner Elements
const btnBudgetPlanner = document.getElementById("btn-budget-planner");
const modalBudgetPlanner = document.getElementById("modal-budget-planner");
const budgetModalClose = document.getElementById("budget-modal-close");
const budgetModalCancel = document.getElementById("budget-modal-cancel");
const budgetListContainer = document.getElementById("budget-list-container");
const plannerTotalBudget = document.getElementById("planner-total-budget");
const plannerOnlyUnset = document.getElementById("planner-only-unset");
const btnSaveAllBudgets = document.getElementById("btn-save-all-budgets");

// Settings & Backup Elements
const btnSettings = document.getElementById("btn-settings");
const modalSettings = document.getElementById("modal-settings");
const settingsModalClose = document.getElementById("settings-modal-close");
const btnExportJson = document.getElementById("btn-export-json");
const inputImportJson = document.getElementById("input-import-json");

// Init function (invoked at bottom after all bindings)
function initApp() {
  setupAuth();
  fetchDreams();
  setupEventListeners();
}

// Global Google Login Trigger (with concurrency lock to prevent double-popup)
let isLoggingIn = false;
window.doGoogleLogin = async function() {
  if (isLoggingIn) return;
  isLoggingIn = true;
  try {
    showToast("구글 로그인 창을 여는 중...");
    const result = await signInWithPopup(auth, googleProvider);
    if (result && result.user) {
      showToast(`${result.user.displayName || '회원'}님, 환영합니다! ✨`);
    }
  } catch (err) {
    console.warn("Popup error:", err);
    if (err.code === "auth/popup-blocked") {
      try {
        showToast("팝업이 차단되어 페이지 이동 로그인으로 전환합니다...");
        await signInWithRedirect(auth, googleProvider);
      } catch (rErr) {
        alert("로그인 페이지 이동 실패: [" + (rErr.code || 'UNKNOWN') + "] " + rErr.message);
      }
    } else if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {
      showToast("로그인이 취소되었습니다.");
    } else {
      alert("구글 로그인 오류: [" + (err.code || 'UNKNOWN') + "] " + (err.message || err));
    }
  } finally {
    isLoggingIn = false;
  }
};

function setupAuth() {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      // User is signed in
      btnLogin.classList.add("hidden");
      userProfile.classList.remove("hidden");
      userProfile.classList.add("flex");
      userAvatar.src = user.photoURL || "https://cdn-icons-png.flaticon.com/512/3209/3209990.png";
      userName.textContent = user.displayName || user.email.split("@")[0];
      showToast(`${user.displayName || '회원'}님 환영합니다! 동기화 중 ✨`);

      // Sync local dreams to Firestore if local dreams exist
      await syncLocalDreamsToFirestore(user.uid);
      // Listen to real-time updates from Firestore
      subscribeToFirestore(user.uid);
    } else {
      // User is signed out
      btnLogin.classList.remove("hidden");
      userProfile.classList.add("hidden");
      userProfile.classList.remove("flex");
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
      }
      fetchDreams();
    }
  });

  // Check redirect result on load
  getRedirectResult(auth).then((result) => {
    if (result && result.user) {
      showToast(`${result.user.displayName || '회원'}님, 로그인 성공! ✨`);
    }
  }).catch((err) => {
    console.error("Redirect error:", err);
    if (err.code) {
      alert("구글 로그인 리디렉션 오류: [" + err.code + "] " + err.message);
    }
  });

  // Note: btn-login click is handled via onclick="window.doGoogleLoginFallback()" to prevent duplicate triggers.

  btnLogout.addEventListener("click", async () => {
    try {
      await signOut(auth);
      showToast("로그아웃 되었습니다.");
    } catch (err) {}
  });
}

async function syncLocalDreamsToFirestore(uid) {
  const localDreams = loadDreamsLocally();
  if (localDreams && localDreams.length > 0) {
    try {
      for (const d of localDreams) {
        const dreamRef = doc(db, "users", uid, "dreams", d.id);
        await setDoc(dreamRef, d, { merge: true });
      }
    } catch (err) {}
  }
}

function subscribeToFirestore(uid) {
  if (unsubscribeFirestore) unsubscribeFirestore();
  const dreamsCol = collection(db, "users", uid, "dreams");
  unsubscribeFirestore = onSnapshot(dreamsCol, (snapshot) => {
    const cloudDreams = [];
    snapshot.forEach((doc) => {
      cloudDreams.push(normalizeDream(doc.data()));
    });
    // Sort latest first
    cloudDreams.sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0));
    dreams = cloudDreams;
    saveDreamsLocally();
    updateCounts();
    renderDreams();
  }, (err) => {
    // Fallback to local
    fetchDreams();
  });
}

function setupEventListeners() {
  // Category tabs
  catTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      catTabs.forEach(t => {
        t.classList.remove("active-tab", "bg-purple-600", "text-white");
        t.classList.add("text-slate-400");
      });
      tab.classList.add("active-tab", "bg-purple-600", "text-white");
      tab.classList.remove("text-slate-400");
      activeCategory = tab.dataset.cat;
      renderDreams();
    });
  });

  // Filters & View
  filterCompletedInput.addEventListener("change", (e) => {
    filterOnlyCompleted = e.target.checked;
    renderDreams();
  });

  viewGridBtn.addEventListener("click", () => {
    currentView = "grid";
    viewGridBtn.classList.add("text-purple-400", "bg-slate-800");
    viewListBtn.classList.remove("text-purple-400", "bg-slate-800");
    renderDreams();
  });

  viewListBtn.addEventListener("click", () => {
    currentView = "list";
    viewListBtn.classList.add("text-purple-400", "bg-slate-800");
    viewGridBtn.classList.remove("text-purple-400", "bg-slate-800");
    renderDreams();
  });

  // Dream Create/Edit Modal
  btnAddDream.addEventListener("click", () => openDreamModal());
  modalClose.addEventListener("click", () => closeDreamModal());
  modalCancel.addEventListener("click", () => closeDreamModal());
  dreamForm.addEventListener("submit", handleDreamFormSubmit);

  // Media Modal
  mediaModalClose.addEventListener("click", () => modalMedia.classList.add("hidden"));
  mediaTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      mediaTabs.forEach(t => {
        t.classList.remove("border-purple-500", "text-purple-300");
        t.classList.add("border-transparent", "text-slate-400");
      });
      tab.classList.add("border-purple-500", "text-purple-300");
      tab.classList.remove("border-transparent", "text-slate-400");

      tabContents.forEach(c => c.classList.add("hidden"));
      document.getElementById(tab.dataset.tab).classList.remove("hidden");
    });
  });

  // Dropzone
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("border-purple-500", "bg-purple-950/20");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("border-purple-500", "bg-purple-950/20");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("border-purple-500", "bg-purple-950/20");
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // Direct URL
  btnSaveDirectUrl.addEventListener("click", handleDirectUrlSubmit);

  // Search Media
  btnSearchMedia.addEventListener("click", performWebSearch);
  searchQueryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") performWebSearch();
  });

  // AI Gen & Synth
  btnAiGenerate.addEventListener("click", handleAiGenerate);
  btnAiSynthesize.addEventListener("click", handleAiSynthesize);

  // Slideshow
  btnSlideshow.addEventListener("click", startSlideshow);
  slideClose.addEventListener("click", stopSlideshow);
  slidePlayPause.addEventListener("click", toggleSlidePlay);
  slidePrev.addEventListener("click", () => changeSlide(-1));
  slideNext.addEventListener("click", () => changeSlide(1));

  // Budget Planner Modal
  btnBudgetPlanner.addEventListener("click", openBudgetPlannerModal);
  budgetModalClose.addEventListener("click", closeBudgetPlannerModal);
  budgetModalCancel.addEventListener("click", closeBudgetPlannerModal);
  plannerOnlyUnset.addEventListener("change", renderBudgetPlannerList);
  btnSaveAllBudgets.addEventListener("click", saveAllBudgets);

  // Settings & JSON Backup Modal
  if (btnSettings && modalSettings) {
    btnSettings.addEventListener("click", () => modalSettings.classList.remove("hidden"));
    settingsModalClose.addEventListener("click", () => modalSettings.classList.add("hidden"));
    btnExportJson.addEventListener("click", exportDataAsJson);
    inputImportJson.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        importDataFromJson(e.target.files[0]);
        e.target.value = "";
      }
    });
  }
}

// --- Fetch & Render ---

// LocalStorage Key for offline / mobile persistence
const STORAGE_KEY = "my_dream_board_items";

// Helper: Save dreams to LocalStorage
function saveDreamsLocally() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dreams));
  } catch (e) {}
}

// Helper: Load dreams from LocalStorage
function loadDreamsLocally() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalizeDream) : null;
    }
  } catch (e) {}
  return null;
}

async function fetchDreams() {
  // 1. First load from LocalStorage for instant mobile loading
  const localData = loadDreamsLocally();
  if (localData && localData.length > 0) {
    dreams = localData;
  }
  updateCounts();
  renderDreams();

  // 2. Fetch server if available (e.g. initial seed or sync)
  try {
    const res = await fetch("/api/dreams");
    if (res.ok) {
      const serverData = await res.json();
      if (Array.isArray(serverData) && (!localData || localData.length === 0)) {
        dreams = serverData;
        saveDreamsLocally();
        updateCounts();
        renderDreams();
      }
    }
  } catch (err) {
    // If running standalone or offline, already loaded from local
  }
}

function updateCounts() {
  document.getElementById("count-all").textContent = dreams.length;
  document.getElementById("count-do").textContent = dreams.filter(d => d.category === "DO").length;
  document.getElementById("count-have").textContent = dreams.filter(d => d.category === "HAVE").length;
  document.getElementById("count-give").textContent = dreams.filter(d => d.category === "GIVE").length;

  // Calculate total budget of all active dreams
  const totalBudget = dreams.reduce((sum, d) => sum + (d.estimated_budget || 0), 0);
  const totalBudgetElem = document.getElementById("total-budget-sum");
  if (totalBudgetElem) {
    totalBudgetElem.textContent = formatKoreanCurrency(totalBudget);
  }
}

function renderDreams() {
  let filtered = [...dreams];
  if (activeCategory !== "ALL") {
    filtered = filtered.filter(d => d.category === activeCategory);
  }
  if (filterOnlyCompleted) {
    filtered = filtered.filter(d => d.is_completed);
  }

  if (filtered.length === 0) {
    dreamsContainer.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  if (currentView === "list") {
    dreamsContainer.className = "flex flex-col space-y-4";
  } else {
    dreamsContainer.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6";
  }

  dreamsContainer.innerHTML = filtered.map(dream => renderDreamCard(dream)).join("");
}

function renderDreamCard(dream) {
  const catMap = {
    DO: { label: "하고 싶은 것", color: "from-blue-500 to-indigo-600", text: "text-blue-400" },
    HAVE: { label: "갖고 싶은 것", color: "from-purple-500 to-pink-600", text: "text-purple-400" },
    GIVE: { label: "해주고 싶은 것", color: "from-amber-500 to-orange-600", text: "text-amber-400" },
  };
  const cat = catMap[dream.category] || catMap.DO;

  // Media rendering
  let mediaHtml = "";
  if (dream.primary_media) {
    if (dream.primary_media.media_type === "video") {
      mediaHtml = `
        <video src="${dream.primary_media.url}" autoplay loop muted playsinline class="w-full h-56 object-cover rounded-t-2xl"></video>
      `;
    } else {
      mediaHtml = `
        <img src="${dream.primary_media.url}" alt="${dream.title}" class="w-full h-56 object-cover rounded-t-2xl group-hover:scale-105 transition duration-500" loading="lazy" />
      `;
    }
  } else {
    mediaHtml = `
      <div class="w-full h-56 bg-slate-900 flex flex-col items-center justify-center text-slate-600 rounded-t-2xl">
        <i class="fa-regular fa-image text-4xl mb-2"></i>
        <span class="text-xs">사진 또는 영상을 추가하세요</span>
      </div>
    `;
  }

  const completedBadge = dream.is_completed
    ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center space-x-1">
        <i class="fa-solid fa-sparkles"></i> <span>달성 완료 (${dream.completed_at || ""})</span>
       </span>`
    : "";

  // D-Day badge calculation
  const ddayInfo = calculateDDay(dream.deadline);
  let ddayBadge = "";
  if (ddayInfo) {
    const badgeColor = ddayInfo.isPassed
      ? "bg-rose-950/80 text-rose-300 border-rose-700/60"
      : (ddayInfo.isUrgent
          ? "bg-amber-950/80 text-amber-300 border-amber-600/60 animate-pulse"
          : "bg-indigo-950/80 text-indigo-300 border-indigo-700/60");
    ddayBadge = `
      <span class="px-2 py-0.5 rounded-md text-[11px] font-black border ${badgeColor} flex items-center space-x-1 shadow-sm">
        <i class="fa-regular fa-hourglass-half text-[10px]"></i>
        <span>${ddayInfo.text}</span>
      </span>
    `;
  }

  // Budget display
  let budgetHtml = "";
  if (dream.estimated_budget && dream.estimated_budget > 0) {
    budgetHtml = `
      <div class="flex items-center justify-between text-xs py-1.5 px-3 rounded-xl bg-slate-900/80 border border-slate-800">
        <span class="text-slate-400 flex items-center space-x-1">
          <i class="fa-solid fa-won-sign text-amber-400"></i>
          <span>필요 예산</span>
        </span>
        <span class="font-bold text-amber-300">${formatKoreanCurrency(dream.estimated_budget)}</span>
      </div>
    `;
  }

  return `
    <div class="glow-card glass-panel rounded-2xl overflow-hidden flex flex-col justify-between group border border-slate-800/80 hover:border-purple-500/40 relative">
      <div>
        <!-- Media container with badge overlay -->
        <div class="relative overflow-hidden cursor-pointer" onclick="openMediaModal('${dream.id}')">
          ${mediaHtml}
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60"></div>
          
          <!-- Category badge & D-Day -->
          <div class="absolute top-3 left-3 flex flex-wrap items-center gap-1.5">
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider text-white bg-gradient-to-r ${cat.color} shadow-md">
              ${cat.label}
            </span>
            ${ddayBadge}
            ${completedBadge}
          </div>

          <!-- Quick Media Edit Button -->
          <button class="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-900/80 hover:bg-purple-600 text-white flex items-center justify-center text-xs transition shadow-lg opacity-80 group-hover:opacity-100" title="사진/영상 관리">
            <i class="fa-solid fa-camera"></i>
          </button>
        </div>

        <!-- Content -->
        <div class="p-5 space-y-3">
          <div class="flex items-start justify-between">
            <h3 class="text-base sm:text-lg font-bold text-white tracking-tight leading-snug hover:text-purple-300 transition cursor-pointer" onclick="openDreamModal('${dream.id}')">
              ${dream.title}
            </h3>
            <button onclick="toggleDreamComplete('${dream.id}')" class="text-slate-500 hover:text-amber-400 text-xl ml-2 transition" title="달성 체크">
              <i class="${dream.is_completed ? 'fa-solid fa-star text-amber-400' : 'fa-regular fa-star'}"></i>
            </button>
          </div>

          ${dream.vivid_description ? `
            <p class="text-xs sm:text-sm text-slate-300 line-clamp-3 leading-relaxed font-light">
              ${dream.vivid_description}
            </p>
          ` : ''}

          ${budgetHtml}

          ${dream.affirmation ? `
            <div class="p-2.5 rounded-xl bg-purple-950/30 border border-purple-800/30 text-purple-200 text-xs italic flex items-center space-x-2">
              <i class="fa-solid fa-quote-left text-[10px] text-purple-400 opacity-60"></i>
              <span class="line-clamp-2">${dream.affirmation}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Footer / Meta -->
      <div class="px-5 py-3.5 border-t border-slate-800/60 bg-slate-900/40 flex items-center justify-between text-xs text-slate-400">
        <span class="flex items-center space-x-1" title="달성 시한 / 목표일">
          <i class="fa-regular fa-clock text-purple-400"></i>
          <span>${dream.deadline || dream.target_date || '시한 미정'}</span>
        </span>
        <div class="flex items-center space-x-3">
          <button onclick="openMediaModal('${dream.id}')" class="hover:text-purple-300 transition flex items-center space-x-1">
            <i class="fa-regular fa-images"></i>
            <span>${dream.media_history ? dream.media_history.length : 0}</span>
          </button>
          <button onclick="openDreamModal('${dream.id}')" class="hover:text-white transition">
            <i class="fa-regular fa-pen-to-square"></i>
          </button>
          <button onclick="deleteDream('${dream.id}')" class="hover:text-red-400 transition">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

// --- Dream Add / Edit ---

function openDreamModal(dreamId = null) {
  if (dreamId) {
    const d = dreams.find(item => item.id === dreamId);
    if (!d) return;
    formDreamId.value = d.id;
    modalTitle.innerHTML = `<span class="text-purple-400"><i class="fa-solid fa-pen"></i></span> <span>꿈 수정하기</span>`;
    document.querySelector(`input[name="form-cat"][value="${d.category}"]`).checked = true;
    document.getElementById("form-title").value = d.title;
    document.getElementById("form-vivid-desc").value = d.vivid_description || "";
    document.getElementById("form-deadline").value = d.deadline || "";
    document.getElementById("form-affirmation").value = d.affirmation || "";
  } else {
    formDreamId.value = "";
    modalTitle.innerHTML = `<span class="text-purple-400"><i class="fa-solid fa-wand-magic-sparkles"></i></span> <span>꿈 등록하기</span>`;
    dreamForm.reset();
    document.getElementById("form-deadline").value = "";
  }
  modalDream.classList.remove("hidden");
}

function closeDreamModal() {
  modalDream.classList.add("hidden");
  dreamForm.reset();
}

async function handleDreamFormSubmit(e) {
  e.preventDefault();
  const dreamId = formDreamId.value;
  const category = document.querySelector('input[name="form-cat"]:checked').value;
  const title = document.getElementById("form-title").value.trim();
  const vivid_description = document.getElementById("form-vivid-desc").value.trim();
  const deadline = document.getElementById("form-deadline").value.trim();
  const affirmation = document.getElementById("form-affirmation").value.trim();

  const existingDream = dreamId ? dreams.find(d => d.id === dreamId) : null;
  const payload = {
    category,
    title,
    vivid_description,
    target_date: deadline,
    deadline,
    estimated_budget: existingDream ? (existingDream.estimated_budget || 0) : 0,
    budget_notes: existingDream ? (existingDream.budget_notes || "") : "",
    affirmation
  };

  // If new dream or update, update local state immediately so mobile works offline/online seamlessly
  if (dreamId) {
    const idx = dreams.findIndex(d => d.id === dreamId);
    if (idx !== -1) {
      dreams[idx] = { ...dreams[idx], ...payload, updated_at: new Date().toISOString() };
    }
  } else {
    const newId = "dream-" + Date.now();
    const newDream = {
      id: newId,
      ...payload,
      is_completed: false,
      completed_at: null,
      primary_media: null,
      media_history: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    dreams.unshift(newDream);
  }

  saveDreamsLocally();
  updateCounts();
  renderDreams();
  closeDreamModal();
  showToast(dreamId ? "꿈이 수정되었습니다." : "새로운 꿈이 등록되었습니다!");

  // Cloud Firestore Sync
  if (currentUser) {
    try {
      const targetId = dreamId || dreams[0].id;
      const targetDream = dreams.find(d => d.id === targetId);
      if (targetDream) {
        await setDoc(doc(db, "users", currentUser.uid, "dreams", targetId), targetDream);
      }
    } catch (err) {}
  }

  if (!dreamId) {
    openMediaModal(dreams[0].id);
  }
}

async function deleteDream(dreamId) {
  if (!confirm("이 꿈을 정말 보드에서 삭제하시겠습니까?")) return;
  dreams = dreams.filter(d => d.id !== dreamId);
  saveDreamsLocally();
  updateCounts();
  renderDreams();
  showToast("꿈 카드가 삭제되었습니다.");

  // Cloud Firestore Delete
  if (currentUser) {
    try {
      await deleteDoc(doc(db, "users", currentUser.uid, "dreams", dreamId));
    } catch (err) {}
  }
}

async function toggleDreamComplete(dreamId) {
  const d = dreams.find(item => item.id === dreamId);
  if (!d) return;
  d.is_completed = !d.is_completed;
  d.completed_at = d.is_completed ? new Date().toISOString().split("T")[0] : null;
  saveDreamsLocally();
  updateCounts();
  renderDreams();

  if (d.is_completed && window.confetti) {
    window.confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    showToast("축하합니다! 꿈을 현실로 이루어내셨습니다! 🎉✨");
  }

  // Cloud Firestore Sync
  if (currentUser) {
    try {
      await setDoc(doc(db, "users", currentUser.uid, "dreams", dreamId), d, { merge: true });
    } catch (err) {}
  }
}

// --- Media Management ---

function openMediaModal(dreamId) {
  const d = dreams.find(item => item.id === dreamId);
  if (!d) return;
  currentManagingDreamId = dreamId;

  mediaModalBadge.textContent = d.category;
  mediaModalDreamTitle.textContent = d.title;
  searchQueryInput.value = d.title.split(" ")[0] || d.title;

  // Reset tab to 1
  mediaTabs[0].click();
  renderMediaHistory(d);

  modalMedia.classList.remove("hidden");
}

function renderMediaHistory(dream) {
  if (!dream.media_history || dream.media_history.length === 0) {
    mediaHistoryGrid.innerHTML = `<span class="text-xs text-slate-500 py-2">아직 등록된 미디어 기록이 없습니다.</span>`;
    return;
  }

  mediaHistoryGrid.innerHTML = dream.media_history.map(m => {
    const isPrimary = dream.primary_media && dream.primary_media.id === m.id;
    return `
      <div onclick="setPrimaryMedia('${m.id}')" class="relative group cursor-pointer flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden border-2 transition ${isPrimary ? 'border-purple-500 ring-2 ring-purple-500/50' : 'border-slate-800 hover:border-slate-600'}">
        <img src="${m.thumbnail_url || m.url}" class="w-full h-full object-cover" />
        ${isPrimary ? `
          <div class="absolute top-1 right-1 w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center text-[10px]">
            <i class="fa-solid fa-check"></i>
          </div>
        ` : ''}
        <div class="absolute inset-x-0 bottom-0 bg-black/70 p-1 text-[9px] text-center text-slate-300 truncate">
          ${m.source}
        </div>
      </div>
    `;
  }).join("");
}

async function saveCurrentDreamToFirestore(d) {
  if (currentUser && d) {
    try {
      await setDoc(doc(db, "users", currentUser.uid, "dreams", d.id), d, { merge: true });
    } catch (err) {}
  }
}

async function setPrimaryMedia(mediaId) {
  if (!currentManagingDreamId) return;
  const d = dreams.find(item => item.id === currentManagingDreamId);
  if (d && d.media_history) {
    const matched = d.media_history.find(m => m.id === mediaId);
    if (matched) {
      d.primary_media = matched;
      saveDreamsLocally();
      saveCurrentDreamToFirestore(d);
      renderMediaHistory(d);
      renderDreams();
      showToast("대표 미디어가 변경되었습니다.");
    }
  }
}

// Helper: Get Firebase ID Token Authorization headers for /api/* calls
async function getAuthHeaders() {
  if (!currentUser) return {};
  try {
    const token = await currentUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

// Helper: Resize & compress image to WebP (maxWidth 1280px) via Canvas
async function resizeImageToWebP(fileOrBlob, maxWidth = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(fileOrBlob);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("WebP 변환에 실패했습니다."));
        },
        "image/webp",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지를 읽을 수 없습니다."));
    };
    img.src = objectUrl;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mimeType = "image/png") {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

// Helper: Upload media to Firebase Storage (/users/{uid}/media/{dreamId}/{fileId}.ext) with graceful Data URL fallback
async function saveMediaAsset(blobOrFile, dreamId, ext = "webp") {
  const fileId = "media-" + Date.now();
  if (currentUser && navigator.onLine) {
    try {
      const path = `users/${currentUser.uid}/media/${dreamId}/${fileId}.${ext}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, blobOrFile);
      const downloadUrl = await getDownloadURL(ref);
      return { id: fileId, url: downloadUrl, storagePath: path };
    } catch (storageErr) {
      console.warn("Firebase Storage upload unavailable, falling back to inline data URL:", storageErr.message);
    }
  }
  const dataUrl = await blobToDataUrl(blobOrFile);
  return { id: fileId, url: dataUrl };
}

async function handleFileUpload(file) {
  if (!currentManagingDreamId) return;
  const d = dreams.find(item => item.id === currentManagingDreamId);
  if (!d) return;

  const isVideo = file.type.startsWith("video");
  if (isVideo && file.size > 20 * 1024 * 1024) {
    alert("영상 파일은 20MB 이하만 직접 업로드할 수 있습니다. 큰 영상은 유튜브 링크로 연결해 주세요!");
    return;
  }

  try {
    showToast(isVideo ? "영상을 업로드하는 중..." : "사진을 WebP로 최적화하여 저장하는 중...");
    const uploadPayload = isVideo ? file : await resizeImageToWebP(file, 1280, 0.82);
    const ext = isVideo ? (file.name.split(".").pop() || "mp4") : "webp";
    const saved = await saveMediaAsset(uploadPayload, d.id, ext);

    const newMedia = {
      id: saved.id,
      media_type: isVideo ? "video" : "image",
      url: saved.url,
      thumbnail_url: saved.url,
      source: "upload",
      caption: file.name
    };
    if (!d.media_history) d.media_history = [];
    d.media_history.unshift(newMedia);
    d.primary_media = newMedia;
    saveDreamsLocally();
    saveCurrentDreamToFirestore(d);
    renderMediaHistory(d);
    renderDreams();
    showToast("미디어가 성공적으로 보존되었습니다! ✨");
  } catch (err) {
    showToast("파일 처리 중 오류가 발생했습니다: " + err.message);
  }
}

async function handleDirectUrlSubmit() {
  const url = directUrlInput.value.trim();
  if (!url || !currentManagingDreamId) return;
  const d = dreams.find(item => item.id === currentManagingDreamId);
  if (!d) return;

  const isVideo = url.includes("youtube.com") || url.includes("youtu.be") || url.endsWith(".mp4");
  const newMedia = {
    id: "media-" + Date.now(),
    url,
    thumbnail_url: url,
    media_type: isVideo ? "video" : "image",
    source: "upload",
    caption: "외부 링크 미디어"
  };

  if (!d.media_history) d.media_history = [];
  d.media_history.unshift(newMedia);
  d.primary_media = newMedia;
  directUrlInput.value = "";
  saveDreamsLocally();
  saveCurrentDreamToFirestore(d);
  renderMediaHistory(d);
  renderDreams();
  showToast("링크 미디어가 추가되었습니다.");
}

async function performWebSearch() {
  const query = searchQueryInput.value.trim();
  if (!query) return;

  searchLoading.classList.remove("hidden");
  searchResultsGrid.innerHTML = "";

  const results = [];
  const seenUrls = new Set();
  const addResult = (url, title) => {
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    results.push({ url, title: title || query });
  };

  // 1. Try serverless proxy (/api/search-images) when authenticated
  if (currentUser && navigator.onLine) {
    try {
      const headers = await getAuthHeaders();
      const apiRes = await fetch(`/api/search-images?q=${encodeURIComponent(query)}`, { headers });
      if (apiRes.ok) {
        const data = await apiRes.json();
        for (const item of (data.results || [])) {
          addResult(item.url, item.title);
        }
      }
    } catch (e) {}
  }

  // 2. Client-side fallback (guest mode or offline/proxy unavailable)
  if (results.length === 0) {
    let searchTerm = query;
    if (/[ㄱ-ㅎ가-힣]/.test(query)) {
      try {
        const trRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(query)}`);
        if (trRes.ok) {
          const trData = await trRes.json();
          const translated = trData?.[0]?.[0]?.[0];
          if (translated) searchTerm = translated;
        }
      } catch (e) {}
    }

    await Promise.allSettled([
      (async () => {
        const ovRes = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(searchTerm)}&page_size=9`);
        if (ovRes.ok) {
          const ovData = await ovRes.json();
          for (const item of (ovData.results || [])) {
            if (item.url) addResult(item.url, item.title);
          }
        }
      })(),
      (async () => {
        const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(searchTerm)}&gsrlimit=9&prop=imageinfo&iiprop=url&format=json&origin=*`;
        const res = await fetch(wikiUrl);
        if (res.ok) {
          const data = await res.json();
          const pages = data.query?.pages ? Object.values(data.query.pages) : [];
          for (const p of pages) {
            const imgUrl = p.imageinfo?.[0]?.url;
            if (imgUrl && /\.(jpg|jpeg|png|webp)$/i.test(imgUrl)) {
              addResult(imgUrl, p.title.replace(/^File:/, ""));
            }
          }
        }
      })()
    ]);
  }

  searchLoading.classList.add("hidden");

  if (results.length === 0) {
    searchResultsGrid.innerHTML = `
      <div class="col-span-2 sm:col-span-3 text-center py-8 text-xs text-slate-400">
        "${query}"에 대한 검색 결과가 없습니다. 다른 키워드(예: 영문 또는 간단한 단어)로 검색해 보세요.
      </div>
    `;
    return;
  }

  searchResultsGrid.innerHTML = results.slice(0, 12).map(item => {
    const safeUrl = item.url.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const safeTitle = item.title.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    return `
      <div onclick="window.selectWebMedia('${safeUrl}', '${safeTitle}')" class="group relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-slate-800 hover:border-purple-500 cursor-pointer transition">
        <img src="${item.url}" alt="${safeTitle}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" loading="lazy" onerror="this.parentElement.style.display='none'" />
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
          <span class="px-2.5 py-1 rounded-lg bg-purple-600 text-white text-[11px] font-bold">선택하기</span>
        </div>
      </div>
    `;
  }).join("");
}

async function selectWebMedia(url, title) {
  if (!currentManagingDreamId) return;
  const d = dreams.find(item => item.id === currentManagingDreamId);
  if (!d) return;

  const newMedia = {
    id: "media-" + Date.now(),
    url: url,
    thumbnail_url: url,
    media_type: "image",
    source: "web_search",
    caption: title || d.title
  };

  if (!d.media_history) d.media_history = [];
  d.media_history.unshift(newMedia);
  d.primary_media = newMedia;
  saveDreamsLocally();
  saveCurrentDreamToFirestore(d);
  renderMediaHistory(d);
  renderDreams();
  showToast("인터넷 사진이 안전하게 내 보드에 연결되었습니다!");
}

async function handleAiGenerate() {
  if (!currentManagingDreamId) return;
  const d = dreams.find(item => item.id === currentManagingDreamId);
  if (!d) return;

  if (!currentUser) {
    alert("AI 상상도 생성은 구글 로그인 후 이용할 수 있습니다.");
    return;
  }

  aiLoading.classList.remove("hidden");

  try {
    const headers = await getAuthHeaders();
    const res = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        title: d.title,
        description: d.vivid_description || "",
        category: d.category || "DO"
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `서버 오류 (${res.status})`);
    }

    const data = await res.json();
    const rawBlob = base64ToBlob(data.base64, data.mimeType || "image/png");
    const webpBlob = await resizeImageToWebP(rawBlob, 1280, 0.85);
    const saved = await saveMediaAsset(webpBlob, d.id, "webp");

    const newMedia = {
      id: saved.id,
      url: saved.url,
      thumbnail_url: saved.url,
      media_type: "image",
      source: "ai_generated",
      caption: `AI 생성: ${d.title}`
    };
    if (!d.media_history) d.media_history = [];
    d.media_history.unshift(newMedia);
    d.primary_media = newMedia;
    saveDreamsLocally();
    saveCurrentDreamToFirestore(d);
    renderMediaHistory(d);
    renderDreams();
    showToast("Gemini가 완성한 상상도가 등록되었습니다! ✨");
  } catch (err) {
    showToast("AI 생성 실패: " + err.message);
  } finally {
    aiLoading.classList.add("hidden");
  }
}

async function handleAiSynthesize() {
  if (!currentManagingDreamId) return;
  const d = dreams.find(item => item.id === currentManagingDreamId);
  if (!d) return;

  if (!currentUser) {
    alert("AI 인물 합성은 구글 로그인 후 이용할 수 있습니다.");
    return;
  }
  if (!synthRefFile.files || synthRefFile.files.length === 0) {
    alert("합성할 인물/가족 사진을 먼저 선택해 주세요!");
    return;
  }

  aiLoading.classList.remove("hidden");

  try {
    // Compress reference photo before sending to serverless function (keeps payload small)
    const refWebp = await resizeImageToWebP(synthRefFile.files[0], 1024, 0.82);
    const refDataUrl = await blobToDataUrl(refWebp);
    const refBase64 = refDataUrl.split(",")[1];

    const headers = await getAuthHeaders();
    const res = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        title: d.title,
        description: d.vivid_description || "",
        category: d.category || "DO",
        referenceImageBase64: refBase64,
        referenceMimeType: "image/webp",
        customPrompt: synthCustomPrompt.value.trim()
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `서버 오류 (${res.status})`);
    }

    const data = await res.json();
    const rawBlob = base64ToBlob(data.base64, data.mimeType || "image/png");
    const webpBlob = await resizeImageToWebP(rawBlob, 1280, 0.85);
    const saved = await saveMediaAsset(webpBlob, d.id, "webp");

    const newMedia = {
      id: saved.id,
      url: saved.url,
      thumbnail_url: saved.url,
      media_type: "image",
      source: data.fallbackUsed ? "ai_generated" : "ai_synthesized",
      caption: data.fallbackUsed ? `AI 상상도: ${d.title}` : `인물 합성: ${d.title}`
    };
    if (!d.media_history) d.media_history = [];
    d.media_history.unshift(newMedia);
    d.primary_media = newMedia;
    synthCustomPrompt.value = "";
    saveDreamsLocally();
    saveCurrentDreamToFirestore(d);
    renderMediaHistory(d);
    renderDreams();
    if (data.fallbackUsed) {
      showToast("인물 합성 대신 생생한 AI 상상도로 안전하게 생성되었습니다! ✨");
    } else {
      showToast("인물 합성 이미지가 생성되었습니다! 🎨");
    }
  } catch (err) {
    showToast("합성 중 오류가 발생했습니다: " + err.message);
  } finally {
    aiLoading.classList.add("hidden");
  }
}

// --- Visualization Slideshow (Meditation Mode) ---

function startSlideshow() {
  if (dreams.length === 0) {
    alert("시각화할 꿈이 없습니다. 먼저 꿈을 등록해 보세요!");
    return;
  }
  slideIndex = 0;
  isSlidePlaying = true;
  modalSlideshow.classList.remove("hidden");
  renderSlide();

  if (slideInterval) clearInterval(slideInterval);
  slideInterval = setInterval(() => {
    if (isSlidePlaying) changeSlide(1);
  }, 6000);
}

function stopSlideshow() {
  modalSlideshow.classList.add("hidden");
  if (slideInterval) clearInterval(slideInterval);
}

function toggleSlidePlay() {
  isSlidePlaying = !isSlidePlaying;
  slidePlayPause.innerHTML = isSlidePlaying
    ? `<i class="fa-solid fa-pause"></i>`
    : `<i class="fa-solid fa-play"></i>`;
}

function changeSlide(direction) {
  slideIndex = (slideIndex + direction + dreams.length) % dreams.length;
  renderSlide();
}

function renderSlide() {
  const d = dreams[slideIndex];
  if (!d) return;

  const ddayInfo = calculateDDay(d.deadline);
  let ddayText = ddayInfo ? ` [${ddayInfo.text}]` : "";
  slideCounter.textContent = `${slideIndex + 1} / ${dreams.length}${ddayText}`;
  slideCatBadge.textContent = d.category;
  slideTitle.textContent = d.title;
  
  let descHtml = d.vivid_description || "꿈을 생생하게 바라보며 이미 이루어진 감정을 온전히 느껴보세요.";
  if (d.estimated_budget && d.estimated_budget > 0) {
    descHtml += `<br><span class="inline-block mt-2 text-xs font-semibold px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30"><i class="fa-solid fa-won-sign mr-1"></i>필요 예산: ${formatKoreanCurrency(d.estimated_budget)}${d.budget_notes ? ` (${d.budget_notes})` : ''}</span>`;
  }
  slideVividDesc.innerHTML = descHtml;
  
  if (d.affirmation) {
    slideAffirmationBox.textContent = `"${d.affirmation}"`;
    slideAffirmationBox.classList.remove("hidden");
  } else {
    slideAffirmationBox.classList.add("hidden");
  }

  if (d.primary_media) {
    if (d.primary_media.media_type === "video") {
      slideMediaContainer.innerHTML = `
        <video src="${d.primary_media.url}" autoplay loop muted playsinline class="max-h-[50vh] w-auto max-w-full rounded-2xl shadow-2xl"></video>
      `;
    } else {
      slideMediaContainer.innerHTML = `
        <img src="${d.primary_media.url}" alt="${d.title}" class="max-h-[50vh] w-auto max-w-full rounded-2xl shadow-2xl object-contain" />
      `;
    }
  } else {
    slideMediaContainer.innerHTML = `
      <div class="h-64 w-96 bg-slate-900 rounded-2xl flex items-center justify-center text-slate-600">
        <i class="fa-solid fa-sparkles text-4xl"></i>
      </div>
    `;
  }
}

// --- Toast ---

function showToast(msg) {
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toast-msg");
  toastMsg.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, 3500);
}

// --- Budget Planner & Price Search ---

let plannerDraftBudgets = {};

function openBudgetPlannerModal() {
  plannerDraftBudgets = {};
  dreams.forEach(d => {
    plannerDraftBudgets[d.id] = {
      estimated_budget: d.estimated_budget || 0,
      budget_notes: d.budget_notes || ""
    };
  });
  renderBudgetPlannerList();
  modalBudgetPlanner.classList.remove("hidden");
}

function closeBudgetPlannerModal() {
  modalBudgetPlanner.classList.add("hidden");
}

function updatePlannerTotalPreview() {
  const total = Object.values(plannerDraftBudgets).reduce(
    (sum, item) => sum + (parseInt(item.estimated_budget, 10) || 0),
    0
  );
  if (plannerTotalBudget) {
    plannerTotalBudget.textContent = formatKoreanCurrency(total);
  }
}

function onPlannerBudgetInput(dreamId, value) {
  const num = value ? Math.max(0, parseInt(value, 10) || 0) : 0;
  if (!plannerDraftBudgets[dreamId]) plannerDraftBudgets[dreamId] = { estimated_budget: 0, budget_notes: "" };
  plannerDraftBudgets[dreamId].estimated_budget = num;
  const label = document.getElementById(`planner-korean-${dreamId}`);
  if (label) label.textContent = formatKoreanCurrency(num);
  updatePlannerTotalPreview();
}

function onPlannerNotesInput(dreamId, value) {
  if (!plannerDraftBudgets[dreamId]) plannerDraftBudgets[dreamId] = { estimated_budget: 0, budget_notes: "" };
  plannerDraftBudgets[dreamId].budget_notes = value;
}

function searchPriceForDream(dreamTitle, engine) {
  if (!dreamTitle) return;
  if (engine === "naver") {
    window.open(`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(dreamTitle)}`, "_blank", "noopener");
  } else {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(dreamTitle + " 가격 비용 예산")}`, "_blank", "noopener");
  }
}

function renderBudgetPlannerList() {
  const onlyUnset = plannerOnlyUnset && plannerOnlyUnset.checked;
  const list = dreams.filter(d => {
    if (!onlyUnset) return true;
    const draft = plannerDraftBudgets[d.id];
    const amt = draft ? draft.estimated_budget : (d.estimated_budget || 0);
    return !amt || amt <= 0;
  });

  updatePlannerTotalPreview();

  if (dreams.length === 0) {
    budgetListContainer.innerHTML = `
      <div class="text-center py-10 text-slate-400 text-xs sm:text-sm">
        아직 작성된 꿈이 없습니다. 먼저 꿈을 자유롭게 등록해 보세요!
      </div>
    `;
    return;
  }

  if (list.length === 0) {
    budgetListContainer.innerHTML = `
      <div class="text-center py-10 text-amber-300/80 text-xs sm:text-sm">
        모든 꿈에 예산이 입력되어 있습니다! ✨
      </div>
    `;
    return;
  }

  const catLabels = {
    DO: { label: "🏃 하고 싶은 것", cls: "bg-indigo-950 text-indigo-300 border-indigo-800" },
    HAVE: { label: "💎 갖고 싶은 것", cls: "bg-purple-950 text-purple-300 border-purple-800" },
    GIVE: { label: "💝 해주고 싶은 것", cls: "bg-rose-950 text-rose-300 border-rose-800" }
  };

  budgetListContainer.innerHTML = list.map(d => {
    const cat = catLabels[d.category] || catLabels.DO;
    const draft = plannerDraftBudgets[d.id] || { estimated_budget: d.estimated_budget || 0, budget_notes: d.budget_notes || "" };
    const safeTitle = d.title.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const valStr = draft.estimated_budget > 0 ? draft.estimated_budget : "";

    return `
      <div class="p-3.5 sm:p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="flex items-center space-x-2 min-w-0">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${cat.cls} shrink-0">${cat.label}</span>
            <h4 class="text-sm font-bold text-white truncate">${d.title}</h4>
          </div>
          <!-- Price/Cost Search Buttons -->
          <div class="flex items-center space-x-1.5 shrink-0">
            <button type="button" onclick="window.searchPriceForDream('${safeTitle}', 'naver')" class="px-2.5 py-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/50 text-[11px] font-semibold transition flex items-center space-x-1">
              <i class="fa-solid fa-magnifying-glass"></i>
              <span>네이버 가격</span>
            </button>
            <button type="button" onclick="window.searchPriceForDream('${safeTitle}', 'google')" class="px-2.5 py-1.5 rounded-lg bg-sky-950/70 hover:bg-sky-900 text-sky-300 border border-sky-700/50 text-[11px] font-semibold transition flex items-center space-x-1">
              <i class="fa-brands fa-google"></i>
              <span>구글 비용 검색</span>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-[11px] text-slate-400">예상 금액 (원)</span>
              <span id="planner-korean-${d.id}" class="text-[11px] font-bold text-amber-300">${formatKoreanCurrency(draft.estimated_budget)}</span>
            </div>
            <input type="number" min="0" step="10000" value="${valStr}" placeholder="금액 입력 (예: 1500000)"
              oninput="window.onPlannerBudgetInput('${d.id}', this.value)"
              class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-amber-500 outline-none text-base sm:text-sm text-white" />
          </div>
          <div>
            <div class="mb-1">
              <span class="text-[11px] text-slate-400">예산 메모 / 자금 계획</span>
            </div>
            <input type="text" value="${(draft.budget_notes || '').replace(/"/g, '&quot;')}" placeholder="예: 매월 50만 저축, 검색 최저가 기준"
              oninput="window.onPlannerNotesInput('${d.id}', this.value)"
              class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-amber-500 outline-none text-base sm:text-sm text-white" />
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function saveAllBudgets() {
  const changedDreams = [];
  dreams = dreams.map(d => {
    const draft = plannerDraftBudgets[d.id];
    if (!draft) return d;
    const newBudget = parseInt(draft.estimated_budget, 10) || 0;
    const newNotes = (draft.budget_notes || "").trim();
    if (newBudget !== (d.estimated_budget || 0) || newNotes !== (d.budget_notes || "")) {
      const updated = {
        ...d,
        estimated_budget: newBudget,
        budget_notes: newNotes,
        updated_at: new Date().toISOString()
      };
      changedDreams.push(updated);
      return updated;
    }
    return d;
  });

  saveDreamsLocally();
  updateCounts();
  renderDreams();
  closeBudgetPlannerModal();
  showToast("모든 꿈의 예산이 깔끔하게 정리되었습니다! 💰✨");

  if (currentUser && changedDreams.length > 0) {
    try {
      await Promise.all(
        changedDreams.map(d => setDoc(doc(db, "users", currentUser.uid, "dreams", d.id), d, { merge: true }))
      );
    } catch (err) {}
  }
}

// --- JSON One-Click Backup / Restore ---

function exportDataAsJson() {
  const backup = {
    version: "1.2",
    exportedAt: new Date().toISOString(),
    dreams
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dream-board-backup-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("꿈보드 백업 JSON 파일이 저장되었습니다! 💾");
}

async function importDataFromJson(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const importedDreams = Array.isArray(parsed) ? parsed : parsed.dreams;
    if (!Array.isArray(importedDreams)) {
      alert("올바른 꿈보드 백업 JSON 형식이 아닙니다.");
      return;
    }

    if (!confirm(`총 ${importedDreams.length}개의 꿈을 불러오시겠습니까? 기존 목록과 병합됩니다.`)) return;

    const existingMap = new Map(dreams.map(d => [d.id, d]));
    const restoredList = [];
    for (const raw of importedDreams) {
      const normalized = normalizeDream(raw);
      if (normalized && normalized.id && normalized.title) {
        existingMap.set(normalized.id, normalized);
        restoredList.push(normalized);
      }
    }

    dreams = Array.from(existingMap.values()).sort(
      (a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0)
    );
    saveDreamsLocally();
    updateCounts();
    renderDreams();
    modalSettings.classList.add("hidden");
    showToast(`${restoredList.length}개의 꿈이 성공적으로 복원되었습니다! ✨`);

    if (currentUser && restoredList.length > 0) {
      await Promise.all(
        restoredList.map(d => setDoc(doc(db, "users", currentUser.uid, "dreams", d.id), d, { merge: true }))
      );
    }
  } catch (err) {
    alert("백업 파일 불러오기 실패: " + err.message);
  }
}

// Expose handlers globally for inline onclick templates inside ES module
window.openDreamModal = openDreamModal;
window.openMediaModal = openMediaModal;
window.toggleDreamComplete = toggleDreamComplete;
window.deleteDream = deleteDream;
window.setPrimaryMedia = setPrimaryMedia;
window.selectWebMedia = selectWebMedia;
window.openBudgetPlannerModal = openBudgetPlannerModal;
window.searchPriceForDream = searchPriceForDream;
window.onPlannerBudgetInput = onPlannerBudgetInput;
window.onPlannerNotesInput = onPlannerNotesInput;

// Start application
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
