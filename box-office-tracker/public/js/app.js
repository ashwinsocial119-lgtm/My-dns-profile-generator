import * as core from "./core.js";

/* ------------------------------------------------------------------ */
/* State + storage                                                     */
/* ------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;
const LS = {
  films: "bot.films",
  results: "bot.results",
  last: "bot.lastRefresh",
  theme: "bot.theme",
  cur: "bot.cur",
  fx: "bot.fx",
};
const FX_FALLBACK = 88;

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      /* storage full or blocked: the app still works for this session */
    }
  },
};

let films = store.get(LS.films, []);
let results = store.get(LS.results, {}); // film.key -> { src -> result | {ok:false,error} }
let lastRefresh = store.get(LS.last, 0);
let fx = store.get(LS.fx, { rate: FX_FALLBACK, at: 0, fallback: true });
let curPref = store.get(LS.cur, "auto");
const loading = {}; // film.key -> { src: true }
let refreshing = false;
let apiReachable = true;

const $ = (id) => document.getElementById(id);
const el = {
  status: $("status"),
  refresh: $("refreshBtn"),
  settingsBtn: $("settingsBtn"),
  settings: $("settings"),
  form: $("searchForm"),
  input: $("searchInput"),
  results: $("results"),
  count: $("slotCount"),
  films: $("films"),
  empty: $("empty"),
  banner: $("banner"),
  toast: $("toast"),
  ptr: $("ptr"),
  fxHint: $("fxHint"),
  srcList: $("srcList"),
  exportBtn: $("exportBtn"),
  copyWidgetBtn: $("copyWidgetBtn"),
};

function saveFilms() { store.set(LS.films, films.filter((f) => !f.resolving)); }
function saveResults() { store.set(LS.results, results); }

/* ------------------------------------------------------------------ */
/* Networking                                                          */
/* ------------------------------------------------------------------ */

// Wikipedia & Wikidata allow browser requests (CORS), so they're called from
// the phone directly. Everything else goes through the small /api/fetch proxy.
const DIRECT = /^https:\/\/(en\.wikipedia\.org|www\.wikidata\.org)\//;

async function viaProxy(url, fresh) {
  const r = await fetch("api/fetch?u=" + encodeURIComponent(url) + (fresh ? "&fresh=1" : ""), {
    cache: fresh ? "no-store" : "default",
  });
  if (!r.ok) {
    let msg = "HTTP " + r.status;
    try {
      const j = await r.json();
      if (j && j.error) msg = j.error;
    } catch (e) { /* not JSON */ }
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return r.text();
}

function makeFetchText(fresh) {
  return async function fetchText(url) {
    if (DIRECT.test(url)) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok) return await r.text();
      } catch (e) { /* fall through to the proxy */ }
      return viaProxy(url, false);
    }
    return viaProxy(url, fresh);
  };
}

async function checkApi() {
  try {
    const r = await fetch("api/health", { cache: "no-store" });
    apiReachable = r.ok;
  } catch (e) {
    apiReachable = false;
  }
  el.banner.hidden = apiReachable;
  if (!apiReachable) {
    el.banner.innerHTML =
      "<b>Live sources offline.</b> Sacnilk, The Numbers and Box Office Mojo need this site's small <code>/api</code> function — deploy the folder to Vercel or Cloudflare Pages (see README). Showing Wikipedia only for now.";
  }
}

async function loadFx() {
  if (fx && !fx.fallback && Date.now() - fx.at < 12 * HOUR) return;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    const j = await r.json();
    const rate = j && j.rates && j.rates.INR;
    if (rate > 30 && rate < 300) {
      fx = { rate: rate, at: Date.now(), fallback: false };
      store.set(LS.fx, fx);
      renderAll();
    }
  } catch (e) { /* keep the fallback */ }
  renderFxHint();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (v, c) => core.formatMoney(v, c);

function toast(msg, ms) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.toast.hidden = true), ms || 2600);
}

function okResults(key) {
  const r = results[key] || {};
  const out = {};
  for (const k in r) if (r[k] && r[k].ok !== false) out[k] = r[k];
  return out;
}

function headlineFor(film) {
  const hl = core.headline(film, okResults(film.key), fx.rate);
  if (!hl) return null;
  if (curPref !== "auto" && hl.currency !== curPref) {
    const v = core.convert(hl.value, hl.currency, curPref, fx.rate);
    if (v != null) return Object.assign({}, hl, { value: v, currency: curPref, alt: hl.value, altCurrency: hl.currency });
  }
  return hl;
}

function deltaHtml(change) {
  if (!change) return "";
  const down = change[0] === "-";
  return `<span class="delta ${down ? "down" : "up"}">${down ? "▼" : "▲"} ${esc(change.replace(/^[+-]/, ""))}</span>`;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderStatus() {
  if (refreshing) {
    el.status.textContent = "Refreshing all sources…";
    return;
  }
  if (!films.length) {
    el.status.textContent = "Live tracker · up to 3 films";
    return;
  }
  if (!lastRefresh) {
    el.status.textContent = "Not refreshed yet";
    return;
  }
  const next = Math.max(0, Math.round((lastRefresh + HOUR - Date.now()) / 60000));
  el.status.textContent = "Updated " + core.timeAgo(lastRefresh) + " · next in " + (next < 1 ? "<1" : next) + " min";
}

function renderCount() {
  const n = films.length;
  el.count.textContent = n + "/" + core.MAX_FILMS;
  el.count.classList.toggle("is-full", n >= core.MAX_FILMS);
  el.input.disabled = n >= core.MAX_FILMS;
  el.input.placeholder = n >= core.MAX_FILMS ? "Remove a film to add another" : "Search any film…";
}

function barsHtml(film, res) {
  const pick = (k) => (res[k] && res[k].daily && res[k].daily.length >= 2 && !core.isStale(res[k], null, 14) ? res[k] : null);
  const r = film.origin === "IN" ? pick("sacnilk") || pick("numbers") : pick("numbers") || pick("sacnilk");
  if (!r) return "";
  const days = r.daily.filter((d) => d.value != null).slice(-14);
  if (days.length < 2) return "";
  const max = Math.max.apply(null, days.map((d) => d.value)) || 1;
  const bars = days
    .map((d, i) => {
      const h = Math.max(4, Math.round((d.value / max) * 100));
      const cls = d.live ? "is-live" : i === days.length - 1 ? "is-last" : "";
      return `<span class="${cls}" style="height:${h}%" title="${esc(d.label + (d.date ? " · " + d.date : "") + ": " + money(d.value, r.currency))}"></span>`;
    })
    .join("");
  const first = days[0];
  const last = days[days.length - 1];
  return `<div class="bars" aria-label="Day-wise collections">
    <div class="bars__head"><span>${esc(r.dailyLabel || "Daily")} · ${esc(r.name)}</span><span>peak ${esc(money(max, r.currency))}</span></div>
    <div class="bars__plot">${bars}</div>
    <div class="bars__foot"><span>${esc(first.date || first.label)}</span><span>${esc(last.date || last.label)}${last.live ? " · live" : ""}</span></div>
  </div>`;
}

function sourceRowHtml(film, src, id, res, hl, maxUsd) {
  const meta = core.SOURCES[src];
  const r = res[src];
  const isLoading = loading[film.key] && loading[film.key][src];
  if (!r && isLoading) {
    return `<div class="src src--loading"><div class="src__row"><span class="src__name">${esc(meta.name)}</span><span class="src__upd">fetching…</span><span class="src__val"></span></div></div>`;
  }
  if (!r || r.ok === false) {
    const msg = r && r.error ? r.error : id ? "Not loaded yet" : "Not listed";
    return `<div class="src src--err"><div class="src__row"><span class="src__name">${esc(meta.name)}</span><span class="src__val">${esc(msg)}</span></div></div>`;
  }
  const main = r.worldwide != null ? { label: "Worldwide", value: r.worldwide } : r.figures[0] || null;
  const usd = main ? core.convert(main.value, r.currency, "USD", fx.rate) : null;
  const pct = usd && maxUsd ? Math.max(3, Math.round((usd / maxUsd) * 100)) : 0;
  const figs = r.figures
    .filter((f) => !main || f.value !== main.value || f.key !== "worldwide")
    .filter((f) => !(main && f.label === main.label))
    .map((f) => `<span>${esc(f.label)} <b class="num">${esc(money(f.value, r.currency))}</b></span>`)
    .join("");
  const stale = core.isStale(r) ? " · older figures" : "";
  const upd = (r.updated ? r.updated : "") + stale;
  const badge = hl && hl.source === src ? `<span class="src__badge">HEADLINE</span>` : "";
  const label = main && main.label !== "Worldwide" ? `<small>${esc(main.label)}</small>` : "";
  const langs =
    src === "sacnilk" && r.langs && r.langs.length > 1
      ? `<div class="langs">${r.langs.map((l) => `<span class="chip">${esc(l.label)} <b class="num">${esc(money(l.value, "INR"))}</b></span>`).join("")}</div>`
      : "";
  return `<a class="src" href="${esc(r.url)}" target="_blank" rel="noopener">
    <div class="src__row"><span class="src__name">${esc(meta.name)}</span>${badge}<span class="src__upd">${esc(upd)}</span>
      <span class="src__val num">${label} ${esc(main ? money(main.value, r.currency) : "—")} <span class="src__arrow">↗</span></span></div>
    ${pct ? `<div class="src__meter"><i style="width:${pct}%"></i></div>` : ""}
    ${figs ? `<div class="src__figs">${figs}</div>` : ""}
    ${langs}
  </a>`;
}

/** Days in release, from the tracker that matches the film's home market (only while it's current). */
function runDay(film, ok) {
  const s = ok.sacnilk && !core.isStale(ok.sacnilk) ? ok.sacnilk.days : null;
  const n = ok.numbers && !core.isStale(ok.numbers) && ok.numbers.daily.length ? parseInt(String(ok.numbers.daily[ok.numbers.daily.length - 1].label).replace(/\D+/g, ""), 10) || null : null;
  return film.origin === "IN" ? s || n : n || s;
}

function cardHtml(film) {
  if (film.resolving) {
    return `<article class="card card--resolving" data-key="${esc(film.key)}">
      <div class="card__head"><div class="poster">🎞️</div><div><h2 class="card__title">${esc(film.title)}</h2>
      <p class="card__meta">${film.year ? esc(film.year) + " · " : ""}finding this film on every source…</p></div></div>
      <div class="hero"><div class="hero__value">Matching Sacnilk, The Numbers, Box Office Mojo, Wikipedia…</div></div>
    </article>`;
  }
  const res = results[film.key] || {};
  const ok = okResults(film.key);
  const hl = headlineFor(film);
  const latest = core.latestDay(film, ok);
  const sources = core.filmSources(film);
  const all = ["sacnilk", "numbers", "bom", "wiki"];
  const missing = all.filter((s) => !sources.some((x) => x.src === s));

  const usdVals = Object.keys(ok)
    .map((k) => {
      const r = ok[k];
      const v = r.worldwide != null ? r.worldwide : r.figures[0] && r.figures[0].value;
      return core.convert(v, r.currency, "USD", fx.rate) || 0;
    })
    .filter(Boolean);
  const maxUsd = usdVals.length ? Math.max.apply(null, usdVals) : 0;

  const meta = [];
  if (film.year) meta.push(`<span>${esc(film.year)}</span>`);
  meta.push(`<span class="chip">${film.origin === "IN" ? "India" : "International"}</span>`);
  const dayNo = runDay(film, ok);
  if (dayNo) meta.push(`<span class="chip chip--accent">Day ${esc(dayNo)}</span>`);
  if (ok.sacnilk && ok.sacnilk.verdict) meta.push(`<span class="chip">${esc(ok.sacnilk.verdict)}</span>`);

  const poster = film.poster ? `style="background-image:url('${esc(film.poster)}')"` : "";
  const anyLoading = loading[film.key] && Object.keys(loading[film.key]).length > 0;

  let heroHtml;
  if (hl) {
    const alt = hl.alt != null ? `≈ <b class="num">${esc(money(hl.alt, hl.altCurrency))}</b> · ` : "";
    heroHtml = `<div class="hero">
      <div class="hero__label">Worldwide gross</div>
      <div class="hero__value num">${esc(money(hl.value, hl.currency))}</div>
      <div class="hero__alt">${alt}via ${esc(hl.sourceName)}</div>
    </div>`;
  } else {
    heroHtml = `<div class="hero"><div class="hero__label">Worldwide gross</div><div class="hero__value num" style="color:var(--text-3)">${anyLoading ? "…" : "—"}</div>
      <div class="hero__alt">${anyLoading ? "Fetching sources" : "No source has figures yet — it may not have released."}</div></div>`;
  }

  let todayHtml = "";
  if (latest) {
    const tag = latest.live
      ? `<span class="live">Live</span>${latest.asOf ? `<span class="est">${esc(latest.asOf)}</span>` : ""}`
      : latest.estimate ? `<span class="est">estimate</span>` : "";
    todayHtml = `<div class="today">
      <div class="today__main">
        <span class="today__label">${esc(latest.label)} · ${esc(latest.region)}</span>
        <span class="today__value num">${esc(money(latest.value, latest.currency))} ${deltaHtml(latest.change)}</span>
      </div>
      <div class="today__tag">${tag}</div>
    </div>`;
  }

  const rows = sources.map((s) => sourceRowHtml(film, s.src, s.id, res, hl, maxUsd)).join("") +
    missing.map((s) => sourceRowHtml(film, s, null, {}, hl, maxUsd)).join("");

  return `<article class="card" data-key="${esc(film.key)}">
    <div class="card__head">
      <div class="poster" ${poster}>${film.poster ? "" : "🎞️"}</div>
      <div style="min-width:0">
        <h2 class="card__title">${esc(film.title)}</h2>
        <p class="card__meta">${meta.join("")}</p>
      </div>
      <button class="card__x" data-remove="${esc(film.key)}" aria-label="Stop tracking ${esc(film.title)}" title="Remove">×</button>
    </div>
    ${heroHtml}
    ${todayHtml}
    ${barsHtml(film, ok)}
    <div class="sources">${rows}</div>
  </article>`;
}

function renderCard(film) {
  const html = cardHtml(film);
  const old = el.films.querySelector(`[data-key="${CSS.escape(film.key)}"]`);
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const node = tmp.firstElementChild;
  if (old) {
    node.style.animation = "none";
    old.replaceWith(node);
  } else el.films.appendChild(node);
}

function renderAll() {
  el.films.innerHTML = "";
  films.forEach(renderCard);
  el.empty.hidden = films.length > 0;
  renderCount();
  renderStatus();
}

function renderFxHint() {
  el.fxHint.textContent = fx.fallback
    ? "Using an approximate rate of 1 USD = ₹" + fx.rate + " (live rate unavailable)."
    : "1 USD = ₹" + fx.rate.toFixed(2) + " · live rate from open.er-api.com, " + core.timeAgo(fx.at) + ".";
}

/* ------------------------------------------------------------------ */
/* Refresh                                                             */
/* ------------------------------------------------------------------ */

async function refreshFilm(film, fresh) {
  const fetchText = makeFetchText(fresh);
  const sources = core.filmSources(film);
  loading[film.key] = {};
  sources.forEach((s) => (loading[film.key][s.src] = true));
  renderCard(film);
  results[film.key] = results[film.key] || {};
  await Promise.all(
    sources.map(async (s) => {
      try {
        const r = await core.fetchSource(fetchText, s.src, s.id);
        results[film.key][s.src] = r;
        if (!film.poster && r.poster) film.poster = r.poster;
      } catch (e) {
        const prev = results[film.key][s.src];
        // Keep the last good figures if a refresh fails; note the error only if we have nothing.
        if (!prev || prev.ok === false) results[film.key][s.src] = { ok: false, error: friendlyError(e), at: Date.now() };
      } finally {
        delete loading[film.key][s.src];
        if (films.indexOf(film) >= 0) renderCard(film);
      }
    })
  );
  saveResults();
  saveFilms();
}

function friendlyError(e) {
  const m = String((e && e.message) || e || "");
  if (/404/.test(m) || /not found/i.test(m)) return "Not listed";
  if (/No .*(figures|grosses|gross|data)/i.test(m)) return "No figures yet";
  if (/429/.test(m)) return "Busy — try again soon";
  if (/allowed|Failed to fetch|NetworkError|Load failed|unreachable/i.test(m)) return apiReachable ? "Unreachable" : "Needs API";
  return "Unavailable";
}

async function refreshAll(fresh) {
  if (refreshing || !films.length) return;
  refreshing = true;
  el.refresh.classList.add("is-spinning");
  renderStatus();
  try {
    await Promise.all(films.filter((f) => !f.resolving).map((f) => refreshFilm(f, fresh)));
    lastRefresh = Date.now();
    store.set(LS.last, lastRefresh);
  } finally {
    refreshing = false;
    el.refresh.classList.remove("is-spinning");
    renderStatus();
  }
}

function maybeAutoRefresh() {
  if (document.hidden) return;
  if (Date.now() - lastRefresh >= HOUR) refreshAll(false);
  else renderStatus();
}

/* ------------------------------------------------------------------ */
/* Search + add/remove                                                 */
/* ------------------------------------------------------------------ */

let searchSeq = 0;
let searchItems = [];
let activeIdx = -1;

function closeResults() {
  el.results.hidden = true;
  el.results.innerHTML = "";
  activeIdx = -1;
}

function showResultsMsg(msg) {
  el.results.hidden = false;
  el.results.innerHTML = `<li class="r-msg">${esc(msg)}</li>`;
}

async function runSearch(q) {
  const seq = ++searchSeq;
  showResultsMsg("Searching…");
  try {
    const items = await core.searchFilms(makeFetchText(false), q);
    if (seq !== searchSeq) return;
    searchItems = items;
    if (!items.length) return showResultsMsg("No films found. Try the exact title or add the year.");
    el.results.hidden = false;
    el.results.innerHTML = items
      .map((it, i) => {
        const tag = it.via === "wiki" ? "WIKI" : it.via === "bom" ? "BOM" : "SAC";
        const tracked = films.some((f) => f.key === core.filmKey(it));
        return `<li role="option" data-i="${i}" aria-selected="false"><button type="button" data-pick="${i}">
          <span><span class="r-title">${esc(it.title)}</span> <span class="r-year">${it.year ? "(" + esc(it.year) + ")" : ""}</span>
          <span class="r-desc">${tracked ? "Already tracking" : esc(it.desc || "")}</span></span>
          <span class="r-tag">${tag}</span></button></li>`;
      })
      .join("");
  } catch (e) {
    if (seq !== searchSeq) return;
    showResultsMsg("Search failed — check your connection and try again.");
  }
}

async function addFilm(pick) {
  closeResults();
  el.input.value = "";
  el.input.blur();
  if (films.filter((f) => !f.resolving).length >= core.MAX_FILMS) return toast("You can track 3 films. Remove one first.");
  const tmpKey = "resolving-" + Date.now();
  const placeholder = { key: tmpKey, title: pick.title, year: pick.year, resolving: true };
  films.push(placeholder);
  renderAll();
  try {
    const film = await core.resolveFilm(makeFetchText(false), pick);
    const idx = films.indexOf(placeholder);
    if (idx < 0) return; // removed while resolving
    if (films.some((f) => f.key === film.key)) {
      films.splice(idx, 1);
      renderAll();
      return toast("Already tracking " + film.title);
    }
    films[idx] = film;
    saveFilms();
    renderAll();
    if (!core.filmSources(film).length) toast("Couldn't find " + film.title + " on any box office source yet.");
    await refreshFilm(film, true);
    if (!lastRefresh) { lastRefresh = Date.now(); store.set(LS.last, lastRefresh); }
    renderStatus();
  } catch (e) {
    films = films.filter((f) => f !== placeholder);
    renderAll();
    toast("Couldn't add that film — " + friendlyError(e).toLowerCase() + ".");
  }
}

function removeFilm(key) {
  const f = films.find((x) => x.key === key);
  if (!f) return;
  if (!confirm("Stop tracking " + f.title + "?")) return;
  films = films.filter((x) => x.key !== key);
  delete results[key];
  saveFilms();
  saveResults();
  renderAll();
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(LS.theme, t); } catch (e) { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute("content", t === "light" ? "#f4f3ef" : "#0a0a0f");
}

function initSettings() {
  let theme = "dark";
  try { theme = localStorage.getItem(LS.theme) || "dark"; } catch (e) { /* ignore */ }
  const tr = el.settings.querySelector(`input[name="theme"][value="${theme}"]`);
  if (tr) tr.checked = true;
  const cr = el.settings.querySelector(`input[name="cur"][value="${curPref}"]`);
  if (cr) cr.checked = true;
  el.settings.addEventListener("change", (e) => {
    if (e.target.name === "theme") applyTheme(e.target.value);
    if (e.target.name === "cur") {
      curPref = e.target.value;
      store.set(LS.cur, curPref);
      renderAll();
    }
  });
  el.settingsBtn.addEventListener("click", () => {
    renderFxHint();
    el.settings.showModal();
  });
  el.settings.addEventListener("click", (e) => { if (e.target === el.settings) el.settings.close(); });
  el.srcList.innerHTML = Object.keys(core.SOURCES)
    .map((k) => `<li><b>${esc(core.SOURCES[k].name)}</b> — ${esc(core.SOURCES[k].blurb)}</li>`)
    .join("");
  el.copyWidgetBtn.addEventListener("click", async () => {
    const src = "widget/Box-Office-Tracker.js";
    try {
      // A promise-backed ClipboardItem keeps Safari's user-gesture permission across the fetch.
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        const blob = fetch(src, { cache: "no-store" }).then((r) => {
          if (!r.ok) throw new Error("missing");
          return r.text();
        }).then((t) => new Blob([t], { type: "text/plain" }));
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      } else {
        const t = await (await fetch(src, { cache: "no-store" })).text();
        await navigator.clipboard.writeText(t);
      }
      toast("Widget script copied. Open Scriptable → + → paste.", 3500);
    } catch (e) {
      window.open(src, "_blank");
    }
  });
  el.exportBtn.addEventListener("click", async () => {
    const payload = JSON.stringify({
      app: "box-office-tracker",
      v: 1,
      films: films.filter((f) => !f.resolving).map((f) => ({ key: f.key, title: f.title, year: f.year, released: f.released, origin: f.origin, wiki: f.wiki, qid: f.qid, imdb: f.imdb, sacnilk: f.sacnilk, numbers: f.numbers, poster: f.poster })),
    });
    try {
      await navigator.clipboard.writeText(payload);
      toast("Copied " + films.length + " film(s). Open the widget script → Import from clipboard.");
    } catch (e) {
      prompt("Copy this text:", payload);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Pull to refresh (useful in home-screen mode, which has no reload)   */
/* ------------------------------------------------------------------ */

function initPullToRefresh() {
  let startY = null;
  let dy = 0;
  window.addEventListener("touchstart", (e) => {
    if (window.scrollY <= 0 && !el.settings.open && e.touches.length === 1) startY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy <= 0) return;
    const y = Math.min(dy, 110) - 60;
    el.ptr.style.transform = `translate(-50%, ${y}px)`;
    el.ptr.classList.toggle("is-ready", dy > 80);
  }, { passive: true });
  window.addEventListener("touchend", () => {
    if (startY == null) return;
    const go = dy > 80;
    startY = null;
    dy = 0;
    el.ptr.style.transform = "";
    el.ptr.classList.remove("is-ready");
    if (go) refreshAll(true);
  });
}

/* ------------------------------------------------------------------ */
/* Wire up                                                             */
/* ------------------------------------------------------------------ */

function init() {
  // Drop any half-finished adds from a previous session.
  films = films.filter((f) => f && f.key && !f.resolving).slice(0, core.MAX_FILMS);
  renderAll();
  initSettings();
  initPullToRefresh();

  let debounce;
  el.input.addEventListener("input", () => {
    clearTimeout(debounce);
    const q = el.input.value.trim();
    if (q.length < 2) return closeResults();
    debounce = setTimeout(() => runSearch(q), 350);
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = el.input.value.trim();
    if (activeIdx >= 0 && searchItems[activeIdx]) return addFilm(searchItems[activeIdx]);
    if (q.length >= 2) {
      clearTimeout(debounce);
      runSearch(q);
    }
  });
  el.input.addEventListener("keydown", (e) => {
    const opts = el.results.querySelectorAll("li[role=option]");
    if (e.key === "Escape") return closeResults();
    if (!opts.length || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute("aria-selected", i === activeIdx ? "true" : "false"));
    opts[activeIdx].scrollIntoView({ block: "nearest" });
  });
  el.results.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (b) addFilm(searchItems[+b.dataset.pick]);
  });
  document.addEventListener("click", (e) => {
    if (!el.results.hidden && !e.target.closest("#results") && !e.target.closest("#searchForm")) closeResults();
  });
  el.films.addEventListener("click", (e) => {
    const x = e.target.closest("[data-remove]");
    if (x) removeFilm(x.dataset.remove);
  });
  el.refresh.addEventListener("click", () => refreshAll(true));

  document.addEventListener("visibilitychange", maybeAutoRefresh);
  setInterval(maybeAutoRefresh, 30 * 1000);

  checkApi().then(() => {
    if (films.length && Date.now() - lastRefresh >= HOUR) refreshAll(false);
  });
  loadFx();
}

init();
