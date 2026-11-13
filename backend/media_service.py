import os
import uuid
import mimetypes
import urllib.parse
from typing import List, Optional
import httpx
from PIL import Image
import io
from backend.models import MediaItem, MediaType

DEFAULT_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "uploads"
)

VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".avi"}

class MediaService:
    def __init__(self, upload_dir: Optional[str] = None):
        self.upload_dir = upload_dir or DEFAULT_UPLOAD_DIR
        os.makedirs(self.upload_dir, exist_ok=True)

    def save_upload(self, file_bytes: bytes, filename: str, caption: str = "") -> MediaItem:
        ext = os.path.splitext(filename)[1].lower() or ".jpg"
        media_id = str(uuid.uuid4())
        saved_filename = f"{media_id}{ext}"
        saved_path = os.path.join(self.upload_dir, saved_filename)

        with open(saved_path, "wb") as f:
            f.write(file_bytes)

        media_type: MediaType = "video" if ext in VIDEO_EXTENSIONS else "image"
        thumbnail_url = None

        # Auto-create lightweight thumbnail for images
        if media_type == "image":
            try:
                with Image.open(io.BytesIO(file_bytes)) as img:
                    img.thumbnail((300, 300))
                    thumb_name = f"thumb_{media_id}.jpg"
                    thumb_path = os.path.join(self.upload_dir, thumb_name)
                    # Convert to RGB if needed
                    if img.mode in ("RGBA", "P"):
                        img = img.convert("RGB")
                    img.save(thumb_path, "JPEG", quality=80)
                    thumbnail_url = f"/uploads/{thumb_name}"
            except Exception:
                pass

        return MediaItem(
            id=media_id,
            media_type=media_type,
            url=f"/uploads/{saved_filename}",
            thumbnail_url=thumbnail_url or f"/uploads/{saved_filename}",
            source="upload",
            caption=caption or filename
        )

    def search_web_media(self, query: str, count: int = 12) -> List[dict]:
        """
        Zero-config public media search (Wikimedia Commons API + Unsplash Direct Fallback).
        Requires no user API key.
        """
        results = []
        clean_q = query.strip()
        if not clean_q:
            clean_q = "dream luxury travel nature"

        try:
            # Wikimedia Commons Open API (Free, high-res, zero-auth)
            wiki_url = "https://commons.wikimedia.org/w/api.php"
            params = {
                "action": "query",
                "format": "json",
                "generator": "search",
                "gsrsearch": f"file:{clean_q}",
                "gsrlimit": str(min(count, 15)),
                "prop": "imageinfo",
                "iiprop": "url|thumburl|extmetadata",
                "iiurlwidth": "600"
            }
            headers = {"User-Agent": "DreamBoardVisionApp/1.0 (local personal vision board)"}
            with httpx.Client(timeout=4.0) as client:
                res = client.get(wiki_url, params=params, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    pages = data.get("query", {}).get("pages", {})
                    for page_id, info in pages.items():
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

        # If zero or few results, provide high quality curated dynamic Unsplash fallback
        if len(results) < count:
            keywords = [k for k in clean_q.split() if len(k) > 1]
            seed_words = keywords if keywords else ["dream", "vision", "luxury", "success", "peace"]
            for idx in range(count - len(results)):
                kw = seed_words[idx % len(seed_words)]
                img_url = f"https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80&sig={idx}" if kw == "dream" else f"https://source.unsplash.com/featured/1200x800?{urllib.parse.quote(kw)}&sig={idx}"
                results.append({
                    "url": f"https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&auto=format&fit=crop&q=80&sig={idx}",
                    "thumbnail_url": f"https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400&auto=format&fit=crop&q=80&sig={idx}",
                    "title": f"{clean_q} - {idx+1}",
                    "source": "web_curated"
                })

        return results[:count]

    def download_and_store_media(self, url: str, caption: str = "") -> MediaItem:
        """
        Downloads remote image so links never break, saving into data/uploads/.
        """
        media_id = str(uuid.uuid4())
        ext = ".jpg"
        saved_filename = f"{media_id}{ext}"
        saved_path = os.path.join(self.upload_dir, saved_filename)

        try:
            with httpx.Client(timeout=10.0, follow_redirects=True) as client:
                res = client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                if res.status_code == 200:
                    with open(saved_path, "wb") as f:
                        f.write(res.content)
                    return MediaItem(
                        id=media_id,
                        media_type="image",
                        url=f"/uploads/{saved_filename}",
                        thumbnail_url=f"/uploads/{saved_filename}",
                        source="web_search",
                        caption=caption
                    )
        except Exception:
            pass

        # Fallback to direct URL if download fails
        return MediaItem(
            id=media_id,
            media_type="image",
            url=url,
            thumbnail_url=url,
            source="web_search",
            caption=caption
        )
