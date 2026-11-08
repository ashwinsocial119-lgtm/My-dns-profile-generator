/* __CORE__ */

/*
 * Box Office Tracker — Scriptable widget for iPhone
 * -------------------------------------------------
 * • Run it in the Scriptable app to add/remove films (max 3), refresh, or
 *   import the films you track on the web app.
 * • Add a Scriptable widget (small / medium / large, or lock-screen
 *   rectangular) and pick this script. It refreshes about every hour —
 *   iOS decides the exact moment — and you can tap it to open the full view.
 * • Small widget: set the widget's Parameter to 2 or 3 to show that film.
 *
 * Everything runs on your phone, straight against Sacnilk, The Numbers,
 * Box Office Mojo and Wikipedia. No server or account needed.
 */

const CONFIG = {
  // Optional: your deployed web app URL. If set, tapping the widget opens it.
  webAppUrl: "",
  refreshMinutes: 60,
  // Re-use data younger than this instead of fetching again (widget redraws).
  reuseMinutes: 10,
};

const STORE_FILE = "box-office-tracker.json";
const COLORS = {
  bg1: new Color("#0a0a0f"),
  bg2: new Color("#181824"),
  text: new Color("#f4f4f7"),
  text2: new Color("#a9a9b8"),
  text3: new Color("#6f6f80"),
  accent: new Color("#f5c451"),
  up: new Color("#3ddc84"),
  down: new Color("#ff6b6b"),
  live: new Color("#ff453a"),
};

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

function fileManager() {
  try {
    const fm = FileManager.iCloud();
    fm.documentsDirectory();
    return fm;
  } catch (e) {
    return FileManager.local();
  }
}

async function loadState() {
  const fm = fileManager();
  const path = fm.joinPath(fm.documentsDirectory(), STORE_FILE);
  if (!fm.fileExists(path)) return { films: [], results: {}, fetchedAt: 0, fx: { rate: 88, at: 0 } };
  try {
    if (fm.isFileStoredIniCloud && fm.isFileStoredIniCloud(path) && !fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
    const s = JSON.parse(fm.readString(path));
    s.films = s.films || [];
    s.results = s.results || {};
    s.fx = s.fx || { rate: 88, at: 0 };
    return s;
  } catch (e) {
    return { films: [], results: {}, fetchedAt: 0, fx: { rate: 88, at: 0 } };
  }
}

function saveState(state) {
  const fm = fileManager();
  fm.writeString(fm.joinPath(fm.documentsDirectory(), STORE_FILE), JSON.stringify(state));
}

/* ------------------------------------------------------------------ */
/* Networking                                                          */
/* ------------------------------------------------------------------ */

async function fetchText(url, headers) {
  const req = new Request(url);
  req.headers = headers || {};
  req.timeoutInterval = 20;
  const body = await req.loadString();
  const code = req.response && req.response.statusCode;
  if (code && (code < 200 || code >= 300)) {
    const err = new Error("HTTP " + code);
    err.status = code;
    throw err;
  }
  return body;
}

async function refreshFx(state) {
  if (state.fx && state.fx.at && Date.now() - state.fx.at < 12 * 3600e3) return;
  try {
    const j = JSON.parse(await fetchText("https://open.er-api.com/v6/latest/USD"));
    const rate = j && j.rates && j.rates.INR;
    if (rate > 30 && rate < 300) state.fx = { rate: rate, at: Date.now() };
  } catch (e) { /* keep last rate */ }
}

async function refreshAll(state, force) {
  if (!force && state.fetchedAt && Date.now() - state.fetchedAt < CONFIG.reuseMinutes * 60e3) return;
  const jobs = [refreshFx(state)];
  for (const film of state.films) {
    state.results[film.key] = state.results[film.key] || {};
    for (const s of core.filmSources(film)) {
      jobs.push(
        core.fetchSource(fetchText, s.src, s.id).then(
          (r) => {
            // Keep the widget payload small: the daily series is only needed for the large size.
            r.daily = (r.daily || []).slice(-10);
            state.results[film.key][s.src] = r;
            if (!film.poster && r.poster) film.poster = r.poster;
          },
          (e) => {
            const prev = state.results[film.key][s.src];
            if (!prev || prev.ok === false) state.results[film.key][s.src] = { ok: false, error: String(e.message || e) };
          }
        )
      );
    }
  }
  await Promise.all(jobs);
  state.fetchedAt = Date.now();
  saveState(state);
}

/* ------------------------------------------------------------------ */
/* Summary helpers                                                     */
/* ------------------------------------------------------------------ */

function okResults(state, key) {
  const r = state.results[key] || {};
  const out = {};
  for (const k in r) if (r[k] && r[k].ok !== false) out[k] = r[k];
  return out;
}

function summarize(state, film) {
  const ok = okResults(state, film.key);
  const hl = core.headline(film, ok, state.fx.rate);
  const latest = core.latestDay(film, ok);
  return { ok: ok, hl: hl, latest: latest };
}

const fmt = (v, c) => core.formatMoney(v, c);

/* ------------------------------------------------------------------ */
/* Widget                                                              */
/* ------------------------------------------------------------------ */

function addText(stack, text, size, color, weight) {
  const t = stack.addText(String(text));
  t.font = weight === "heavy" ? Font.heavyRoundedSystemFont(size) : weight === "bold" ? Font.boldRoundedSystemFont(size) : weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || COLORS.text;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.55;
  return t;
}

function latestLine(stack, latest, size) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  if (latest.live) {
    addText(row, "● ", size, COLORS.live, "bold");
  }
  addText(row, latest.label.replace(/ · .*/, "") + " ", size, COLORS.text2);
  addText(row, fmt(latest.value, latest.currency), size, COLORS.text, "semibold");
  if (latest.change) {
    const down = latest.change[0] === "-";
    addText(row, " " + (down ? "▼" : "▲") + latest.change.replace(/^[+-]/, ""), size - 1, down ? COLORS.down : COLORS.up, "semibold");
  }
  return row;
}

async function loadPoster(url) {
  if (!url) return null;
  try {
    const r = new Request(url);
    r.timeoutInterval = 10;
    return await r.loadImage();
  } catch (e) {
    return null;
  }
}

function footer(w, state) {
  w.addSpacer();
  const f = w.addStack();
  f.layoutHorizontally();
  f.centerAlignContent();
  addText(f, "BOX OFFICE", 9, COLORS.accent, "bold");
  f.addSpacer();
  if (state.fetchedAt) {
    const d = f.addDate(new Date(state.fetchedAt));
    d.applyRelativeStyle();
    d.font = Font.systemFont(9);
    d.textColor = COLORS.text3;
    d.lineLimit = 1;
  }
}

async function buildWidget(state, family) {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [COLORS.bg1, COLORS.bg2];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.refreshAfterDate = new Date(Date.now() + CONFIG.refreshMinutes * 60e3);
  if (CONFIG.webAppUrl) w.url = CONFIG.webAppUrl;

  const films = state.films;
  if (!films.length) {
    w.setPadding(14, 14, 14, 14);
    addText(w, "🎬 Box Office", 14, COLORS.accent, "bold");
    w.addSpacer(6);
    const t = w.addText("Run this script in Scriptable to pick up to 3 films.");
    t.font = Font.systemFont(12);
    t.textColor = COLORS.text2;
    return w;
  }

  if (family === "accessoryRectangular" || family === "accessoryInline" || family === "accessoryCircular") {
    const film = films[0];
    const s = summarize(state, film);
    addText(w, film.title, 12, Color.white(), "semibold");
    addText(w, s.hl ? fmt(s.hl.value, s.hl.currency) + " WW" : "—", 16, Color.white(), "bold");
    if (s.latest) addText(w, (s.latest.live ? "● " : "") + s.latest.label.replace(/ · .*/, "") + " " + fmt(s.latest.value, s.latest.currency), 11, Color.white());
    return w;
  }

  if (family === "small") {
    const n = Math.max(1, Math.min(films.length, parseInt(args.widgetParameter, 10) || 1));
    const film = films[n - 1];
    const s = summarize(state, film);
    w.setPadding(14, 14, 12, 14);
    addText(w, film.title, 13, COLORS.text2, "semibold");
    w.addSpacer(4);
    addText(w, s.hl ? fmt(s.hl.value, s.hl.currency) : "—", 26, COLORS.text, "heavy");
    addText(w, s.hl ? "worldwide · " + s.hl.sourceName : "no figures yet", 10, COLORS.text3);
    if (s.hl && s.hl.alt != null) addText(w, "≈ " + fmt(s.hl.alt, s.hl.altCurrency), 11, COLORS.text2);
    w.addSpacer(6);
    if (s.latest) latestLine(w, s.latest, 11);
    footer(w, state);
    return w;
  }

  if (family === "large") {
    w.setPadding(14, 14, 12, 14);
    for (let i = 0; i < films.length; i++) {
      const film = films[i];
      const s = summarize(state, film);
      const row = w.addStack();
      row.layoutHorizontally();
      row.topAlignContent();
      const img = await loadPoster(film.poster);
      if (img) {
        const im = row.addImage(img);
        im.imageSize = new Size(40, 60);
        im.cornerRadius = 6;
        row.addSpacer(10);
      }
      const col = row.addStack();
      col.layoutVertically();
      addText(col, film.title, 13, COLORS.text2, "semibold");
      const top = col.addStack();
      top.layoutHorizontally();
      top.bottomAlignContent();
      addText(top, s.hl ? fmt(s.hl.value, s.hl.currency) : "—", 22, COLORS.text, "heavy");
      if (s.hl && s.hl.alt != null) addText(top, "  ≈ " + fmt(s.hl.alt, s.hl.altCurrency), 11, COLORS.text3);
      if (s.latest) latestLine(col, s.latest, 11);
      const parts = core.filmSources(film)
        .filter((x) => x.src !== "wiki")
        .map((x) => {
          const r = s.ok[x.src];
          const v = r ? (r.worldwide != null ? r.worldwide : r.figures[0] && r.figures[0].value) : null;
          return core.SOURCES[x.src].short + " " + (v != null ? fmt(v, r.currency) : "—");
        });
      if (parts.length) addText(col, parts.join("  ·  "), 9, COLORS.text3);
      if (i < films.length - 1) w.addSpacer(10);
    }
    footer(w, state);
    return w;
  }

  // medium (default)
  w.setPadding(12, 14, 10, 14);
  films.forEach((film, i) => {
    const s = summarize(state, film);
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    const left = row.addStack();
    left.layoutVertically();
    addText(left, film.title, 12.5, COLORS.text, "semibold");
    if (s.latest) latestLine(left, s.latest, 10);
    else addText(left, s.hl ? "via " + s.hl.sourceName : "no figures yet", 10, COLORS.text3);
    row.addSpacer();
    const right = row.addStack();
    right.layoutVertically();
    const v = addText(right, s.hl ? fmt(s.hl.value, s.hl.currency) : "—", films.length > 2 ? 17 : 20, COLORS.text, "heavy");
    v.rightAlignText();
    if (i < films.length - 1) w.addSpacer(films.length > 2 ? 6 : 10);
  });
  footer(w, state);
  return w;
}

/* ------------------------------------------------------------------ */
/* In-app UI                                                           */
/* ------------------------------------------------------------------ */

async function alertInput(title, message, placeholder) {
  const a = new Alert();
  a.title = title;
  a.message = message || "";
  a.addTextField(placeholder || "", "");
  a.addAction("Search");
  a.addCancelAction("Cancel");
  const i = await a.presentAlert();
  return i === -1 ? null : a.textFieldValue(0).trim();
}

async function pick(title, options, message) {
  const a = new Alert();
  a.title = title;
  if (message) a.message = message;
  options.forEach((o) => a.addAction(o));
  a.addCancelAction("Cancel");
  return a.presentSheet();
}

async function addFilmFlow(state) {
  if (state.films.length >= core.MAX_FILMS) {
    await pick("You're tracking 3 films", ["OK"], "Remove one to add another.");
    return;
  }
  const q = await alertInput("Add a film", "Type any recent Indian or international film.", "e.g. film title");
  if (!q) return;
  let items = [];
  try {
    items = await core.searchFilms(fetchText, q);
  } catch (e) {
    await pick("Search failed", ["OK"], String(e.message || e));
    return;
  }
  if (!items.length) {
    await pick("No films found", ["OK"], "Try the exact title or add the year.");
    return;
  }
  const idx = await pick("Pick the film", items.map((it) => it.title + (it.year ? " (" + it.year + ")" : "") + (it.desc ? " — " + it.desc : "")));
  if (idx < 0) return;
  const film = await core.resolveFilm(fetchText, items[idx]);
  if (state.films.some((f) => f.key === film.key)) return;
  state.films.push(film);
  saveState(state);
  await refreshAll(state, true);
}

async function importFlow(state) {
  let data;
  try {
    data = JSON.parse(Pasteboard.paste() || "");
  } catch (e) {
    await pick("Nothing to import", ["OK"], "In the web app open Settings → Copy films for widget, then try again.");
    return;
  }
  if (!data || data.app !== "box-office-tracker" || !Array.isArray(data.films)) {
    await pick("Nothing to import", ["OK"], "The clipboard doesn't contain films from the web app.");
    return;
  }
  state.films = data.films.slice(0, core.MAX_FILMS).map((f) => Object.assign({}, f, { key: f.key || core.filmKey(f) }));
  state.results = {};
  saveState(state);
  await refreshAll(state, true);
}

async function filmActions(state, film) {
  const links = core.filmSources(film).map((s) => {
    const r = (state.results[film.key] || {})[s.src];
    return { label: "Open " + core.SOURCES[s.src].name, url: r && r.url };
  }).filter((l) => l.url);
  const opts = links.map((l) => l.label).concat(["Remove " + film.title]);
  const i = await pick(film.title, opts);
  if (i < 0) return false;
  if (i < links.length) {
    Safari.open(links[i].url);
    return false;
  }
  state.films = state.films.filter((f) => f.key !== film.key);
  delete state.results[film.key];
  saveState(state);
  return true;
}

function renderTable(table, state) {
  table.removeAllRows();
  table.showSeparators = true;

  const head = new UITableRow();
  head.isHeader = true;
  head.height = 60;
  const ht = head.addText("Box Office", state.fetchedAt ? "Updated " + core.timeAgo(state.fetchedAt) + " · auto every hour" : "Not refreshed yet");
  ht.titleFont = Font.boldRoundedSystemFont(24);
  ht.subtitleColor = Color.gray();
  table.addRow(head);

  const actions = new UITableRow();
  actions.height = 50;
  const add = actions.addButton(state.films.length >= core.MAX_FILMS ? "3/3 tracked" : "＋ Add film");
  add.onTap = async () => { await addFilmFlow(state); renderTable(table, state); };
  const ref = actions.addButton("↻ Refresh");
  ref.onTap = async () => { await refreshAll(state, true); renderTable(table, state); };
  const imp = actions.addButton("Import");
  imp.onTap = async () => { await importFlow(state); renderTable(table, state); };
  table.addRow(actions);

  if (!state.films.length) {
    const r = new UITableRow();
    r.height = 80;
    r.addText("No films yet", "Tap ＋ Add film, or Import the films from the web app.").subtitleColor = Color.gray();
    table.addRow(r);
  }

  for (const film of state.films) {
    const s = summarize(state, film);
    const r = new UITableRow();
    r.height = 74;
    r.dismissOnSelect = false;
    const latest = s.latest ? (s.latest.live ? "● LIVE " : "") + s.latest.label.replace(/ · .*/, "") + " " + fmt(s.latest.value, s.latest.currency) + (s.latest.change ? " (" + s.latest.change + ")" : "") : "";
    const t = r.addText(film.title + (film.year ? " (" + film.year + ")" : ""), latest || (s.hl ? "via " + s.hl.sourceName : "No figures yet"));
    t.widthWeight = 62;
    t.titleFont = Font.semiboldSystemFont(16);
    t.subtitleColor = s.latest && s.latest.live ? Color.red() : Color.gray();
    const v = r.addText(s.hl ? fmt(s.hl.value, s.hl.currency) : "—", s.hl ? (s.hl.alt != null ? "≈ " + fmt(s.hl.alt, s.hl.altCurrency) + " · " : "") + core.SOURCES[s.hl.source].short : "");
    v.widthWeight = 38;
    v.rightAligned();
    v.titleFont = Font.boldRoundedSystemFont(18);
    v.subtitleColor = Color.gray();
    r.onSelect = async () => { if (await filmActions(state, film)) renderTable(table, state); };
    table.addRow(r);

    for (const src of core.filmSources(film)) {
      const res = (state.results[film.key] || {})[src.src];
      const sr = new UITableRow();
      sr.height = 40;
      sr.dismissOnSelect = false;
      let val = "—", sub = "";
      if (res && res.ok !== false) {
        const main = res.worldwide != null ? { label: "WW", value: res.worldwide } : res.figures[0];
        val = main ? fmt(main.value, res.currency) : "—";
        sub = (main && main.label !== "WW" ? main.label + " · " : "") + (res.updated || "");
      } else if (res) {
        sub = res.error || "unavailable";
      }
      const a = sr.addText("   " + core.SOURCES[src.src].name, sub);
      a.widthWeight = 62;
      a.titleFont = Font.systemFont(13);
      a.subtitleFont = Font.systemFont(11);
      a.subtitleColor = Color.gray();
      const b = sr.addText(val);
      b.widthWeight = 38;
      b.rightAligned();
      b.titleFont = Font.mediumSystemFont(13);
      sr.onSelect = () => { if (res && res.url) Safari.open(res.url); };
      table.addRow(sr);
    }
  }

  const prev = new UITableRow();
  prev.height = 50;
  const ps = prev.addButton("Preview small");
  ps.onTap = async () => (await buildWidget(state, "small")).presentSmall();
  const pm = prev.addButton("medium");
  pm.onTap = async () => (await buildWidget(state, "medium")).presentMedium();
  const pl = prev.addButton("large");
  pl.onTap = async () => (await buildWidget(state, "large")).presentLarge();
  table.addRow(prev);

  table.reload();
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const state = await loadState();

if (config.runsInWidget) {
  try {
    await refreshAll(state, false);
  } catch (e) { /* show cached figures */ }
  Script.setWidget(await buildWidget(state, config.widgetFamily));
} else {
  const table = new UITable();
  renderTable(table, state);
  // Show cached data instantly, then fetch fresh numbers while the table is open.
  const shown = table.present(false);
  try {
    await refreshAll(state, true);
    renderTable(table, state);
  } catch (e) { /* keep cached */ }
  await shown;
}
Script.complete();
