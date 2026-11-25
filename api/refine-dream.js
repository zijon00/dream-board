import { verifyFirebaseAuth } from "./_auth.js";

// Always use the latest Gemini Pro model
const PRO_MODEL = "gemini-3.8-pro";

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

  const { mode = "refine", title = "", note = "", category = "DO" } = req.body || {};

  const prompt =
    mode === "ideas"
      ? `사용자의 꿈보드 카테고리(${category})에 맞는 영감을 주는 긍정적이고 구체적인 소망 아이디어 5가지를 한국어 JSON 배열(["아이디어1", ...])로만 답해 주세요. 짧고 가슴 뛰는 문장으로 작성하세요.`
      : `사용자의 소망 제목: "${title}"
메모: "${note}"
카테고리: ${category}

위 내용을 바탕으로 다음 2가지를 한국어 JSON 객체로만 출력해 주세요:
{
  "vivid_description": "오감(시각, 청각, 촉각, 감정)이 생생하게 느껴지는 2~3문장의 현재형 묘사",
  "affirmation": "이미 이루어진 것처럼 선언하는 힘 있는 현재형 확언 1문장"
}`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${PRO_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Gemini Pro API 오류: ${errText}` });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(rawText);
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: "AI 다듬기 처리 실패: " + err.message });
  }
}
