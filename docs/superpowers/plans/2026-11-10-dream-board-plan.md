# 꿈보드 (Dream Board) 웹앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 하고 싶은 것, 갖고 싶은 것, 해주고 싶은 것을 생생하게 등록하고, 내 사진/영상 업로드, 인터넷 고화질 미디어 즉시 검색, Gemini AI 이미지 생성/합성 및 미디어 히스토리 갤러리를 갖춘 로컬 영구 보관형 웹앱을 구현한다.

**Architecture:** Python FastAPI 백엔드가 JSON 데이터베이스 및 로컬 미디어 저장소(`data/dreams.json`, `data/uploads/`)를 관리하고 Gemini API(`google-genai` 최신 SDK) 및 Zero-Config 공개 미디어 검색을 프록시 제공한다. 프론트엔드는 반응형 매거진 그리드 보드, 미디어 탭 피커, 미디어 히스토리 갤러리 썸네일 전환, 풀스크린 시각화 슬라이드쇼(명상 모드)를 제공한다.

**Tech Stack:** Python 3.10+, FastAPI, Uvicorn, `google-genai` SDK, Requests/HTTPX, Pillow, Vanilla JS + Tailwind CSS (CDN).

**Spec:** `C:\Users\zijon\Desktop\gemini-projects\dream-board\docs\superpowers\specs\2026-11-10-dream-board-design.md`

## Global Constraints
- Target root: `C:\Users\zijon\Desktop\gemini-projects\dream-board`
- Data persistence: `data/dreams.json` & `data/uploads/`
- Zero-config image search without external API key registration
- Media history preservation: New uploads or AI generations must append to `media_history` and never delete previous files
- AI Model: Text/Vision prompt optimization with Gemini Pro/Argon (`gemini-4-argon` or `gemini-3.8-flash`), Image generation via `gemini-3-pro-image` or `gemini-nano-banana-2.1` using `google-genai` SDK
- One-click launcher: `run_dream_board.bat`

## Review Focus
1. Non-image media handling: Short mp4/webm uploads and video URL embedding (mute loop preview on cards)
2. Media history rollback: Selecting any thumbnail in `media_history` swaps current `primary_media` without data loss
3. Gemini API fallback: When AI generation or external search fails/timeouts, clear UI feedback without crashing the app
4. Zero-Config search stability: Wikimedia Commons / open photo search graceful fallback if query yields 0 results
5. Large image auto-optimization: Resizing uploads to prevent UI lag while keeping high quality

---

### Task 1: Project Scaffold, Data Models & Persistence Layer

**Files:**
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\requirements.txt`
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\backend\models.py`
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\backend\storage.py`
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\tests\test_storage.py`

**Interfaces:**
- `DreamItem`: `{ id: str, category: 'DO'|'HAVE'|'GIVE', title: str, vivid_description: str, target_date: str, affirmation: str, is_completed: bool, completed_at: Optional[str], primary_media: MediaItem, media_history: List[MediaItem], created_at: str }`
- `MediaItem`: `{ id: str, media_type: 'image'|'video'|'embed', url: str, source: 'upload'|'web_search'|'ai_generated'|'ai_synthesized', thumbnail_url: Optional[str], caption: Optional[str], created_at: str }`
- `StorageManager`: `get_all_dreams() -> List[DreamItem]`, `get_dream(id) -> Optional[DreamItem]`, `create_dream(data) -> DreamItem`, `update_dream(id, data) -> Optional[DreamItem]`, `delete_dream(id) -> bool`, `set_primary_media(dream_id, media_id) -> bool`, `add_media_to_history(dream_id, media_item) -> DreamItem`

- [ ] **Step 1: Write tests for StorageManager**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement `models.py` and `storage.py` with initial sample dreams**
- [ ] **Step 4: Run tests to verify they pass**

---

### Task 2: Media Management & Zero-Config Search Service

**Files:**
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\backend\media_service.py`
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\tests\test_media_service.py`

**Interfaces:**
- `save_uploaded_file(file_bytes: bytes, filename: str) -> MediaItem`: Saves to `data/uploads/` with unique ID, generates thumbnail if image.
- `search_web_media(query: str, count: int = 12) -> List[dict]`: Zero-config high-resolution photo/media search (Wikimedia / Open search adapter) returning `{ url, title, thumbnail_url, source }`.
- `download_and_store_media(url: str, caption: str = "") -> MediaItem`: Downloads external image to `data/uploads/` so links never break.

- [ ] **Step 1: Write test for upload saving and media search adapter**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement `media_service.py` with file storage and zero-config search**
- [ ] **Step 4: Run tests to verify passing**

---

### Task 3: Gemini AI Generation & Multi-Image Vision Synthesis Service

**Files:**
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\backend\ai_service.py`
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\tests\test_ai_service.py`

**Interfaces:**
- `generate_vivid_dream_image(title: str, vivid_description: str, affirmation: str) -> MediaItem`: Uses `gemini-4-argon` / `gemini-3.8-flash` to craft prompt + `gemini-3-pro-image` / `gemini-nano-banana-2.1` to generate image, saves to `data/uploads/`.
- `synthesize_user_with_dream(reference_image_paths: List[str], dream_title: str, dream_description: str, custom_request: str) -> MediaItem`: Analyzes reference photos via Gemini Vision and synthesizes the user into the dream scene.

- [ ] **Step 1: Write test with mocked Gemini client for generation and synthesis**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement `ai_service.py` with `google-genai` SDK and graceful fallback**
- [ ] **Step 4: Run tests to verify passing**

---

### Task 4: FastAPI REST API & Static File Server

**Files:**
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\backend\main.py`
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\tests\test_api.py`

**Endpoints:**
- `GET /api/dreams` & `POST /api/dreams`
- `GET /api/dreams/{id}`, `PUT /api/dreams/{id}`, `DELETE /api/dreams/{id}`
- `POST /api/dreams/{id}/media/upload`
- `POST /api/dreams/{id}/media/search`
- `POST /api/dreams/{id}/media/select-web`
- `POST /api/dreams/{id}/media/ai-generate`
- `POST /api/dreams/{id}/media/ai-synthesize`
- `POST /api/dreams/{id}/media/set-primary`
- `StaticFiles`: `/uploads` -> `data/uploads/`, `/` -> `frontend/`

- [ ] **Step 1: Write API tests using FastAPI TestClient**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement `main.py` mounting routers and static files**
- [ ] **Step 4: Run tests to verify passing**

---

### Task 5: Frontend UI (Magazine Grid, 3-Tab Media Picker, History Gallery & Slideshow)

**Files:**
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\frontend\index.html`
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\frontend\app.js`
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\frontend\styles.css`

**Features:**
- Header with stats (Total, Do, Have, Give, Achieved count) + `[+ 꿈 추가]` + `[🎬 명상 슬라이드쇼]`
- Category tabs (`전체`, `🏃 하고 싶은 것`, `💎 갖고 싶은 것`, `💝 해주고 싶은 것`) and View toggle (Grid / List)
- Dream Card: Primary media (auto-looping muted video or high-res image), category badge, vivid description preview, target date, completion star
- Dream Modal with 3-tab Media Picker:
  - Tab 1: Drag & drop upload or direct URL/YouTube embed
  - Tab 2: Zero-config internet media search with 1-click apply
  - Tab 3: AI Dream Painter & Portrait Synthesizer
- Media History Strip: Interactive thumbnail carousel showing all past photos/videos for this card with 1-click restore/set primary
- Fullscreen Visualization Meditation Slideshow: Dark backdrop, serene ambient transitions, auto/manual next, large imagery, affirmation typography

- [ ] **Step 1: Build modern responsive HTML layout & Tailwind styling**
- [ ] **Step 2: Implement `app.js` state management, card rendering, and API interactions**
- [ ] **Step 3: Implement 3-Tab Media Picker and Media History switcher**
- [ ] **Step 4: Implement Fullscreen Meditation Slideshow mode**

---

### Task 6: One-Click Windows Launcher & End-to-End Verification

**Files:**
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\run_dream_board.bat`
- Create: `C:\Users\zijon\Desktop\gemini-projects\dream-board\README.md`

- [ ] **Step 1: Create `run_dream_board.bat` (checks Python, installs requirements, sets Gemini key, launches uvicorn and opens browser)**
- [ ] **Step 2: Run full automated pytest suite**
- [ ] **Step 3: Launch server and verify end-to-end via HTTP requests & browser check**
