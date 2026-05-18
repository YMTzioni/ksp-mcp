export const KSP_API = "https://ksp.co.il/m_action/api";
export const KSP_WEB = "https://ksp.co.il/web";

export const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: `${KSP_WEB}/`,
  Origin: "https://ksp.co.il",
};

export interface Label {
  msg: string;
}

export interface Payments {
  max_num_payments_wo_interest?: number;
  estimated_payment?: number;
}

export interface ProductItem {
  name: string;
  uin: string;
  price?: number;
  min_price?: number;
  brandName?: string;
  labels?: Label[];
  payments?: Payments;
  description?: string;
  img?: string;
}

export function formatPrice(price: number | null | undefined): string | null {
  if (price == null) return null;
  return `₪${Math.round(price).toLocaleString("en-US")}`;
}

export function formatProduct(item: ProductItem, index: number): string {
  const lines: string[] = [`${index}. **${item.name}**`];

  lines.push(`   Price: ${formatPrice(item.price ?? null)}`);
  if (item.min_price && item.min_price !== item.price) {
    lines.push(`   Club price: ${formatPrice(item.min_price)}`);
  }

  if (item.brandName) {
    lines.push(`   Brand: ${item.brandName}`);
  }

  const labels = item.labels || [];
  if (labels.length > 0) {
    lines.push(`   ${labels.map((l) => l.msg).join(" | ")}`);
  }

  const payments = item.payments || {};
  if (payments.max_num_payments_wo_interest) {
    lines.push(
      `   Payments: up to ${payments.max_num_payments_wo_interest} interest-free (est. ${formatPrice(payments.estimated_payment ?? null)}/mo)`
    );
  }

  if (item.description) {
    lines.push(`   ${item.description}`);
  }

  lines.push(`   URL: ${KSP_WEB}/item/${item.uin}`);
  if (item.img) {
    lines.push(`   Image: ${item.img}`);
  }

  return lines.join("\n");
}

export interface SearchResult {
  query: string;
  page: number;
  total: number;
  items: ProductItem[];
  minMax?: { min: number; max: number };
  hasNext: boolean;
  searchUrl: string;
}

export async function searchProducts(
  query: string,
  page: number
): Promise<SearchResult | { error: string; status: number }> {
  const params = new URLSearchParams({ search: query });
  if (page > 1) params.set("page", String(page));

  const resp = await fetch(`${KSP_API}/category/?${params}`, {
    headers: HEADERS,
  });

  if (!resp.ok) {
    return { error: `KSP API error: ${resp.status}`, status: resp.status };
  }

  const json = (await resp.json()) as {
    result: {
      items?: ProductItem[];
      products_total?: number;
      minMax?: { min: number; max: number };
      next?: number;
    };
  };

  const result = json.result;
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

export interface ProductDetail {
  uin: string;
  name: string;
  price: number;
  min_price?: number;
  eilatPrice?: number;
  brandName?: string;
  inStock: boolean;
  description?: string;
  options: { name: string; values: string[] }[];
  variations: {
    label: string;
    price: string | null;
    clubPrice: string | null;
  }[];
  specifications: { name: string; value: string }[];
  images: string[];
  branches: string[];
  payments?: Payments;
  url: string;
}

export async function getProductDetail(
  uin: string
): Promise<ProductDetail | { error: string; status?: number }> {
  const match = uin.match(/\d+/);
  if (!match) {
    return { error: "Invalid product ID." };
  }
  const productId = match[0];

  const resp = await fetch(`${KSP_API}/item/${productId}`, {
    headers: HEADERS,
  });

  if (!resp.ok) {
    return { error: `KSP API error: ${resp.status}`, status: resp.status };
  }

  const json = (await resp.json()) as {
    result: {
      data: {
        name: string;
        price: number;
        min_price?: number;
        eilatPrice?: number;
        brandName?: string;
        addToCart?: boolean;
        smalldesc?: string;
      };
      products_options?: {
        render?: {
          tags?: Record<
            string,
            {
              name: string;
              items: { id: number; name: string }[];
            }
          >;
        };
        variations?: {
          tags: Record<string, string>;
          data: { price?: number; bms_price?: number };
        }[];
      };
      specification?: { name: string; value: string }[];
      images?: (string | { url: string })[];
      stock?: { name?: string; title?: string }[];
      payments?: Payments;
    };
  };

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
    .filter((v) => Object.keys(v.tags).length > 0)
    .map((v) => {
      const varParts: string[] = [];
      for (const [k, vId] of Object.entries(v.tags)) {
        const tagGroup = tags[k];
        if (tagGroup) {
          const item = tagGroup.items.find((i) => String(i.id) === String(vId));
          if (item) varParts.push(`${tagGroup.name}: ${item.name}`);
        }
      }
      const varData = v.data || {};
      return {
        label: varParts.join(", "),
        price: formatPrice(Math.round(varData.price || 0)),
        clubPrice:
          varData.bms_price &&
          varData.bms_price !== Math.round(varData.price || 0)
            ? formatPrice(varData.bms_price)
            : null,
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

export function searchResultToText(
  data: SearchResult,
  startIndex: number
): string {
  if (data.items.length === 0) {
    return `No products found for "${data.query}" on KSP.`;
  }

  const productLines = data.items.map((item, i) =>
    formatProduct(item, startIndex + i)
  );

  let summary = `Found ${data.total} products for "${data.query}" on KSP (showing page ${data.page}):\n\n`;
  summary += productLines.join("\n\n");

  if (data.minMax) {
    summary += `\n\n---\nPrice range: ${formatPrice(data.minMax.min)} – ${formatPrice(data.minMax.max)}`;
  }

  if (data.hasNext) {
    summary += `\nMore results available — use page ${data.page + 1} to see next page.`;
  }

  summary += `\n\nSearch URL: ${data.searchUrl}`;
  return summary;
}

export function productDetailToText(p: ProductDetail): string {
  let text = `**${p.name}**\n\n`;
  text += `Price: ${formatPrice(p.price)}\n`;

  if (p.min_price && p.min_price !== p.price) {
    text += `Club price: ${formatPrice(p.min_price)}\n`;
  }
  if (p.eilatPrice) {
    text += `Eilat (tax-free) price: ${formatPrice(p.eilatPrice)}\n`;
  }

  text += `Brand: ${p.brandName || "N/A"}\n`;
  text += `In stock: ${p.inStock ? "Yes" : "No"}\n`;

  if (p.description) {
    text += `\nDescription: ${p.description}\n`;
  }

  if (p.options.length > 0) {
    text += "\n**Options:**\n";
    for (const opt of p.options) {
      text += `  ${opt.name}: ${opt.values.join(", ")}\n`;
    }
  }

  if (p.variations.length > 1) {
    text += "\n**Variations:**\n";
    for (const v of p.variations) {
      let line = `  - ${v.label} → ${v.price}`;
      if (v.clubPrice) line += ` (club: ${v.clubPrice})`;
      text += line + "\n";
    }
  }

  if (p.specifications.length > 0) {
    text += "\n**Specifications:**\n";
    for (const spec of p.specifications) {
      text += `  - ${spec.name}: ${spec.value}\n`;
    }
  }

  if (p.images.length > 0) {
    text += "\n**Images:**\n";
    for (const img of p.images.slice(0, 5)) {
      text += `  ${img}\n`;
    }
  }

  if (p.branches.length > 0) {
    text += "\n**Available at branches:**\n";
    for (const b of p.branches.slice(0, 5)) {
      text += `  - ${b}\n`;
    }
  }

  if (p.payments?.max_num_payments_wo_interest) {
    text += `\nPayment options: up to ${p.payments.max_num_payments_wo_interest} interest-free payments\n`;
  }

  text += `\nURL: ${p.url}`;
  return text;
}
