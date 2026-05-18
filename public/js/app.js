/* KSP MCP GUI */
const STORAGE_API_KEY = "ksp-api-base";

function isGitHubPages() {
  return /github\.io$/i.test(window.location.hostname);
}

function getApiBase() {
  const cfg = window.__KSP_CONFIG__ || {};
  const fromCfg = (cfg.apiBase || "").trim().replace(/\/$/, "");
  if (fromCfg) return fromCfg;
  const saved = (localStorage.getItem(STORAGE_API_KEY) || "").trim().replace(/\/$/, "");
  if (saved) return saved;
  if (!isGitHubPages()) return window.location.origin;
  return "";
}

function apiUrl(path) {
  const base = getApiBase();
  if (!base) {
    throw new Error("יש להגדיר כתובת שרת API (Cloudflare Worker) למעלה");
  }
  return base + path;
}

const state = {
  search: { items: [], query: "", page: 1, hasNext: false, total: 0 },
  yaniv: { map: new Map(), config: null, abort: false },
  compare: [],
  view: { search: "grid", yaniv: "grid" },
};

const fmt = (n) => (n == null ? "—" : `₪${Math.round(n).toLocaleString("en-US")}`);

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

async function api(path, opts) {
  const res = await fetch(apiUrl(path), opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `שגיאה ${res.status}`);
  return data;
}

function setLoading(el, msg = "טוען...") {
  el.innerHTML = `<div class="loading"><div class="spinner"></div><p>${esc(msg)}</p></div>`;
}

function setError(el, msg) {
  el.innerHTML = `<div class="error-box">${esc(msg)}</div>`;
}

function readToolbar(prefix) {
  return {
    sort: document.getElementById(`${prefix}Sort`)?.value || "price",
    dir: document.getElementById(`${prefix}Dir`)?.value || "asc",
    minPrice: parseInt(document.getElementById(`${prefix}MinPrice`)?.value, 10) || undefined,
    maxPrice: parseInt(document.getElementById(`${prefix}MaxPrice`)?.value, 10) || undefined,
    minDiscount: parseInt(document.getElementById(`${prefix}MinDisc`)?.value, 10) || undefined,
    text: document.getElementById(`${prefix}Text`)?.value?.trim() || undefined,
    brand: document.getElementById(`${prefix}Brand`)?.value?.trim() || undefined,
    inStockOnly: document.getElementById(`${prefix}InStock`)?.checked || false,
    dealType: document.getElementById(`${prefix}DealType`)?.value || "הכל",
  };
}

function toolbarQuery(t, extra = {}) {
  const p = new URLSearchParams();
  if (t.text) p.set("q", t.text);
  if (t.minPrice != null) p.set("minPrice", String(t.minPrice));
  if (t.maxPrice != null) p.set("maxPrice", String(t.maxPrice));
  if (t.minDiscount != null) p.set("minDiscount", String(t.minDiscount));
  if (t.inStockOnly) p.set("inStock", "1");
  if (t.brand) p.set("brand", t.brand);
  if (t.dealType && t.dealType !== "הכל") p.set("dealType", t.dealType);
  p.set("sort", t.sort);
  p.set("dir", t.dir);
  Object.entries(extra).forEach(([k, v]) => p.set(k, v));
  return p.toString();
}

function exportCsv(rows, filename) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ——— Compare ———
function updateCompareBar() {
  const bar = document.getElementById("compareBar");
  const chips = document.getElementById("compareChips");
  if (!state.compare.length) {
    bar?.classList.remove("visible");
    return;
  }
  bar?.classList.add("visible");
  chips.innerHTML = state.compare
    .map(
      (c) =>
        `<span class="compare-chip">${esc(c.name?.slice(0, 30) || c.uin)}<button type="button" data-rm="${esc(c.uin)}" aria-label="הסר">×</button></span>`
    )
    .join("");
  chips.querySelectorAll("[data-rm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.compare = state.compare.filter((x) => x.uin !== btn.dataset.rm);
      updateCompareBar();
    });
  });
}

function addToCompare(item) {
  if (state.compare.some((c) => c.uin === String(item.uin))) return;
  if (state.compare.length >= 5) {
    alert("ניתן להשוות עד 5 מוצרים");
    return;
  }
  state.compare.push({
    uin: String(item.uin),
    name: item.name,
    price: item.effectivePrice ?? item.price,
  });
  updateCompareBar();
}

async function runCompare() {
  if (state.compare.length < 2) return;
  const el = document.getElementById("investigateResult");
  switchTab("investigate");
  setLoading(el, "משווה מוצרים...");
  try {
    const data = await api(
      `/api/compare?uins=${state.compare.map((c) => c.uin).join(",")}`
    );
    const cheapest = data.rows[0];
    el.innerHTML = `
      <div class="investigate-box">
        <h3>השוואת מוצרים (${data.rows.length})</h3>
        <p style="margin:0.5rem 0;color:var(--club);font-weight:600">הכי זול: ${esc(cheapest.name)} — ${fmt(cheapest.bestPrice)} (${esc(cheapest.bestLabel)})</p>
        <div class="results-table-wrap">
          <table class="results-table">
            <thead><tr>
              <th>מוצר</th><th>מותג</th><th>מחיר רשימה</th><th>מחיר טוב</th><th>ציון יניב</th><th>מלאי</th><th></th>
            </tr></thead>
            <tbody>
              ${data.rows
                .map(
                  (r) => `<tr>
                    <td>${esc(r.name)}</td>
                    <td>${esc(r.brandName)}</td>
                    <td>${fmt(r.listPrice)}</td>
                    <td><strong>${fmt(r.bestPrice)}</strong> <small>${esc(r.bestLabel)}</small></td>
                    <td>${r.yanivScore || "—"}</td>
                    <td class="${r.inStock ? "stock-yes" : "stock-no"}">${r.inStock ? "כן" : "לא"}</td>
                    <td><a href="${esc(r.url)}" target="_blank" rel="noopener">KSP</a></td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (e) {
    setError(el, e.message);
  }
}

// ——— Cards ———
function cardActionsHtml(item, opts = {}) {
  const uin = String(item.uin);
  return `
    <button class="btn btn-primary" data-uin="${uin}" data-action="detail">פרטים</button>
    <button class="btn btn-secondary card-compare-add" data-uin="${uin}" data-action="compare" data-name="${esc(item.name)}">+ השוואה</button>
    ${opts.investigate ? `<button class="btn btn-secondary" data-uin="${uin}" data-action="investigate">תחקור</button>` : ""}
    <a class="btn btn-secondary" href="https://ksp.co.il/web/item/${uin}" target="_blank" rel="noopener">KSP</a>`;
}

function bindCardActions(container) {
  container.querySelectorAll('[data-action="detail"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("uinInput").value = btn.dataset.uin;
      switchTab("product");
      loadProduct(btn.dataset.uin);
    });
  });
  container.querySelectorAll('[data-action="compare"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      addToCompare({
        uin: btn.dataset.uin,
        name: btn.dataset.name || btn.dataset.uin,
        price: 0,
      });
    });
  });
  container.querySelectorAll('[data-action="investigate"]').forEach((btn) => {
    btn.addEventListener("click", () => runInvestigate(btn.dataset.uin));
  });
}

function renderSearchCard(item) {
  const img = item.img
    ? `<img src="${esc(item.img)}" alt="" loading="lazy" />`
    : `<span class="placeholder">📦</span>`;
  const disc =
    item.discountPercent > 0
      ? `<span class="club-price">-${item.discountPercent}%</span>`
      : "";
  const club =
    item.min_price && item.min_price !== item.price
      ? `<span class="club-price">מועדון: ${fmt(item.min_price)}</span>`
      : "";

  return `
    <article class="card">
      <div class="card-img">${img}</div>
      <div class="card-body">
        <div class="card-title">${esc(item.name)}</div>
        <div class="price-row">
          <span class="price">${fmt(item.effectivePrice ?? item.price)}</span>
          ${item.effectivePrice < item.price ? `<span style="text-decoration:line-through;color:var(--muted);font-size:0.85rem">${fmt(item.price)}</span>` : ""}
          ${disc} ${club}
        </div>
        ${item.brandName ? `<small style="color:var(--muted)">${esc(item.brandName)}</small>` : ""}
        ${!item.inStock ? '<p class="stock-no" style="font-size:0.8rem">לא במלאי</p>' : ""}
        <div class="card-actions">${cardActionsHtml(item, { investigate: true })}</div>
      </div>
    </article>`;
}

function renderSearchTable(items) {
  return `
    <div class="results-table-wrap">
      <table class="results-table">
        <thead><tr><th></th><th>שם</th><th>מותג</th><th>מחיר</th><th>הנחה</th><th>מלאי</th><th>פעולות</th></tr></thead>
        <tbody>
          ${items
            .map(
              (item) => `<tr>
                <td>${item.img ? `<img class="thumb" src="${esc(item.img)}" alt="" />` : "—"}</td>
                <td>${esc(item.name)}</td>
                <td>${esc(item.brandName || "—")}</td>
                <td><strong>${fmt(item.effectivePrice)}</strong>${item.discountPercent ? ` <small class="club-price">-${item.discountPercent}%</small>` : ""}</td>
                <td>${item.discountPercent || "—"}%</td>
                <td class="${item.inStock ? "stock-yes" : "stock-no"}">${item.inStock ? "כן" : "לא"}</td>
                <td style="white-space:nowrap">
                  <button class="btn btn-secondary" style="padding:0.3rem 0.5rem;font-size:0.75rem" data-uin="${item.uin}" data-action="detail">פרטים</button>
                  <button class="btn btn-secondary" style="padding:0.3rem 0.5rem;font-size:0.75rem" data-uin="${item.uin}" data-action="investigate">תחקור</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderSearchResults() {
  const el = document.getElementById("searchResults");
  const items = state.search.items;
  const countEl = document.getElementById("searchFilteredCount");

  if (!items.length) {
    el.innerHTML = `<div class="empty">אין תוצאות לאחר סינון — נסה להרחיב את הקריטריונים</div>`;
    if (countEl) countEl.textContent = "0";
    return;
  }

  if (countEl) {
    countEl.textContent = `${items.length} מוצגים (מתוך ${state.search.pageTotal} בעמוד)`;
  }

  if (state.view.search === "table") {
    el.innerHTML = renderSearchTable(items);
  } else {
    el.innerHTML = `<div class="grid">${items.map(renderSearchCard).join("")}</div>`;
  }
  bindCardActions(el);
}

async function doSearch(query, page = 1) {
  const resultsEl = document.getElementById("searchResults");
  const metaEl = document.getElementById("searchMeta");
  const btn = document.getElementById("searchBtn");
  if (!query.trim()) return;

  state.search.query = query.trim();
  state.search.page = page;
  btn.disabled = true;
  setLoading(resultsEl);

  try {
    const t = readToolbar("search");
    const qs = toolbarQuery(t, {
      query: state.search.query,
      page: String(page),
    });
    const data = await api(`/api/search?${qs}`);

    state.search.items = data.items || [];
    state.search.hasNext = data.hasNext;
    state.search.total = data.total;
    state.search.pageTotal = data.pageTotal ?? state.search.items.length;

    if (!state.search.items.length && page === 1) {
      metaEl.style.display = "none";
      resultsEl.innerHTML = `<div class="empty">לא נמצאו מוצרים עבור "${esc(state.search.query)}"</div>`;
      return;
    }

    metaEl.style.display = "flex";
    document.getElementById("totalCount").textContent = data.total;
    document.getElementById("pageNum").textContent = data.page;
    document.getElementById("priceRange").textContent = data.minMax
      ? `טווח: ${fmt(data.minMax.min)} – ${fmt(data.minMax.max)}`
      : "";
    document.getElementById("prevPage").disabled = page <= 1;
    document.getElementById("nextPage").disabled = !data.hasNext;

    renderSearchResults();
  } catch (e) {
    metaEl.style.display = "none";
    setError(resultsEl, e.message);
  } finally {
    btn.disabled = false;
  }
}

function applySearchFiltersLocal() {
  doSearch(state.search.query, state.search.page);
}

// ——— Yaniv ———
function renderYanivCard(d) {
  const img = d.img
    ? `<img src="${esc(d.img)}" alt="" loading="lazy" />`
    : `<span class="placeholder">🏷️</span>`;
  return `
    <article class="card deal-card">
      <span class="deal-score">${d.score}</span>
      <div class="card-img">${img}</div>
      <div class="card-body">
        <div class="card-title">${esc(d.name)}</div>
        <div class="price-row">
          <span class="price">${fmt(d.effectivePrice)}</span>
          ${d.discountPercent ? `<span class="club-price">-${d.discountPercent}%</span>` : ""}
        </div>
        <div class="labels">${d.dealTypes.map((t) => `<span class="deal-type-tag">${esc(t)}</span>`).join("")}</div>
        <p class="deal-reasons">${d.reasons.slice(0, 2).map(esc).join(" · ")}</p>
        <div class="card-actions">${cardActionsHtml(d, { investigate: true })}</div>
      </div>
    </article>`;
}

function renderYanivTable(deals) {
  return `
    <div class="results-table-wrap">
      <table class="results-table">
        <thead><tr><th>ציון</th><th>שם</th><th>מחיר</th><th>הנחה</th><th>סוגים</th><th>מלאי</th></tr></thead>
        <tbody>
          ${deals
            .map(
              (d) => `<tr data-uin="${d.uin}" style="cursor:pointer">
                <td><strong>${d.score}</strong></td>
                <td>${esc(d.name)}</td>
                <td>${fmt(d.effectivePrice)}</td>
                <td>${d.discountPercent || 0}%</td>
                <td>${d.dealTypes.map(esc).join(", ")}</td>
                <td class="${d.inStock ? "stock-yes" : "stock-no"}">${d.inStock ? "כן" : "לא"}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderYanivAnalytics(analytics) {
  const el = document.getElementById("yanivAnalytics");
  if (!el || !analytics.total) {
    el.innerHTML = "";
    return;
  }
  const types = Object.entries(analytics.byDealType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k} (${v})`)
    .join(" · ");

  el.innerHTML = `
    <div class="analytics-grid">
      <div class="stat-card"><div class="val">${analytics.total}</div><div class="lbl">המלצות</div></div>
      <div class="stat-card"><div class="val">${analytics.avgScore}</div><div class="lbl">ציון ממוצע</div></div>
      <div class="stat-card"><div class="val">${analytics.avgDiscount}%</div><div class="lbl">הנחה ממוצעת</div></div>
      <div class="stat-card"><div class="val">${analytics.inStock}</div><div class="lbl">במלאי</div></div>
      <div class="stat-card"><div class="val">${fmt(analytics.priceRange.min)}</div><div class="lbl">מינימום</div></div>
      <div class="stat-card"><div class="val">${fmt(analytics.priceRange.max)}</div><div class="lbl">מקסימום</div></div>
    </div>
    ${types ? `<p style="font-size:0.82rem;color:var(--muted);margin-bottom:0.75rem">${esc(types)}</p>` : ""}`;
}

async function getFilteredYanivDeals() {
  const deals = [...state.yaniv.map.values()];
  const t = readToolbar("yaniv");
  try {
    const data = await api(`/api/yaniv/analyze?${toolbarQuery(t)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deals }),
    });
    return data;
  } catch {
    return { filtered: deals, analytics: { total: deals.length }, count: deals.length };
  }
}

async function renderYanivResults() {
  const el = document.getElementById("yanivResults");
  const data = await getFilteredYanivDeals();
  const deals = data.filtered || [];
  const sortLabel = document.getElementById("yanivSortLabel");
  if (sortLabel) {
    const t = readToolbar("yaniv");
    sortLabel.textContent = `${t.sort} / ${t.dir}`;
  }
  document.getElementById("yanivFound").textContent = state.yaniv.map.size;
  document.getElementById("yanivShown").textContent = deals.length;
  renderYanivAnalytics(data.analytics);

  if (!deals.length) {
    el.innerHTML = `<div class="empty">אין תוצאות — התחל סריקה או שנה סינון</div>`;
    return;
  }

  if (state.view.yaniv === "table") {
    el.innerHTML = renderYanivTable(deals);
    el.querySelectorAll("tbody tr").forEach((row) => {
      row.addEventListener("click", () => runInvestigate(row.dataset.uin));
    });
  } else {
    el.innerHTML = `<div class="grid">${deals.map(renderYanivCard).join("")}</div>`;
    bindCardActions(el);
  }
}

async function runYanivScan() {
  if (!state.yaniv.config) {
    state.yaniv.config = await api("/api/yaniv/config");
  }
  state.yaniv.abort = false;
  state.yaniv.map = new Map();

  const pagesPerQuery = parseInt(document.getElementById("yanivPages").value, 10);
  const minScore = parseInt(document.getElementById("yanivMinScore").value, 10);
  const queries = state.yaniv.config.queries;
  const totalSteps = queries.length * pagesPerQuery;
  let step = 0;
  let scannedTotal = 0;

  const progress = document.getElementById("yanivProgress");
  const fill = document.getElementById("yanivProgressFill");
  const ptext = document.getElementById("yanivProgressText");
  const resultsEl = document.getElementById("yanivResults");

  document.getElementById("yanivScanBtn").disabled = true;
  document.getElementById("yanivStopBtn").disabled = false;
  progress.classList.add("visible");
  document.getElementById("yanivStats").style.display = "flex";
  setLoading(resultsEl, "סורק...");

  const dealTypes = new Set(state.yaniv.config.dealTypes);
  const dealSelect = document.getElementById("yanivDealType");
  if (dealSelect) {
    dealSelect.innerHTML =
      `<option value="הכל">הכל</option>` +
      [...dealTypes].map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  }

  for (const q of queries) {
    for (let page = 1; page <= pagesPerQuery; page++) {
      if (state.yaniv.abort) break;
      step++;
      fill.style.width = Math.round((step / totalSteps) * 100) + "%";
      ptext.textContent = `${q.label} · עמוד ${page}/${pagesPerQuery}`;

      try {
        const data = await api(
          `/api/yaniv/scan-step?query=${encodeURIComponent(q.query)}&label=${encodeURIComponent(q.label)}&page=${page}&minScore=${minScore}`
        );
        scannedTotal += data.scanned || 0;
        document.getElementById("yanivScanned").textContent = scannedTotal;

        for (const deal of data.deals || []) {
          const prev = state.yaniv.map.get(deal.uin);
          if (!prev || deal.score > prev.score) {
            if (prev) {
              deal.dealTypes = [...new Set([...prev.dealTypes, ...deal.dealTypes])];
              deal.reasons = [...new Set([...prev.reasons, ...deal.reasons])];
              deal.score = Math.max(prev.score, deal.score);
            }
            state.yaniv.map.set(deal.uin, deal);
          }
        }
        await renderYanivResults();
        if (!data.hasNext) break;
      } catch (e) {
        console.warn(e);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (state.yaniv.abort) break;
  }

  ptext.textContent = state.yaniv.abort
    ? "הופסק"
    : `הושלם — ${state.yaniv.map.size} המלצות`;
  localStorage.setItem(
    "ksp-yaniv-scan",
    JSON.stringify({ at: Date.now(), deals: [...state.yaniv.map.values()] })
  );
  document.getElementById("yanivScanBtn").disabled = false;
  document.getElementById("yanivStopBtn").disabled = true;
}

function exportYanivCsv() {
  const deals = [...state.yaniv.map.values()];
  if (!deals.length) return alert("אין נתונים לייצוא");
  const rows = [
    ["UIN", "שם", "ציון", "מחיר", "הנחה%", "סוגים", "מלאי", "קישור"],
    ...deals.map((d) => [
      d.uin,
      d.name,
      d.score,
      d.effectivePrice,
      d.discountPercent,
      d.dealTypes.join("; "),
      d.inStock ? "כן" : "לא",
      d.url,
    ]),
  ];
  exportCsv(rows, `yaniv-${Date.now()}.csv`);
}

// ——— Investigate ———
async function runInvestigate(uin) {
  if (!uin) uin = document.getElementById("investigateUin")?.value?.trim();
  if (!uin) return;
  const el = document.getElementById("investigateResult");
  switchTab("investigate");
  setLoading(el, "חוקר מוצר...");
  try {
    const r = await api(`/api/investigate?uin=${encodeURIComponent(uin)}`);
    const p = r.product;
    el.innerHTML = `
      <div class="investigate-box">
        <h2 style="font-size:1.2rem;margin-bottom:0.5rem">${esc(p.name)}</h2>
        <p><strong>מחיר מומלץ:</strong> ${fmt(r.bestPrice)} (${esc(r.bestLabel)})
        ${r.maxSavingsPercent > 0 ? ` · חיסכון עד <span class="club-price">${r.maxSavingsPercent}%</span>` : ""}</p>
        ${r.yanivDeal ? `<p>ציון יניב: <strong>${r.yanivDeal.score}</strong> — ${r.yanivDeal.dealTypes.map(esc).join(", ")}</p>` : ""}

        <h3 class="section-title">מדרג מחירים</h3>
        <div class="tier-bar">
          ${r.priceTiers
            .map(
              (t, i) =>
                `<div class="tier-row${i === 0 ? " best" : ""}">
                  <span>${esc(t.label)}</span>
                  <span>${esc(t.formatted)}${t.savingsPercent ? ` (-${t.savingsPercent}%)` : ""}</span>
                </div>`
            )
            .join("")}
        </div>

        <h3 class="section-title">תובנות</h3>
        <ul class="insight-list">${r.insights.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>

        ${
          r.similar?.length
            ? `<h3 class="section-title">מוצרים דומים</h3>
               <div class="results-table-wrap"><table class="results-table"><tbody>
               ${r.similar
                 .map(
                   (s) => `<tr><td>${esc(s.name)}</td><td>${fmt(s.price)}</td><td><a href="${esc(s.url)}" target="_blank">פתח</a></td></tr>`
                 )
                 .join("")}
               </tbody></table></div>`
            : ""
        }

        <div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">
          <a class="btn btn-primary" href="${esc(p.url)}" target="_blank">פתח ב-KSP</a>
          <button type="button" class="btn btn-secondary" id="invAddCompare">+ השוואה</button>
          <button type="button" class="btn btn-secondary" data-action="detail" data-uin="${p.uin}">פרטים מלאים</button>
        </div>
      </div>`;
    document.getElementById("invAddCompare")?.addEventListener("click", () =>
      addToCompare({ uin: p.uin, name: p.name, price: r.bestPrice })
    );
    el.querySelector('[data-action="detail"]')?.addEventListener("click", (e) => {
      document.getElementById("uinInput").value = e.target.dataset.uin;
      switchTab("product");
      loadProduct(e.target.dataset.uin);
    });
  } catch (e) {
    setError(el, e.message);
  }
}

// ——— Product detail ———
function renderProductDetail(p) {
  const gallery =
    p.images?.length > 0
      ? `<div class="detail-gallery">${p.images.map((u) => `<img src="${esc(u)}" alt="" />`).join("")}</div>`
      : "";
  return `
    <div class="detail-view visible">
      ${gallery}
      <h2>${esc(p.name)}</h2>
      <p class="price" style="font-size:1.5rem">${fmt(p.price)}</p>
      ${p.min_price && p.min_price !== p.price ? `<p class="club-price">מועדון: ${fmt(p.min_price)}</p>` : ""}
      ${p.eilatPrice ? `<p>אילת: ${fmt(p.eilatPrice)}</p>` : ""}
      <p>מותג: ${esc(p.brandName || "—")} · מלאי: <span class="${p.inStock ? "stock-yes" : "stock-no"}">${p.inStock ? "במלאי" : "אזל"}</span></p>
      ${p.description ? `<p style="color:var(--muted);margin-top:0.5rem">${esc(p.description)}</p>` : ""}
      <div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">
        <a class="btn btn-primary" href="${esc(p.url)}" target="_blank">KSP</a>
        <button type="button" class="btn btn-secondary" id="prodInvestigate">תחקור מחיר</button>
        <button type="button" class="btn btn-secondary" id="prodCompare">+ השוואה</button>
      </div>
    </div>`;
}

async function loadProduct(uin) {
  const el = document.getElementById("productResult");
  if (!uin?.trim()) return;
  setLoading(el);
  try {
    const data = await api(`/api/product?uin=${encodeURIComponent(uin.trim())}`);
    el.innerHTML = renderProductDetail(data);
    document.getElementById("prodInvestigate")?.addEventListener("click", () =>
      runInvestigate(data.uin)
    );
    document.getElementById("prodCompare")?.addEventListener("click", () =>
      addToCompare({ uin: data.uin, name: data.name, price: data.price })
    );
  } catch (e) {
    setError(el, e.message);
  }
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", p.id === `panel-${name}`);
  });
}

async function checkHealth() {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  try {
    await api("/api/health");
    dot.classList.remove("offline");
    text.textContent = "שרת פעיל";
  } catch {
    dot.classList.add("offline");
    text.textContent = "שרת לא זמין";
  }
}

function loadSavedYaniv() {
  try {
    const raw = localStorage.getItem("ksp-yaniv-scan");
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved.deals?.length) return;
    if (Date.now() - saved.at > 86400000) return;
    for (const d of saved.deals) state.yaniv.map.set(d.uin, d);
    renderYanivResults();
    document.getElementById("yanivStats").style.display = "flex";
    document.getElementById("yanivScanned").textContent = "—";
    document.getElementById("yanivFound").textContent = state.yaniv.map.size;
  } catch {}
}

function setupApiSettings() {
  const box = document.getElementById("apiSettings");
  const input = document.getElementById("apiBaseInput");
  const saveBtn = document.getElementById("apiSaveBtn");
  if (!box || !input) return;

  const cfg = window.__KSP_CONFIG__ || {};
  input.value =
    localStorage.getItem(STORAGE_API_KEY) ||
    cfg.apiBase ||
    (isGitHubPages() ? "" : window.location.origin);

  if (isGitHubPages() || !cfg.apiBase) {
    box.classList.remove("hidden");
  }

  saveBtn?.addEventListener("click", () => {
    const v = input.value.trim().replace(/\/$/, "");
    if (!v) {
      localStorage.removeItem(STORAGE_API_KEY);
    } else {
      localStorage.setItem(STORAGE_API_KEY, v);
    }
    updateApiBadges();
    checkHealth();
  });
}

function updateApiBadges() {
  const base = getApiBase() || "(לא הוגדר)";
  const badge = document.getElementById("baseUrlBadge");
  if (badge) badge.textContent = "API: " + base;
  const sse = document.getElementById("sseUrl");
  const mcp = document.getElementById("mcpUrl");
  if (getApiBase()) {
    if (sse) sse.textContent = getApiBase() + "/sse";
    if (mcp) mcp.textContent = getApiBase() + "/mcp";
  } else {
    if (sse) sse.textContent = "—";
    if (mcp) mcp.textContent = "—";
  }
}

function init() {
  setupApiSettings();
  updateApiBadges();

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  document.getElementById("searchForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    doSearch(document.getElementById("searchInput").value, 1);
  });
  document.getElementById("prevPage")?.addEventListener("click", () => {
    if (state.search.page > 1) doSearch(state.search.query, state.search.page - 1);
  });
  document.getElementById("nextPage")?.addEventListener("click", () => {
    if (state.search.hasNext) doSearch(state.search.query, state.search.page + 1);
  });
  document.getElementById("productForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    loadProduct(document.getElementById("uinInput").value);
  });
  document.getElementById("quickTags")?.addEventListener("click", (e) => {
    const tag = e.target.closest(".quick-tag");
    if (!tag) return;
    document.getElementById("searchInput").value = tag.dataset.q;
    doSearch(tag.dataset.q, 1);
  });

  ["search", "yaniv"].forEach((prefix) => {
    document.getElementById(`${prefix}Apply`)?.addEventListener("click", () => {
      if (prefix === "search") applySearchFiltersLocal();
      else renderYanivResults();
    });
    document.getElementById(`${prefix}ViewGrid`)?.addEventListener("click", () => {
      state.view[prefix] = "grid";
      document.getElementById(`${prefix}ViewGrid`)?.classList.add("active");
      document.getElementById(`${prefix}ViewTable`)?.classList.remove("active");
      prefix === "search" ? renderSearchResults() : renderYanivResults();
    });
    document.getElementById(`${prefix}ViewTable`)?.addEventListener("click", () => {
      state.view[prefix] = "table";
      document.getElementById(`${prefix}ViewTable`)?.classList.add("active");
      document.getElementById(`${prefix}ViewGrid`)?.classList.remove("active");
      prefix === "search" ? renderSearchResults() : renderYanivResults();
    });
  });

  document.getElementById("yanivPages")?.addEventListener("input", (e) => {
    document.getElementById("yanivPagesOut").textContent = e.target.value;
  });
  document.getElementById("yanivMinScore")?.addEventListener("input", (e) => {
    document.getElementById("yanivMinScoreOut").textContent = e.target.value;
  });
  document.getElementById("yanivScanBtn")?.addEventListener("click", runYanivScan);
  document.getElementById("yanivStopBtn")?.addEventListener("click", () => {
    state.yaniv.abort = true;
  });
  document.getElementById("yanivExport")?.addEventListener("click", exportYanivCsv);
  document.getElementById("yanivLoadSaved")?.addEventListener("click", loadSavedYaniv);

  document.getElementById("investigateForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    runInvestigate();
  });
  document.getElementById("compareRunBtn")?.addEventListener("click", runCompare);
  document.getElementById("compareClearBtn")?.addEventListener("click", () => {
    state.compare = [];
    updateCompareBar();
  });

  loadSavedYaniv();
  checkHealth();
  setInterval(checkHealth, 30000);
}

init();
