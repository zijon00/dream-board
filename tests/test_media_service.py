import os
import pytest
import shutil
from backend.media_service import MediaService

TEST_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "test_uploads")

@pytest.fixture(autouse=True)
def setup_teardown():
    os.makedirs(TEST_UPLOAD_DIR, exist_ok=True)
    yield
    if os.path.exists(TEST_UPLOAD_DIR):
        shutil.rmtree(TEST_UPLOAD_DIR, ignore_errors=True)

def test_save_uploaded_image_file():
    service = MediaService(upload_dir=TEST_UPLOAD_DIR)
    # 1x1 red PNG bytes
    tiny_png = (
        b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
        b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf'
        b'\xc0\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82'
    )
    media = service.save_upload(
        file_bytes=tiny_png,
        filename="my_photo.png",
        caption="테스트 사진"
    )
    assert media.id is not None
    assert media.media_type == "image"
    assert media.source == "upload"
    assert media.url.startswith("/uploads/")
    assert os.path.exists(os.path.join(TEST_UPLOAD_DIR, os.path.basename(media.url)))

def test_zero_config_web_search():
    service = MediaService(upload_dir=TEST_UPLOAD_DIR)
    # Test query
    results = service.search_web_media(query="Switzerland alps", count=3)
    assert isinstance(results, list)
    # Even if offline or mock, returns structured results without throwing
    if len(results) > 0:
        first = results[0]
        assert "url" in first
        assert "thumbnail_url" in first
        assert "title" in first
