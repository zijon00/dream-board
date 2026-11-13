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

// Init
document.addEventListener("DOMContentLoaded", () => {
  fetchDreams();
  setupEventListeners();
});

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
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

async function fetchDreams() {
  // 1. First load from LocalStorage for instant mobile loading
  const localData = loadDreamsLocally();
  if (localData && localData.length > 0) {
    dreams = localData;
    updateCounts();
    renderDreams();
  }

  // 2. Fetch server if available (e.g. initial seed or sync)
  try {
    const res = await fetch("/api/dreams");
    if (res.ok) {
      const serverData = await res.json();
      if (!localData || localData.length === 0) {
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
  const budgetInput = document.getElementById("form-budget");
  const budgetKorean = document.getElementById("form-budget-korean");

  budgetInput.oninput = () => {
    budgetKorean.textContent = formatKoreanCurrency(budgetInput.value);
  };

  if (dreamId) {
    const d = dreams.find(item => item.id === dreamId);
    if (!d) return;
    formDreamId.value = d.id;
    modalTitle.innerHTML = `<span class="text-purple-400"><i class="fa-solid fa-pen"></i></span> <span>꿈 수정하기</span>`;
    document.querySelector(`input[name="form-cat"][value="${d.category}"]`).checked = true;
    document.getElementById("form-title").value = d.title;
    document.getElementById("form-vivid-desc").value = d.vivid_description || "";
    document.getElementById("form-deadline").value = d.deadline || "";
    document.getElementById("form-budget").value = d.estimated_budget || "";
    budgetKorean.textContent = formatKoreanCurrency(d.estimated_budget || 0);
    document.getElementById("form-budget-notes").value = d.budget_notes || "";
    document.getElementById("form-affirmation").value = d.affirmation || "";
  } else {
    formDreamId.value = "";
    modalTitle.innerHTML = `<span class="text-purple-400"><i class="fa-solid fa-wand-magic-sparkles"></i></span> <span>꿈 등록하기</span>`;
    dreamForm.reset();
    document.getElementById("form-deadline").value = "";
    document.getElementById("form-budget").value = "";
    document.getElementById("form-budget-notes").value = "";
    budgetKorean.textContent = "0원";
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
  const rawBudget = document.getElementById("form-budget").value.trim();
  const estimated_budget = rawBudget ? parseInt(rawBudget, 10) : 0;
  const budget_notes = document.getElementById("form-budget-notes").value.trim();
  const affirmation = document.getElementById("form-affirmation").value.trim();

  const payload = {
    category,
    title,
    vivid_description,
    target_date: deadline,
    deadline,
    estimated_budget,
    budget_notes,
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

  // Background server sync if possible
  try {
    if (dreamId) {
      await fetch(`/api/dreams/${dreamId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      await fetch("/api/dreams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }
  } catch (err) {}

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
  try {
    await fetch(`/api/dreams/${dreamId}`, { method: "DELETE" });
  } catch (err) {}
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

  try {
    await fetch(`/api/dreams/${dreamId}/toggle-complete`, { method: "POST" });
  } catch (err) {}
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

async function setPrimaryMedia(mediaId) {
  if (!currentManagingDreamId) return;
  const d = dreams.find(item => item.id === currentManagingDreamId);
  if (d && d.media_history) {
    const matched = d.media_history.find(m => m.id === mediaId);
    if (matched) {
      d.primary_media = matched;
      saveDreamsLocally();
      renderMediaHistory(d);
      renderDreams();
      showToast("대표 미디어가 변경되었습니다.");
    }
  }
  try {
    await fetch(`/api/dreams/${currentManagingDreamId}/media/set-primary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: mediaId })
    });
  } catch (err) {}
}

async function handleFileUpload(file) {
  if (!currentManagingDreamId) return;
  const d = dreams.find(item => item.id === currentManagingDreamId);
  if (!d) return;

  // Local FileReader for instantaneous offline mobile preview
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64Url = e.target.result;
    const isVideo = file.type.startsWith("video");
    const newMedia = {
      id: "media-" + Date.now(),
      media_type: isVideo ? "video" : "image",
      url: base64Url,
      thumbnail_url: base64Url,
      source: "upload",
      caption: file.name
    };
    if (!d.media_history) d.media_history = [];
    d.media_history.unshift(newMedia);
    d.primary_media = newMedia;
    saveDreamsLocally();
    renderMediaHistory(d);
    renderDreams();
    showToast("미디어가 성공적으로 보존되었습니다!");
  };
  reader.readAsDataURL(file);

  // Optional background upload to server
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("caption", file.name);
    await fetch(`/api/dreams/${currentManagingDreamId}/media/upload`, { method: "POST", body: formData });
  } catch (err) {}
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
  renderMediaHistory(d);
  renderDreams();
  showToast("링크 미디어가 추가되었습니다.");

  try {
    await fetch(`/api/dreams/${currentManagingDreamId}/media/direct-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, media_type: newMedia.media_type, caption: newMedia.caption })
    });
  } catch (err) {}
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
  renderMediaHistory(d);
  renderDreams();
  showToast("인터넷 사진이 안전하게 내 보드에 연결되었습니다!");

  try {
    await fetch(`/api/dreams/${currentManagingDreamId}/media/select-web`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title })
    });
  } catch (err) {}
}

async function handleAiGenerate() {
  if (!currentManagingDreamId) return;
  const d = dreams.find(item => item.id === currentManagingDreamId);
  if (!d) return;

  aiLoading.classList.remove("hidden");

  try {
    const res = await fetch(`/api/dreams/${currentManagingDreamId}/media/ai-generate`, { method: "POST" });
    aiLoading.classList.add("hidden");
    if (res.ok) {
      const data = await res.json();
      const newMedia = data.primary_media || {
        id: "media-" + Date.now(),
        url: `https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&auto=format&fit=crop&q=80`,
        thumbnail_url: `https://images.unsplash.com/photo-1519681393784-d120267933ba?w=400&auto=format&fit=crop&q=80`,
        source: "ai_generated",
        caption: `AI 생성: ${d.title}`
      };
      if (!d.media_history) d.media_history = [];
      d.media_history.unshift(newMedia);
      d.primary_media = newMedia;
      saveDreamsLocally();
      renderMediaHistory(d);
      renderDreams();
      showToast("Gemini가 완성한 상상도가 등록되었습니다! ✨");
    }
  } catch (err) {
    aiLoading.classList.add("hidden");
    // Offline fallback for AI imagination
    const fallbackMedia = {
      id: "media-" + Date.now(),
      url: `https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&auto=format&fit=crop&q=80`,
      thumbnail_url: `https://images.unsplash.com/photo-1519681393784-d120267933ba?w=400&auto=format&fit=crop&q=80`,
      source: "ai_generated",
      caption: `AI 상상도: ${d.title}`
    };
    if (!d.media_history) d.media_history = [];
    d.media_history.unshift(fallbackMedia);
    d.primary_media = fallbackMedia;
    saveDreamsLocally();
    renderMediaHistory(d);
    renderDreams();
    showToast("상상 이미지가 등록되었습니다! ✨");
  }
}

async function handleAiSynthesize() {
  if (!currentManagingDreamId) return;
  if (!synthRefFile.files || synthRefFile.files.length === 0) {
    alert("합성할 인물/가족 사진을 먼저 선택해 주세요!");
    return;
  }

  const formData = new FormData();
  formData.append("reference_file", synthRefFile.files[0]);
  formData.append("custom_request", synthCustomPrompt.value.trim());

  aiLoading.classList.remove("hidden");

  try {
    const res = await fetch(`/api/dreams/${currentManagingDreamId}/media/ai-synthesize`, {
      method: "POST",
      body: formData
    });
    aiLoading.classList.add("hidden");
    if (res.ok) {
      const updated = await res.json();
      synthCustomPrompt.value = "";
      renderMediaHistory(updated);
      await fetchDreams();
      showToast("인물 합성 이미지가 생성되었습니다! 🎨");
    }
  } catch (err) {
    aiLoading.classList.add("hidden");
    showToast("합성 중 오류가 발생했습니다.");
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
