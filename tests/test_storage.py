import os
import json
import pytest
import shutil
from backend.models import DreamItem, MediaItem
from backend.storage import StorageManager

TEST_DATA_DIR = os.path.join(os.path.dirname(__file__), "test_data")
TEST_JSON = os.path.join(TEST_DATA_DIR, "test_dreams.json")

@pytest.fixture(autouse=True)
def setup_teardown():
    os.makedirs(TEST_DATA_DIR, exist_ok=True)
    if os.path.exists(TEST_JSON):
        os.remove(TEST_JSON)
    yield
    if os.path.exists(TEST_DATA_DIR):
        shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)

def test_create_and_get_dream():
    storage = StorageManager(filepath=TEST_JSON)
    dream = storage.create_dream(
        category="DO",
        title="스위스 융프라우 가기",
        vivid_description="눈 덮인 알프스 산맥을 바라보며 따뜻한 핫초코 마시기",
        target_date="2027-05",
        affirmation="나는 전 세계를 자유롭게 여행하며 풍요를 만끽한다."
    )
    assert dream.id is not None
    assert dream.title == "스위스 융프라우 가기"
    assert dream.category == "DO"
    assert dream.is_completed is False

    retrieved = storage.get_dream(dream.id)
    assert retrieved is not None
    assert retrieved.title == dream.title

def test_media_history_preservation_and_primary_switch():
    storage = StorageManager(filepath=TEST_JSON)
    dream = storage.create_dream(
        category="HAVE",
        title="남산 뷰 서재",
        vivid_description="통창으로 아침 햇살이 비치는 원목 책상 서재"
    )

    media1 = MediaItem(
        media_type="image",
        url="/uploads/my_photo1.jpg",
        source="upload",
        caption="내가 찍은 서재 샘플"
    )
    storage.add_media_to_dream(dream.id, media1, set_primary=True)

    d1 = storage.get_dream(dream.id)
    assert d1.primary_media.id == media1.id
    assert len(d1.media_history) == 1

    # Add second media (e.g. AI generated), set as primary
    media2 = MediaItem(
        media_type="image",
        url="/uploads/ai_gen.jpg",
        source="ai_generated",
        caption="Gemini가 그려준 서재"
    )
    storage.add_media_to_dream(dream.id, media2, set_primary=True)

    d2 = storage.get_dream(dream.id)
    assert d2.primary_media.id == media2.id
    assert len(d2.media_history) == 2
    # Verify previous media is still preserved in history
    assert any(m.id == media1.id for m in d2.media_history)

    # Switch primary back to media1
    success = storage.set_primary_media(dream.id, media1.id)
    assert success is True
    d3 = storage.get_dream(dream.id)
    assert d3.primary_media.id == media1.id
    assert len(d3.media_history) == 2

def test_toggle_completed():
    storage = StorageManager(filepath=TEST_JSON)
    dream = storage.create_dream(
        category="GIVE",
        title="부모님 하와이 여행",
        vivid_description="부모님 칠순에 비즈니스석으로 보내드리기"
    )
    assert dream.is_completed is False

    updated = storage.toggle_completed(dream.id)
    assert updated.is_completed is True
    assert updated.completed_at is not None

    updated2 = storage.toggle_completed(dream.id)
    assert updated2.is_completed is False
    assert updated2.completed_at is None
