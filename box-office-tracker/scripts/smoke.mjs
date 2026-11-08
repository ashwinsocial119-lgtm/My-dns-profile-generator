#!/usr/bin/env node
// Live check against the real sources — run when a site may have changed its layout.
//   node scripts/smoke.mjs "jailer 2" "clayface"
// (Behind a corporate/sandbox proxy, Node needs NODE_USE_ENV_PROXY=1 on Node >= 22.21.)
import * as core from "../public/js/core.js";

async function fetchText(url, headers) {
  const res = await fetch(url, { headers: headers || {}, redirect: "follow" });
  if (!res.ok) throw Object.assign(new Error("HTTP " + res.status + " from " + new URL(url).hostname), { status: res.status });
  return res.text();
}

const queries = process.argv.slice(2);
if (!queries.length) queries.push("oppenheimer");
let failures = 0;
for (const q of queries) {
  console.log(`\n▶ ${q}`);
  const hits = await core.searchFilms(fetchText, q);
  if (!hits.length) { console.log("  no search results"); failures++; continue; }
  console.log("  search:", hits.slice(0, 4).map((h) => `${h.title} (${h.year ?? "?"}) [${h.via}]`).join(" | "));
  const film = await core.resolveFilm(fetchText, hits[0]);
  console.log("  ids:", JSON.stringify({ origin: film.origin, wiki: film.wiki, imdb: film.imdb, sacnilk: film.sacnilk, numbers: film.numbers }));
  const results = {};
  for (const s of core.filmSources(film)) {
    try {
      const r = await core.fetchSource(fetchText, s.src, s.id);
      results[s.src] = r;
      console.log(`  ✓ ${r.name.padEnd(15)} ${r.figures.map((f) => f.label + " " + core.formatMoney(f.value, r.currency)).join(" · ")}${r.latest ? "  | latest " + r.latest.label + " " + core.formatMoney(r.latest.value, r.currency) + (r.latest.live ? " LIVE" : "") : ""}`);
    } catch (e) {
      console.log(`  ✗ ${core.SOURCES[s.src].name.padEnd(15)} ${e.message}`);
      if (!/No .*(yet|data)/.test(e.message)) failures++;
    }
  }
  const hl = core.headline(film, results, 88);
  console.log("  headline:", hl ? core.formatMoney(hl.value, hl.currency) + " via " + hl.sourceName : "—");
}
process.exitCode = failures ? 1 : 0;
