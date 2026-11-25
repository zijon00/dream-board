import { verifyFirebaseAuth } from "./_auth.js";

const IMAGE_MODEL = "gemini-3-pro-image";

async function callGeminiImage(apiKey, parts) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const candidates = data?.candidates || [];
  for (const cand of candidates) {
    const resParts = cand?.content?.parts || [];
    for (const part of resParts) {
      if (part.inlineData && part.inlineData.data) {
        return {
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        };
      }
    }
  }
  throw new Error("생성된 이미지가 반환되지 않았습니다.");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await verifyFirebaseAuth(req, res);
  if (!user) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." });
  }

  const { title = "", description = "", category = "DO", referenceImageBase64, referenceMimeType, customPrompt = "" } = req.body || {};

  const visionPrompt = `Create a vivid, inspiring, photorealistic, warm-lit vision-board photograph representing this dream: "${title}". Details: "${description}". Category: ${category}. Make it joyful, aspirational, high-resolution photography with natural lighting.`;

  // Mode B: Portrait synthesis with automatic fallback to Mode A if filtered/rejected
  if (referenceImageBase64) {
    try {
      const synthPrompt = `Place the person/people from the attached reference photo naturally and respectfully into this dream scene: "${title}". Scene details: "${description}". Extra request: "${customPrompt}". Keep their facial identity warm and recognizable, photorealistic lighting, joyful atmosphere.`;
      const img = await callGeminiImage(apiKey, [
        { text: synthPrompt },
        {
          inlineData: {
            mimeType: referenceMimeType || "image/jpeg",
            data: referenceImageBase64,
          },
        },
      ]);
      return res.status(200).json({ ...img, fallbackUsed: false, mode: "synthesis" });
    } catch (synthErr) {
      // Automatic fallback to pure vision generation (Mode A) per PRD v1.2
      try {
        const fallbackImg = await callGeminiImage(apiKey, [{ text: visionPrompt }]);
        return res.status(200).json({
          ...fallbackImg,
          fallbackUsed: true,
          fallbackReason: synthErr.message,
          mode: "vision",
        });
      } catch (visionErr) {
        return res.status(502).json({ error: visionErr.message });
      }
    }
  }

  // Mode A: Pure AI vision generation
  try {
    const img = await callGeminiImage(apiKey, [{ text: visionPrompt }]);
    return res.status(200).json({ ...img, fallbackUsed: false, mode: "vision" });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
