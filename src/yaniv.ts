import { formatPrice, searchProducts, type ProductItem } from "./ksp";

export interface YanivQuery {
  id: string;
  label: string;
  query: string;
}

export const YANIV_QUERIES: YanivQuery[] = [
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

export interface RawKspItem extends ProductItem {
  eilatPrice?: number;
  min_eilat_price?: number;
  outOfStock?: boolean;
  addToCart?: boolean;
  redMsg?: unknown[];
  tags?: Record<string, string>;
  tags_data?: { id: number; hebrew_title: string }[];
  disPayments?: number;
}

export interface YanivDeal {
  uin: string;
  name: string;
  price: number;
  min_price?: number;
  eilatPrice?: number;
  brandName?: string;
  img?: string;
  description?: string;
  labels?: { msg: string }[];
  payments?: ProductItem["payments"];
  inStock: boolean;
  score: number;
  dealTypes: string[];
  reasons: string[];
  discountPercent: number;
  effectivePrice: number;
  foundVia: string;
  url: string;
}

interface DealRule {
  type: string;
  patterns: RegExp[];
  weight: number;
}

/** מוצרים שחוזרים מחיפוש ייעודי מקבלים בונוס — KSP כבר סיווג אותם */
const QUERY_BUCKET_BONUS: Record<string, { type: string; bonus: number }> = {
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

const DEAL_RULES: DealRule[] = [
  {
    type: "מציאון",
    patterns: [/מציאון/i, /metsion/i, /treasure/i],
    weight: 45,
  },
  {
    type: "חיסול מלאי",
    patterns: [
      /חיסול/i,
      /סייל/i,
      /מחסנ/i,
      /outlet/i,
      /ליקוי/i,
      /מלאי ישן/i,
      /overstock/i,
      /clearance/i,
      /end of line/i,
    ],
    weight: 40,
  },
  {
    type: "הריסת מחירים",
    patterns: [/הריסת מחיר/i, /מחירים בשקל/i, /price smash/i],
    weight: 38,
  },
  {
    type: "מוצר תצוגה",
    patterns: [/תצוגה/i, /open box/i, /box פתוח/i, /demo/i],
    weight: 32,
  },
  {
    type: "יד שניה",
    patterns: [/יד שניה/i, /יד-שניה/i, /used/i, /מחודש/i],
    weight: 30,
  },
  {
    type: "מבצע מיוחד",
    patterns: [
      /מבצע/i,
      /קופון/i,
      /הנחה/i,
      /sale/i,
      /משתתף בקופון/i,
      /מבצעי שבועות/i,
    ],
    weight: 22,
  },
];

function productText(item: RawKspItem): string {
  const parts = [
    item.name,
    item.description?.replace(/<[^>]+>/g, " "),
    item.brandName,
    JSON.stringify(item.tags ?? {}),
    ...(item.tags_data?.map((t) => t.hebrew_title) ?? []),
    ...(item.labels?.map((l) => l.msg) ?? []),
    ...(item.redMsg ?? []).filter((m): m is string => typeof m === "string"),
  ];
  return parts.filter(Boolean).join(" ");
}

export function scoreYanivItem(
  item: RawKspItem,
  foundVia: string,
  minScore = 18
): YanivDeal | null {
  const text = productText(item);
  const dealTypes: string[] = [];
  const reasons: string[] = [];
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
    if (pct >= 5) {
      if (!dealTypes.includes("מחיר אילת")) {
        dealTypes.push("מחיר אילת");
        score += 8 + Math.min(Math.round(pct / 2), 18);
        reasons.push(`מחיר אילת חסכוני ~${pct}% (${formatPrice(item.eilatPrice)})`);
      }
    }
  }

  const payEst = item.payments?.estimated_payment;
  if (payEst && price > 0 && payEst < price * 0.75) {
    const pct = Math.round((1 - payEst / price) * 100);
    if (!dealTypes.includes("תשלומים מוזלים")) {
      dealTypes.push("תשלומים מוזלים");
      score += 10;
      reasons.push(`תשלום מוערך נמוך: ${formatPrice(payEst)} לעומת ${formatPrice(price)}`);
    }
  }

  const bucket = QUERY_BUCKET_BONUS[foundVia];
  if (bucket) {
    if (!dealTypes.includes(bucket.type)) {
      dealTypes.push(bucket.type);
    }
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

  if (score < minScore) {
    return null;
  }

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
    url: `https://ksp.co.il/web/item/${item.uin}`,
  };
}

export interface YanivScanStepResult {
  query: string;
  queryLabel: string;
  page: number;
  scanned: number;
  deals: YanivDeal[];
  hasNext: boolean;
  error?: string;
}

export async function yanivScanStep(
  query: string,
  queryLabel: string,
  page: number,
  minScore = 18
): Promise<YanivScanStepResult> {
  const result = await searchProducts(query, page);

  if ("error" in result) {
    return {
      query,
      queryLabel,
      page,
      scanned: 0,
      deals: [],
      hasNext: false,
      error: result.error,
    };
  }

  const deals: YanivDeal[] = [];
  for (const item of result.items as RawKspItem[]) {
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
}

export function mergeYanivDeals(
  existing: Map<string, YanivDeal>,
  incoming: YanivDeal[]
): void {
  for (const deal of incoming) {
    const prev = existing.get(deal.uin);
    if (!prev || deal.score > prev.score) {
      const mergedTypes = new Set([
        ...(prev?.dealTypes ?? []),
        ...deal.dealTypes,
      ]);
      const mergedReasons = [
        ...new Set([...(prev?.reasons ?? []), ...deal.reasons]),
      ];
      existing.set(deal.uin, {
        ...deal,
        dealTypes: [...mergedTypes],
        reasons: mergedReasons,
        score: Math.max(prev?.score ?? 0, deal.score),
        foundVia: prev ? `${prev.foundVia}, ${deal.foundVia}` : deal.foundVia,
      });
    }
  }
}

export function yanivDealsToText(deals: YanivDeal[], limit = 25): string {
  if (deals.length === 0) {
    return "לא נמצאו המלצות בקטגוריית יניב בקריטריונים הנוכחיים.";
  }

  const sorted = [...deals].sort((a, b) => b.score - a.score).slice(0, limit);
  let text = `**קטגוריית יניב** — ${deals.length} המלצות למחירים שווים (מציג ${sorted.length}):\n\n`;

  sorted.forEach((d, i) => {
    text += `${i + 1}. **${d.name}** (ציון ${d.score})\n`;
    text += `   ${d.dealTypes.join(" · ")}\n`;
    text += `   מחיר: ${formatPrice(d.effectivePrice)}`;
    if (d.discountPercent > 0) text += ` (הנחה ~${d.discountPercent}%)`;
    text += `\n   ${d.reasons.slice(0, 3).join(" | ")}\n`;
    text += `   ${d.url}\n\n`;
  });

  return text;
}
