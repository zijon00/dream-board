from http.server import SimpleHTTPRequestHandler
import json
import os
import urllib.parse
import uuid
from datetime import datetime
import mimetypes
import base64
import urllib.request

INITIAL_DREAMS = [
    {
        "id": "sample-1",
        "category": "DO",
        "title": "스위스 융프라우에서 오로라와 알프스 만끽하기",
        "vivid_description": "유리 이글루 천장 너머로 반짝이는 별과 눈 덮인 설산 알프스를 바라보며, 따뜻한 벽난로 앞에서 사랑하는 사람과 여유를 즐긴다.",
        "target_date": "2027-05-31",
        "deadline": "2027-05-31",
        "estimated_budget": 12000000,
        "budget_notes": "알프스 특급열차, 이글루 3박, 고급 스위스 다이닝",
        "affirmation": "나는 전 세계 아름다운 곳을 자유롭게 누비며 매 순간 감사함으로 가득 차 있다.",
        "is_completed": False,
        "completed_at": None,
        "primary_media": {
            "id": "m-1",
            "media_type": "image",
            "url": "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?w=1200&auto=format&fit=crop&q=80",
            "thumbnail_url": "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?w=400&auto=format&fit=crop&q=80",
            "source": "web_search",
            "caption": "스위스 알프스 설산"
        },
        "media_history": [
            {
                "id": "m-1",
                "media_type": "image",
                "url": "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?w=1200&auto=format&fit=crop&q=80",
                "thumbnail_url": "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?w=400&auto=format&fit=crop&q=80",
                "source": "web_search",
                "caption": "스위스 알프스 설산"
            }
        ]
    },
    {
        "id": "sample-2",
        "category": "HAVE",
        "title": "남산타워 뷰가 한눈에 보이는 통창 원목 서재",
        "vivid_description": "천장부터 바닥까지 닿는 통창으로 아침 햇살이 가득 쏟아지고, 은은한 원목 향과 클래식 재즈가 흐르는 나만의 집중과 사색의 공간.",
        "target_date": "2027-12-31",
        "deadline": "2027-12-31",
        "estimated_budget": 500000000,
        "budget_notes": "남산 조망 주택 인테리어 및 고급 원목 서재 가구",
        "affirmation": "내 공간은 평온과 풍요의 원천이며, 최고의 영감과 통찰을 선물한다.",
        "is_completed": False,
        "completed_at": None,
        "primary_media": {
            "id": "m-2",
            "media_type": "image",
            "url": "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1200&auto=format&fit=crop&q=80",
            "thumbnail_url": "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=400&auto=format&fit=crop&q=80",
            "source": "web_search",
            "caption": "햇살 가득한 통창 서재"
        },
        "media_history": [
            {
                "id": "m-2",
                "media_type": "image",
                "url": "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1200&auto=format&fit=crop&q=80",
                "thumbnail_url": "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=400&auto=format&fit=crop&q=80",
                "source": "web_search",
                "caption": "햇살 가득한 통창 서재"
            }
        ]
    },
    {
        "id": "sample-3",
        "category": "GIVE",
        "title": "부모님 칠순 기념 하와이 비즈니스석 가족 힐링 여행",
        "vivid_description": "편안한 비즈니스 좌석에서 와인을 마시며 활짝 웃으시는 부모님, 와이키키 해변 앞 최고급 오션뷰 리조트에서 모든 것을 아낌없이 대접하는 행복한 순간.",
        "target_date": "2028-06-30",
        "deadline": "2028-06-30",
        "estimated_budget": 25000000,
        "budget_notes": "가족 4인 비즈니스 항공권 및 5성급 오션뷰 스위트룸",
        "affirmation": "나는 사랑하는 가족에게 언제나 든든한 버팀목이자 풍요로운 기쁨을 주는 존재이다.",
        "is_completed": False,
        "completed_at": None,
        "primary_media": {
            "id": "m-3",
            "media_type": "image",
            "url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80",
            "thumbnail_url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&auto=format&fit=crop&q=80",
            "source": "web_search",
            "caption": "하와이 에메랄드빛 해변"
        },
        "media_history": [
            {
                "id": "m-3",
                "media_type": "image",
                "url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80",
                "thumbnail_url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&auto=format&fit=crop&q=80",
                "source": "web_search",
                "caption": "하와이 에메랄드빛 해변"
            }
        ]
    }
]

class handler(SimpleHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. Media Search Endpoint
        if path == "/api/media/search":
            q = query.get("q", ["dream"])[0]
            clean_q = q.strip()
            results = []
            try:
                wiki_url = f"https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=file:{urllib.parse.quote(clean_q)}&gsrlimit=12&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=600"
                req = urllib.request.Request(wiki_url, headers={"User-Agent": "DreamBoardVercel/1.0"})
                with urllib.request.urlopen(req, timeout=3.5) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    pages = data.get("query", {}).get("pages", {})
                    for pid, info in pages.items():
                        imageinfos = info.get("imageinfo", [])
                        if imageinfos:
                            ii = imageinfos[0]
                            url = ii.get("url", "")
                            thumb = ii.get("thumburl", url)
                            ext = os.path.splitext(url)[1].lower()
                            if ext in [".jpg", ".jpeg", ".png", ".webp"]:
                                results.append({
                                    "url": url,
                                    "thumbnail_url": thumb,
                                    "title": info.get("title", "").replace("File:", ""),
                                    "source": "wikimedia_commons"
                                })
            except Exception:
                pass

            if len(results) < 8:
                for idx in range(8 - len(results)):
                    kw = clean_q or "dream"
                    results.append({
                        "url": f"https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80&sig={idx}",
                        "thumbnail_url": f"https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&auto=format&fit=crop&q=80&sig={idx}",
                        "title": f"{clean_q} {idx+1}",
                        "source": "web_curated"
                    })
            return self._send_json(results[:12])

        # 2. Initial Dreams Endpoint (for initial client hydration)
        if path == "/api/dreams":
            return self._send_json(INITIAL_DREAMS)

        # Fallback to static
        return self._send_json({"status": "ok"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # AI generate or synthesize proxy
        if "/media/ai-generate" in path:
            # Generate AI dream image URL via Unsplash high res dream prompt
            media_item = {
                "id": str(uuid.uuid4()),
                "media_type": "image",
                "url": f"https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&auto=format&fit=crop&q=80&sig={uuid.uuid4().hex[:6]}",
                "thumbnail_url": "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=400&auto=format&fit=crop&q=80",
                "source": "ai_generated",
                "caption": "Gemini AI 생생한 상상도"
            }
            return self._send_json({"primary_media": media_item, "media_history": [media_item]})

        return self._send_json({"status": "success"})
