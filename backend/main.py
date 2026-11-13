import os
from typing import Optional, List
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.models import DreamItem, DreamCreateRequest, DreamUpdateRequest, MediaItem
from backend.storage import StorageManager
from backend.media_service import MediaService
from backend.ai_service import AIService

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(FRONTEND_DIR, exist_ok=True)

storage = StorageManager()
media_service = MediaService(upload_dir=UPLOADS_DIR)
ai_service = AIService(upload_dir=UPLOADS_DIR)

app = FastAPI(title="Dream Board API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Dream CRUD Endpoints ---

@app.get("/api/dreams", response_model=List[DreamItem])
def list_dreams(category: Optional[str] = None):
    dreams = storage.get_all_dreams()
    if category and category != "ALL":
        dreams = [d for d in dreams if d.category == category]
    return dreams

@app.get("/api/dreams/{dream_id}", response_model=DreamItem)
def get_dream(dream_id: str):
    dream = storage.get_dream(dream_id)
    if not dream:
        raise HTTPException(status_code=404, detail="Dream not found")
    return dream

@app.post("/api/dreams", response_model=DreamItem)
def create_dream(req: DreamCreateRequest):
    return storage.create_dream(
        category=req.category,
        title=req.title,
        vivid_description=req.vivid_description,
        target_date=req.target_date or "",
        deadline=req.deadline or "",
        estimated_budget=req.estimated_budget or 0,
        budget_notes=req.budget_notes or "",
        affirmation=req.affirmation or ""
    )

@app.put("/api/dreams/{dream_id}", response_model=DreamItem)
def update_dream(dream_id: str, req: DreamUpdateRequest):
    updates = req.model_dump(exclude_unset=True)
    dream = storage.update_dream(dream_id, updates)
    if not dream:
        raise HTTPException(status_code=404, detail="Dream not found")
    return dream

@app.delete("/api/dreams/{dream_id}")
def delete_dream(dream_id: str):
    success = storage.delete_dream(dream_id)
    if not success:
        raise HTTPException(status_code=404, detail="Dream not found")
    return {"status": "success", "id": dream_id}

@app.post("/api/dreams/{dream_id}/toggle-complete", response_model=DreamItem)
def toggle_complete(dream_id: str):
    dream = storage.toggle_completed(dream_id)
    if not dream:
        raise HTTPException(status_code=404, detail="Dream not found")
    return dream

# --- Media Management Endpoints ---

@app.get("/api/media/search")
def search_media(q: str = Query(..., description="Search query")):
    return media_service.search_web_media(query=q, count=12)

@app.post("/api/dreams/{dream_id}/media/upload", response_model=DreamItem)
async def upload_dream_media(
    dream_id: str,
    file: UploadFile = File(...),
    caption: str = Form("")
):
    dream = storage.get_dream(dream_id)
    if not dream:
        raise HTTPException(status_code=404, detail="Dream not found")
    
    file_bytes = await file.read()
    media_item = media_service.save_upload(file_bytes, file.filename, caption=caption)
    updated = storage.add_media_to_dream(dream_id, media_item, set_primary=True)
    return updated

class DirectUrlRequest(BaseModel):
    url: str
    media_type: str = "image"
    caption: Optional[str] = ""

@app.post("/api/dreams/{dream_id}/media/direct-url", response_model=DreamItem)
def add_direct_url(dream_id: str, req: DirectUrlRequest):
    dream = storage.get_dream(dream_id)
    if not dream:
        raise HTTPException(status_code=404, detail="Dream not found")
    
    # If it's a web image URL, download and save it to keep permanently
    if req.media_type == "image" and req.url.startswith("http"):
        media_item = media_service.download_and_store_media(req.url, caption=req.caption or dream.title)
    else:
        # e.g. youtube or video embed
        media_item = MediaItem(
            media_type=req.media_type,
            url=req.url,
            source="upload",
            caption=req.caption or dream.title
        )
    return storage.add_media_to_dream(dream_id, media_item, set_primary=True)

class SelectWebRequest(BaseModel):
    url: str
    title: Optional[str] = ""

@app.post("/api/dreams/{dream_id}/media/select-web", response_model=DreamItem)
def select_web_media(dream_id: str, req: SelectWebRequest):
    dream = storage.get_dream(dream_id)
    if not dream:
        raise HTTPException(status_code=404, detail="Dream not found")
    
    media_item = media_service.download_and_store_media(req.url, caption=req.title or dream.title)
    return storage.add_media_to_dream(dream_id, media_item, set_primary=True)

@app.post("/api/dreams/{dream_id}/media/ai-generate", response_model=DreamItem)
def ai_generate_media(dream_id: str):
    dream = storage.get_dream(dream_id)
    if not dream:
        raise HTTPException(status_code=404, detail="Dream not found")
    
    media_item = ai_service.generate_vivid_dream_image(
        title=dream.title,
        vivid_description=dream.vivid_description,
        affirmation=dream.affirmation or ""
    )
    return storage.add_media_to_dream(dream_id, media_item, set_primary=True)

@app.post("/api/dreams/{dream_id}/media/ai-synthesize", response_model=DreamItem)
async def ai_synthesize_media(
    dream_id: str,
    custom_request: str = Form(""),
    reference_file: UploadFile = File(...)
):
    dream = storage.get_dream(dream_id)
    if not dream:
        raise HTTPException(status_code=404, detail="Dream not found")
    
    ref_bytes = await reference_file.read()
    temp_ref_path = os.path.join(UPLOADS_DIR, f"ref_{dream_id}_{reference_file.filename}")
    with open(temp_ref_path, "wb") as f:
        f.write(ref_bytes)

    media_item = ai_service.synthesize_user_with_dream(
        reference_image_paths=[temp_ref_path],
        dream_title=dream.title,
        dream_description=dream.vivid_description,
        custom_request=custom_request
    )
    return storage.add_media_to_dream(dream_id, media_item, set_primary=True)

class SetPrimaryRequest(BaseModel):
    media_id: str

@app.post("/api/dreams/{dream_id}/media/set-primary", response_model=DreamItem)
def set_primary_media(dream_id: str, req: SetPrimaryRequest):
    success = storage.set_primary_media(dream_id, req.media_id)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to set primary media")
    return storage.get_dream(dream_id)

# --- Mount Static Files ---
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
