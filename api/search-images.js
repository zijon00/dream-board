import { verifyFirebaseAuth } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await verifyFirebaseAuth(req, res);
  if (!user) return;

  const rawQuery = (req.method === "GET" ? req.query?.q : req.body?.query) || "";
  const query = String(rawQuery).trim();
  if (!query) {
    return res.status(400).json({ error: "검색어를 입력해 주세요." });
  }

  // Translate Korean query to English for global stock/CC photo matching
  let searchTerm = query;
  if (/[ㄱ-ㅎ가-힣]/.test(query)) {
    try {
      const trRes = await fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(query)}`
      );
      if (trRes.ok) {
        const trData = await trRes.json();
        const translated = trData?.[0]?.[0]?.[0];
        if (translated) searchTerm = translated;
      }
    } catch {}
  }

  const results = [];
  const seen = new Set();
  const addResult = (url, thumbnail, title, source) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    results.push({
      url,
      thumbnail: thumbnail || url,
      title: title || query,
      source,
    });
  };

  const tasks = [
    // 1. Openverse
    (async () => {
      const r = await fetch(
        `https://api.openverse.org/v1/images/?q=${encodeURIComponent(searchTerm)}&page_size=9`,
        { headers: { "User-Agent": "DreamBoard/1.2" } }
      );
      if (r.ok) {
        const d = await r.json();
        for (const item of d.results || []) {
          addResult(item.url, item.thumbnail || item.url, item.title, "openverse");
        }
      }
    })(),
    // 2. Wikimedia Commons
    (async () => {
      const r = await fetch(
        `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(searchTerm)}&gsrlimit=9&prop=imageinfo&iiprop=url&format=json&origin=*`
      );
      if (r.ok) {
        const d = await r.json();
        const pages = d.query?.pages ? Object.values(d.query.pages) : [];
        for (const p of pages) {
          const imgUrl = p.imageinfo?.[0]?.url;
          if (imgUrl && /\.(jpg|jpeg|png|webp)$/i.test(imgUrl)) {
            addResult(imgUrl, imgUrl, p.title?.replace(/^File:/, ""), "wikimedia");
          }
        }
      }
    })(),
  ];

  // 3. Optional Unsplash API (if UNSPLASH_ACCESS_KEY is configured in Vercel env)
  if (process.env.UNSPLASH_ACCESS_KEY) {
    tasks.push(
      (async () => {
        const r = await fetch(
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchTerm)}&per_page=8`,
          { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` } }
        );
        if (r.ok) {
          const d = await r.json();
          for (const item of d.results || []) {
            addResult(item.urls?.regular, item.urls?.small, item.alt_description, "unsplash");
          }
        }
      })()
    );
  }

  // 4. Optional Pexels API (if PEXELS_API_KEY is configured in Vercel env)
  if (process.env.PEXELS_API_KEY) {
    tasks.push(
      (async () => {
        const r = await fetch(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchTerm)}&per_page=8`,
          { headers: { Authorization: process.env.PEXELS_API_KEY } }
        );
        if (r.ok) {
          const d = await r.json();
          for (const item of d.photos || []) {
            addResult(item.src?.large, item.src?.medium, item.alt, "pexels");
          }
        }
      })()
    );
  }

  await Promise.allSettled(tasks);

  return res.status(200).json({
    query,
    translatedQuery: searchTerm,
    results: results.slice(0, 15),
  });
}
