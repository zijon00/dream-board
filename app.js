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
  getDoc,
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
  return { text: "숨 고르기 중 · 날짜 다시 잡기", isUrgent: false, isPassed: true };
}
// State
let dreams = [];
let dream100List = [];
let userProfileData = {
  myWhy: [
    "사랑하는 가족과 시간·경제적 자유를 누리기 위해",
    "부모님께 건강한 노후와 여행을 선물하기 위해",
    "누군가의 꿈을 돕는 선한 영향력의 리더가 되기 위해"
  ],
  enablePinPlanner: false,
  monthlySavingCapacity: 1000000,
  visualizationStreak: { count: 0, lastCheckedDate: "" }
};
let activeCategory = "ALL";
let plannerYearFilter = "ALL";
let simDeltaIncome = 0;
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

// My Why & Streak Elements
const btnToggleWhy = document.getElementById("btn-toggle-why");
const whyChevron = document.getElementById("why-chevron");
const myWhyList = document.getElementById("my-why-list");
const btnEditWhy = document.getElementById("btn-edit-why");
const modalWhy = document.getElementById("modal-why");
const whyModalClose = document.getElementById("why-modal-close");
const whyModalCancel = document.getElementById("why-modal-cancel");
const whyForm = document.getElementById("why-form");
const streakCountText = document.getElementById("streak-count-text");
const streakCountMobile = document.getElementById("streak-count-mobile");

// Dream Discovery (Dream 100 & AI Refine & Inspiration)
const btnDream100 = document.getElementById("btn-dream-100");
const modalDream100 = document.getElementById("modal-dream-100");
const dream100ModalClose = document.getElementById("dream100-modal-close");
const dream100Form = document.getElementById("dream100-form");
const dream100Cat = document.getElementById("dream100-cat");
const dream100Input = document.getElementById("dream100-input");
const dream100ListEl = document.getElementById("dream100-list");
const dream100Counter = document.getElementById("dream100-counter");
const inspirationChips = document.getElementById("inspiration-chips");
const btnAiRefine = document.getElementById("btn-ai-refine");

// Future Diary & Navigation Elements
const headerSubbar = document.getElementById("header-subbar");
const sectionDreamBoard = document.getElementById("section-dream-board");
const sectionFutureDiary = document.getElementById("section-future-diary");
const futureDiaryList = document.getElementById("future-diary-list");
const btnNavDiaryTop = document.getElementById("btn-nav-diary-top");
const btnBackToBoard = document.getElementById("btn-back-to-board");
const btnNewDiary = document.getElementById("btn-new-diary");
const modalFutureDiary = document.getElementById("modal-future-diary");
const diaryModalClose = document.getElementById("diary-modal-close");
const diaryModalCancel = document.getElementById("diary-modal-cancel");
const diaryForm = document.getElementById("diary-form");
const mobileNavBtns = document.querySelectorAll(".mobile-nav-btn");

// Simulator & Slideshow v1.2 Elements
const plannerProgressText = document.getElementById("planner-progress-text");
const plannerProgressBar = document.getElementById("planner-progress-bar");
const plannerYearTabs = document.querySelectorAll(".planner-year-tab");
const simMonthlySavingInput = document.getElementById("sim-monthly-saving");
const simPresetBtns = document.querySelectorAll(".sim-preset-btn");
const simResultBox = document.getElementById("sim-result-box");
const slideIntervalSelect = document.getElementById("slide-interval-select");
const slideBgmToggle = document.getElementById("slide-bgm-toggle");
const slideTtsToggle = document.getElementById("slide-tts-toggle");
const slideSaveWallpaper = document.getElementById("slide-save-wallpaper");
const slideDiaryBox = document.getElementById("slide-diary-box");
const btnCheckinStreak = document.getElementById("btn-checkin-streak");

// Stage 3: Optional Business Planner Elements
const togglePinPlanner = document.getElementById("toggle-pin-planner");
const btnNavPlannerTop = document.getElementById("btn-nav-planner-top");
const btnNavPlannerMobile = document.getElementById("btn-nav-planner-mobile");
const sectionPlanner = document.getElementById("section-planner");
const btnPlannerBackBoard = document.getElementById("btn-planner-back-board");
const plannerSubtabs = document.querySelectorAll(".planner-subtab");
const plannerSubpanels = document.querySelectorAll(".planner-subpanel");
const pfSelect = document.getElementById("pf-select");
const pfStatusBadge = document.getElementById("pf-status-badge");
const btnPfRollover = document.getElementById("btn-pf-rollover");
const btnPfSave = document.getElementById("btn-pf-save");
const pfPinSelect = document.getElementById("pf-pin-select");
const pfYearBucket = document.getElementById("pf-year-bucket");
const pfMonthlyIncome = document.getElementById("pf-monthly-income");
const pfAnnualBonus = document.getElementById("pf-annual-bonus");
const pfIncomeSummary = document.getElementById("pf-income-summary");
const pfLinkedDreamsStrip = document.getElementById("pf-linked-dreams-strip");
const pfMonthsGrid = document.getElementById("pf-months-grid");
const core10WeekInput = document.getElementById("core10-week-input");
const btnCore10Save = document.getElementById("btn-core10-save");
const core10HistoryList = document.getElementById("core10-history-list");
const pinTimelineContainer = document.getElementById("pin-timeline-container");
const pinReferenceTable = document.getElementById("pin-reference-table");

let fiscalPlansMap = {};
let coreLogsMap = {};
let currentPfCode = "";

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

      // Load user profile (myWhy, streak, settings)
      await loadUserProfile(user.uid);
      // Sync local dreams to Firestore if local dreams exist
      await syncLocalDreamsToFirestore(user.uid);
      // Listen to real-time updates from Firestore
      subscribeToFirestore(user.uid);
    } else {
      // User is signed out
      loadLocalUserProfile();
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

  // My Why 3 Reasons Banner & Modal
  if (btnToggleWhy && myWhyList) {
    btnToggleWhy.addEventListener("click", () => {
      myWhyList.classList.toggle("hidden");
      if (whyChevron) whyChevron.classList.toggle("rotate-180");
    });
  }
  if (btnEditWhy) btnEditWhy.addEventListener("click", openWhyModal);
  if (whyModalClose) whyModalClose.addEventListener("click", () => modalWhy.classList.add("hidden"));
  if (whyModalCancel) whyModalCancel.addEventListener("click", () => modalWhy.classList.add("hidden"));
  if (whyForm) whyForm.addEventListener("submit", handleWhyFormSubmit);

  // Dream 100 Discovery & AI Refine
  if (btnDream100) btnDream100.addEventListener("click", openDream100Modal);
  if (dream100ModalClose) dream100ModalClose.addEventListener("click", () => modalDream100.classList.add("hidden"));
  if (dream100Form) dream100Form.addEventListener("submit", handleDream100Add);
  if (btnAiRefine) btnAiRefine.addEventListener("click", handleAiRefine);
  document.querySelectorAll('input[name="form-cat"]').forEach(radio => {
    radio.addEventListener("change", () => renderInspirationChips(radio.value));
  });

  // Future Diary & Navigation
  if (btnNavDiaryTop) btnNavDiaryTop.addEventListener("click", () => switchMainView("diary"));
  if (btnBackToBoard) btnBackToBoard.addEventListener("click", () => switchMainView("board"));
  if (btnNewDiary) btnNewDiary.addEventListener("click", () => openDiaryModal());
  if (diaryModalClose) diaryModalClose.addEventListener("click", () => modalFutureDiary.classList.add("hidden"));
  if (diaryModalCancel) diaryModalCancel.addEventListener("click", () => modalFutureDiary.classList.add("hidden"));
  if (diaryForm) diaryForm.addEventListener("submit", handleDiaryFormSubmit);

  mobileNavBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.nav;
      if (target === "board") switchMainView("board");
      else if (target === "diary") switchMainView("diary");
      else if (target === "planner") switchMainView("planner");
      else if (target === "dream100") openDream100Modal();
      else if (target === "budget") openBudgetPlannerModal();
      else if (target === "meditate") startSlideshow();
    });
  });

  // Budget Planner Year Tabs & Simulator
  plannerYearTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      plannerYearTabs.forEach(t => {
        t.classList.remove("bg-amber-600", "text-white");
        t.classList.add("text-slate-400");
      });
      tab.classList.add("bg-amber-600", "text-white");
      tab.classList.remove("text-slate-400");
      plannerYearFilter = tab.dataset.year;
      renderBudgetPlannerList();
    });
  });
  if (simMonthlySavingInput) {
    simMonthlySavingInput.addEventListener("input", () => {
      userProfileData.monthlySavingCapacity = Math.max(0, parseInt(simMonthlySavingInput.value, 10) || 0);
      updatePlannerTotalPreview();
    });
  }
  simPresetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      simPresetBtns.forEach(b => b.classList.remove("bg-indigo-600", "text-white"));
      btn.classList.add("bg-indigo-600", "text-white");
      simDeltaIncome = parseInt(btn.dataset.delta, 10) || 0;
      updatePlannerTotalPreview();
    });
  });

  // Slideshow v1.2 Controls
  if (slideIntervalSelect) {
    slideIntervalSelect.addEventListener("change", () => {
      if (isSlidePlaying && !modalSlideshow.classList.contains("hidden")) {
        restartSlideTimer();
      }
    });
  }
  if (slideBgmToggle) slideBgmToggle.addEventListener("click", toggleSlideBgm);
  if (slideTtsToggle) slideTtsToggle.addEventListener("click", toggleSlideTts);
  if (slideSaveWallpaper) slideSaveWallpaper.addEventListener("click", savePhoneWallpaper);
  if (btnCheckinStreak) btnCheckinStreak.addEventListener("click", checkinVisualizationStreak);

  // Stage 3: Business Planner Module Listeners
  if (togglePinPlanner) {
    togglePinPlanner.addEventListener("change", async () => {
      const enabled = togglePinPlanner.checked;
      await saveUserProfile({ enablePinPlanner: enabled });
      applyPinPlannerVisibility();
      if (!enabled && sectionPlanner && !sectionPlanner.classList.contains("hidden")) {
        switchMainView("board");
      }
      showToast(enabled ? "PIN 로드맵 & 실행 플래너가 활성화되었습니다! 🏆" : "심플 꿈보드 모드로 전환되었습니다.");
    });
  }
  if (btnNavPlannerTop) btnNavPlannerTop.addEventListener("click", () => switchMainView("planner"));
  if (btnPlannerBackBoard) btnPlannerBackBoard.addEventListener("click", () => switchMainView("board"));

  plannerSubtabs.forEach(tab => {
    tab.addEventListener("click", () => {
      plannerSubtabs.forEach(t => {
        t.classList.remove("bg-amber-600", "text-white");
        t.classList.add("bg-slate-900", "text-slate-400");
      });
      tab.classList.add("bg-amber-600", "text-white");
      tab.classList.remove("bg-slate-900", "text-slate-400");
      const target = tab.dataset.subtab;
      plannerSubpanels.forEach(p => p.classList.add("hidden"));
      document.getElementById(`planner-tab-${target}`)?.classList.remove("hidden");
      if (target === "timeline") {
        renderPinTimeline();
        renderPinReferenceTable();
      }
    });
  });

  if (pfSelect) {
    pfSelect.addEventListener("change", () => {
      currentPfCode = pfSelect.value;
      renderFiscalPlanner();
    });
  }
  if (pfPinSelect) {
    pfPinSelect.addEventListener("change", () => {
      const preset = PIN_PRESETS.find(p => p.pin === pfPinSelect.value);
      if (preset) {
        if (pfMonthlyIncome) pfMonthlyIncome.value = preset.monthly;
        if (pfAnnualBonus) pfAnnualBonus.value = preset.annualBonus;
      }
      updateCurrentPfDraftFromHeader();
      renderPfIncomeSummary();
    });
  }
  [pfYearBucket, pfMonthlyIncome, pfAnnualBonus].forEach(el => {
    el?.addEventListener("input", () => {
      updateCurrentPfDraftFromHeader();
      renderPfIncomeSummary();
    });
  });
  if (btnPfSave) btnPfSave.addEventListener("click", saveCurrentFiscalPlan);
  if (btnPfRollover) btnPfRollover.addEventListener("click", rolloverFiscalPlan);

  if (core10WeekInput) {
    core10WeekInput.addEventListener("change", renderCore10Form);
  }
  if (btnCore10Save) btnCore10Save.addEventListener("click", saveCurrentCoreLog);
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
  const goEl = document.getElementById("count-go");
  const beEl = document.getElementById("count-be");
  if (goEl) goEl.textContent = dreams.filter(d => d.category === "GO").length;
  if (beEl) beEl.textContent = dreams.filter(d => d.category === "BE").length;

  // Exclude completed dreams from remaining budget sum
  const totalBudget = dreams
    .filter(d => !d.is_completed)
    .reduce((sum, d) => sum + Math.max(0, (d.estimated_budget || 0) - (d.savedAmount || 0)), 0);
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
    GO: { label: "가고 싶은 곳", color: "from-emerald-500 to-teal-600", text: "text-emerald-400" },
    BE: { label: "되고 싶은 사람", color: "from-rose-500 to-fuchsia-600", text: "text-rose-400" },
  };
  const cat = catMap[dream.category] || catMap.DO;
  const yearLabels = { "1Y": "1년 후", "2Y": "2년 후", "3Y": "3년 후" };
  const yearTag = yearLabels[dream.targetYearBucket] || "1년 후";

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

  // D-Day badge calculation (gentle reset UX when passed)
  const ddayInfo = calculateDDay(dream.deadline);
  let ddayBadge = "";
  if (ddayInfo) {
    if (ddayInfo.isPassed && !dream.is_completed) {
      ddayBadge = `
        <button type="button" onclick="event.stopPropagation(); window.openDreamModal('${dream.id}', true)" class="px-2 py-0.5 rounded-md text-[11px] font-semibold border bg-slate-900/90 hover:bg-slate-800 text-amber-200 border-amber-500/40 flex items-center space-x-1 shadow-sm transition">
          <i class="fa-solid fa-rotate-right text-[10px] text-amber-400"></i>
          <span>${ddayInfo.text}</span>
        </button>
      `;
    } else if (!ddayInfo.isPassed) {
      const badgeColor = ddayInfo.isUrgent
        ? "bg-amber-950/80 text-amber-300 border-amber-600/60 animate-pulse"
        : "bg-indigo-950/80 text-indigo-300 border-indigo-700/60";
      ddayBadge = `
        <span class="px-2 py-0.5 rounded-md text-[11px] font-black border ${badgeColor} flex items-center space-x-1 shadow-sm">
          <i class="fa-regular fa-hourglass-half text-[10px]"></i>
          <span>${ddayInfo.text}</span>
        </span>
      `;
    }
  }

  // Budget & Progress display
  let budgetHtml = "";
  if (dream.estimated_budget && dream.estimated_budget > 0) {
    const saved = dream.savedAmount || 0;
    const pct = Math.min(100, Math.round((saved / dream.estimated_budget) * 100));
    budgetHtml = `
      <div class="space-y-1.5 py-2 px-3 rounded-xl bg-slate-900/80 border border-slate-800">
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-400 flex items-center space-x-1">
            <i class="fa-solid fa-won-sign text-amber-400"></i>
            <span>목표 예산</span>
          </span>
          <span class="font-bold text-amber-300">${formatKoreanCurrency(dream.estimated_budget)}</span>
        </div>
        ${saved > 0 ? `
          <div class="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-400" style="width: ${pct}%"></div>
          </div>
          <div class="flex justify-between text-[10px] text-emerald-300 font-semibold">
            <span>준비됨: ${formatKoreanCurrency(saved)}</span>
            <span>${pct}% 달성</span>
          </div>
        ` : ''}
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
          
          <!-- Category badge, Year tag & D-Day -->
          <div class="absolute top-3 left-3 flex flex-wrap items-center gap-1.5 pr-10">
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider text-white bg-gradient-to-r ${cat.color} shadow-md">
              ${cat.label}
            </span>
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-900/85 text-slate-200 border border-slate-700">${yearTag}</span>
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

          ${dream.whyNote ? `
            <p class="text-[11px] text-indigo-300 font-medium flex items-start space-x-1.5">
              <i class="fa-solid fa-heart text-rose-400 mt-0.5 shrink-0"></i>
              <span>${dream.whyNote}</span>
            </p>
          ` : ''}

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

function openDreamModal(dreamId = null, focusDeadline = false) {
  if (dreamId) {
    const d = dreams.find(item => item.id === dreamId);
    if (!d) return;
    formDreamId.value = d.id;
    modalTitle.innerHTML = `<span class="text-purple-400"><i class="fa-solid fa-pen"></i></span> <span>꿈 수정하기</span>`;
    const catRadio = document.querySelector(`input[name="form-cat"][value="${d.category}"]`);
    if (catRadio) catRadio.checked = true;
    document.getElementById("form-title").value = d.title;
    document.getElementById("form-why-note").value = d.whyNote || "";
    document.getElementById("form-vivid-desc").value = d.vivid_description || "";
    document.getElementById("form-year-bucket").value = d.targetYearBucket || "1Y";
    document.getElementById("form-deadline").value = d.deadline || "";
    document.getElementById("form-affirmation").value = d.affirmation || "";
    renderInspirationChips(d.category);
  } else {
    formDreamId.value = "";
    modalTitle.innerHTML = `<span class="text-purple-400"><i class="fa-solid fa-wand-magic-sparkles"></i></span> <span>꿈 등록하기</span>`;
    dreamForm.reset();
    document.getElementById("form-year-bucket").value = "1Y";
    document.getElementById("form-deadline").value = "";
    renderInspirationChips("DO");
  }
  modalDream.classList.remove("hidden");
  if (focusDeadline) {
    setTimeout(() => document.getElementById("form-deadline")?.focus(), 150);
  }
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
  const whyNote = document.getElementById("form-why-note").value.trim();
  const vivid_description = document.getElementById("form-vivid-desc").value.trim();
  const targetYearBucket = document.getElementById("form-year-bucket").value || "1Y";
  const deadline = document.getElementById("form-deadline").value.trim();
  const affirmation = document.getElementById("form-affirmation").value.trim();

  const existingDream = dreamId ? dreams.find(d => d.id === dreamId) : null;
  const payload = {
    category,
    title,
    whyNote,
    vivid_description,
    targetYearBucket,
    target_date: deadline,
    deadline,
    estimated_budget: existingDream ? (existingDream.estimated_budget || 0) : 0,
    savedAmount: existingDream ? (existingDream.savedAmount || 0) : 0,
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

// --- Visualization Slideshow (Meditation Mode v1.2) ---

let bgmAudioCtx = null;
let bgmGainNode = null;
let isBgmPlaying = false;
let isTtsEnabled = false;

function restartSlideTimer() {
  if (slideInterval) clearInterval(slideInterval);
  const ms = parseInt(slideIntervalSelect?.value || "8000", 10) || 8000;
  slideInterval = setInterval(() => {
    if (isSlidePlaying) changeSlide(1);
  }, ms);
}

function startSlideshow() {
  if (dreams.length === 0) {
    alert("시각화할 꿈이 없습니다. 먼저 꿈을 등록해 보세요!");
    return;
  }
  slideIndex = 0;
  isSlidePlaying = true;
  modalSlideshow.classList.remove("hidden");
  renderSlide();
  restartSlideTimer();
}

function stopSlideshow() {
  modalSlideshow.classList.add("hidden");
  if (slideInterval) clearInterval(slideInterval);
  if (isBgmPlaying) toggleSlideBgm();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
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

function toggleSlideBgm() {
  if (!isBgmPlaying) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      bgmAudioCtx = new AudioCtx();
      bgmGainNode = bgmAudioCtx.createGain();
      bgmGainNode.gain.setValueAtTime(0.04, bgmAudioCtx.currentTime);
      bgmGainNode.connect(bgmAudioCtx.destination);
      // Warm calm ambient chord (432Hz harmonic pad)
      [216, 272.1, 324].forEach(freq => {
        const osc = bgmAudioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, bgmAudioCtx.currentTime);
        osc.connect(bgmGainNode);
        osc.start();
      });
      isBgmPlaying = true;
      slideBgmToggle?.classList.add("bg-purple-700", "text-white");
      showToast("잔잔한 명상 BGM이 재생됩니다 🎵");
    } catch {}
  } else {
    try { bgmAudioCtx?.close(); } catch {}
    bgmAudioCtx = null;
    isBgmPlaying = false;
    slideBgmToggle?.classList.remove("bg-purple-700", "text-white");
  }
}

function toggleSlideTts() {
  isTtsEnabled = !isTtsEnabled;
  if (isTtsEnabled) {
    slideTtsToggle?.classList.add("bg-purple-700", "text-white");
    speakCurrentSlide();
  } else {
    slideTtsToggle?.classList.remove("bg-purple-700", "text-white");
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
}

function speakCurrentSlide() {
  if (!isTtsEnabled || !window.speechSynthesis) return;
  const d = dreams[slideIndex];
  if (!d) return;
  window.speechSynthesis.cancel();
  const text = `${d.title}. ${d.vivid_description || ""} ${d.affirmation || ""}`;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ko-KR";
  utter.rate = 0.92;
  window.speechSynthesis.speak(utter);
}

async function savePhoneWallpaper() {
  showToast("9:16 스마트폰 비전보드 배경화면을 생성하는 중...");
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");

  // Gradient Background
  const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
  grad.addColorStop(0, "#0f172a");
  grad.addColorStop(0.5, "#1e1b4b");
  grad.addColorStop(1, "#090d16");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1920);

  // Header Title
  ctx.fillStyle = "#e9d5ff";
  ctx.font = "bold 44px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("✨ MY DREAM BOARD ✨", 540, 180);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "28px sans-serif";
  ctx.fillText(userProfileData.myWhy?.[0] || "상상할 수 있다면 이미 현실이 되기 시작한 것이다", 540, 235);

  const imgDreams = dreams.filter(d => d.primary_media && d.primary_media.media_type !== "video").slice(0, 6);
  const cols = 2;
  const pad = 50;
  const gap = 30;
  const cardW = (1080 - pad * 2 - gap) / cols;
  const cardH = 380;

  for (let i = 0; i < imgDreams.length; i++) {
    const d = imgDreams[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cardW + gap);
    const y = 310 + row * (cardH + gap);

    ctx.fillStyle = "rgba(30, 41, 59, 0.85)";
    ctx.fillRect(x, y, cardW, cardH);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((res) => {
        img.onload = res;
        img.onerror = res;
        img.src = d.primary_media.url;
      });
      if (img.width > 0) {
        ctx.drawImage(img, x, y, cardW, cardH - 70);
      }
    } catch {}

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(d.title.slice(0, 18), x + cardW / 2, y + cardH - 25);
  }

  ctx.fillStyle = "#c4b5fd";
  ctx.font = "26px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("dream-board-eta.vercel.app", 540, 1830);

  try {
    const link = document.createElement("a");
    link.download = `dream-board-wallpaper-${new Date().toISOString().split("T")[0]}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("스마트폰 배경화면(9:16)이 저장되었습니다! 📱");
  } catch {
    showToast("외부 이미지 보안 정책으로 일부 사진이 제외될 수 있습니다.");
  }
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
    descHtml += `<br><span class="inline-block mt-2 text-xs font-semibold px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30"><i class="fa-solid fa-won-sign mr-1"></i>목표 예산: ${formatKoreanCurrency(d.estimated_budget)}${d.budget_notes ? ` (${d.budget_notes})` : ''}</span>`;
  }
  slideVividDesc.innerHTML = descHtml;
  
  if (d.affirmation) {
    slideAffirmationBox.textContent = `"${d.affirmation}"`;
    slideAffirmationBox.classList.remove("hidden");
  } else {
    slideAffirmationBox.classList.add("hidden");
  }

  if (slideDiaryBox) {
    if (d.futureDiary && d.futureDiary.content) {
      slideDiaryBox.innerHTML = `<span class="font-bold text-emerald-300">📖 미래일기 (${d.futureDiary.date || ''}):</span> ${d.futureDiary.content}`;
      slideDiaryBox.classList.remove("hidden");
    } else {
      slideDiaryBox.classList.add("hidden");
    }
  }

  if (d.primary_media) {
    if (d.primary_media.media_type === "video") {
      slideMediaContainer.innerHTML = `
        <video src="${d.primary_media.url}" autoplay loop muted playsinline class="max-h-[44vh] w-auto max-w-full rounded-2xl shadow-2xl"></video>
      `;
    } else {
      slideMediaContainer.innerHTML = `
        <img src="${d.primary_media.url}" alt="${d.title}" class="max-h-[44vh] w-auto max-w-full rounded-2xl shadow-2xl object-contain" />
      `;
    }
  } else {
    slideMediaContainer.innerHTML = `
      <div class="h-56 w-80 bg-slate-900 rounded-2xl flex items-center justify-center text-slate-600">
        <i class="fa-solid fa-sparkles text-4xl"></i>
      </div>
    `;
  }

  speakCurrentSlide();
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

// --- Budget Planner, Progress & Income Simulator ---

let plannerDraftBudgets = {};

function openBudgetPlannerModal() {
  plannerDraftBudgets = {};
  dreams.forEach(d => {
    plannerDraftBudgets[d.id] = {
      estimated_budget: d.estimated_budget || 0,
      savedAmount: d.savedAmount || 0,
      budget_notes: d.budget_notes || ""
    };
  });
  if (simMonthlySavingInput) {
    simMonthlySavingInput.value = userProfileData.monthlySavingCapacity || 1000000;
  }
  renderBudgetPlannerList();
  modalBudgetPlanner.classList.remove("hidden");
}

function closeBudgetPlannerModal() {
  modalBudgetPlanner.classList.add("hidden");
}

function updatePlannerTotalPreview() {
  const activeDreams = dreams.filter(d => {
    if (d.is_completed) return false;
    if (plannerYearFilter !== "ALL" && (d.targetYearBucket || "1Y") !== plannerYearFilter) return false;
    return true;
  });

  let totalTarget = 0;
  let totalSaved = 0;
  for (const d of activeDreams) {
    const draft = plannerDraftBudgets[d.id];
    const target = draft ? (parseInt(draft.estimated_budget, 10) || 0) : (d.estimated_budget || 0);
    const saved = draft ? (parseInt(draft.savedAmount, 10) || 0) : (d.savedAmount || 0);
    totalTarget += target;
    totalSaved += Math.min(target > 0 ? target : saved, saved);
  }

  const remainingTotal = Math.max(0, totalTarget - totalSaved);
  const pct = totalTarget > 0 ? Math.min(100, Math.round((totalSaved / totalTarget) * 100)) : 0;

  if (plannerTotalBudget) {
    plannerTotalBudget.textContent = formatKoreanCurrency(remainingTotal);
  }
  if (plannerProgressText) {
    plannerProgressText.textContent = `달성률 ${pct}% (준비됨 ${formatKoreanCurrency(totalSaved)})`;
  }
  if (plannerProgressBar) {
    plannerProgressBar.style.width = `${pct}%`;
  }

  if (simResultBox) {
    const baseMonthly = Math.max(0, parseInt(simMonthlySavingInput?.value || userProfileData.monthlySavingCapacity || 0, 10) || 0);
    if (remainingTotal <= 0) {
      simResultBox.innerHTML = `<span class="text-emerald-300 font-bold">🎉 선택된 목표 예산을 이미 100% 준비하셨습니다!</span>`;
    } else if (baseMonthly + simDeltaIncome <= 0) {
      simResultBox.innerHTML = `<span class="text-slate-400">월 저축 여력을 입력하시면 예상 달성 기간을 계산해 드립니다.</span>`;
    } else {
      const baseMonths = baseMonthly > 0 ? Math.ceil(remainingTotal / baseMonthly) : null;
      const boostedMonths = Math.ceil(remainingTotal / (baseMonthly + simDeltaIncome));
      const savedMonths = baseMonths !== null ? Math.max(0, baseMonths - boostedMonths) : 0;
      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() + boostedMonths);
      const ym = `${targetDate.getFullYear()}년 ${targetDate.getMonth() + 1}월`;

      simResultBox.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <span>월 저축+추가수입 <strong class="text-indigo-300">${formatKoreanCurrency(baseMonthly + simDeltaIncome)}</strong> 기준:</span>
          <span class="font-bold text-amber-300 text-sm">약 ${boostedMonths}개월 (${ym} 달성 예상)</span>
        </div>
        ${simDeltaIncome > 0 && savedMonths > 0 ? `<div class="mt-1 text-emerald-300 font-semibold">✨ 추가 수입 ${formatKoreanCurrency(simDeltaIncome)}으로 꿈이 <strong>${savedMonths}개월</strong> 더 앞당겨집니다!</div>` : ''}
      `;
    }
  }
}

function onPlannerBudgetInput(dreamId, value) {
  const num = value ? Math.max(0, parseInt(value, 10) || 0) : 0;
  if (!plannerDraftBudgets[dreamId]) plannerDraftBudgets[dreamId] = { estimated_budget: 0, savedAmount: 0, budget_notes: "" };
  plannerDraftBudgets[dreamId].estimated_budget = num;
  const label = document.getElementById(`planner-korean-${dreamId}`);
  if (label) label.textContent = formatKoreanCurrency(num);
  updatePlannerTotalPreview();
}

function onPlannerSavedInput(dreamId, value) {
  const num = value ? Math.max(0, parseInt(value, 10) || 0) : 0;
  if (!plannerDraftBudgets[dreamId]) plannerDraftBudgets[dreamId] = { estimated_budget: 0, savedAmount: 0, budget_notes: "" };
  plannerDraftBudgets[dreamId].savedAmount = num;
  const label = document.getElementById(`planner-saved-korean-${dreamId}`);
  if (label) label.textContent = formatKoreanCurrency(num);
  updatePlannerTotalPreview();
}

function onPlannerNotesInput(dreamId, value) {
  if (!plannerDraftBudgets[dreamId]) plannerDraftBudgets[dreamId] = { estimated_budget: 0, savedAmount: 0, budget_notes: "" };
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
    if (d.is_completed) return false;
    if (plannerYearFilter !== "ALL" && (d.targetYearBucket || "1Y") !== plannerYearFilter) return false;
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
        해당 조건의 미완료 꿈 항목이 없습니다! ✨
      </div>
    `;
    return;
  }

  const catLabels = {
    DO: { label: "🏃 하고 싶은 것", cls: "bg-indigo-950 text-indigo-300 border-indigo-800" },
    HAVE: { label: "💎 갖고 싶은 것", cls: "bg-purple-950 text-purple-300 border-purple-800" },
    GIVE: { label: "💝 해주고 싶은 것", cls: "bg-rose-950 text-rose-300 border-rose-800" },
    GO: { label: "✈️ 가고 싶은 곳", cls: "bg-emerald-950 text-emerald-300 border-emerald-800" },
    BE: { label: "🌟 되고 싶은 사람", cls: "bg-pink-950 text-pink-300 border-pink-800" }
  };

  budgetListContainer.innerHTML = list.map(d => {
    const cat = catLabels[d.category] || catLabels.DO;
    const draft = plannerDraftBudgets[d.id] || { estimated_budget: d.estimated_budget || 0, savedAmount: d.savedAmount || 0, budget_notes: d.budget_notes || "" };
    const safeTitle = d.title.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const valStr = draft.estimated_budget > 0 ? draft.estimated_budget : "";
    const savedStr = draft.savedAmount > 0 ? draft.savedAmount : "";

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

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-[11px] text-slate-400">목표 예산 (원)</span>
              <span id="planner-korean-${d.id}" class="text-[11px] font-bold text-amber-300">${formatKoreanCurrency(draft.estimated_budget)}</span>
            </div>
            <input type="number" min="0" step="10000" value="${valStr}" placeholder="예: 1500000"
              oninput="window.onPlannerBudgetInput('${d.id}', this.value)"
              class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-amber-500 outline-none text-base sm:text-sm text-white" />
          </div>
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-[11px] text-slate-400">현재 준비됨 (원)</span>
              <span id="planner-saved-korean-${d.id}" class="text-[11px] font-bold text-emerald-300">${formatKoreanCurrency(draft.savedAmount)}</span>
            </div>
            <input type="number" min="0" step="10000" value="${savedStr}" placeholder="예: 300000"
              oninput="window.onPlannerSavedInput('${d.id}', this.value)"
              class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500 outline-none text-base sm:text-sm text-white" />
          </div>
          <div>
            <div class="mb-1">
              <span class="text-[11px] text-slate-400">예산 메모 / 자금 계획</span>
            </div>
            <input type="text" value="${(draft.budget_notes || '').replace(/"/g, '&quot;')}" placeholder="예: 매월 50만 적립"
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
    const newSaved = parseInt(draft.savedAmount, 10) || 0;
    const newNotes = (draft.budget_notes || "").trim();
    if (newBudget !== (d.estimated_budget || 0) || newSaved !== (d.savedAmount || 0) || newNotes !== (d.budget_notes || "")) {
      const updated = {
        ...d,
        estimated_budget: newBudget,
        savedAmount: newSaved,
        budget_notes: newNotes,
        updated_at: new Date().toISOString()
      };
      changedDreams.push(updated);
      return updated;
    }
    return d;
  });

  saveDreamsLocally();
  saveUserProfile({ monthlySavingCapacity: userProfileData.monthlySavingCapacity });
  updateCounts();
  renderDreams();
  closeBudgetPlannerModal();
  showToast("모든 꿈의 예산과 준비 금액이 저장되었습니다! 💰✨");

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
    profile: userProfileData,
    dreams,
    dream100List,
    fiscalPlans: fiscalPlansMap,
    coreLogs: coreLogsMap
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

// --- Stage 2: My Why, Streak, Dream 100, AI Refine, Future Diary ---

const PROFILE_STORAGE_KEY = "my_dream_board_profile";
const DREAM100_STORAGE_KEY = "my_dream_100_list";

const INSPIRATION_QUESTIONS = {
  DO: [
    "돈과 시간이 충분하다면 이번 달에 가장 먼저 하고 싶은 것은?",
    "평생 한 번은 꼭 도전해보고 싶은 버킷리스트 경험은?",
    "매주 루틴으로 즐기고 싶은 나만의 취미 생활은?"
  ],
  HAVE: [
    "매일 아침 눈을 뜰 때 나를 미소 짓게 만드는 공간이나 물건은?",
    "내 삶의 질과 건강을 한 단계 높여줄 아이템은?",
    "온전히 내 힘으로 소유하고 싶은 드림카나 드림하우스는?"
  ],
  GIVE: [
    "사랑하는 부모님이나 가족에게 가장 먼저 선물하고 싶은 것은?",
    "경제적 여유가 생겼을 때 조용히 돕고 싶은 사람이나 단체는?",
    "소중한 사람들과 함께 누리고 싶은 특별한 기억은?"
  ],
  GO: [
    "사랑하는 사람들과 일주일 이상 머물며 쉬고 싶은 여행지는?",
    "계절마다 한 번씩 꼭 찾아가고 싶은 나만의 안식처는?",
    "내 영감을 깨워줄 세계의 명소나 도시는?"
  ],
  BE: [
    "3년 뒤 나는 어떤 에너지와 표정을 가진 사람으로 기억되고 싶나요?",
    "주변 사람들에게 어떤 선한 영향력을 주는 리더가 되고 싶나요?",
    "내가 가장 존경하는 나 자신의 모습은 어떤 모습인가요?"
  ]
};

function loadLocalUserProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      userProfileData = { ...userProfileData, ...JSON.parse(raw) };
    }
    const raw100 = localStorage.getItem(DREAM100_STORAGE_KEY);
    if (raw100) {
      dream100List = JSON.parse(raw100) || [];
    }
  } catch {}
  renderMyWhyBanner();
  updateStreakUI();
  applyPinPlannerVisibility();
  loadPlannerDataLocal();
}

async function loadUserProfile(uid) {
  loadLocalUserProfile();
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      userProfileData = { ...userProfileData, ...snap.data() };
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(userProfileData));
      renderMyWhyBanner();
      updateStreakUI();
      applyPinPlannerVisibility();
    }
    await loadPlannerDataFromFirestore(uid);
  } catch {}
}

async function saveUserProfile(partial) {
  userProfileData = { ...userProfileData, ...partial, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(userProfileData));
  } catch {}
  renderMyWhyBanner();
  updateStreakUI();
  if (currentUser) {
    try {
      await setDoc(doc(db, "users", currentUser.uid), userProfileData, { merge: true });
    } catch {}
  }
}

function renderMyWhyBanner() {
  if (!myWhyList) return;
  const whys = Array.isArray(userProfileData.myWhy) && userProfileData.myWhy.length > 0
    ? userProfileData.myWhy
    : ["나의 첫 번째 Why를 적어보세요"];
  myWhyList.innerHTML = whys.slice(0, 3).map((txt, idx) => `
    <div class="p-2.5 rounded-xl bg-slate-900/70 border border-purple-500/20 flex items-start space-x-2">
      <span class="w-5 h-5 rounded-full bg-purple-600/40 text-purple-200 text-[10px] font-bold flex items-center justify-center shrink-0">${idx + 1}</span>
      <span class="leading-snug text-slate-200">${txt || "아직 작성되지 않음"}</span>
    </div>
  `).join("");
}

function openWhyModal() {
  const whys = userProfileData.myWhy || [];
  document.getElementById("why-input-1").value = whys[0] || "";
  document.getElementById("why-input-2").value = whys[1] || "";
  document.getElementById("why-input-3").value = whys[2] || "";
  modalWhy.classList.remove("hidden");
}

async function handleWhyFormSubmit(e) {
  e.preventDefault();
  const w1 = document.getElementById("why-input-1").value.trim();
  const w2 = document.getElementById("why-input-2").value.trim();
  const w3 = document.getElementById("why-input-3").value.trim();
  const list = [w1, w2, w3].filter(Boolean);
  await saveUserProfile({ myWhy: list.length > 0 ? list : ["나의 꿈을 이루기 위해"] });
  modalWhy.classList.add("hidden");
  showToast("나의 핵심 Why 3가지가 저장되었습니다! ✨");
}

function updateStreakUI() {
  const count = userProfileData.visualizationStreak?.count || 0;
  if (streakCountText) streakCountText.textContent = `${count}일 연속`;
  if (streakCountMobile) streakCountMobile.textContent = `${count}일`;
}

async function checkinVisualizationStreak() {
  const today = new Date().toISOString().split("T")[0];
  const prev = userProfileData.visualizationStreak || { count: 0, lastCheckedDate: "" };
  if (prev.lastCheckedDate === today) {
    showToast(`오늘도 이미 시각화 체크인을 완료하셨습니다! (🔥 ${prev.count}일 연속)`);
    return;
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const nextCount = prev.lastCheckedDate === yesterday ? prev.count + 1 : 1;
  await saveUserProfile({
    visualizationStreak: { count: nextCount, lastCheckedDate: today }
  });
  if (window.confetti) window.confetti({ particleCount: 70, spread: 60, origin: { y: 0.7 } });
  showToast(`오늘의 시각화 완료! 🔥 ${nextCount}일 연속 기록 중!`);
}

function renderInspirationChips(cat) {
  if (!inspirationChips) return;
  const qs = INSPIRATION_QUESTIONS[cat] || INSPIRATION_QUESTIONS.DO;
  inspirationChips.innerHTML = qs.map(q => {
    const safeQ = q.replace(/'/g, "\\'");
    return `<button type="button" onclick="window.applyInspirationChip('${safeQ}')" class="whitespace-nowrap px-3 py-1.5 rounded-full bg-indigo-950/60 hover:bg-indigo-900 border border-indigo-500/30 text-[11px] text-indigo-200 transition shrink-0">${q}</button>`;
  }).join("");
}

function applyInspirationChip(questionText) {
  const whyInput = document.getElementById("form-why-note");
  if (whyInput && !whyInput.value.trim()) {
    whyInput.value = questionText;
  }
  document.getElementById("form-title")?.focus();
  showToast("질문을 떠올리며 자유롭게 꿈을 적어보세요! ✨");
}

async function handleAiRefine() {
  const titleEl = document.getElementById("form-title");
  const descEl = document.getElementById("form-vivid-desc");
  const affEl = document.getElementById("form-affirmation");
  const title = titleEl.value.trim();
  const note = descEl.value.trim() || document.getElementById("form-why-note").value.trim();
  const category = document.querySelector('input[name="form-cat"]:checked')?.value || "DO";

  if (!title) {
    alert("먼저 소망 제목을 간단히 입력해 주세요!");
    titleEl.focus();
    return;
  }

  const origHtml = btnAiRefine.innerHTML;
  btnAiRefine.disabled = true;
  btnAiRefine.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>다듬는 중...</span>`;

  try {
    if (currentUser && navigator.onLine) {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/refine-dream", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ mode: "refine", title, note, category })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.vivid_description) descEl.value = data.vivid_description;
        if (data.affirmation) affEl.value = data.affirmation;
        showToast("Gemini Pro가 생생한 묘사와 확언을 다듬었습니다! ✨");
        return;
      }
    }
    // Warm local fallback when guest/offline
    descEl.value = `나는 지금 '${title}'을(를) 온전히 이루었다. 눈앞에 펼쳐진 생생한 풍경과 따뜻한 공기를 느끼며 가슴 벅찬 감사와 자유로움을 만끽하고 있다.`;
    affEl.value = `나는 이미 '${title}'을(를) 기쁘고 여유롭게 누리고 있다.`;
    showToast("생생한 현재형 묘사와 확언이 채워졌습니다! ✨");
  } catch {
    showToast("AI 다듬기 중 잠시 오류가 발생했습니다.");
  } finally {
    btnAiRefine.disabled = false;
    btnAiRefine.innerHTML = origHtml;
  }
}

// Dream 100 Quick Discovery
function openDream100Modal() {
  loadLocalUserProfile();
  renderDream100List();
  modalDream100.classList.remove("hidden");
}

function saveDream100Locally() {
  try {
    localStorage.setItem(DREAM100_STORAGE_KEY, JSON.stringify(dream100List));
  } catch {}
}

function handleDream100Add(e) {
  e.preventDefault();
  const title = dream100Input.value.trim();
  if (!title) return;
  dream100List.unshift({
    id: "d100-" + Date.now(),
    category: dream100Cat.value || "DO",
    title,
    promoted: false
  });
  dream100Input.value = "";
  saveDream100Locally();
  renderDream100List();
}

function renderDream100List() {
  if (!dream100ListEl) return;
  if (dream100Counter) dream100Counter.textContent = `${dream100List.length} / 100`;

  if (dream100List.length === 0) {
    dream100ListEl.innerHTML = `<div class="text-center py-8 text-xs text-slate-400">아직 적은 꿈이 없습니다. 마음 가는 대로 한 줄씩 적어보세요!</div>`;
    return;
  }

  const icons = { DO: "🏃", HAVE: "💎", GIVE: "💝", GO: "✈️", BE: "🌟" };
  dream100ListEl.innerHTML = dream100List.map((item, idx) => `
    <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
      <div class="flex items-center space-x-2 min-w-0">
        <span class="text-sm shrink-0">${icons[item.category] || "✨"}</span>
        <span class="text-xs sm:text-sm text-slate-200 truncate ${item.promoted ? 'line-through text-slate-500' : ''}">${item.title}</span>
      </div>
      <div class="flex items-center space-x-1.5 shrink-0">
        ${item.promoted
          ? `<span class="px-2 py-1 rounded-lg bg-emerald-950/60 text-emerald-300 text-[10px] font-bold">승격됨</span>`
          : `<button type="button" onclick="window.promoteDream100Item(${idx})" class="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold transition">✨ 카드 승격</button>`
        }
        <button type="button" onclick="window.deleteDream100Item(${idx})" class="p-1.5 text-slate-500 hover:text-rose-400 text-xs">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </div>
    </div>
  `).join("");
}

async function promoteDream100Item(idx) {
  const item = dream100List[idx];
  if (!item) return;
  const newDream = normalizeDream({
    id: "dream-" + Date.now(),
    category: item.category || "DO",
    title: item.title,
    targetYearBucket: "1Y",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  dreams.unshift(newDream);
  item.promoted = true;
  saveDreamsLocally();
  saveDream100Locally();
  updateCounts();
  renderDreams();
  renderDream100List();
  showToast(`'${item.title}'이(가) 정식 꿈 카드로 승격되었습니다! ✨`);

  if (currentUser) {
    try {
      await setDoc(doc(db, "users", currentUser.uid, "dreams", newDream.id), newDream);
    } catch {}
  }
}

function deleteDream100Item(idx) {
  dream100List.splice(idx, 1);
  saveDream100Locally();
  renderDream100List();
}

// Future Diary & Main View Switcher
function switchMainView(viewName) {
  sectionDreamBoard?.classList.add("hidden");
  sectionFutureDiary?.classList.add("hidden");
  sectionPlanner?.classList.add("hidden");

  if (viewName === "diary") {
    headerSubbar?.classList.add("hidden");
    sectionFutureDiary?.classList.remove("hidden");
    renderFutureDiaryList();
  } else if (viewName === "planner") {
    headerSubbar?.classList.add("hidden");
    sectionPlanner?.classList.remove("hidden");
    initPlannerView();
  } else {
    headerSubbar?.classList.remove("hidden");
    sectionDreamBoard?.classList.remove("hidden");
  }
  mobileNavBtns.forEach(btn => {
    const active = btn.dataset.nav === viewName;
    btn.classList.toggle("text-purple-400", active);
    btn.classList.toggle("text-slate-400", !active);
  });
}

function renderFutureDiaryList() {
  if (!futureDiaryList) return;
  const diaryDreams = dreams.filter(d => d.futureDiary && d.futureDiary.content);
  if (diaryDreams.length === 0) {
    futureDiaryList.innerHTML = `
      <div class="col-span-full text-center py-16 px-4 glass-panel rounded-2xl border border-slate-800">
        <i class="fa-solid fa-book-open text-3xl text-emerald-400/60 mb-3"></i>
        <p class="text-sm font-bold text-slate-300">아직 작성된 미래 일기가 없습니다</p>
        <p class="text-xs text-slate-500 mt-1">꿈이 이미 이루어진 미래의 하루를 현재형으로 먼저 살아보세요.</p>
      </div>
    `;
    return;
  }

  futureDiaryList.innerHTML = diaryDreams.map(d => `
    <div class="glass-panel rounded-2xl p-5 border border-emerald-500/25 space-y-3">
      <div class="flex items-center justify-between">
        <span class="px-2.5 py-1 rounded-lg bg-emerald-950/70 text-emerald-300 border border-emerald-700/50 text-xs font-bold">
          📅 ${d.futureDiary.date || '미래의 어느 날'} · ${d.futureDiary.weather || '맑음'}
        </span>
        <button onclick="window.openDiaryModal('${d.id}')" class="text-xs text-slate-400 hover:text-white">
          <i class="fa-regular fa-pen-to-square"></i> 수정
        </button>
      </div>
      <h3 class="text-base font-bold text-white">✨ ${d.title}</h3>
      <p class="text-xs sm:text-sm text-slate-300 leading-relaxed whitespace-pre-line">${d.futureDiary.content}</p>
    </div>
  `).join("");
}

function openDiaryModal(dreamId = null) {
  if (dreams.length === 0) {
    alert("먼저 연결할 꿈을 1개 이상 등록해 주세요!");
    return;
  }
  const select = document.getElementById("diary-dream-select");
  select.innerHTML = dreams.map(d => `<option value="${d.id}">${d.title}</option>`).join("");
  if (dreamId) select.value = dreamId;

  const target = dreams.find(d => d.id === select.value) || dreams[0];
  document.getElementById("diary-date").value = target.futureDiary?.date || new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0];
  document.getElementById("diary-weather").value = target.futureDiary?.weather || "맑음";
  document.getElementById("diary-content").value = target.futureDiary?.content || "";
  modalFutureDiary.classList.remove("hidden");
}

async function handleDiaryFormSubmit(e) {
  e.preventDefault();
  const dreamId = document.getElementById("diary-dream-select").value;
  const d = dreams.find(item => item.id === dreamId);
  if (!d) return;

  d.futureDiary = {
    date: document.getElementById("diary-date").value,
    weather: document.getElementById("diary-weather").value.trim() || "맑음",
    content: document.getElementById("diary-content").value.trim()
  };
  d.updated_at = new Date().toISOString();

  saveDreamsLocally();
  renderFutureDiaryList();
  modalFutureDiary.classList.add("hidden");
  showToast("미래 일기가 소중하게 기록되었습니다! 📖✨");

  if (currentUser) {
    try {
      await setDoc(doc(db, "users", currentUser.uid, "dreams", d.id), d, { merge: true });
    } catch {}
  }
}

// --- Stage 3: Optional Business Planner Module (PIN Roadmap, Fiscal Year Plan, Weekly 10-Core) ---

const PF_STORAGE_KEY = "my_dream_board_fiscal_plans";
const CORE10_STORAGE_KEY = "my_dream_board_core_logs";
const PF_MONTHS = ["09", "10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08"];

const PIN_PRESETS = [
  { pin: "브론즈 파운데이션 / 9~15%", monthly: 500000, annualBonus: 0, desc: "3레그 이상 3%~6% 균형 구축" },
  { pin: "브론즈 빌더 / 15~18%", monthly: 1200000, annualBonus: 0, desc: "3레그 6% 이상 안정 성장" },
  { pin: "SP (21%)", monthly: 2500000, annualBonus: 0, desc: "1,000만 PV 달성 (월간 21% 보너스)" },
  { pin: "GP (골드 프로듀서)", monthly: 2800000, annualBonus: 1500000, desc: "회계연도 내 21% 3개월 달성" },
  { pin: "PT (플래티늄)", monthly: 3200000, annualBonus: 3500000, desc: "21% 6개월 달성 (리더십 정착)" },
  { pin: "Founders PT", monthly: 3800000, annualBonus: 7000000, desc: "21% 12개월 달성 (연간 인센티브)" },
  { pin: "Sapphire (사파이어)", monthly: 5500000, annualBonus: 12000000, desc: "2개 Q레그 + 사이드 볼륨" },
  { pin: "Founders Sapphire", monthly: 7000000, annualBonus: 20000000, desc: "2개 Q레그 12개월 유지" },
  { pin: "Emerald (에메랄드)", monthly: 9500000, annualBonus: 35000000, desc: "3개 Q레그 6개월 이상 달성" },
  { pin: "Founders Emerald", monthly: 12000000, annualBonus: 55000000, desc: "3개 Q레그 12개월 달성" },
  { pin: "Diamond (다이아몬드)", monthly: 18000000, annualBonus: 90000000, desc: "6개 Q레그 6개월 이상 달성" },
  { pin: "Founders Diamond", monthly: 25000000, annualBonus: 150000000, desc: "6개 Q레그 12개월 달성" }
];

function applyPinPlannerVisibility() {
  const enabled = Boolean(userProfileData.enablePinPlanner);
  if (togglePinPlanner) togglePinPlanner.checked = enabled;
  if (btnNavPlannerTop) {
    btnNavPlannerTop.classList.toggle("hidden", !enabled);
    btnNavPlannerTop.classList.toggle("md:flex", enabled);
  }
  if (btnNavPlannerMobile) {
    btnNavPlannerMobile.classList.toggle("hidden", !enabled);
  }
}

function getCurrentFiscalYearNum() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // Amway Fiscal Year starts in September (Month 9 -> PF of year+1)
  const pfYear = month >= 9 ? year + 1 : year;
  return pfYear % 100;
}

function getCurrentFiscalYearCode() {
  return `PF${String(getCurrentFiscalYearNum()).padStart(2, "0")}`;
}

function getFiscalYearRangeLabel(pfCode) {
  const num = parseInt(String(pfCode).replace(/\D/g, ""), 10);
  if (isNaN(num)) return pfCode;
  const endYear = 2000 + num;
  const startYear = endYear - 1;
  return `${pfCode} (${startYear}.09 ~ ${endYear}.08)`;
}

function createEmptyFiscalPlan(pfCode) {
  const curNum = getCurrentFiscalYearNum();
  const num = parseInt(String(pfCode).replace(/\D/g, ""), 10) || curNum;
  const diff = Math.max(0, Math.min(2, num - curNum));
  const yearBucket = diff === 0 ? "1Y" : (diff === 1 ? "2Y" : "3Y");
  const monthlyPlan = {};
  PF_MONTHS.forEach(m => {
    monthlyPlan[m] = { legsPv: [0, 0, 0, 0, 0, 0, 0, 0], sidePv: 0, qLegs: 0, estIncome: 0 };
  });
  return {
    fiscalYear: pfCode,
    yearBucket,
    targetPin: "PT (플래티늄)",
    expectedMonthlyIncome: 3200000,
    expectedAnnualBonus: 3500000,
    monthlyPlan,
    memo: "",
    updatedAt: new Date().toISOString()
  };
}

function loadPlannerDataLocal() {
  try {
    const rawPf = localStorage.getItem(PF_STORAGE_KEY);
    if (rawPf) fiscalPlansMap = JSON.parse(rawPf) || {};
    const rawCore = localStorage.getItem(CORE10_STORAGE_KEY);
    if (rawCore) coreLogsMap = JSON.parse(rawCore) || {};
  } catch {}
}

function savePlannerDataLocal() {
  try {
    localStorage.setItem(PF_STORAGE_KEY, JSON.stringify(fiscalPlansMap));
    localStorage.setItem(CORE10_STORAGE_KEY, JSON.stringify(coreLogsMap));
  } catch {}
}

async function loadPlannerDataFromFirestore(uid) {
  try {
    const pfSnap = await getDocs(collection(db, "users", uid, "fiscalPlans"));
    pfSnap.forEach(docSnap => {
      fiscalPlansMap[docSnap.id] = docSnap.data();
    });
    const coreSnap = await getDocs(collection(db, "users", uid, "coreLogs"));
    coreSnap.forEach(docSnap => {
      coreLogsMap[docSnap.id] = docSnap.data();
    });
    savePlannerDataLocal();
  } catch {}
}

function getCurrentIsoWeek() {
  const d = new Date();
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function initPlannerView() {
  if (!currentPfCode) {
    currentPfCode = getCurrentFiscalYearCode();
  }
  renderFiscalYearOptions();
  renderPinSelectOptions();
  renderFiscalPlanner();

  if (core10WeekInput && !core10WeekInput.value) {
    core10WeekInput.value = getCurrentIsoWeek();
  }
  renderCore10Form();
  renderCore10History();
}

function renderFiscalYearOptions() {
  if (!pfSelect) return;
  const curNum = getCurrentFiscalYearNum();
  const codeSet = new Set();
  // Include past 3 years, current year, and future 3 years + any saved PF
  for (let y = curNum - 3; y <= curNum + 3; y++) {
    codeSet.add(`PF${String(y).padStart(2, "0")}`);
  }
  Object.keys(fiscalPlansMap).forEach(k => codeSet.add(k));

  const sortedCodes = Array.from(codeSet).sort();
  pfSelect.innerHTML = sortedCodes.map(code => {
    const num = parseInt(code.replace(/\D/g, ""), 10);
    let tag = "";
    if (num < curNum) tag = " [지난 회계연도]";
    else if (num === curNum) tag = " [현재 진행 중]";
    else tag = " [미래 계획]";
    const savedMark = fiscalPlansMap[code] ? " ✓" : "";
    return `<option value="${code}">${getFiscalYearRangeLabel(code)}${tag}${savedMark}</option>`;
  }).join("");
  pfSelect.value = currentPfCode;
}

function renderPinSelectOptions() {
  if (!pfPinSelect) return;
  pfPinSelect.innerHTML = PIN_PRESETS.map(p => `<option value="${p.pin}">${p.pin}</option>`).join("");
}

function getOrCreatePfDraft(pfCode) {
  if (!fiscalPlansMap[pfCode]) {
    fiscalPlansMap[pfCode] = createEmptyFiscalPlan(pfCode);
  }
  return fiscalPlansMap[pfCode];
}

function updateCurrentPfDraftFromHeader() {
  const plan = getOrCreatePfDraft(currentPfCode);
  if (pfPinSelect) plan.targetPin = pfPinSelect.value;
  if (pfYearBucket) plan.yearBucket = pfYearBucket.value;
  if (pfMonthlyIncome) plan.expectedMonthlyIncome = Math.max(0, parseInt(pfMonthlyIncome.value, 10) || 0);
  if (pfAnnualBonus) plan.expectedAnnualBonus = Math.max(0, parseInt(pfAnnualBonus.value, 10) || 0);
}

function renderPfIncomeSummary() {
  const plan = getOrCreatePfDraft(currentPfCode);
  let monthlySum = 0;
  PF_MONTHS.forEach(m => {
    monthlySum += parseInt(plan.monthlyPlan?.[m]?.estIncome || 0, 10) || 0;
  });
  const baseAnnual = monthlySum > 0 ? monthlySum : (plan.expectedMonthlyIncome || 0) * 12;
  const totalEstAnnual = baseAnnual + (plan.expectedAnnualBonus || 0);

  const bucketDreams = dreams.filter(d => !d.is_completed && (d.targetYearBucket || "1Y") === (plan.yearBucket || "1Y"));
  const bucketBudget = bucketDreams.reduce((sum, d) => sum + Math.max(0, (d.estimated_budget || 0) - (d.savedAmount || 0)), 0);

  if (pfIncomeSummary) {
    pfIncomeSummary.innerHTML = `
      <span>예상 연간 총수입: <strong class="text-amber-300">${formatKoreanCurrency(totalEstAnnual)}</strong></span>
      <span class="mx-2 text-slate-600">|</span>
      <span>연결된 ${plan.yearBucket} 꿈 잔여예산: <strong class="text-purple-300">${formatKoreanCurrency(bucketBudget)}</strong> (${bucketDreams.length}건)</span>
    `;
  }

  if (pfLinkedDreamsStrip) {
    if (bucketDreams.length === 0) {
      pfLinkedDreamsStrip.innerHTML = `<span class="text-slate-500 text-[11px]">연결된 꿈 없음</span>`;
    } else {
      pfLinkedDreamsStrip.innerHTML = bucketDreams.slice(0, 5).map(d => {
        const thumb = d.primary_media && d.primary_media.media_type !== "video"
          ? `<img src="${d.primary_media.url}" class="w-6 h-6 rounded object-cover" />`
          : `<span class="w-6 h-6 rounded bg-purple-900/60 flex items-center justify-center text-[10px]">✨</span>`;
        return `<div class="flex items-center space-x-1.5 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 shrink-0">${thumb}<span class="text-[11px] text-slate-200 max-w-[90px] truncate">${d.title}</span></div>`;
      }).join("");
    }
  }
}

function renderFiscalPlanner() {
  const plan = getOrCreatePfDraft(currentPfCode);
  const curNum = getCurrentFiscalYearNum();
  const num = parseInt(currentPfCode.replace(/\D/g, ""), 10);

  if (pfStatusBadge) {
    if (num < curNum) {
      pfStatusBadge.textContent = "지난 회계연도 (아카이브)";
      pfStatusBadge.className = "px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-600";
    } else if (num === curNum) {
      pfStatusBadge.textContent = "현재 진행 중";
      pfStatusBadge.className = "px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/50";
    } else {
      pfStatusBadge.textContent = "예정된 미래 계획";
      pfStatusBadge.className = "px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/50";
    }
  }

  if (pfPinSelect) pfPinSelect.value = plan.targetPin || "PT (플래티늄)";
  if (pfYearBucket) pfYearBucket.value = plan.yearBucket || "1Y";
  if (pfMonthlyIncome) pfMonthlyIncome.value = plan.expectedMonthlyIncome || 0;
  if (pfAnnualBonus) pfAnnualBonus.value = plan.expectedAnnualBonus || 0;

  renderPfIncomeSummary();

  if (!pfMonthsGrid) return;
  pfMonthsGrid.innerHTML = PF_MONTHS.map(m => {
    const mData = plan.monthlyPlan?.[m] || { legsPv: [0, 0, 0, 0, 0, 0, 0, 0], sidePv: 0, qLegs: 0, estIncome: 0 };
    const legs = Array.isArray(mData.legsPv) ? mData.legsPv : [0, 0, 0, 0, 0, 0, 0, 0];
    const legsInputs = [0, 1, 2, 3, 4, 5, 6, 7].map(idx => `
      <div class="flex items-center justify-between gap-1">
        <span class="text-[10px] text-slate-500 w-7">${idx + 1}레그</span>
        <input type="number" min="0" value="${legs[idx] || ''}" placeholder="0"
          oninput="window.onPfMonthLegInput('${m}', ${idx}, this.value)"
          class="w-16 px-1.5 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-right text-white outline-none focus:border-amber-500" />
      </div>
    `).join("");

    return `
      <div class="w-40 shrink-0 p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
        <div class="text-xs font-extrabold text-amber-300 text-center pb-1 border-b border-slate-800">${parseInt(m, 10)}월</div>
        <div class="space-y-1">${legsInputs}</div>
        <div class="pt-1.5 border-t border-slate-800 space-y-1">
          <div class="flex items-center justify-between gap-1">
            <span class="text-[10px] text-indigo-300">Q레그</span>
            <input type="number" min="0" max="20" value="${mData.qLegs || ''}" placeholder="0"
              oninput="window.onPfMonthFieldInput('${m}', 'qLegs', this.value)"
              class="w-16 px-1.5 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-right text-indigo-200 outline-none" />
          </div>
          <div class="flex items-center justify-between gap-1">
            <span class="text-[10px] text-slate-400">SIDE</span>
            <input type="number" min="0" value="${mData.sidePv || ''}" placeholder="0"
              oninput="window.onPfMonthFieldInput('${m}', 'sidePv', this.value)"
              class="w-16 px-1.5 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-right text-white outline-none" />
          </div>
          <div>
            <span class="text-[10px] text-emerald-300 block mb-0.5">예상 월수입(원)</span>
            <input type="number" min="0" step="100000" value="${mData.estIncome || ''}" placeholder="0"
              oninput="window.onPfMonthFieldInput('${m}', 'estIncome', this.value)"
              class="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-right text-emerald-300 font-bold outline-none" />
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function onPfMonthLegInput(month, legIdx, val) {
  const plan = getOrCreatePfDraft(currentPfCode);
  if (!plan.monthlyPlan) plan.monthlyPlan = {};
  if (!plan.monthlyPlan[month]) plan.monthlyPlan[month] = { legsPv: [0, 0, 0, 0, 0, 0, 0, 0], sidePv: 0, qLegs: 0, estIncome: 0 };
  if (!Array.isArray(plan.monthlyPlan[month].legsPv)) plan.monthlyPlan[month].legsPv = [0, 0, 0, 0, 0, 0, 0, 0];
  plan.monthlyPlan[month].legsPv[legIdx] = Math.max(0, parseInt(val, 10) || 0);
}

function onPfMonthFieldInput(month, field, val) {
  const plan = getOrCreatePfDraft(currentPfCode);
  if (!plan.monthlyPlan) plan.monthlyPlan = {};
  if (!plan.monthlyPlan[month]) plan.monthlyPlan[month] = { legsPv: [0, 0, 0, 0, 0, 0, 0, 0], sidePv: 0, qLegs: 0, estIncome: 0 };
  plan.monthlyPlan[month][field] = Math.max(0, parseInt(val, 10) || 0);
  if (field === "estIncome") renderPfIncomeSummary();
}

async function saveCurrentFiscalPlan() {
  updateCurrentPfDraftFromHeader();
  const plan = getOrCreatePfDraft(currentPfCode);
  plan.updatedAt = new Date().toISOString();
  fiscalPlansMap[currentPfCode] = plan;
  savePlannerDataLocal();
  renderFiscalYearOptions();
  showToast(`${currentPfCode} 회계연도 플랜이 저장되었습니다! 📅✨`);

  if (currentUser) {
    try {
      await setDoc(doc(db, "users", currentUser.uid, "fiscalPlans", currentPfCode), plan, { merge: true });
    } catch {}
  }
}

async function rolloverFiscalPlan() {
  const num = parseInt(currentPfCode.replace(/\D/g, ""), 10) || getCurrentFiscalYearNum();
  const nextPfCode = `PF${String(num + 1).padStart(2, "0")}`;
  if (!confirm(`현재 ${currentPfCode} 계획을 다음 회계연도(${nextPfCode})로 복사/이월하시겠습니까?`)) return;

  const source = JSON.parse(JSON.stringify(getOrCreatePfDraft(currentPfCode)));
  source.fiscalYear = nextPfCode;
  source.updatedAt = new Date().toISOString();
  fiscalPlansMap[nextPfCode] = source;
  currentPfCode = nextPfCode;
  savePlannerDataLocal();
  renderFiscalYearOptions();
  renderFiscalPlanner();
  showToast(`${nextPfCode} 회계연도로 플랜이 유연하게 이월되었습니다! 🚀`);

  if (currentUser) {
    try {
      await setDoc(doc(db, "users", currentUser.uid, "fiscalPlans", nextPfCode), source, { merge: true });
    } catch {}
  }
}

// Weekly 10-Core Note
function renderCore10Form() {
  const weekId = core10WeekInput?.value || getCurrentIsoWeek();
  const existing = coreLogsMap[weekId] || {};
  document.getElementById("core10-gratitude").value = existing.gratitudeAndWhy || "";
  document.getElementById("core10-book").value = existing.bookAndAudioInsight || "";
  document.getElementById("core10-stp").value = existing.stpAndConsumerCount?.stp ?? 0;
  document.getElementById("core10-consumer").value = existing.stpAndConsumerCount?.consumerCare ?? 0;
  document.getElementById("core10-product").value = existing.productStory || "";
  document.getElementById("core10-next").value = existing.nextWeekFocus || "";
}

async function saveCurrentCoreLog() {
  const weekId = core10WeekInput?.value || getCurrentIsoWeek();
  const entry = {
    weekId,
    gratitudeAndWhy: document.getElementById("core10-gratitude").value.trim(),
    bookAndAudioInsight: document.getElementById("core10-book").value.trim(),
    stpAndConsumerCount: {
      stp: Math.max(0, parseInt(document.getElementById("core10-stp").value, 10) || 0),
      consumerCare: Math.max(0, parseInt(document.getElementById("core10-consumer").value, 10) || 0)
    },
    productStory: document.getElementById("core10-product").value.trim(),
    nextWeekFocus: document.getElementById("core10-next").value.trim(),
    createdAt: coreLogsMap[weekId]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  coreLogsMap[weekId] = entry;
  savePlannerDataLocal();
  renderCore10History();
  showToast(`${weekId} 주간 10코아 노트가 저장되었습니다! 📝✨`);

  if (currentUser) {
    try {
      await setDoc(doc(db, "users", currentUser.uid, "coreLogs", weekId), entry, { merge: true });
    } catch {}
  }
}

function renderCore10History() {
  if (!core10HistoryList) return;
  const entries = Object.values(coreLogsMap).sort((a, b) => (b.weekId || "").localeCompare(a.weekId || ""));
  if (entries.length === 0) {
    core10HistoryList.innerHTML = `<div class="col-span-full text-center py-6 text-xs text-slate-500">아직 작성된 주간 10코아 노트가 없습니다.</div>`;
    return;
  }

  core10HistoryList.innerHTML = entries.map(log => `
    <div onclick="window.selectCore10Week('${log.weekId}')" class="glass-panel rounded-xl p-4 border border-slate-800 hover:border-indigo-500/40 cursor-pointer space-y-2 transition">
      <div class="flex items-center justify-between">
        <span class="px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700/50 text-xs font-bold">${log.weekId}</span>
        <span class="text-[11px] text-slate-400">STP ${log.stpAndConsumerCount?.stp || 0}회 · 케어 ${log.stpAndConsumerCount?.consumerCare || 0}회</span>
      </div>
      ${log.gratitudeAndWhy ? `<p class="text-xs text-slate-200 line-clamp-2">🙏 ${log.gratitudeAndWhy}</p>` : ''}
      ${log.nextWeekFocus ? `<p class="text-[11px] text-amber-300 line-clamp-1">🎯 ${log.nextWeekFocus}</p>` : ''}
    </div>
  `).join("");
}

function selectCore10Week(weekId) {
  if (core10WeekInput) {
    core10WeekInput.value = weekId;
    renderCore10Form();
  }
}

// PIN Roadmap Timeline & Reference Table
function renderPinTimeline() {
  if (!pinTimelineContainer) return;
  const buckets = [
    { key: "1Y", label: "1년 후 목표" },
    { key: "2Y", label: "2년 후 목표" },
    { key: "3Y", label: "3년 후 목표" }
  ];

  const savedPfs = Object.values(fiscalPlansMap);
  pinTimelineContainer.innerHTML = buckets.map(b => {
    const matchedPf = savedPfs.find(p => p.yearBucket === b.key);
    const bDreams = dreams.filter(d => !d.is_completed && (d.targetYearBucket || "1Y") === b.key);
    const bBudget = bDreams.reduce((s, d) => s + Math.max(0, (d.estimated_budget || 0) - (d.savedAmount || 0)), 0);

    return `
      <div class="glass-panel rounded-2xl p-4 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center space-x-2">
            <span class="px-2.5 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30">${b.label}</span>
            <span class="text-sm font-bold text-white">${matchedPf ? `🏆 ${matchedPf.targetPin} (${matchedPf.fiscalYear})` : '목표 PIN 미연결'}</span>
          </div>
          <p class="text-xs text-slate-400">
            실현 예정 꿈 <strong class="text-purple-300">${bDreams.length}건</strong> · 잔여 필요 예산 <strong class="text-amber-200">${formatKoreanCurrency(bBudget)}</strong>
          </p>
        </div>
        <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          ${bDreams.slice(0, 4).map(d => `<span class="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-200 whitespace-nowrap">${d.title}</span>`).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderPinReferenceTable() {
  if (!pinReferenceTable) return;
  pinReferenceTable.innerHTML = `
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="border-b border-slate-800 text-slate-400">
          <th class="py-2 pr-3">목표 PIN</th>
          <th class="py-2 px-3">참고 월 평균수입</th>
          <th class="py-2 px-3">참고 연간 보너스</th>
          <th class="py-2 pl-3">달성 기준 요약</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-800/60">
        ${PIN_PRESETS.map(p => `
          <tr class="hover:bg-slate-900/50">
            <td class="py-2 pr-3 font-bold text-amber-300 whitespace-nowrap">${p.pin}</td>
            <td class="py-2 px-3 text-slate-200 whitespace-nowrap">${formatKoreanCurrency(p.monthly)}</td>
            <td class="py-2 px-3 text-emerald-300 whitespace-nowrap">${formatKoreanCurrency(p.annualBonus)}</td>
            <td class="py-2 pl-3 text-slate-400">${p.desc}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
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
window.onPlannerSavedInput = onPlannerSavedInput;
window.onPlannerNotesInput = onPlannerNotesInput;
window.openDream100Modal = openDream100Modal;
window.promoteDream100Item = promoteDream100Item;
window.deleteDream100Item = deleteDream100Item;
window.openDiaryModal = openDiaryModal;
window.applyInspirationChip = applyInspirationChip;
window.onPfMonthLegInput = onPfMonthLegInput;
window.onPfMonthFieldInput = onPfMonthFieldInput;
window.selectCore10Week = selectCore10Week;

// Start application
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
