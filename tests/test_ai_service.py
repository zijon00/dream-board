import os
import pytest
import shutil
from unittest.mock import MagicMock, patch
from backend.ai_service import AIService

TEST_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "test_ai_uploads")

@pytest.fixture(autouse=True)
def setup_teardown():
    os.makedirs(TEST_UPLOAD_DIR, exist_ok=True)
    yield
    if os.path.exists(TEST_UPLOAD_DIR):
        shutil.rmtree(TEST_UPLOAD_DIR, ignore_errors=True)

def test_ai_service_initialization():
    service = AIService(upload_dir=TEST_UPLOAD_DIR, api_key="dummy_key")
    assert service.upload_dir == TEST_UPLOAD_DIR

def test_prompt_optimization_fallback():
    service = AIService(upload_dir=TEST_UPLOAD_DIR, api_key="dummy_offline_key")
    # Service client will fail to connect or fallback to default prompt string
    prompt = service.build_optimized_prompt("스위스 여행", "설산이 보이는 오두막", "자유롭다")
    assert isinstance(prompt, str)
    assert len(prompt) > 20
    assert "photorealistic" in prompt.lower() or "alps" in prompt.lower() or "swiss" in prompt.lower()

