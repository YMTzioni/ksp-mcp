/* Client-side KSP API — runs fully in the browser (GitHub Pages) */
(function (global) {
  const KSP_API = "https://ksp.co.il/m_action/api";
  const KSP_WEB = "https://ksp.co.il/web";

  const YANIV_QUERIES = [
    { id: "metsion", label: "מציאון", query: "מציאון" },
    { id: "hisul", label: "חיסול מלאי", query: "חיסול מלאי" },
    { id: "harisa", label: "הריסת מחירים", query: "הריסת מחירים" },
    { id: "outlet", label: "Outlet", query: "outlet" },
    { id: "tzuga", label: "מוצרי תצוגה", query: "מוצרי תצוגה" },
    { id: "sale", label: "מבצעים", query: "מבצע" },
    { id: "second", label: "יד שניה", query: "יד שניה" },
    { id: "warehouse", label: "מחסנים", query: "מחסנים" },
    { id: "openbox", label: "Open Box", query: "open box" },
    { id: "clearance", label: "סייל", query: "סייל" },
  ];

  const QUERY_BUCKET_BONUS = {
    מציאון: { type: "מציאון", bonus: 28 },
    "חיסול מלאי": { type: "חיסול מלאי", bonus: 28 },
    "הריסת מחירים": { type: "הריסת מחירים", bonus: 26 },
    Outlet: { type: "חיסול מלאי", bonus: 24 },
    "מוצרי תצוגה": { type: "מוצר תצוגה", bonus: 24 },
    מבצעים: { type: "מבצע מיוחד", bonus: 20 },
    "יד שניה": { type: "יד שניה", bonus: 24 },
    מחסנים: { type: "חיסול מלאי", bonus: 22 },
    "Open Box": { type: "מוצר תצוגה", bonus: 24 },
    סייל: { type: "חיסול מלאי", bonus: 22 },
  };

  const DEAL_RULES = [
    { type: "מציאון", patterns: [/מציאון/i, /metsion/i, /treasure/i], weight: 45 },
    {
      type: "חיסול מלאי",
      patterns: [/חיסול/i, /סייל/i, /מחסנ/i, /outlet/i, /ליקוי/i, /מלאי ישן/i, /overstock/i, /clearance/i, /end of line/i],
      weight: 40,
    },
    { type: "הריסת מחירים", patterns: [/הריסת מחיר/i, /מחירים בשקל/i, /price smash/i], weight: 38 },
    { type: "מוצר תצוגה", patterns: [/תצוגה/i, /open box/i, /box פתוח/i, /demo/i], weight: 32 },
    { type: "יד שניה", patterns: [/יד שניה/i, /יד-שניה/i, /used/i, /מחודש/i], weight: 30 },
    { type: "מבצע מיוחד", patterns: [/מבצע/i, /קופון/i, /הנחה/i, /sale/i, /משתתף בקופון/i, /מבצעי שבועות/i], weight: 22 },
  ];

  function formatPrice(price) {
    if (price == null) return null;
    return `₪${Math.round(price).toLocaleString("en-US")}`;
  }

  function getApiProxy() {
    const cfg = global.__KSP_CONFIG__ || {};
    return (cfg.apiProxy || "").trim().replace(/\/$/, "");
  }

  function parseKspJson(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("<") || trimmed.startsWith("<!")) {
      throw new Error("KSP חסם את הבקשה (403). נדרש שרת API פעיל.");
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("תשובה לא תקינה מ-KSP");
    }
  }

  async function readKspResponse(resp) {
    if (!resp.ok) {
      const err = new Error(`שגיאת KSP: ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return parseKspJson(await resp.text());
  }

  async function kspFetch(apiPath) {
    const apiProxy = getApiProxy();
    if (apiProxy) {
      const resp = await fetch(`${apiProxy}${apiPath}`, {
        headers: { Accept: "application/json" },
      });
      return readKspResponse(resp);
    }

    const url = `${KSP_API}${apiPath}`;
    const attempts = [
      async () => {
        const r = await fetch(
          `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
          { headers: { Accept: "application/json" } }
        );
        if (!r.ok) throw new Error(`proxy ${r.status}`);
        const wrap = await r.json();
        return parseKspJson(wrap.contents || "");
      },
      async () => {
        const r = await fetch(
          `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
          { headers: { Accept: "application/json" } }
        );
        return readKspResponse(r);
      },
    ];

    let lastErr;
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (e) {
        lastErr = e;
        console.warn("KSP fetch attempt failed", e);
      }
    }
    throw (
      lastErr ||
      new Error(
        "לא ניתן להתחבר ל-KSP. יש לפרוס את שרת ה-API (Cloudflare Worker) — ראה README."
      )
    );
  }

  async function searchProducts(query, page) {
    const params = new URLSearchParams({ search: query });
    if (page > 1) params.set("page", String(page));
    const json = await kspFetch(`/category/?${params}`);
    const result = json.result || {};
    const items = result.items || [];
    return {
      query,
      page,
      total: result.products_total ?? items.length,
      items,
      minMax: result.minMax,
      hasNext: Boolean(result.next && result.next > 0),
      searchUrl: `${KSP_WEB}/cat/?search=${encodeURIComponent(query)}`,
    };
  }

  async function getProductDetail(uin) {
    const match = String(uin).match(/\d+/);
    if (!match) throw new Error("Invalid product ID.");
    const productId = match[0];
    const json = await kspFetch(`/item/${productId}`);
    const r = json.result;
    const d = r.data;
    const options = r.products_options || {};
    const render = options.render || {};
    const tags = render.tags || {};

    const optionList = Object.values(tags).map((tagGroup) => ({
      name: tagGroup.name,
      values: tagGroup.items.map((i) => i.name),
    }));

    const variations = (options.variations || [])
      .filter((v) => Object.keys(v.tags || {}).length > 0)
      .map((v) => {
        const varParts = [];
        for (const [k, vId] of Object.entries(v.tags)) {
          const tagGroup = tags[k];
          if (tagGroup) {
            const item = tagGroup.items.find((i) => String(i.id) === String(vId));
            if (item) varParts.push(`${tagGroup.name}: ${item.name}`);
          }
        }
        const varData = v.data || {};
        const price = Math.round(varData.price || 0);
        const bms = varData.bms_price;
        return {
          label: varParts.join(", "),
          price: formatPrice(price),
          clubPrice: bms && bms !== price ? formatPrice(bms) : null,
        };
      });

    const images = (r.images || [])
      .slice(0, 8)
      .map((img) => (typeof img === "string" ? img : img.url));

    const branches = (r.stock || [])
      .slice(0, 10)
      .map((s) => s.name || s.title || "")
      .filter(Boolean);

    return {
      uin: productId,
      name: d.name,
      price: d.price,
      min_price: d.min_price,
      eilatPrice: d.eilatPrice,
      brandName: d.brandName,
      inStock: Boolean(d.addToCart),
      description: d.smalldesc,
      options: optionList,
      variations,
      specifications: r.specification || [],
      images,
      branches,
      payments: r.payments,
      url: `${KSP_WEB}/item/${productId}`,
    };
  }

  function enrichSearchItem(item) {
    const price = item.price ?? 0;
    const effective = item.min_price && item.min_price < price ? item.min_price : price;
    const discountPercent =
      price > 0 && effective < price ? Math.round((1 - effective / price) * 100) : 0;
    return {
      ...item,
      effectivePrice: effective,
      discountPercent,
      inStock: Boolean(item.addToCart) && !item.outOfStock,
    };
  }

  function parseFilters(params) {
    const minPrice = params.get("minPrice");
    const maxPrice = params.get("maxPrice");
    const minDiscount = params.get("minDiscount");
    return {
      text: params.get("q")?.trim() || undefined,
      minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
      maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
      minDiscount: minDiscount ? parseInt(minDiscount, 10) : undefined,
      inStockOnly: params.get("inStock") === "1",
      brand: params.get("brand")?.trim() || undefined,
      dealType: params.get("dealType")?.trim() || undefined,
    };
  }

  function matchText(text, q) {
    if (!q) return true;
    return text.toLowerCase().includes(q.toLowerCase());
  }

  function filterSearchItems(items, f) {
    return items.filter((item) => {
      if (f.inStockOnly && !item.inStock) return false;
      if (f.minPrice != null && item.effectivePrice < f.minPrice) return false;
      if (f.maxPrice != null && item.effectivePrice > f.maxPrice) return false;
      if (f.minDiscount != null && item.discountPercent < f.minDiscount) return false;
      if (f.brand && !(item.brandName || "").includes(f.brand)) return false;
      if (
        !matchText(
          [item.name, item.brandName, item.description].filter(Boolean).join(" "),
          f.text
        )
      )
        return false;
      return true;
    });
  }

  function filterYanivDeals(deals, f) {
    return deals.filter((d) => {
      if (f.inStockOnly && !d.inStock) return false;
      if (f.minPrice != null && d.effectivePrice < f.minPrice) return false;
      if (f.maxPrice != null && d.effectivePrice > f.maxPrice) return false;
      if (f.minDiscount != null && d.discountPercent < f.minDiscount) return false;
      if (f.brand && !(d.brandName || "").includes(f.brand)) return false;
      if (f.dealType && f.dealType !== "הכל" && !d.dealTypes.includes(f.dealType)) return false;
      if (
        !matchText(
          [d.name, d.brandName, d.foundVia, ...d.dealTypes, ...d.reasons].join(" "),
          f.text
        )
      )
        return false;
      return true;
    });
  }

  function sortSearchItems(items, field, dir) {
    const m = dir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      switch (field) {
        case "price":
          return (a.effectivePrice - b.effectivePrice) * m;
        case "discount":
          return (a.discountPercent - b.discountPercent) * m;
        case "name":
          return a.name.localeCompare(b.name, "he") * m;
        case "brand":
          return (a.brandName || "").localeCompare(b.brandName || "", "he") * m;
        case "savings":
          return (b.price - b.effectivePrice - (a.price - a.effectivePrice)) * m;
        default:
          return 0;
      }
    });
  }

  function sortYanivDeals(deals, field, dir) {
    const m = dir === "asc" ? 1 : -1;
    return [...deals].sort((a, b) => {
      switch (field) {
        case "score":
          return (a.score - b.score) * m;
        case "price":
          return (a.effectivePrice - b.effectivePrice) * m;
        case "discount":
          return (a.discountPercent - b.discountPercent) * m;
        case "name":
          return a.name.localeCompare(b.name, "he") * m;
        case "brand":
          return (a.brandName || "").localeCompare(b.brandName || "", "he") * m;
        case "savings":
          return (b.price - b.effectivePrice - (a.price - a.effectivePrice)) * m;
        default:
          return (a.score - b.score) * m;
      }
    });
  }

  function analyzeYanivDeals(deals) {
    if (!deals.length) {
      return {
        total: 0,
        inStock: 0,
        avgScore: 0,
        avgDiscount: 0,
        maxScore: 0,
        byDealType: {},
        topBrands: [],
        priceRange: { min: 0, max: 0 },
      };
    }
    const byDealType = {};
    const brandCounts = {};
    let scoreSum = 0;
    let discSum = 0;
    let maxScore = 0;
    let inStock = 0;
    let minP = Infinity;
    let maxP = 0;
    for (const d of deals) {
      scoreSum += d.score;
      discSum += d.discountPercent;
      maxScore = Math.max(maxScore, d.score);
      if (d.inStock) inStock++;
      minP = Math.min(minP, d.effectivePrice);
      maxP = Math.max(maxP, d.effectivePrice);
      for (const t of d.dealTypes) byDealType[t] = (byDealType[t] || 0) + 1;
      const b = d.brandName || "אחר";
      brandCounts[b] = (brandCounts[b] || 0) + 1;
    }
    const topBrands = Object.entries(brandCounts)
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    return {
      total: deals.length,
      inStock,
      avgScore: Math.round(scoreSum / deals.length),
      avgDiscount: Math.round(discSum / deals.length),
      maxScore,
      byDealType,
      topBrands,
      priceRange: { min: minP === Infinity ? 0 : minP, max: maxP },
    };
  }

  function productText(item) {
    const parts = [
      item.name,
      item.description?.replace(/<[^>]+>/g, " "),
      item.brandName,
      JSON.stringify(item.tags ?? {}),
      ...(item.tags_data?.map((t) => t.hebrew_title) ?? []),
      ...(item.labels?.map((l) => l.msg) ?? []),
      ...(item.redMsg ?? []).filter((m) => typeof m === "string"),
    ];
    return parts.filter(Boolean).join(" ");
  }

  function scoreYanivItem(item, foundVia, minScore = 18) {
    const text = productText(item);
    const dealTypes = [];
    const reasons = [];
    let score = 0;

    for (const rule of DEAL_RULES) {
      if (rule.patterns.some((p) => p.test(text))) {
        if (!dealTypes.includes(rule.type)) {
          dealTypes.push(rule.type);
          score += rule.weight;
          reasons.push(`סיווג: ${rule.type}`);
        }
      }
    }

    let discountPercent = 0;
    const price = item.price ?? 0;
    let effectivePrice = price;

    if (item.min_price && price > 0 && item.min_price < price) {
      const pct = Math.round((1 - item.min_price / price) * 100);
      if (pct >= 3) {
        discountPercent = Math.max(discountPercent, pct);
        effectivePrice = Math.min(effectivePrice, item.min_price);
        if (!dealTypes.includes("מחיר מועדון")) {
          dealTypes.push("מחיר מועדון");
          score += 12 + Math.min(pct, 35);
          reasons.push(`הנחת מועדון ${pct}% (${formatPrice(item.min_price)})`);
        }
      }
    }

    if (item.eilatPrice && price > 0 && item.eilatPrice < price * 0.95) {
      const pct = Math.round((1 - item.eilatPrice / price) * 100);
      if (pct >= 5 && !dealTypes.includes("מחיר אילת")) {
        dealTypes.push("מחיר אילת");
        score += 8 + Math.min(Math.round(pct / 2), 18);
        reasons.push(`מחיר אילת חסכוני ~${pct}% (${formatPrice(item.eilatPrice)})`);
      }
    }

    const payEst = item.payments?.estimated_payment;
    if (payEst && price > 0 && payEst < price * 0.75) {
      if (!dealTypes.includes("תשלומים מוזלים")) {
        dealTypes.push("תשלומים מוזלים");
        score += 10;
        reasons.push(`תשלום מוערך נמוך: ${formatPrice(payEst)} לעומת ${formatPrice(price)}`);
      }
    }

    const bucket = QUERY_BUCKET_BONUS[foundVia];
    if (bucket) {
      if (!dealTypes.includes(bucket.type)) dealTypes.push(bucket.type);
      score += bucket.bonus;
      reasons.push(`בקטלוג KSP: ${foundVia}`);
    } else if (foundVia) {
      score += 5;
      reasons.push(`נמצא בחיפוש: ${foundVia}`);
    }

    const inStock = Boolean(item.addToCart) && !item.outOfStock;
    if (!inStock) {
      score -= 25;
      reasons.push("לא במלאי כרגע");
    } else {
      score += 3;
    }

    if (score < minScore) return null;

    return {
      uin: String(item.uin),
      name: item.name,
      price,
      min_price: item.min_price,
      eilatPrice: item.eilatPrice,
      brandName: item.brandName,
      img: item.img,
      description: item.description?.replace(/<[^>]+>/g, " ").trim(),
      labels: item.labels,
      payments: item.payments,
      inStock,
      score: Math.round(score),
      dealTypes,
      reasons,
      discountPercent,
      effectivePrice,
      foundVia,
      url: `${KSP_WEB}/item/${item.uin}`,
    };
  }

  async function yanivScanStep(query, queryLabel, page, minScore = 18) {
    try {
      const result = await searchProducts(query, page);
      const deals = [];
      for (const item of result.items) {
        const deal = scoreYanivItem(item, queryLabel, minScore);
        if (deal) deals.push(deal);
      }
      return {
        query,
        queryLabel,
        page,
        scanned: result.items.length,
        deals,
        hasNext: result.hasNext,
      };
    } catch (e) {
      return {
        query,
        queryLabel,
        page,
        scanned: 0,
        deals: [],
        hasNext: false,
        error: e.message,
      };
    }
  }

  function buildPriceTiers(price, min_price, eilatPrice, payments) {
    const tiers = [];
    const add = (label, p) => {
      if (p <= 0) return;
      const savings = Math.max(0, price - p);
      tiers.push({
        label,
        price: p,
        formatted: formatPrice(p) ?? `₪${p}`,
        savingsVsList: savings,
        savingsPercent: price > 0 ? Math.round((savings / price) * 100) : 0,
      });
    };
    add("מחיר רגיל", price);
    if (min_price && min_price !== price) add("מחיר מועדון", min_price);
    if (eilatPrice && eilatPrice < price) add("מחיר אילת", eilatPrice);
    if (payments?.estimated_payment && payments.estimated_payment < price) {
      add(
        `תשלום מוערך (${payments.max_num_payments_wo_interest || "?"} תשלומים)`,
        payments.estimated_payment
      );
    }
    return tiers.sort((a, b) => a.price - b.price);
  }

  async function investigateProduct(uin) {
    const product = await getProductDetail(uin);
    const rawItem = {
      uin: product.uin,
      name: product.name,
      price: product.price,
      min_price: product.min_price,
      eilatPrice: product.eilatPrice,
      brandName: product.brandName,
      addToCart: product.inStock,
      outOfStock: !product.inStock,
      description: product.description,
      payments: product.payments,
    };
    const yanivDeal = scoreYanivItem(rawItem, "תחקור", 0);
    const priceTiers = buildPriceTiers(
      product.price,
      product.min_price,
      product.eilatPrice,
      product.payments
    );
    const best = priceTiers[0];
    const listPrice = product.price;
    const maxSavings = listPrice - (best?.price ?? listPrice);
    const maxSavingsPercent =
      listPrice > 0 ? Math.round((maxSavings / listPrice) * 100) : 0;
    const insights = [];
    if (maxSavingsPercent >= 10) {
      insights.push(`חיסכון משמעותי עד ${maxSavingsPercent}% לעומת מחיר הרשימה`);
    }
    if (product.min_price && product.min_price < product.price) {
      insights.push("כדאי לבדוק מחיר מועדון KSP");
    }
    if (product.eilatPrice && product.eilatPrice < product.price * 0.92) {
      insights.push("מחיר אילת משתלם לרכישה באילת");
    }
    if (!product.inStock) insights.push("המוצר לא במלאי — שווה לעקוב אחרי חזרה למלאי");
    else insights.push("המוצר זמין לרכישה כעת");
    if (yanivDeal && yanivDeal.score >= 30) {
      insights.push(`ציון יניב ${yanivDeal.score}: ${yanivDeal.dealTypes.join(", ")}`);
    }
    if (product.variations.length > 1) {
      insights.push(`קיימות ${product.variations.length} וריאציות מחיר`);
    }
    if (product.branches.length > 0) {
      insights.push(`זמין באיסוף מ-${product.branches.length} סניפים`);
    }

    let similar = [];
    const searchTerm = product.name.split(" ").slice(0, 3).join(" ");
    if (searchTerm.length >= 3) {
      try {
        const sr = await searchProducts(searchTerm, 1);
        similar = sr.items
          .filter((i) => String(i.uin) !== product.uin)
          .slice(0, 6)
          .map((i) => ({
            uin: String(i.uin),
            name: i.name,
            price:
              i.min_price && i.min_price < (i.price ?? 0) ? i.min_price : (i.price ?? 0),
            url: `${KSP_WEB}/item/${i.uin}`,
          }));
      } catch {
        /* ignore */
      }
    }

    return {
      uin: product.uin,
      product,
      yanivDeal,
      priceTiers,
      bestPrice: best?.price ?? product.price,
      bestLabel: best?.label ?? "מחיר רגיל",
      maxSavings,
      maxSavingsPercent,
      insights,
      similar,
    };
  }

  async function compareProducts(uins) {
    const unique = [
      ...new Set(
        uins.map((u) => String(u).match(/\d+/)?.[0]).filter(Boolean)
      ),
    ];
    if (unique.length < 2) throw new Error("נדרשים לפחות 2 מזהי מוצר להשוואה");
    if (unique.length > 5) throw new Error("ניתן להשוות עד 5 מוצרים");

    const rows = [];
    for (const id of unique) {
      try {
        const p = await getProductDetail(id);
        const deal = scoreYanivItem(
          {
            uin: p.uin,
            name: p.name,
            price: p.price,
            min_price: p.min_price,
            eilatPrice: p.eilatPrice,
            brandName: p.brandName,
            addToCart: p.inStock,
            outOfStock: !p.inStock,
          },
          "השוואה",
          0
        );
        const tiers = buildPriceTiers(p.price, p.min_price, p.eilatPrice, p.payments);
        const best = tiers[0];
        rows.push({
          uin: p.uin,
          name: p.name,
          brandName: p.brandName || "—",
          inStock: p.inStock,
          listPrice: p.price,
          bestPrice: best?.price ?? p.price,
          bestLabel: best?.label ?? "רגיל",
          eilatPrice: p.eilatPrice,
          yanivScore: deal?.score ?? 0,
          dealTypes: deal?.dealTypes ?? [],
          url: p.url,
        });
      } catch {
        /* skip */
      }
    }
    if (rows.length < 2) throw new Error("לא ניתן היה לטעון מספיק מוצרים להשוואה");
    return { rows: rows.sort((a, b) => a.bestPrice - b.bestPrice) };
  }

  async function clientApi(path, opts = {}) {
    const u = new URL(path, "https://local");
    const params = u.searchParams;

    if (opts.method === "POST" && u.pathname === "/api/yaniv/analyze") {
      const body = opts.body ? JSON.parse(opts.body) : {};
      const deals = body.deals ?? [];
      const filters = parseFilters(params);
      const sort = params.get("sort") || "score";
      const dir = params.get("dir") || "desc";
      const filtered = sortYanivDeals(filterYanivDeals(deals, filters), sort, dir);
      return {
        analytics: analyzeYanivDeals(deals),
        filtered,
        count: filtered.length,
        total: deals.length,
      };
    }

    if (u.pathname === "/api/health") {
      const apiProxy = getApiProxy();
      if (apiProxy) {
        try {
          const r = await fetch(`${apiProxy}/health`, {
            headers: { Accept: "application/json" },
          });
          if (!r.ok) throw new Error("proxy down");
        } catch {
          return {
            status: "error",
            message: "שרת API לא זמין — פרוס מחדש את ה-Worker",
            apiProxy,
          };
        }
      }
      return {
        status: "ok",
        name: "ksp-deals",
        version: "1.0.0",
        mode: "client",
        apiProxy: apiProxy || null,
      };
    }

    if (u.pathname === "/api/yaniv/config") {
      return {
        name: "יניב",
        description: "סורק מוצרים ב-KSP וממליץ על מציאונים, חיסול מלאי, הריסת מחירים ועוד",
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
      };
    }

    if (u.pathname === "/api/yaniv/scan-step") {
      const query = params.get("query")?.trim();
      if (!query) throw new Error("Missing query parameter");
      const queryLabel =
        params.get("label")?.trim() ||
        YANIV_QUERIES.find((q) => q.query === query)?.label ||
        query;
      const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
      const minScore = Math.max(0, parseInt(params.get("minScore") || "18", 10) || 18);
      return yanivScanStep(query, queryLabel, page, minScore);
    }

    if (u.pathname === "/api/search") {
      const query = params.get("query")?.trim();
      if (!query) throw new Error("Missing query parameter");
      const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
      const result = await searchProducts(query, page);
      const filters = parseFilters(params);
      const sort = params.get("sort") || "price";
      const dir = params.get("dir") || "asc";
      let items = result.items.map(enrichSearchItem);
      const pageTotal = items.length;
      items = sortSearchItems(filterSearchItems(items, filters), sort, dir);
      return {
        ...result,
        items,
        pageTotal,
        filteredCount: items.length,
        sort,
        dir,
      };
    }

    if (u.pathname === "/api/investigate") {
      const id = params.get("uin")?.trim();
      if (!id) throw new Error("Missing uin parameter");
      return investigateProduct(id);
    }

    if (u.pathname === "/api/compare") {
      const raw = params.get("uins")?.trim();
      if (!raw) throw new Error("Missing uins parameter");
      return compareProducts(raw.split(/[,;\s]+/).filter(Boolean));
    }

    if (u.pathname === "/api/product") {
      const id = params.get("uin")?.trim();
      if (!id) throw new Error("Missing uin parameter");
      return getProductDetail(id);
    }

    throw new Error(`Unknown API: ${u.pathname}`);
  }

  global.KspClient = { api: clientApi };
})(typeof window !== "undefined" ? window : globalThis);
