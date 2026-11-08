import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../public/js/core.js";
import { handleRequest, slimHtml } from "../lib/proxy.js";

test("parses Indian and US money strings", () => {
  assert.equal(core.parseINR("₹390.50 Cr"), 3905000000);
  assert.equal(core.parseINR("₹42 L"), 4200000);
  assert.equal(core.parseINR("₹1,742.10 Cr"), 17421000000);
  assert.equal(core.parseUSD("$6,000,000"), 6000000);
  assert.equal(core.parseUSD("$983.1 million"), 983100000);
  assert.equal(core.parseUSD("US$1.2 billion"), 1200000000);
  assert.equal(core.parseUSD("$30–44 million"), 30000000);
});

test("reads Wikipedia infobox money templates", () => {
  assert.deepEqual(core.parseWikiMoney("{{INRConvert|433.86|c}}<ref>x</ref>"), { value: 4338600000, currency: "INR", text: "₹433.86 crore" });
  assert.equal(core.parseWikiMoney("{{INR|821 crore}}").value, 8210000000);
  assert.equal(core.parseWikiMoney(" $109&nbsp;million<ref name=\"NUM\">{{Cite The Numbers |id=X}}</ref>").value, 109000000);
  assert.equal(core.parseWikiMoney("{{US$|1.2 billion}}").currency, "USD");
});

test("finds tracker ids in Wikipedia citations", () => {
  const t = "{{Cite The Numbers |id=Clayface-(2026) |access-date=x}} {{Cite Box Office Mojo |id=34890576 |a}} https://www.sacnilk.com/movie/Jailer_2_2026 x";
  assert.deepEqual(core.extractSourceLinks(t), { numbers: "Clayface-(2026)", imdb: "tt34890576", sacnilk: "/movie/Jailer_2_2026" });
});

test("formats money the way trade sites do", () => {
  assert.equal(core.formatMoney(3905000000, "INR"), "₹390.50 Cr");
  assert.equal(core.formatMoney(17421000000, "INR"), "₹1,742 Cr");
  assert.equal(core.formatMoney(4200000, "INR"), "₹42 L");
  assert.equal(core.formatMoney(975811333, "USD"), "$975.8M");
  assert.equal(core.formatMoney(1234567890, "USD"), "$1.23B");
  assert.equal(core.formatMoney(null, "USD"), "—");
});

test("builds The Numbers slugs", () => {
  assert.deepEqual(core.numbersSlugCandidates("The Cat in the Hat", 2026, false), ["Cat-in-the-Hat-The-(2026)", "Cat-in-the-Hat-The-(2026-India)"]);
  assert.equal(core.numbersSlugCandidates("Jailer 2", 2026, true)[0], "Jailer-2-(2026-India)");
});

test("parses loose dates", () => {
  assert.equal(core.parseLooseDate("Figures till 8 Nov 2026"), "2026-11-08");
  assert.equal(core.parseLooseDate("November 8, 2026"), "2026-11-08");
  assert.equal(core.parseLooseDate("Nov 5, 2026"), "2026-11-05");
});

test("matches Sacnilk results to the right film", () => {
  const results = [
    { kind: "daywise", path: "/news/Thalaivar_169_2023_Box_Office_Collection_Day_Wise_Worldwide", label: "Jailer", year: 2023 },
    { kind: "movie", path: "/movie/Jailer_2_2026", label: "Jailer 2", year: 2026 },
  ];
  assert.equal(core.pickSacnilk(results, "Jailer 2", 2026), "/movie/Jailer_2_2026");
  assert.equal(core.pickSacnilk(results, "Jailer", 2023), "/news/Thalaivar_169_2023_Box_Office_Collection_Day_Wise_Worldwide");
  assert.equal(core.pickSacnilk(results, "Oppenheimer", 2023), null);
});

test("headline prefers Sacnilk for Indian films and the larger total otherwise", () => {
  const sac = { source: "sacnilk", currency: "INR", worldwide: 4992000000 };
  const tn = { source: "numbers", currency: "USD", worldwide: 55656000 };
  const bom = { source: "bom", currency: "USD", worldwide: 9100000 };
  const inFilm = core.headline({ origin: "IN" }, { sacnilk: sac, numbers: tn }, 88);
  assert.equal(inFilm.source, "sacnilk");
  assert.equal(inFilm.currency, "INR");
  const intl = core.headline({ origin: "INTL" }, { numbers: tn, bom: bom }, 88);
  assert.equal(intl.source, "numbers");
  assert.equal(Math.round(intl.alt), Math.round(55656000 * 88));
});

test("source ids are validated before any request", () => {
  assert.ok(core.validSourceId("bom", "tt15398776"));
  assert.ok(!core.validSourceId("bom", "../admin"));
  assert.ok(core.validSourceId("sacnilk", "/movie/Jailer_2_2026"));
  assert.ok(!core.validSourceId("sacnilk", "/admin/login"));
});

test("proxy only allows known source URLs", async () => {
  const call = (u) => handleRequest(new Request("http://x/api/fetch?u=" + encodeURIComponent(u)));
  assert.equal((await call("https://evil.example.com/")).status, 400);
  assert.equal((await call("https://www.sacnilk.com/admin")).status, 400);
  assert.equal((await call("http://www.sacnilk.com/movie/Jailer_2_2026")).status, 400);
  assert.equal((await call("https://www.boxofficemojo.com:8443/title/tt1/")).status, 400);
  assert.equal((await handleRequest(new Request("http://x/api/health"))).status, 200);
  assert.equal((await handleRequest(new Request("http://x/api/nope"))).status, 404);
});

test("slimHtml drops scripts but keeps data", () => {
  const out = slimHtml('<meta property="og:title" content="X"><script>var a=1</script><style>.a{}</style><div class="ds-hero-fig">₹1 Cr</div>');
  assert.ok(!/script|style/.test(out));
  assert.ok(out.includes("ds-hero-fig") && out.includes("og:title"));
});
