import os
import json
from typing import List, Optional
from datetime import datetime
from backend.models import DreamItem, MediaItem

DEFAULT_DREAMS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "dreams.json"
)

INITIAL_SAMPLE_DREAMS = [
    {
        "category": "DO",
        "title": "스위스 융프라우에서 오로라와 알프스 만끽하기",
        "vivid_description": "유리 이글루 천장 너머로 반짝이는 별과 눈 덮인 설산 알프스를 바라보며, 따뜻한 벽난로 앞에서 사랑하는 사람과 여유를 즐긴다.",
        "target_date": "2027-05",
        "affirmation": "나는 전 세계 아름다운 곳을 자유롭게 누비며 매 순간 감사함으로 가득 차 있다.",
        "primary_media": {
            "media_type": "image",
            "url": "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?w=1200&auto=format&fit=crop&q=80",
            "source": "web_search",
            "caption": "스위스 알프스 설산"
        }
    },
    {
        "category": "HAVE",
        "title": "남산타워 뷰가 한눈에 보이는 통창 원목 서재",
        "vivid_description": "천장부터 바닥까지 닿는 통창으로 아침 햇살이 가득 쏟아지고, 은은한 원목 향과 클래식 재즈가 흐르는 나만의 집중과 사색의 공간.",
        "target_date": "2027-12",
        "affirmation": "내 공간은 평온과 풍요의 원천이며, 최고의 영감과 통찰을 선물한다.",
        "primary_media": {
            "media_type": "image",
            "url": "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1200&auto=format&fit=crop&q=80",
            "source": "web_search",
            "caption": "햇살 가득한 통창 서재"
        }
    },
    {
        "category": "GIVE",
        "title": "부모님 칠순 기념 하와이 비즈니스석 가족 힐링 여행",
        "vivid_description": "편안한 비즈니스 좌석에서 와인을 마시며 활짝 웃으시는 부모님, 와이키키 해변 앞 최고급 오션뷰 리조트에서 모든 것을 아낌없이 대접하는 행복한 순간.",
        "target_date": "2028-06",
        "affirmation": "나는 사랑하는 가족에게 언제나 든든한 버팀목이자 풍요로운 기쁨을 주는 존재이다.",
        "primary_media": {
            "media_type": "image",
            "url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80",
            "source": "web_search",
            "caption": "하와이 에메랄드빛 해변"
        }
    }
]

class StorageManager:
    def __init__(self, filepath: Optional[str] = None):
        self.filepath = filepath or DEFAULT_DREAMS_PATH
        os.makedirs(os.path.dirname(self.filepath), exist_ok=True)
        self._ensure_file()

    def _ensure_file(self):
        if not os.path.exists(self.filepath):
            # Seed with initial sample dreams if empty
            initial_items = []
            for item in INITIAL_SAMPLE_DREAMS:
                media = MediaItem(**item["primary_media"])
                dream = DreamItem(
                    category=item["category"],
                    title=item["title"],
                    vivid_description=item["vivid_description"],
                    target_date=item.get("target_date", ""),
                    affirmation=item.get("affirmation", ""),
                    primary_media=media,
                    media_history=[media]
                )
                initial_items.append(dream.model_dump())
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(initial_items, f, ensure_ascii=False, indent=2)

    def _read_data(self) -> List[dict]:
        try:
            with open(self.filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def _write_data(self, data: List[dict]):
        with open(self.filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def get_all_dreams(self) -> List[DreamItem]:
        raw_items = self._read_data()
        return [DreamItem(**item) for item in raw_items]

    def get_dream(self, dream_id: str) -> Optional[DreamItem]:
        for item in self._read_data():
            if item.get("id") == dream_id:
                return DreamItem(**item)
        return None

    def create_dream(
        self,
        category: str,
        title: str,
        vivid_description: str = "",
        target_date: str = "",
        deadline: str = "",
        estimated_budget: int = 0,
        budget_notes: str = "",
        affirmation: str = "",
        primary_media: Optional[MediaItem] = None
    ) -> DreamItem:
        items = self._read_data()
        media_history = [primary_media] if primary_media else []
        dream = DreamItem(
            category=category,
            title=title,
            vivid_description=vivid_description,
            target_date=target_date,
            deadline=deadline,
            estimated_budget=estimated_budget,
            budget_notes=budget_notes,
            affirmation=affirmation,
            primary_media=primary_media,
            media_history=media_history
        )
        items.insert(0, dream.model_dump())
        self._write_data(items)
        return dream

    def update_dream(self, dream_id: str, updates: dict) -> Optional[DreamItem]:
        items = self._read_data()
        for idx, item in enumerate(items):
            if item.get("id") == dream_id:
                for k, v in updates.items():
                    if k in item:
                        item[k] = v
                item["updated_at"] = datetime.now().isoformat()
                items[idx] = item
                self._write_data(items)
                return DreamItem(**item)
        return None

    def delete_dream(self, dream_id: str) -> bool:
        items = self._read_data()
        initial_len = len(items)
        items = [i for i in items if i.get("id") != dream_id]
        if len(items) < initial_len:
            self._write_data(items)
            return True
        return False

    def toggle_completed(self, dream_id: str) -> Optional[DreamItem]:
        dream = self.get_dream(dream_id)
        if not dream:
            return None
        new_status = not dream.is_completed
        completed_at = datetime.now().strftime("%Y-%m-%d") if new_status else None
        return self.update_dream(dream_id, {
            "is_completed": new_status,
            "completed_at": completed_at
        })

    def add_media_to_dream(self, dream_id: str, media: MediaItem, set_primary: bool = True) -> Optional[DreamItem]:
        items = self._read_data()
        for idx, item in enumerate(items):
            if item.get("id") == dream_id:
                history = item.get("media_history", [])
                # Prepend to history so latest is first
                history.insert(0, media.model_dump())
                item["media_history"] = history
                if set_primary:
                    item["primary_media"] = media.model_dump()
                item["updated_at"] = datetime.now().isoformat()
                items[idx] = item
                self._write_data(items)
                return DreamItem(**item)
        return None

    def set_primary_media(self, dream_id: str, media_id: str) -> bool:
        items = self._read_data()
        for idx, item in enumerate(items):
            if item.get("id") == dream_id:
                history = item.get("media_history", [])
                matched = next((m for m in history if m.get("id") == media_id), None)
                if matched:
                    item["primary_media"] = matched
                    item["updated_at"] = datetime.now().isoformat()
                    items[idx] = item
                    self._write_data(items)
                    return True
        return False
