// Shared Firebase Auth ID Token Verification for Vercel Serverless Functions
// Uses Google Identity Toolkit REST API (zero heavy dependencies, fast cold-start)

const FIREBASE_WEB_API_KEY =
  process.env.FIREBASE_WEB_API_KEY || "AIzaSyC06UG7Slxh-4Wg-dVng485XQXDxf-6vuo";

export async function verifyFirebaseAuth(req, res) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "로그인이 필요합니다. (Missing Bearer token)" });
    return null;
  }

  const idToken = match[1].trim();
  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!verifyRes.ok) {
      res.status(401).json({ error: "유효하지 않거나 만료된 로그인 토큰입니다." });
      return null;
    }

    const data = await verifyRes.json();
    const user = data?.users?.[0];
    if (!user || !user.localId) {
      res.status(401).json({ error: "사용자 인증 정보를 확인할 수 없습니다." });
      return null;
    }

    return { uid: user.localId, email: user.email || "" };
  } catch (err) {
    res.status(500).json({ error: "인증 서버 통신 오류: " + err.message });
    return null;
  }
}
