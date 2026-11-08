/*
 * Box Office Tracker core.
 *
 * Environment-agnostic: no DOM, no fetch, no URL/URLSearchParams (Scriptable on
 * iOS has none of them). Every network call goes through an injected
 * `fetchText(url, headers)` that resolves to the response body as a string.
 *
 * Used by:
 *   - the API (Vercel / Cloudflare Pages / Node server)  -> scraping + JSON
 *   - the Scriptable iPhone widget (bundled in by scripts/build-widget.mjs)
 *   - the web front end (only the formatting / summary helpers)
 */

export const CORE_VERSION = "1.0.0";
export const MAX_FILMS = 3;

const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const BOT_UA =
  "BoxOfficeTracker/1.0 (personal box office tracker; https://github.com/ashwinsocial119-lgtm/my-dns-profile-generator)";

const HOSTS = {
  wiki: "https://en.wikipedia.org",
  wikidata: "https://www.wikidata.org",
  bom: "https://www.boxofficemojo.com",
  sacnilk: "https://www.sacnilk.com",
  numbers: "https://www.the-numbers.com",
};

export const SOURCES = {
  sacnilk: {
    name: "Sacnilk",
    short: "SAC",
    blurb: "Indian trade tracker. Live day estimates, India net/gross and overseas.",
  },
  numbers: {
    name: "The Numbers",
    short: "TN",
    blurb: "Nash Information Services. Fast weekend and daily estimates, worldwide totals.",
  },
  bom: {
    name: "Box Office Mojo",
    short: "BOM",
    blurb: "IMDb's box office database. Studio-reported domestic and international grosses.",
  },
  wiki: {
    name: "Wikipedia",
    short: "WIKI",
    blurb: "Editor-maintained figure citing trade sources.",
  },
};

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·",
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  hellip: "…", rarr: "→", larr: "←", times: "×", bull: "•", rupee: "₹",
};

export function decodeEntities(s) {
  return String(s == null ? "" : s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v == null ? m : v;
  });
}

export function stripTags(s) {
  return decodeEntities(String(s == null ? "" : s).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function qs(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
    .join("&");
}

/** Lower-case, strip accents/punctuation, collapse spaces. */
export function normTitle(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanWikiTitle(t) {
  return String(t || "").replace(/\s*\((?:\d{4} )?(?:[A-Za-z-]+ )*film\)\s*$/i, "").trim();
}

function yearFrom(s) {
  const m = String(s || "").match(/\b(19[0-9]{2}|20[0-9]{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

export function filmKey(f) {
  return (normTitle(f.title).replace(/ /g, "-") || "film") + "-" + (f.year || "na");
}

async function getJSON(fetchText, url, headers) {
  const txt = await fetchText(url, headers);
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error("Bad JSON from " + url.split("?")[0]);
  }
}

function wikiHeaders() {
  return { "User-Agent": BOT_UA, "Api-User-Agent": BOT_UA, Accept: "application/json" };
}
function browserHeaders() {
  return { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };
}

/* ------------------------------------------------------------------ */
/* Money parsing                                                       */
/* ------------------------------------------------------------------ */

const INR_UNITS = { cr: 1e7, crore: 1e7, crores: 1e7, c: 1e7, l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, k: 1e3, b: 1e9, billion: 1e9, m: 1e6, million: 1e6 };
const USD_UNITS = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, mn: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** "₹390.50 Cr" | "₹42 L" | "₹1,742.10 Cr" -> rupees */
export function parseINR(s) {
  const m = String(s || "").replace(/\s+/g, " ").match(/([\d,]+(?:\.\d+)?)(?:\s*[–-]\s*[\d,]+(?:\.\d+)?)?\s*(crores?|cr|lakhs?|lac|l|k)?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return null;
  const unit = m[2] ? INR_UNITS[m[2].toLowerCase()] : 1;
  return Math.round(n * (unit || 1));
}

/** "$6,000,000" | "$983.1 million" | "US$1.2 billion" -> dollars */
export function parseUSD(s) {
  const m = String(s || "").replace(/\s+/g, " ").match(/\$\s*([\d,]+(?:\.\d+)?)(?:\s*[–-]\s*\$?[\d,]+(?:\.\d+)?)?\s*(thousand|million|billion|mn|bn|k|m|b)?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return null;
  const unit = m[2] ? USD_UNITS[m[2].toLowerCase()] : 1;
  return Math.round(n * (unit || 1));
}

/* ------------------------------------------------------------------ */
/* Formatting (shared by web app + widget)                             */
/* ------------------------------------------------------------------ */

function trimNum(n, digits) {
  return n.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function groupIndian(n) {
  const s = String(Math.round(n));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return rest + "," + last3;
}

export function formatMoney(value, currency, opts) {
  opts = opts || {};
  if (value == null || !isFinite(value)) return "—";
  const neg = value < 0;
  const v = Math.abs(value);
  let out;
  if (currency === "INR") {
    if (v >= 1e7) {
      const cr = v / 1e7;
      out = "₹" + (cr >= 1000 ? groupIndian(cr) : cr.toFixed(2)) + " Cr";
    } else if (v >= 1e5) out = "₹" + trimNum(v / 1e5, 2) + " L";
    else out = "₹" + groupIndian(v);
  } else {
    if (v >= 1e9) out = "$" + trimNum(v / 1e9, 2) + "B";
    else if (v >= 1e6) out = "$" + trimNum(v / 1e6, v >= 1e8 ? 1 : 2) + "M";
    else if (v >= 1e3) out = "$" + trimNum(v / 1e3, 1) + "K";
    else out = "$" + Math.round(v);
  }
  if (opts.compact) out = out.replace(" Cr", "Cr").replace(" L", "L");
  return (neg ? "-" : "") + out;
}

export function convert(value, from, to, usdInr) {
  if (value == null || from === to) return value;
  if (!usdInr) return null;
  if (from === "USD" && to === "INR") return value * usdInr;
  if (from === "INR" && to === "USD") return value / usdInr;
  return null;
}

export function timeAgo(iso, now) {
  if (!iso) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!isFinite(t)) return "";
  const s = Math.max(0, Math.round(((now || Date.now()) - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + " hr ago";
  const d = Math.round(h / 24);
  return d + (d === 1 ? " day ago" : " days ago");
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "8 Nov 2026" | "Nov 8, 2026" | "November 8, 2026" | "Nov 8" -> "2026-11-08" (or null). */
export function parseLooseDate(s, now) {
  const t = String(s || "");
  let d, mo, y;
  let m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m) { d = +m[1]; mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; y = +m[3]; }
  if (!mo) {
    m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/);
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) { mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = m[3] ? +m[3] : null; }
  }
  if (!mo) {
    m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\b/);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) { d = +m[1]; mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; y = null; }
  }
  if (!mo || !d) return null;
  if (!y) {
    const ref = new Date(now || Date.now());
    y = ref.getFullYear();
    if (Date.UTC(y, mo - 1, d) > ref.getTime() + 2 * 864e5) y -= 1;
  }
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

export function isStale(result, now, days) {
  if (!result || !result.asOf) return false;
  const t = Date.parse(result.asOf + (result.asOf.length === 10 ? "T23:59:59Z" : ""));
  return isFinite(t) && (now || Date.now()) - t > (days || 10) * 864e5;
}

/* ------------------------------------------------------------------ */
/* Wikipedia / Wikidata                                                */
/* ------------------------------------------------------------------ */

const FILM_DESC = /\b(film|movie)\b/i;

export async function wikiSearch(fetchText, q) {
  const url =
    HOSTS.wiki +
    "/w/api.php?" +
    qs({
      action: "query",
      format: "json",
      formatversion: 2,
      origin: "*",
      generator: "search",
      gsrsearch: q + " film",
      gsrlimit: 12,
      gsrnamespace: 0,
      prop: "pageprops|description",
      ppprop: "wikibase_item|disambiguation",
      redirects: 1,
    });
  const data = await getJSON(fetchText, url, wikiHeaders());
  const pages = (data.query && data.query.pages) || [];
  pages.sort((a, b) => a.index - b.index);
  const out = [];
  for (const p of pages) {
    const desc = p.description || "";
    const pp = p.pageprops || {};
    if (pp.disambiguation !== undefined) continue;
    const isFilm = /\bfilm\)$/i.test(p.title) || (FILM_DESC.test(desc) && !/\b(series|season|soundtrack|album|song|franchise|character|actor|actress|director|novel|book)\b/i.test(desc));
    if (!isFilm) continue;
    out.push({
      title: cleanWikiTitle(p.title),
      year: yearFrom(p.title) || yearFrom(desc),
      desc: desc,
      wiki: p.title,
      qid: pp.wikibase_item || null,
      via: "wiki",
    });
  }
  // Recent and upcoming films first; otherwise keep Wikipedia's relevance order.
  const now = new Date().getFullYear();
  const recent = (c) => (c.year ? c.year >= now - 1 : /upcoming|\b20\d\d\b/i.test(c.desc)) ? 0 : 1;
  return out.map((c, i) => ({ c: c, i: i })).sort((a, b) => recent(a.c) - recent(b.c) || a.i - b.i).map((x) => x.c);
}

function infoboxField(text, name) {
  // Grab "| name = value" up to the next top-level "\n|" or "\n}}"
  const re = new RegExp("\\n\\s*\\|\\s*" + name + "\\s*=([\\s\\S]*?)(?=\\n\\s*\\||\\n\\s*\\}\\})", "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function cleanWikitext(v) {
  return String(v || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/\{\{\s*(?:efn|sfn|refn|r)\b[^{}]*\}\}/gi, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/'''?/g, "")
    .replace(/&nbsp;|\{\{\s*nbsp\s*\}\}/gi, " ")
    .trim();
}

/** Parse an infobox gross/budget value into {value, currency, text}. */
export function parseWikiMoney(raw) {
  let v = cleanWikitext(raw);
  if (!v) return null;
  // Templates: {{INRConvert|433.86|c}}  {{INR|821 crore}}  {{US$|1.2 billion}}  {{est.}}
  v = v.replace(/\{\{\s*INRConvert\s*\|\s*([\d.,]+)\s*(?:\|\s*([a-z]+))?[^}]*\}\}/gi, (m, n, u) => {
    const unit = (u || "").toLowerCase();
    const word = unit === "c" || unit === "cr" ? " crore" : unit === "l" ? " lakh" : unit === "b" ? " billion" : unit === "m" ? " million" : "";
    return "₹" + n + word;
  });
  v = v.replace(/\{\{\s*(?:INR|Indian Rupee)\s*\}\}\s*/gi, "₹");
  v = v.replace(/\{\{\s*(?:INR|₹)\s*\|\s*([^}|]+)[^}]*\}\}/gi, "₹$1");
  v = v.replace(/\{\{\s*(?:US\$|USD)\s*\|\s*([^}|]+)[^}]*\}\}/gi, "$$$1");
  v = v.replace(/\{\{\s*(?:US\$|USD)\s*\}\}\s*/gi, "$$");
  v = v.replace(/\{\{\s*(?:est\.?|estimated|circa|c\.)\s*\}\}/gi, "est. ");
  v = v.replace(/\{\{[^{}]*\}\}/g, "").replace(/\s+/g, " ").trim();
  const text = v;
  const inrIdx = text.search(/₹|\bRs\.?\s?\d|\bINR\b/);
  const usdIdx = text.search(/\$\s?\d/);
  let value = null;
  let currency = null;
  if (inrIdx >= 0 && (usdIdx < 0 || inrIdx < usdIdx)) {
    value = parseINR(text.slice(inrIdx).replace(/^(?:₹|Rs\.?|INR)\s*/, ""));
    currency = "INR";
  } else if (usdIdx >= 0) {
    value = parseUSD(text.slice(usdIdx));
    currency = "USD";
  }
  if (value == null) return { value: null, currency: null, text: text };
  return { value: value, currency: currency, text: text };
}

function parseWikiReleased(raw) {
  const v = String(raw || "");
  const fd = v.match(/\{\{\s*(?:Film date|Start date)\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i);
  if (fd) return fd[1] + "-" + fd[2].padStart(2, "0") + "-" + fd[3].padStart(2, "0");
  const y = yearFrom(cleanWikitext(v));
  return y ? String(y) : null;
}

/** Find links to the other trackers in a wikitext blob. */
export function extractSourceLinks(text) {
  const t = String(text || "");
  const out = {};
  let m = t.match(/the-numbers\.com\/movie\/([A-Za-z0-9%'.,!&+_\-()]+?)(?:#|\s|\||\]|\}|\/|$)/) || t.match(/\{\{\s*Cite The Numbers\s*\|[^}]*?\bid\s*=\s*([^|}\s]+)/i);
  if (m) {
    try { out.numbers = decodeURIComponent(m[1]); } catch (e) { out.numbers = m[1]; }
  }
  m = t.match(/boxofficemojo\.com\/(?:title|movies\/\?id=)\/?(tt\d+)/) || t.match(/\{\{\s*Cite Box Office Mojo\s*\|[^}]*?\bid\s*=\s*(?:tt)?(\d{5,10})\b/i);
  if (m) out.imdb = /^tt/.test(m[1]) ? m[1] : "tt" + m[1];
  m = t.match(/sacnilk\.com\/(movie\/[A-Za-z0-9_\-]+)/);
  if (m) out.sacnilk = "/" + m[1];
  else {
    m = t.match(/sacnilk\.com\/(news\/[A-Za-z0-9_\-]+_Box_Office_Collection_Day_Wise_Worldwide)/);
    if (m) out.sacnilk = "/" + m[1];
  }
  return out;
}

async function wikiPage(fetchText, title) {
  const url =
    HOSTS.wiki +
    "/w/api.php?" +
    qs({
      action: "query",
      format: "json",
      formatversion: 2,
      origin: "*",
      prop: "revisions|pageprops",
      ppprop: "wikibase_item",
      rvprop: "content|timestamp",
      rvslots: "main",
      rvsection: 0,
      redirects: 1,
      titles: title,
    });
  const data = await getJSON(fetchText, url, wikiHeaders());
  const p = data.query && data.query.pages && data.query.pages[0];
  if (!p || p.missing) throw new Error("Wikipedia page not found");
  const rev = p.revisions && p.revisions[0];
  const text = rev ? (rev.slots && rev.slots.main && rev.slots.main.content) || rev.content || "" : "";
  return { title: p.title, qid: p.pageprops && p.pageprops.wikibase_item, text: text, timestamp: rev && rev.timestamp };
}

async function wikidataImdb(fetchText, qid) {
  if (!/^Q\d+$/.test(qid || "")) return null;
  const url = HOSTS.wikidata + "/w/api.php?" + qs({ action: "wbgetclaims", format: "json", origin: "*", entity: qid, property: "P345" });
  const data = await getJSON(fetchText, url, wikiHeaders());
  const claims = (data.claims && data.claims.P345) || [];
  for (const c of claims) {
    const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
    if (/^tt\d+$/.test(v || "")) return v;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Sacnilk                                                             */
/* ------------------------------------------------------------------ */

export async function sacnilkSearch(fetchText, q) {
  const term = String(q || "").trim();
  if (term.length < 3) return [];
  const url = HOSTS.sacnilk + "/pages/search.php?" + qs({ term: term });
  const data = await getJSON(fetchText, url, Object.assign(browserHeaders(), { Accept: "application/json" }));
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const r of data) {
    const v = String(r.value || "");
    const label = decodeEntities(String(r.label || ""));
    let m = v.match(/^\/movie\/([A-Za-z0-9_\-]+)$/);
    if (m) {
      out.push({ kind: "movie", path: v, label: label, year: yearFrom(m[1].slice(-4)) });
      continue;
    }
    m = v.match(/^\/news\/([A-Za-z0-9_\-]+)_Box_Office_Collection_Day_Wise_Worldwide$/);
    if (m) {
      out.push({ kind: "daywise", path: v, label: label.replace(/\s*Box Office Collection.*$/i, "").trim(), year: yearFrom(m[1].slice(-4)) });
    }
  }
  return out;
}

function scoreTitle(candidate, wanted) {
  const a = normTitle(candidate);
  const b = normTitle(wanted);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const bNoSub = normTitle(String(wanted).split(/[:\-–]/)[0]);
  if (a === bNoSub) return 85;
  if (b.startsWith(a + " ") || a.startsWith(b + " ")) return 70;
  if (b.indexOf(a) >= 0 || a.indexOf(b) >= 0) return 50;
  // token overlap
  const at = a.split(" "), bt = b.split(" ");
  const common = at.filter((t) => bt.indexOf(t) >= 0).length;
  return Math.round((common / Math.max(at.length, bt.length)) * 45);
}

export function pickSacnilk(results, title, year) {
  let best = null;
  for (const r of results) {
    let s = scoreTitle(r.label, title);
    if (s < 50) continue;
    if (r.kind === "movie") s += 5;
    if (year && r.year) {
      // Sacnilk slugs carry the *announcement* year, which can predate release.
      if (r.year === year) s += 10;
      else if (r.year < year && year - r.year <= 5) s += 2;
      else s -= 30;
    }
    if (!best || s > best.s) best = { s: s, r: r };
  }
  return best && best.s >= 55 ? best.r.path : null;
}

function sacnilkStats(seg) {
  const stats = {};
  const re = /<div class="ds-stat__k">([\s\S]*?)<\/div>\s*<div class="ds-stat__v[^"]*">([\s\S]*?)<\/div>(?:\s*<div class="ds-stat__s">([\s\S]*?)<\/div>)?/g;
  let m;
  while ((m = re.exec(seg))) {
    stats[stripTags(m[1])] = { v: stripTags(m[2]), s: m[3] ? stripTags(m[3]) : "" };
  }
  return stats;
}

function sacnilkDaily(html) {
  const i = html.indexOf('data-ds-dpanel="all"');
  if (i < 0) return { rows: [], live: null };
  const end = html.indexOf("</table>", i);
  const table = html.slice(i, end > 0 ? end : i + 40000);
  const rows = [];
  let live = null;
  const rre = /<tr(?: class="([^"]*)")?>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rre.exec(table))) {
    const cls = m[1] || "";
    if (/\b(wk|tot)\b/.test(cls)) continue;
    const cells = m[2].match(/<td[^>]*>[\s\S]*?<\/td>/g);
    if (!cells || cells.length < 3) continue;
    const first = cells[0];
    const labelM = first.match(/<a[^>]*>([\s\S]*?)<\/a>/);
    const subM = first.match(/<span class="sub">([^<]*)/);
    const label = labelM ? stripTags(labelM[1]) : stripTags(first.replace(/<span[\s\S]*$/, ""));
    const net = parseINR(stripTags(cells[1]));
    const gross = parseINR(stripTags(cells[2]));
    const isLive = /\bis-today\b/.test(cls) && /ds-pill--live/.test(m[2]);
    const row = { label: label, date: subM ? stripTags(subM[1]) : "", value: net, gross: gross };
    if (isLive) {
      const asof = m[2].match(/as of ([^<]+)</);
      row.live = true;
      live = { label: label, asOf: asof ? stripTags(asof[1]) : "" };
    }
    if (/^Day \d+/i.test(label)) rows.push(row);
  }
  return { rows: rows, live: live };
}

export function parseSacnilk(html, path) {
  const url = HOSTS.sacnilk + path;
  const hi = html.indexOf('class="ds-hero-fig"');
  if (hi < 0) throw new Error("No box office figures on Sacnilk yet");
  // The hero card is preceded by its header on day-wise pages and followed by the stats grid.
  const seg = html.slice(Math.max(0, hi - 600), hi + 6000);
  const heroV = seg.match(/ds-hero-fig__v">([\s\S]*?)<\/span>\s*(?:<span class="ds-upd">|<\/div>)/);
  const heroL = seg.match(/ds-hero-fig__lbl">([\s\S]*?)<\/span>/);
  const upd = seg.match(/class="ds-upd">([^<]+)</) || seg.match(/ds-ww-card__h">[\s\S]*?·\s*(updated[^<]+)</);
  const stats = sacnilkStats(seg);

  const titleM = html.match(/<meta property="og:title" content="([^"]+)"/);
  const imgM = html.match(/<meta property="og:image" content="(https:\/\/cdn\.sacnilk\.com\/[^"]+)"/);
  const heroLabel = heroL ? stripTags(heroL[1]) : "Worldwide gross";
  const ww = heroV ? parseINR(stripTags(heroV[1])) : null;
  const statVal = (k) => (stats[k] ? parseINR(stats[k].v) : null);
  const overseasRaw = stats["Overseas"] ? stats["Overseas"].v : "";
  const overseas = /\d/.test(overseasRaw) ? parseINR(overseasRaw) : null;

  const figures = [];
  const add = (key, label, value, note) => { if (value != null) figures.push({ key: key, label: label, value: value, note: note || "" }); };
  add("worldwide", overseas != null ? "Worldwide gross" : "Gross (India)", ww);
  add("india_net", "India net", statVal("India net"));
  add("india_gross", "India gross", statVal("India gross"));
  add("overseas", "Overseas", overseas);

  const daily = sacnilkDaily(html);
  let latest = null;
  const dayKey = Object.keys(stats).filter((k) => /^Day \d+$/i.test(k))[0];
  if (dayKey) {
    const s = stats[dayKey];
    const ch = s.s.match(/[▲▼]\s*([\d.]+%)/);
    latest = { label: dayKey, value: parseINR(s.v), change: ch ? (s.s.indexOf("▼") >= 0 ? "-" : "+") + ch[1] : "" };
  } else {
    const lm = seg.match(/Latest day:\s*<b>([^<]+)<\/b>\s*<b[^>]*>([^<]+)<\/b>/);
    if (lm) latest = { label: stripTags(lm[1]), value: parseINR(lm[2]), change: "" };
  }
  if (latest && daily.live && daily.live.label === latest.label) {
    latest.live = true;
    latest.asOf = daily.live.asOf;
  } else if (latest && /ds-pill--live/.test(seg)) {
    const asof = seg.match(/ds-dp-asof">([^<]+)</);
    latest.live = true;
    latest.asOf = asof ? stripTags(asof[1]).replace(/^as of\s*/i, "") : "";
  }

  const langs = [];
  const li = seg.match(/<ul class="ds-dp-langs"[\s\S]*?<\/ul>/);
  if (li) {
    const lre = /<li><span>([^<]+)<\/span><b>([^<]+)<\/b><\/li>/g;
    let lm;
    while ((lm = lre.exec(li[0]))) langs.push({ label: stripTags(lm[1]), value: parseINR(lm[2]) });
  }

  const byline = html.match(/Updated:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/);
  const asOf = parseLooseDate(upd && /\d{4}/.test(upd[1]) ? upd[1] : byline ? byline[1] : "");
  const daysM = heroLabel.match(/(\d+)\s*days?/i) || (upd && upd[0].match(/(\d+)\s*days/));
  const verdict = stats["Verdict"] ? stats["Verdict"].v : "";
  return {
    source: "sacnilk",
    url: url,
    title: titleM ? decodeEntities(titleM[1]) : null,
    poster: imgM ? imgM[1] : null,
    currency: "INR",
    worldwide: overseas != null ? ww : null, // Without overseas the hero is India-only.
    indiaGross: statVal("India gross"),
    figures: figures,
    latest: latest,
    daily: daily.rows.slice(-21),
    dailyLabel: "India net",
    langs: langs,
    days: daysM ? parseInt(daysM[1], 10) : null,
    verdict: verdict,
    asOf: asOf,
    updated: upd ? stripTags(upd[1]).replace(/^Figures till\s*/i, "till ") : "",
  };
}

/* ------------------------------------------------------------------ */
/* Box Office Mojo                                                     */
/* ------------------------------------------------------------------ */

export async function bomSearch(fetchText, q) {
  const html = await fetchText(HOSTS.bom + "/search/?" + qs({ q: q }), browserHeaders());
  const out = [];
  const re = /<a class="a-size-medium a-link-normal a-text-bold" href="\/title\/(tt\d+)\/[^"]*">([\s\S]*?)<\/a>(?:\s*<span class="a-color-secondary">\s*\((\d{4})\)<\/span>)?/g;
  let m;
  while ((m = re.exec(html))) {
    out.push({ imdb: m[1], title: stripTags(m[2]), year: m[3] ? parseInt(m[3], 10) : null });
    if (out.length >= 8) break;
  }
  return out;
}

export function parseBom(html, imdb) {
  const url = HOSTS.bom + "/title/" + imdb + "/";
  const flat = html.replace(/\s+/g, " ");
  const h1 = flat.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = h1 ? stripTags(h1[1].replace(/<span[\s\S]*$/, "")) : null;
  const yearM = h1 && h1[1].match(/\((\d{4})\)/);
  const si = flat.indexOf("mojo-performance-summary-table");
  if (si < 0) throw new Error("No grosses on Box Office Mojo yet");
  const seg = flat.slice(si, si + 5000);
  const vals = {};
  const re = /<span class="a-size-small">([\s\S]*?)<\/span>\s*<br\/>\s*<span class="a-size-medium a-text-bold">([\s\S]*?)<\/span>\s*<\/div>/g;
  let m;
  while ((m = re.exec(seg))) {
    const label = stripTags(m[1]).replace(/\(.*?\)/, "").trim().toLowerCase();
    const money = m[2].match(/class="money">([^<]+)</);
    vals[label] = money ? parseUSD(money[1]) : null;
  }
  const summary = {};
  const sre = /<div class="a-section a-spacing-none"><span>([^<]+)<\/span><span>([\s\S]*?)<\/span><\/div>/g;
  const vi = flat.indexOf("mojo-summary-values");
  const vseg = vi > 0 ? flat.slice(vi, vi + 8000) : "";
  while ((m = sre.exec(vseg))) summary[stripTags(m[1])] = stripTags(m[2]).replace(/See (?:full company information|more details at IMDbPro)/g, "").trim();

  const imgM = flat.slice(0, si + 200).match(/<img[^>]+src="(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/) || flat.match(/<div class="a-section mojo-posters"[\s\S]*?<img[^>]+src="([^"]+)"/);
  const poster = imgM ? imgM[1].replace(/\._V1_[^/]*\.jpg$/, "._V1_SX300.jpg") : null;

  const figures = [];
  const add = (key, label, value) => { if (value != null) figures.push({ key: key, label: label, value: value }); };
  add("worldwide", "Worldwide", vals.worldwide);
  add("domestic", "Domestic (US & Canada)", vals.domestic);
  add("international", "International", vals.international);
  const opening = summary["Domestic Opening"] ? parseUSD(summary["Domestic Opening"]) : null;
  add("opening", "Domestic opening", opening);

  const ww = vals.worldwide != null ? vals.worldwide : (vals.domestic || 0) + (vals.international || 0) || null;
  return {
    source: "bom",
    url: url,
    title: title,
    year: yearM ? parseInt(yearM[1], 10) : null,
    poster: poster,
    currency: "USD",
    worldwide: ww,
    figures: figures,
    latest: null,
    daily: [],
    released: summary["Earliest Release Date"] || "",
    distributor: summary["Domestic Distributor"] || "",
    updated: "",
  };
}

/* ------------------------------------------------------------------ */
/* The Numbers                                                         */
/* ------------------------------------------------------------------ */

/** "Cat in the Hat, The" style slug: The Numbers moves a leading article to the end. */
export function numbersSlugCandidates(title, year, isIndian) {
  if (!title || !year) return [];
  let t = String(title).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const art = t.match(/^(The|A|An)\s+(.+)$/i);
  if (art) t = art[2] + " " + art[1];
  const base = t
    .replace(/&/g, "and")
    .replace(/['’.]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const list = [];
  if (isIndian) list.push(base + "-(" + year + "-India)");
  list.push(base + "-(" + year + ")");
  if (!isIndian) list.push(base + "-(" + year + "-India)");
  return list;
}

function numbersRow(flat, label) {
  const re = new RegExp("<b>" + label + "</b></td>\\s*<td class='data[^']*'>\\s*(\\$[\\d,]+)");
  const m = flat.match(re);
  return m ? parseUSD(m[1]) : null;
}

export function parseNumbers(html, slug) {
  const url = HOSTS.numbers + "/movie/" + slug;
  const flat = html.replace(/\s+/g, " ");
  if (flat.indexOf("id='movie_finances'") < 0 && flat.indexOf('id="movie_finances"') < 0) throw new Error("No financial data on The Numbers");
  const dom = numbersRow(flat, "Domestic Box Office");
  const intl = numbersRow(flat, "International Box Office");
  const ww = numbersRow(flat, "Worldwide Box Office");
  if (dom == null && intl == null && ww == null) throw new Error("No grosses on The Numbers yet");
  const h1 = flat.match(/<h1>([\s\S]*?)<\/h1>/);
  const posterM = flat.match(/<img src='(https:\/\/media\.the-numbers\.com\/images\/movie-posters\/[^']+)'/);

  const daily = [];
  const di = flat.indexOf("Daily Box Office Performance");
  if (di > 0) {
    const end = flat.indexOf("</table>", di);
    const table = flat.slice(di, end > 0 ? end : di + 20000);
    const rre = /<tr[^>]*>\s*<td><a href="\/box-office-chart\/daily\/[^"]+">([\s\S]*?)<\/a><\/td>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = rre.exec(table))) {
      const cells = m[2].match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
      const gross = cells[1] ? parseUSD(stripTags(cells[1])) : null;
      const est = cells[1] ? /estimate/.test(cells[1]) : false;
      const day = cells.length ? parseInt(stripTags(cells[cells.length - 1]), 10) : null;
      const full = stripTags(m[1]);
      daily.push({ label: day ? "Day " + day : full, date: full.replace(/,\s*\d{4}$/, ""), iso: parseLooseDate(full), value: gross, estimate: est });
    }
  }
  let latest = null;
  if (daily.length) {
    const last = daily[daily.length - 1];
    const prev = daily[daily.length - 2];
    latest = {
      label: last.label + " · " + last.date,
      value: last.value,
      change: prev && prev.value ? ((last.value >= prev.value ? "+" : "") + Math.round(((last.value - prev.value) / prev.value) * 100) + "%") : "",
      estimate: last.estimate,
      region: "US & Canada",
    };
  }
  const figures = [];
  const add = (key, label, value) => { if (value != null) figures.push({ key: key, label: label, value: value }); };
  add("worldwide", "Worldwide", ww);
  add("domestic", "Domestic (US & Canada)", dom);
  add("international", "International", intl);
  return {
    source: "numbers",
    url: url,
    title: h1 ? stripTags(h1[1]).replace(/\s*\(\d{4}\)\s*$/, "") : null,
    poster: posterM ? posterM[1] : null,
    currency: "USD",
    worldwide: ww != null ? ww : dom != null || intl != null ? (dom || 0) + (intl || 0) : null,
    figures: figures,
    latest: latest,
    daily: daily.slice(-21),
    dailyLabel: "US & Canada daily",
    asOf: daily.length ? daily[daily.length - 1].iso : null,
    updated: daily.length ? "till " + daily[daily.length - 1].date : "",
  };
}

/* ------------------------------------------------------------------ */
/* Wikipedia as a source                                               */
/* ------------------------------------------------------------------ */

export function parseWiki(page) {
  const text = page.text;
  const gross = parseWikiMoney(infoboxField(text, "gross"));
  const budget = parseWikiMoney(infoboxField(text, "budget"));
  if (!gross || gross.value == null) throw new Error("No gross listed on Wikipedia yet");
  const figures = [{ key: "worldwide", label: "Gross", value: gross.value, note: gross.text.length < 60 ? gross.text : "" }];
  if (budget && budget.value != null && budget.currency === gross.currency) figures.push({ key: "budget", label: "Budget", value: budget.value, note: "" });
  return {
    source: "wiki",
    url: HOSTS.wiki + "/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")),
    title: cleanWikiTitle(page.title),
    poster: null,
    currency: gross.currency,
    worldwide: gross.value,
    figures: figures,
    latest: null,
    daily: [],
    asOf: page.timestamp ? page.timestamp.slice(0, 10) : null,
    updated: page.timestamp ? "edited " + page.timestamp.slice(0, 10) : "",
    editedAt: page.timestamp || null,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

function settle(p) {
  return p.then((v) => ({ ok: true, v: v }), (e) => ({ ok: false, e: e }));
}

/**
 * Search for films. Wikipedia drives the results (best fuzzy matching for
 * Indian and international titles); Sacnilk and Box Office Mojo fill in
 * films that have no Wikipedia article yet.
 */
export async function searchFilms(fetchText, q) {
  q = String(q || "").trim().slice(0, 80);
  if (q.length < 2) return [];
  const [w, s, b] = await Promise.all([
    settle(wikiSearch(fetchText, q)),
    settle(sacnilkSearch(fetchText, q)),
    settle(bomSearch(fetchText, q)),
  ]);
  const out = [];
  const seen = {};
  const push = (c) => {
    const k = normTitle(c.title) + "|" + (c.year || "");
    const kNoYear = normTitle(c.title) + "|";
    if (seen[k] || (c.year == null && seen[kNoYear])) return;
    // Treat same title within a year as the same film.
    for (const y of [c.year - 1, c.year + 1]) if (c.year && seen[normTitle(c.title) + "|" + y]) return;
    seen[k] = true;
    seen[kNoYear] = true;
    out.push(c);
  };
  // Extras from the trackers: only close title matches, and not the same film under a shorter name.
  const extra = (c) => {
    if (scoreTitle(c.title, q) < 50 && scoreTitle(q, c.title) < 50) return;
    if (out.some((o) => o.year && c.year && Math.abs(o.year - c.year) <= 1 && scoreTitle(c.title, o.title) >= 70)) return;
    push(c);
  };
  if (w.ok) w.v.slice(0, 7).forEach(push);
  if (b.ok) b.v.slice(0, 5).forEach((r) => extra({ title: r.title, year: r.year, desc: "Found on Box Office Mojo", imdb: r.imdb, via: "bom" }));
  if (s.ok)
    s.v
      .filter((r) => r.kind === "movie")
      .slice(0, 4)
      .forEach((r) => extra({ title: r.label, year: r.year, desc: "Found on Sacnilk", sacnilk: r.path, via: "sacnilk" }));
  if (!out.length && !w.ok && !s.ok && !b.ok) throw new Error("Search sources unreachable");
  return out.slice(0, 10);
}

/**
 * Turn a search pick into a film descriptor with an id for every source:
 * { key, title, year, released, origin, wiki, qid, imdb, sacnilk, numbers }
 */
export async function resolveFilm(fetchText, pick) {
  const film = {
    title: pick.title,
    year: pick.year || null,
    released: null,
    origin: null,
    wiki: pick.wiki || null,
    qid: pick.qid || null,
    imdb: pick.imdb || null,
    sacnilk: pick.sacnilk || null,
    numbers: pick.numbers || null,
  };
  let links = {};
  if (film.wiki) {
    const r = await settle(wikiPage(fetchText, film.wiki));
    if (r.ok) {
      const p = r.v;
      film.wiki = p.title;
      film.qid = film.qid || p.qid || null;
      film.title = cleanWikiTitle(p.title);
      const released = parseWikiReleased(infoboxField(p.text, "released"));
      film.released = released && released.length === 10 ? released : null;
      film.year = film.year || yearFrom(released) || yearFrom(p.title);
      const country = cleanWikitext(infoboxField(p.text, "country") + " " + infoboxField(p.text, "language"));
      film.origin = /\bIndia\b|Hindi|Tamil|Telugu|Malayalam|Kannada|Marathi|Bengali|Punjabi/i.test(country) ? "IN" : "INTL";
      links = extractSourceLinks(p.text);
    }
  }
  const tasks = [];
  if (!film.imdb && links.imdb) film.imdb = links.imdb;
  if (!film.imdb && film.qid) tasks.push(settle(wikidataImdb(fetchText, film.qid)).then((r) => { if (r.ok && r.v) film.imdb = r.v; }));
  if (!film.sacnilk && links.sacnilk) film.sacnilk = links.sacnilk;
  if (!film.sacnilk) {
    const term = film.title.split(/[:–]/)[0].trim();
    tasks.push(
      settle(sacnilkSearch(fetchText, term.length >= 3 ? term : film.title)).then((r) => {
        if (r.ok) film.sacnilk = pickSacnilk(r.v, film.title, film.year);
      })
    );
  }
  await Promise.all(tasks);

  // No IMDb id (brand-new films are often missing on Wikidata): ask Box Office Mojo.
  if (!film.imdb) {
    const r = await settle(bomSearch(fetchText, film.title));
    if (r.ok) {
      const hit = r.v.find((x) => scoreTitle(x.title, film.title) >= 85 && (!film.year || !x.year || Math.abs(x.year - film.year) <= 1));
      if (hit) film.imdb = hit.imdb;
    }
  }
  if (!film.origin) film.origin = film.sacnilk && !film.imdb ? "IN" : "INTL";

  if (!film.numbers && links.numbers) film.numbers = links.numbers;
  if (!film.numbers && film.year) {
    for (const slug of numbersSlugCandidates(film.title, film.year, film.origin === "IN")) {
      const r = await settle(fetchSource(fetchText, "numbers", slug));
      if (r.ok) { film.numbers = slug; break; }
    }
  }
  if (film.numbers && /-India\)$/.test(film.numbers)) film.origin = "IN";
  film.key = filmKey(film);
  return film;
}

const ID_RULES = {
  sacnilk: /^\/(movie\/[A-Za-z0-9_\-]{2,120}|news\/[A-Za-z0-9_\-]{2,160}_Box_Office_Collection_Day_Wise_Worldwide)$/,
  bom: /^tt\d{5,10}$/,
  numbers: /^[A-Za-z0-9%'.,!&+_\-()]{3,160}$/,
  wiki: /^[^#<>\[\]{}|]{1,200}$/,
};

export function validSourceId(src, id) {
  return !!(ID_RULES[src] && ID_RULES[src].test(String(id || "")));
}

/** Fetch + parse one source for one film. */
export async function fetchSource(fetchText, src, id) {
  if (!validSourceId(src, id)) throw new Error("Invalid id for " + src);
  let res;
  if (src === "sacnilk") {
    res = parseSacnilk(await fetchText(HOSTS.sacnilk + id, browserHeaders()), id);
  } else if (src === "bom") {
    res = parseBom(await fetchText(HOSTS.bom + "/title/" + id + "/", browserHeaders()), id);
  } else if (src === "numbers") {
    const path = encodeURIComponent(id).replace(/%28/g, "(").replace(/%29/g, ")").replace(/%2C/g, ",").replace(/%27/g, "'");
    res = parseNumbers(await fetchText(HOSTS.numbers + "/movie/" + path, browserHeaders()), id);
  } else if (src === "wiki") {
    res = parseWiki(await wikiPage(fetchText, id));
  } else {
    throw new Error("Unknown source");
  }
  res.name = SOURCES[src].name;
  res.fetchedAt = new Date().toISOString();
  return res;
}

/** Which sources a film descriptor can be tracked on, in display order. */
export function filmSources(film) {
  const list = [];
  const indian = film.origin === "IN";
  const s = film.sacnilk ? { src: "sacnilk", id: film.sacnilk } : null;
  const n = film.numbers ? { src: "numbers", id: film.numbers } : null;
  const b = film.imdb ? { src: "bom", id: film.imdb } : null;
  const w = film.wiki ? { src: "wiki", id: film.wiki } : null;
  (indian ? [s, n, b, w] : [n, b, s, w]).forEach((x) => x && list.push(x));
  return list;
}

/**
 * Pick the headline worldwide figure.
 * Indian films: Sacnilk (the primary Indian trade tracker) when it has a true worldwide.
 * Others: the highest of The Numbers / Box Office Mojo, since running totals only
 * grow and the bigger one is the more recently updated.
 */
export function headline(film, results, usdInr) {
  const ok = (k) => results[k] && results[k].ok !== false && results[k].worldwide != null ? results[k] : null;
  const home = film.origin === "IN" ? "INR" : "USD";
  let pick = null;
  if (film.origin === "IN" && ok("sacnilk")) pick = ok("sacnilk");
  if (!pick) {
    const cands = ["numbers", "bom"].map(ok).filter(Boolean);
    cands.sort((a, b) => b.worldwide - a.worldwide);
    pick = cands[0] || ok("sacnilk") || ok("wiki");
  }
  if (!pick) return null;
  const value = convert(pick.worldwide, pick.currency, home, usdInr);
  const alt = home === "INR" ? "USD" : "INR";
  return {
    value: value != null ? value : pick.worldwide,
    currency: value != null ? home : pick.currency,
    alt: convert(pick.worldwide, pick.currency, alt, usdInr),
    altCurrency: alt,
    source: pick.source,
    sourceName: SOURCES[pick.source].name,
  };
}

/** Best "latest day" across sources: a live Sacnilk estimate beats everything. */
export function latestDay(film, results) {
  const fresh = (r) => r && r.ok !== false && r.latest && r.latest.value != null && !isStale(r) ? r : null;
  const s = fresh(results.sacnilk);
  const n = fresh(results.numbers);
  const order = film.origin === "IN" ? [s, n] : [n, s];
  for (const r of order) {
    if (r) return Object.assign({ currency: r.currency, source: r.source, region: r.source === "sacnilk" ? "India net" : "US & Canada" }, r.latest);
  }
  return null;
}
