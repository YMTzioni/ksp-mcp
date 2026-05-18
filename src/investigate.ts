import { formatPrice, getProductDetail, searchProducts } from "./ksp";
import { scoreYanivItem, type RawKspItem, type YanivDeal } from "./yaniv";

export interface PriceTier {
  label: string;
  price: number;
  formatted: string;
  savingsVsList: number;
  savingsPercent: number;
}

export interface InvestigationReport {
  uin: string;
  product: Awaited<ReturnType<typeof getProductDetail>>;
  yanivDeal: YanivDeal | null;
  priceTiers: PriceTier[];
  bestPrice: number;
  bestLabel: string;
  maxSavings: number;
  maxSavingsPercent: number;
  insights: string[];
  similar: { uin: string; name: string; price: number; url: string }[];
}

function buildPriceTiers(
  price: number,
  min_price?: number,
  eilatPrice?: number,
  payments?: { estimated_payment?: number; max_num_payments_wo_interest?: number }
): PriceTier[] {
  const tiers: PriceTier[] = [];
  const add = (label: string, p: number) => {
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

export async function investigateProduct(
  uin: string
): Promise<InvestigationReport | { error: string }> {
  const product = await getProductDetail(uin);
  if ("error" in product) {
    return { error: product.error };
  }

  const rawItem: RawKspItem = {
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

  const insights: string[] = [];

  if (maxSavingsPercent >= 10) {
    insights.push(`חיסכון משמעותי עד ${maxSavingsPercent}% לעומת מחיר הרשימה`);
  }
  if (product.min_price && product.min_price < product.price) {
    insights.push("כדאי לבדוק מחיר מועדון KSP");
  }
  if (product.eilatPrice && product.eilatPrice < product.price * 0.92) {
    insights.push("מחיר אילת משתלם לרכישה באילת");
  }
  if (!product.inStock) {
    insights.push("המוצר לא במלאי — שווה לעקוב אחרי חזרה למלאי");
  } else {
    insights.push("המוצר זמין לרכישה כעת");
  }
  if (yanivDeal && yanivDeal.score >= 30) {
    insights.push(
      `ציון יניב ${yanivDeal.score}: ${yanivDeal.dealTypes.join(", ")}`
    );
  }
  if (product.variations.length > 1) {
    insights.push(`קיימות ${product.variations.length} וריאציות מחיר`);
  }
  if (product.branches.length > 0) {
    insights.push(`זמין באיסוף מ-${product.branches.length} סניפים`);
  }

  let similar: InvestigationReport["similar"] = [];
  const searchTerm = product.name.split(" ").slice(0, 3).join(" ");
  if (searchTerm.length >= 3) {
    const sr = await searchProducts(searchTerm, 1);
    if (!("error" in sr)) {
      similar = sr.items
        .filter((i) => String(i.uin) !== product.uin)
        .slice(0, 6)
        .map((i) => ({
          uin: String(i.uin),
          name: i.name,
          price: i.min_price && i.min_price < (i.price ?? 0) ? i.min_price : (i.price ?? 0),
          url: `https://ksp.co.il/web/item/${i.uin}`,
        }));
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

export interface CompareRow {
  uin: string;
  name: string;
  brandName: string;
  inStock: boolean;
  listPrice: number;
  bestPrice: number;
  bestLabel: string;
  eilatPrice?: number;
  yanivScore: number;
  dealTypes: string[];
  url: string;
}

export async function compareProducts(
  uins: string[]
): Promise<{ rows: CompareRow[] } | { error: string }> {
  const unique = [...new Set(uins.map((u) => u.match(/\d+/)?.[0]).filter(Boolean))];
  if (unique.length < 2) {
    return { error: "נדרשים לפחות 2 מזהי מוצר להשוואה" };
  }
  if (unique.length > 5) {
    return { error: "ניתן להשוות עד 5 מוצרים" };
  }

  const rows: CompareRow[] = [];

  for (const id of unique) {
    const p = await getProductDetail(id!);
    if ("error" in p) continue;

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
  }

  if (rows.length < 2) {
    return { error: "לא ניתן היה לטעון מספיק מוצרים להשוואה" };
  }

  return { rows: rows.sort((a, b) => a.bestPrice - b.bestPrice) };
}

export function investigationToText(r: InvestigationReport): string {
  const p = r.product;
  if ("error" in p) return "שגיאה";

  let text = `## תחקור: ${p.name}\n\n`;
  text += `**המחיר הטוב ביותר:** ${formatPrice(r.bestPrice)} (${r.bestLabel})\n`;
  if (r.maxSavingsPercent > 0) {
    text += `**חיסכון מקסימלי:** ${formatPrice(r.maxSavings)} (${r.maxSavingsPercent}%)\n`;
  }
  text += `\n### מדרג מחירים\n`;
  for (const t of r.priceTiers) {
    text += `- ${t.label}: ${t.formatted}`;
    if (t.savingsVsList > 0) text += ` (חיסכון ${t.savingsPercent}%)`;
    text += `\n`;
  }
  text += `\n### תובנות\n`;
  for (const i of r.insights) text += `- ${i}\n`;
  if (r.similar.length) {
    text += `\n### מוצרים דומים\n`;
    for (const s of r.similar) {
      text += `- ${s.name}: ${formatPrice(s.price)} — ${s.url}\n`;
    }
  }
  text += `\n${p.url}`;
  return text;
}
