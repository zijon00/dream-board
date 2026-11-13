from typing import List, Optional, Literal
from pydantic import BaseModel, Field
import uuid
from datetime import datetime

CategoryType = Literal["DO", "HAVE", "GIVE"]
MediaType = Literal["image", "video", "embed"]
MediaSource = Literal["upload", "web_search", "ai_generated", "ai_synthesized"]

class MediaItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    media_type: MediaType = "image"
    url: str
    source: MediaSource = "upload"
    thumbnail_url: Optional[str] = None
    caption: Optional[str] = ""
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())

class DreamItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: CategoryType = "DO"
    title: str
    vivid_description: str = ""
    target_date: Optional[str] = ""
    deadline: Optional[str] = ""          # 달성 시한 (예: 2027-12-31, 3년 이내 등)
    estimated_budget: Optional[int] = 0   # 필요 예산 (원 단위 숫자, 예: 15000000)
    budget_notes: Optional[str] = ""      # 예산 세부 메모 (예: 비즈니스석 800만 + 5성급 리조트 700만)
    affirmation: Optional[str] = ""
    is_completed: bool = False
    completed_at: Optional[str] = None
    primary_media: Optional[MediaItem] = None
    media_history: List[MediaItem] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())

class DreamCreateRequest(BaseModel):
    category: CategoryType
    title: str
    vivid_description: str = ""
    target_date: Optional[str] = ""
    deadline: Optional[str] = ""
    estimated_budget: Optional[int] = 0
    budget_notes: Optional[str] = ""
    affirmation: Optional[str] = ""

class DreamUpdateRequest(BaseModel):
    category: Optional[CategoryType] = None
    title: Optional[str] = None
    vivid_description: Optional[str] = None
    target_date: Optional[str] = None
    deadline: Optional[str] = None
    estimated_budget: Optional[int] = None
    budget_notes: Optional[str] = None
    affirmation: Optional[str] = None
