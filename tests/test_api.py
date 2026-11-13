import os
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_api_list_dreams():
    res = client.get("/api/dreams")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) >= 1

def test_api_create_and_delete_dream():
    payload = {
        "category": "DO",
        "title": "서핑 배우기",
        "vivid_description": "하와이 해변에서 파도를 타는 상쾌함",
        "target_date": "2027-08",
        "affirmation": "나는 활력 넘치고 매 순간 도전한다"
    }
    res = client.post("/api/dreams", json=payload)
    assert res.status_code == 200
    created = res.json()
    dream_id = created["id"]
    assert created["title"] == "서핑 배우기"

    # Delete
    del_res = client.delete(f"/api/dreams/{dream_id}")
    assert del_res.status_code == 200

def test_api_search_media():
    res = client.get("/api/media/search?q=bali")
    assert res.status_code == 200
    results = res.json()
    assert isinstance(results, list)
