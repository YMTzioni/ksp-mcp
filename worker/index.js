/** Proxy ל-API של KSP — עוקף CORS וחסימת פרוקסי ציבורי */
const KSP_API = "https://ksp.co.il/m_action/api";

const UPSTREAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: "https://ksp.co.il/web/",
  Origin: "https://ksp.co.il",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return Response.json(
        { status: "ok", service: "ksp-api-proxy" },
        { headers: CORS }
      );
    }

    let apiPath = url.pathname;
    if (apiPath.startsWith("/api/ksp")) {
      apiPath = apiPath.slice("/api/ksp".length);
    }
    if (!apiPath || apiPath === "/") {
      return Response.json(
        { error: "Use /category/ or /item/{id}" },
        { status: 400, headers: CORS }
      );
    }

    const target = `${KSP_API}${apiPath}${url.search}`;
    const upstream = await fetch(target, { headers: UPSTREAM_HEADERS });
    const text = await upstream.text();

    return new Response(text, {
      status: upstream.status,
      headers: {
        ...CORS,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  },
};
