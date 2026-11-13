import os
import uuid
import base64
from typing import List, Optional
from PIL import Image
import io
from backend.models import MediaItem

DEFAULT_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "uploads"
)

# User's Gemini API key from environment variable
DEFAULT_GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

class AIService:
    def __init__(self, upload_dir: Optional[str] = None, api_key: Optional[str] = None):
        self.upload_dir = upload_dir or DEFAULT_UPLOAD_DIR
        self.api_key = api_key or DEFAULT_GEMINI_KEY
        os.makedirs(self.upload_dir, exist_ok=True)
        self._init_client()

    def _init_client(self):
        self.client = None
        if self.api_key:
            try:
                from google import genai
                self.client = genai.Client(api_key=self.api_key)
            except Exception:
                self.client = None

    def build_optimized_prompt(self, title: str, vivid_description: str, affirmation: str) -> str:
        """
        Uses Gemini Pro/Argon to expand user's dream into an inspiring, photorealistic prompt.
        """
        base_desc = f"{title}. {vivid_description}. Feeling: {affirmation}".strip()
        if not self.client:
            return f"A breathtaking, photorealistic vision of {base_desc}, 8k resolution, cinematic golden hour lighting, architectural digest style, highly detailed."

        try:
            prompt_request = (
                f"You are an expert visual director. The user wants to visualize their dream: '{title}'. "
                f"Details: '{vivid_description}'. Mood/Affirmation: '{affirmation}'. "
                "Write an ultra-detailed, vivid, cinematic English prompt for an AI image generator. "
                "Describe the atmosphere, colors, lighting, perspective, and emotional warmth. "
                "Output ONLY the prompt text, without any quotes or markdown."
            )
            response = self.client.interactions.create(
                model="gemini-4-argon",
                input=prompt_request
            )
            if response and response.output_text:
                return response.output_text.strip()
        except Exception:
            try:
                # Fallback to gemini-3.8-flash if argon is unavailable
                response = self.client.interactions.create(
                    model="gemini-3.8-flash",
                    input=prompt_request
                )
                if response and response.output_text:
                    return response.output_text.strip()
            except Exception:
                pass

        return f"A breathtaking, photorealistic vision of {base_desc}, 8k resolution, cinematic golden hour lighting, highly detailed."

    def generate_vivid_dream_image(self, title: str, vivid_description: str, affirmation: str) -> MediaItem:
        """
        Generates an image via Gemini image generation models (gemini-3-pro-image or gemini-nano-banana-2.1).
        """
        optimized_prompt = self.build_optimized_prompt(title, vivid_description, affirmation)
        media_id = str(uuid.uuid4())
        filename = f"ai_gen_{media_id}.png"
        saved_path = os.path.join(self.upload_dir, filename)

        if self.client:
            # 1. Try gemini-3-pro-image
            for model_name in ["gemini-3-pro-image", "gemini-nano-banana-2.1"]:
                try:
                    res = self.client.interactions.create(
                        model=model_name,
                        input=optimized_prompt
                    )
                    if res and res.output_image:
                        image_data = res.output_image.data
                        if isinstance(image_data, str):
                            raw_bytes = base64.b64decode(image_data)
                        else:
                            raw_bytes = image_data
                        with open(saved_path, "wb") as f:
                            f.write(raw_bytes)

                        return MediaItem(
                            id=media_id,
                            media_type="image",
                            url=f"/uploads/{filename}",
                            thumbnail_url=f"/uploads/{filename}",
                            source="ai_generated",
                            caption=f"AI 생성: {title}"
                        )
                except Exception as e:
                    continue

        # Graceful placeholder image creation if API offline or quota exceeded
        return self._create_gradient_placeholder(media_id, title, saved_path)

    def synthesize_user_with_dream(
        self,
        reference_image_paths: List[str],
        dream_title: str,
        dream_description: str,
        custom_request: str = ""
    ) -> MediaItem:
        """
        Analyzes user's reference photo via Gemini Vision, crafts a synthesis prompt, and generates the fused scene.
        """
        media_id = str(uuid.uuid4())
        filename = f"ai_synth_{media_id}.png"
        saved_path = os.path.join(self.upload_dir, filename)

        vision_analysis = ""
        if self.client and reference_image_paths:
            try:
                # Load first reference image
                ref_path = reference_image_paths[0]
                if os.path.exists(ref_path):
                    with Image.open(ref_path) as pil_img:
                        buf = io.BytesIO()
                        pil_img.save(buf, format="JPEG")
                        ref_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

                    analyze_prompt = (
                        "Describe the key visual characteristics of the main subject/person in this image: "
                        "approximate age, gender, hair style, facial expression, general clothing vibe, so they can be recognized. "
                        "Keep it concise (1-2 sentences)."
                    )
                    vision_res = self.client.interactions.create(
                        model="gemini-4-argon",
                        input=[
                            {"type": "text", "text": analyze_prompt},
                            {"type": "image", "data": ref_b64, "mime_type": "image/jpeg"}
                        ]
                    )
                    if vision_res and vision_res.output_text:
                        vision_analysis = vision_res.output_text.strip()
            except Exception:
                pass

        combined_prompt = (
            f"A high quality photorealistic scene: A person matching these traits ({vision_analysis or 'happy relaxed individual'}) "
            f"experiencing their dream: {dream_title}. Scene details: {dream_description}. "
            f"Special request: {custom_request or 'Warm, joyful, realistic, natural lighting, cinematic depth of field'}"
        )

        if self.client:
            for model_name in ["gemini-3-pro-image", "gemini-nano-banana-2.1"]:
                try:
                    res = self.client.interactions.create(
                        model=model_name,
                        input=combined_prompt
                    )
                    if res and res.output_image:
                        image_data = res.output_image.data
                        raw_bytes = base64.b64decode(image_data) if isinstance(image_data, str) else image_data
                        with open(saved_path, "wb") as f:
                            f.write(raw_bytes)
                        return MediaItem(
                            id=media_id,
                            media_type="image",
                            url=f"/uploads/{filename}",
                            thumbnail_url=f"/uploads/{filename}",
                            source="ai_synthesized",
                            caption=f"AI 인물 합성: {dream_title}"
                        )
                except Exception:
                    continue

        return self._create_gradient_placeholder(media_id, f"합성: {dream_title}", saved_path)

    def _create_gradient_placeholder(self, media_id: str, text: str, save_path: str) -> MediaItem:
        img = Image.new("RGB", (1200, 800), color=(30, 41, 59))
        img.save(save_path, "PNG")
        return MediaItem(
            id=media_id,
            media_type="image",
            url=f"/uploads/{os.path.basename(save_path)}",
            thumbnail_url=f"/uploads/{os.path.basename(save_path)}",
            source="ai_generated",
            caption=f"상상 캔버스: {text}"
        )
