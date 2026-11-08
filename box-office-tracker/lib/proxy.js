/*
 * A deliberately narrow read-only proxy.
 *
 * Browsers can't read Sacnilk, Box Office Mojo or The Numbers directly (no CORS
 * headers), so the web app asks this endpoint to fetch a page for it. Only a
 * handful of URL shapes on those hosts are allowed — it is not an open proxy.
 * Parsing happens in the browser (public/js/core.js), so the function does
 * almost no CPU work and fits comfortably in free serverless tiers.
 *
 * Routes:
 *   GET /api/fetch?u=<absolute url>   -> page body (scripts/styles stripped)
 *   GET /api/health                   -> {"ok":true}
 */

const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const BOT_UA =
  "BoxOfficeTracker/1.0 (personal box office tracker; https://github.com/ashwinsocial119-lgtm/my-dns-profile-generator)";

const ALLOW = [
  {
    host: "www.sacnilk.com",
    path: /^\/(?:movie\/[A-Za-z0-9_\-]{2,120}|news\/[A-Za-z0-9_\-]{2,160}_Box_Office_Collection_Day_Wise_Worldwide|pages\/search\.php\?term=[^&#]{1,200})$/,
    ttl: 120,
  },
  { host: "www.boxofficemojo.com", path: /^\/(?:title\/tt\d{5,10}\/|search\/\?q=[^&#]{1,200})$/, ttl: 300 },
  { host: "www.the-numbers.com", path: /^\/movie\/[A-Za-z0-9%'.,!&+_\-()]{3,200}$/, ttl: 300 },
  // Wikipedia/Wikidata are called straight from the browser; these are a fallback only.
  { host: "en.wikipedia.org", path: /^\/w\/api\.php\?[^#]{1,1500}$/, ttl: 300, bot: true },
  { host: "www.wikidata.org", path: /^\/w\/api\.php\?[^#]{1,600}$/, ttl: 3600, bot: true },
];

function json(status, obj, extra) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, extra || {}),
  });
}

/** Drop the bulk the parsers never look at (scripts, styles, inline SVG, comments). */
export function slimHtml(html) {
  return html
    .replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

function allowed(target) {
  let u;
  try {
    u = new URL(target);
  } catch (e) {
    return null;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  const pathAndQuery = u.pathname + u.search;
  for (const rule of ALLOW) {
    if (u.hostname === rule.host && rule.path.test(pathAndQuery)) return { url: u.toString(), rule: rule };
  }
  return null;
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "GET") return json(405, { error: "GET only" });

  if (path === "/api/health") return json(200, { ok: true, service: "box-office-tracker", time: new Date().toISOString() });

  if (path !== "/api/fetch") return json(404, { error: "Not found" });

  const target = url.searchParams.get("u") || "";
  const ok = allowed(target);
  if (!ok) return json(400, { error: "URL not allowed" });

  const fresh = url.searchParams.get("fresh") === "1";
  let upstream;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    upstream = await fetch(ok.url, {
      headers: ok.rule.bot
        ? { "User-Agent": BOT_UA, "Api-User-Agent": BOT_UA, Accept: "application/json" }
        : { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch (e) {
    return json(502, { error: "Upstream unreachable", detail: String((e && e.message) || e) });
  }
  if (!upstream.ok) return json(upstream.status === 404 ? 404 : 502, { error: "Upstream HTTP " + upstream.status, status: upstream.status });

  const type = upstream.headers.get("content-type") || "text/plain";
  let body = await upstream.text();
  if (/html/i.test(type)) body = slimHtml(body);

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": /json/i.test(type) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
      // Short shared cache: many quick reloads hit the edge, an hourly refresh is always fresh.
      "cache-control": fresh ? "no-store" : "public, max-age=0, s-maxage=" + ok.rule.ttl + ", stale-while-revalidate=60",
      "x-upstream": ok.rule.host,
    },
  });
}
