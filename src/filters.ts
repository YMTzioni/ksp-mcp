import type { ProductItem } from "./ksp";
import type { YanivDeal } from "./yaniv";

export type SortField =
  | "score"
  | "price"
  | "discount"
  | "name"
  | "brand"
  | "savings";

export type SortDir = "asc" | "desc";

export interface ListFilters {
  text?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscount?: number;
  inStockOnly?: boolean;
  brand?: string;
  dealType?: string;
}

export interface SearchListItem extends ProductItem {
  effectivePrice: number;
  discountPercent: number;
  inStock: boolean;
}

export function enrichSearchItem(
  item: ProductItem & {
    addToCart?: boolean;
    outOfStock?: boolean;
    min_price?: number;
    price?: number;
  }
): SearchListItem {
  const price = item.price ?? 0;
  const effective =
    item.min_price && item.min_price < price ? item.min_price : price;
  const discountPercent =
    price > 0 && effective < price
      ? Math.round((1 - effective / price) * 100)
      : 0;
  return {
    ...item,
    effectivePrice: effective,
    discountPercent,
    inStock: Boolean(item.addToCart) && !item.outOfStock,
  };
}

export function parseFilters(params: URLSearchParams): ListFilters {
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

function matchText(text: string, q?: string): boolean {
  if (!q) return true;
  return text.toLowerCase().includes(q.toLowerCase());
}

export function filterSearchItems(
  items: SearchListItem[],
  f: ListFilters
): SearchListItem[] {
  return items.filter((item) => {
    if (f.inStockOnly && !item.inStock) return false;
    if (f.minPrice != null && item.effectivePrice < f.minPrice) return false;
    if (f.maxPrice != null && item.effectivePrice > f.maxPrice) return false;
    if (f.minDiscount != null && item.discountPercent < f.minDiscount)
      return false;
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

export function filterYanivDeals(
  deals: YanivDeal[],
  f: ListFilters
): YanivDeal[] {
  return deals.filter((d) => {
    if (f.inStockOnly && !d.inStock) return false;
    if (f.minPrice != null && d.effectivePrice < f.minPrice) return false;
    if (f.maxPrice != null && d.effectivePrice > f.maxPrice) return false;
    if (f.minDiscount != null && d.discountPercent < f.minDiscount) return false;
    if (f.brand && !(d.brandName || "").includes(f.brand)) return false;
    if (f.dealType && f.dealType !== "הכל" && !d.dealTypes.includes(f.dealType))
      return false;
    if (
      !matchText(
        [d.name, d.brandName, d.foundVia, ...d.dealTypes, ...d.reasons].join(
          " "
        ),
        f.text
      )
    )
      return false;
    return true;
  });
}

export function sortSearchItems(
  items: SearchListItem[],
  field: SortField,
  dir: SortDir
): SearchListItem[] {
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
        return (
          (b.price - b.effectivePrice) - (a.price - a.effectivePrice)
        ) * m;
      default:
        return 0;
    }
  });
}

export function sortYanivDeals(
  deals: YanivDeal[],
  field: SortField,
  dir: SortDir
): YanivDeal[] {
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

export interface YanivAnalytics {
  total: number;
  inStock: number;
  avgScore: number;
  avgDiscount: number;
  maxScore: number;
  byDealType: Record<string, number>;
  topBrands: { brand: string; count: number }[];
  priceRange: { min: number; max: number };
}

export function analyzeYanivDeals(deals: YanivDeal[]): YanivAnalytics {
  if (deals.length === 0) {
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

  const byDealType: Record<string, number> = {};
  const brandCounts: Record<string, number> = {};
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
    for (const t of d.dealTypes) {
      byDealType[t] = (byDealType[t] || 0) + 1;
    }
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
