import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getProductDetail,
  productDetailToText,
  searchProducts,
  searchResultToText,
} from "./ksp";
import {
  analyzeYanivDeals,
  enrichSearchItem,
  filterSearchItems,
  filterYanivDeals,
  parseFilters,
  sortSearchItems,
  sortYanivDeals,
  type SortDir,
  type SortField,
} from "./filters";
import {
  compareProducts,
  investigateProduct,
  investigationToText,
} from "./investigate";
import {
  mergeYanivDeals,
  yanivDealsToText,
  yanivScanStep,
  YANIV_QUERIES,
  type YanivDeal,
} from "./yaniv";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withUtf8Charset(response: Response, contentType: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", contentType);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

async function handleApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === "POST" && url.pathname === "/api/yaniv/analyze") {
    const body = (await request.json().catch(() => ({}))) as {
      deals?: YanivDeal[];
    };
    const deals = body.deals ?? [];
    const filters = parseFilters(url.searchParams);
    const filtered = filterYanivDeals(deals, filters);
    const sort = (url.searchParams.get("sort") as SortField) || "score";
    const dir = (url.searchParams.get("dir") as SortDir) || "desc";
    const sorted = sortYanivDeals(filtered, sort, dir);
    return jsonResponse({
      analytics: analyzeYanivDeals(deals),
      filtered: sorted,
      count: sorted.length,
      total: deals.length,
    });
  }

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/health") {
    return jsonResponse({
      status: "ok",
      name: "ksp-mcp",
      version: "0.2.0",
      endpoints: {
        gui: "/",
        search: "/api/search?query=...&page=1",
        product: "/api/product?uin=...",
        yaniv: "/api/yaniv/config",
        yanivScan: "/api/yaniv/scan-step?query=...&page=1",
        sse: "/sse",
        mcp: "/mcp",
      },
    });
  }

  if (url.pathname === "/api/yaniv/config") {
    return jsonResponse({
      name: "יניב",
      description:
        "סורק מוצרים ב-KSP וממליץ על מציאונים, חיסול מלאי, הריסת מחירים ועוד",
      queries: YANIV_QUERIES,
      dealTypes: [
        "מציאון",
        "חיסול מלאי",
        "הריסת מחירים",
        "מוצר תצוגה",
        "יד שניה",
        "מבצע מיוחד",
        "מחיר מועדון",
        "מחיר אילת",
        "תשלומים מוזלים",
      ],
      defaults: { pagesPerQuery: 5, minScore: 18 },
    });
  }

  if (url.pathname === "/api/yaniv/scan-step") {
    const query = url.searchParams.get("query")?.trim();
    if (!query) {
      return jsonResponse({ error: "Missing query parameter" }, 400);
    }
    const queryLabel =
      url.searchParams.get("label")?.trim() ||
      YANIV_QUERIES.find((q) => q.query === query)?.label ||
      query;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const minScore = Math.max(
      0,
      parseInt(url.searchParams.get("minScore") || "18", 10) || 18
    );
    const result = await yanivScanStep(query, queryLabel, page, minScore);
    return jsonResponse(result);
  }

  if (url.pathname === "/api/search") {
    const query = url.searchParams.get("query")?.trim();
    if (!query) {
      return jsonResponse({ error: "Missing query parameter" }, 400);
    }
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const result = await searchProducts(query, page);
    if ("error" in result) {
      return jsonResponse(result, result.status);
    }

    const filters = parseFilters(url.searchParams);
    const sort = (url.searchParams.get("sort") as SortField) || "price";
    const dir = (url.searchParams.get("dir") as SortDir) || "asc";
    let items = result.items.map((i) => enrichSearchItem(i));
    const pageTotal = items.length;
    items = filterSearchItems(items, filters);
    items = sortSearchItems(items, sort, dir);

    return jsonResponse({
      ...result,
      items,
      pageTotal,
      filteredCount: items.length,
      sort,
      dir,
    });
  }

  if (url.pathname === "/api/investigate") {
    const uin = url.searchParams.get("uin")?.trim();
    if (!uin) return jsonResponse({ error: "Missing uin parameter" }, 400);
    const report = await investigateProduct(uin);
    if ("error" in report) {
      return jsonResponse(report, 400);
    }
    return jsonResponse(report);
  }

  if (url.pathname === "/api/compare") {
    const uins = url.searchParams.get("uins")?.trim();
    if (!uins) return jsonResponse({ error: "Missing uins parameter" }, 400);
    const list = uins.split(/[,;\s]+/).filter(Boolean);
    const result = await compareProducts(list);
    if ("error" in result) {
      return jsonResponse(result, 400);
    }
    return jsonResponse(result);
  }

  if (url.pathname === "/api/product") {
    const uin = url.searchParams.get("uin")?.trim();
    if (!uin) {
      return jsonResponse({ error: "Missing uin parameter" }, 400);
    }
    const result = await getProductDetail(uin);
    if ("error" in result) {
      return jsonResponse(result, result.status ?? 400);
    }
    return jsonResponse(result);
  }

  return null;
}

export class KspMCP extends McpAgent {
  server = new McpServer({
    name: "ksp-mcp",
    version: "0.1.0",
  });

  async init() {
    this.server.tool(
      "search_products",
      `Search for products on KSP.co.il — one of Israel's largest electronics and retail stores.
Returns product names, prices, descriptions, and links. Supports Hebrew and English search terms.`,
      {
        query: z
          .string()
          .describe(
            "Search term (e.g. 'iphone 15', 'מקלדת', 'אוזניות')"
          ),
        page: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe("Page number for pagination (default: 1, 12 items per page)"),
      },
      async ({ query, page }) => {
        const result = await searchProducts(query, page);

        if ("error" in result) {
          return {
            content: [{ type: "text" as const, text: result.error }],
          };
        }

        const startIndex = (page - 1) * 12 + 1;
        return {
          content: [
            {
              type: "text" as const,
              text: searchResultToText(result, startIndex),
            },
          ],
        };
      }
    );

    this.server.tool(
      "get_product",
      `Get detailed information about a specific product on KSP.co.il including specs, variations, stock, and images.`,
      {
        uin: z
          .string()
          .describe(
            "Product UIN (ID number) from KSP, e.g. '368086'. Can also be a full URL."
          ),
      },
      async ({ uin }) => {
        const result = await getProductDetail(uin);

        if ("error" in result) {
          return {
            content: [{ type: "text" as const, text: result.error }],
          };
        }

        return {
          content: [
            { type: "text" as const, text: productDetailToText(result) },
          ],
        };
      }
    );

    this.server.tool(
      "yaniv_recommendations",
      `Scan KSP.co.il for exceptional deals — Yaniv's category. Finds bargains like מציאון (treasure hunt), חיסול מלאי (clearance), הריסת מחירים, outlet, display items, club discounts, and Eilat prices. Returns scored recommendations.`,
      {
        pages_per_query: z
          .number()
          .int()
          .min(1)
          .max(15)
          .default(3)
          .describe("Pages to scan per search bucket (12 items each)"),
        min_score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .default(18)
          .describe("Minimum deal score (0-100)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max recommendations to return"),
      },
      async ({ pages_per_query, min_score, limit }) => {
        const all = new Map<string, import("./yaniv").YanivDeal>();

        for (const q of YANIV_QUERIES) {
          for (let page = 1; page <= pages_per_query; page++) {
            const step = await yanivScanStep(q.query, q.label, page, min_score);
            if (step.error) continue;
            mergeYanivDeals(all, step.deals);
            if (!step.hasNext) break;
          }
        }

        const deals = [...all.values()].sort((a, b) => b.score - a.score);
        return {
          content: [
            {
              type: "text" as const,
              text: yanivDealsToText(deals, limit),
            },
          ],
        };
      }
    );

    this.server.tool(
      "investigate_product",
      "Deep price investigation for a KSP product: best price tier, savings, Yaniv score, insights, and similar products.",
      {
        uin: z.string().describe("Product UIN or KSP URL"),
      },
      async ({ uin }) => {
        const report = await investigateProduct(uin);
        if ("error" in report) {
          return { content: [{ type: "text" as const, text: report.error }] };
        }
        return {
          content: [{ type: "text" as const, text: investigationToText(report) }],
        };
      }
    );

    this.server.tool(
      "compare_products",
      "Compare up to 5 KSP products side by side by price, stock, and Yaniv deal score.",
      {
        uins: z
          .array(z.string())
          .min(2)
          .max(5)
          .describe("Product UINs or URLs to compare"),
      },
      async ({ uins }) => {
        const result = await compareProducts(uins);
        if ("error" in result) {
          return { content: [{ type: "text" as const, text: result.error }] };
        }
        let text = "**השוואת מוצרים**\n\n";
        for (const r of result.rows) {
          text += `- **${r.name}** — ${r.bestLabel}: ₪${r.bestPrice} (ציון ${r.yanivScore}) ${r.inStock ? "במלאי" : "אזל"}\n`;
        }
        return { content: [{ type: "text" as const, text }] };
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    const apiResponse = await handleApi(request);
    if (apiResponse) return apiResponse;

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return KspMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/message") {
      return KspMCP.serve("/mcp").fetch(request, env, ctx);
    }

    if (
      url.pathname === "/" ||
      url.pathname === "/gui" ||
      url.pathname === "/index.html" ||
      url.pathname === "/favicon.ico"
    ) {
      if (url.pathname === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }
      const assetUrl = new URL("/index.html", request.url);
      const assetRequest = new Request(assetUrl.toString(), request);
      const assetResponse = await env.ASSETS.fetch(assetRequest);
      if (assetResponse.status !== 404) {
        return withUtf8Charset(assetResponse, "text/html; charset=utf-8");
      }
    }

    if (
      url.pathname.startsWith("/js/") ||
      url.pathname.startsWith("/css/")
    ) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        const type = url.pathname.endsWith(".js")
          ? "application/javascript; charset=utf-8"
          : "text/css; charset=utf-8";
        return withUtf8Charset(assetResponse, type);
      }
    }

    if (url.pathname === "/info") {
      return jsonResponse({
        name: "ksp-mcp",
        description: "MCP server for searching products on KSP.co.il",
        endpoints: {
          gui: "/",
          search: "/api/search",
          product: "/api/product",
          sse: "/sse",
          mcp: "/mcp",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

interface Env {
  ASSETS: Fetcher;
}
