"use strict";

const C = BalanzaCore;
const { icon, esc, haptic, int, dec1, dec2, signed1, signed2 } = UI;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const VERSION = "1.3";
const FIREBASE_DB = "https://paso-682df-default-rtdb.firebaseio.com";
const TAGS = ["Ayunas", "Post-entreno", "Tarde", "Noche"];

// ==================== ESTADO Y PERSISTENCIA ====================
const store = {
  get(k, d) { try { const v = localStorage.getItem("balanza." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("balanza." + k, JSON.stringify(v)); } catch (e) {} }
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const genRoom = () => "balanza-" + Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(16).padStart(2, "0")).join("");

const S = {
  profile: store.get("profile", null),
  entries: store.get("entries", []),
  deleted: store.get("deleted", {}),
  sync: store.get("sync", { room: null, lastAt: 0, lastErr: null }),
  gist: store.get("gist", { token: "", id: "", lastAt: 0 }),
  settings: Object.assign({ autoSaveBle: true, lastDevice: "" }, store.get("settings", {})),
  remoteDiag: store.get("remoteDiag", null)
};

const save = {
  profile: () => store.set("profile", S.profile),
  entries: () => store.set("entries", S.entries),
  deleted: () => store.set("deleted", S.deleted),
  sync: () => store.set("sync", S.sync),
  gist: () => store.set("gist", S.gist),
  settings: () => store.set("settings", S.settings),
  remoteDiag: () => store.set("remoteDiag", S.remoteDiag)
};

const view = { tab: "home", range: 30, metric: "weight", selIdx: -1, homeSelIdx: -1 };
const ble = new ScaleBLE();
let liveOpen = false;
let liveState = { kg: null, locked: false, bioState: null, imp: null, fat: null, water: null, muscle: null, bone: null, bmr: null, visceral: null, proto: null, saved: false, savedId: null, autoTimer: null, rawSeen: 0 };

// ==================== HELPERS ====================
const fmtDayShort = ts => new Date(ts).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
const fmtDayFull = ts => new Date(ts).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
const fmtHour = ts => new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtAgo = ts => {
  if (!ts) return "Nunca";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "Ahora";
  if (m < 60) return `Hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `Hace ${h} h`;
  return `Hace ${Math.round(h / 24)} d`;
};
const syncUrl = room => `${FIREBASE_DB}/rooms/${room}.json`;
const shareLink = room => `${location.origin}${location.pathname}?sync=${encodeURIComponent(room)}`;

function enrichEntry(e) {
  if (!e || !S.profile) return e;
  // Si hay impedancia válida y faltan métricas BIA, las calculamos con Sun/Janssen
  if (e.imp && e.imp >= 200 && e.imp <= 1200) {
    const m = C.biaMetrics({ kg: e.kg, cm: S.profile.height, age: S.profile.age, sex: S.profile.sex, imp: e.imp });
    if (m) {
      return {
        ...e,
        fat: e.fat ?? m.fatPct,
        water: e.water ?? m.waterPct,
        muscle: e.muscle ?? m.musclePct,
        bone: e.bone ?? m.boneKg,
        bmr: e.bmr ?? m.bmr,
        ffm: m.ffmKg,
        biaCalc: e.fat == null ? "sun" : "scale"
      };
    }
  }
  return e;
}

function addEntry(data) {
  const now = Date.now();
  const base = {
    id: uid(),
    t: data.t || now,
    upd: now,
    kg: C.round2(data.kg),
    source: data.source || "manual",
    proto: data.proto || null,
    imp: data.imp || null,
    fat: data.fat || null,
    water: data.water || null,
    muscle: data.muscle || null,
    bone: data.bone || null,
    bmr: data.bmr || null,
    visceral: data.visceral || null,
    tag: data.tag || ""
  };
  const entry = enrichEntry(base);
  S.entries.push(entry);
  S.entries.sort((a, b) => b.t - a.t);
  save.entries();
  syncPush().catch(() => {});
  return entry;
}

function updateEntry(id, patch) {
  const idx = S.entries.findIndex(e => e.id === id);
  if (idx < 0) return;
  S.entries[idx] = enrichEntry({ ...S.entries[idx], ...patch, upd: Date.now() });
  S.entries.sort((a, b) => b.t - a.t);
  save.entries();
  syncPush().catch(() => {});
}

function deleteEntry(id) {
  S.entries = S.entries.filter(e => e.id !== id);
  S.deleted[id] = Date.now();
  save.entries();
  save.deleted();
  syncPush().catch(() => {});
}

// ==================== SYNC FIREBASE (MISMA INSTANCIA QUE PASO) ====================
let syncBusy = false;

function ensureSyncRoom() {
  if (!S.sync.room || S.sync.room.length < 16) {
    S.sync.room = genRoom();
    save.sync();
  }
  return S.sync.room;
}

async function syncPullAndMerge({ silent = true, includeDiag = false } = {}) {
  if (!S.sync.room || S.sync.room.length < 16 || syncBusy) return false;
  syncBusy = true;
  try {
    const res = await fetch(syncUrl(S.sync.room), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remote = await res.json();
    if (remote && typeof remote === "object") {
      if (remote.profile) {
        if (!S.profile || (remote.profile.upd || 0) > (S.profile.upd || 0)) {
          S.profile = remote.profile;
          save.profile();
        }
      }
      const merged = C.mergeEntries(S.entries, remote.entries || [], S.deleted, remote.deleted || {});
      S.entries = merged.entries;
      S.deleted = merged.deleted;
      save.entries();
      save.deleted();
      if (remote.bleDiag) {
        S.remoteDiag = remote.bleDiag;
        save.remoteDiag();
      }
    }
    await pushPayloadOnly(includeDiag);
    S.sync.lastAt = Date.now();
    S.sync.lastErr = null;
    save.sync();
    if (!silent) UI.toast("Sincronizado");
    return true;
  } catch (e) {
    S.sync.lastErr = e.message;
    save.sync();
    if (!silent) UI.toast("Error de sync: " + e.message);
    return false;
  } finally {
    syncBusy = false;
  }
}

async function pushPayloadOnly(includeDiag = false) {
  if (!S.sync.room || S.sync.room.length < 16) return;
  const payload = {
    v: 1,
    upd: Date.now(),
    profile: S.profile,
    entries: S.entries,
    deleted: S.deleted,
    bleDiag: includeDiag && ble.logs.length ? ble.diagnosticText() : S.remoteDiag
  };
  const res = await fetch(syncUrl(S.sync.room), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function syncPush(includeDiag = false) {
  if (!S.sync.room || S.sync.room.length < 16) return;
  try {
    await pushPayloadOnly(includeDiag);
    S.sync.lastAt = Date.now();
    S.sync.lastErr = null;
    save.sync();
  } catch (e) {
    S.sync.lastErr = e.message;
    save.sync();
  }
}

// ==================== BACKUP OPCIONAL EN GITHUB GIST PRIVADO ====================
async function gistPush() {
  if (!S.gist.token) throw new Error("Falta el token de GitHub");
  const content = JSON.stringify({
    v: 1, exportedAt: new Date().toISOString(),
    profile: S.profile, entries: S.entries, deleted: S.deleted
  }, null, 2);
  const body = {
    description: "Balanza — backup privado de pesajes",
    public: false,
    files: { "balanza-backup.json": { content } }
  };
  const isUpdate = !!S.gist.id;
  const url = isUpdate ? `https://api.github.com/gists/${S.gist.id}` : "https://api.github.com/gists";
  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers: {
      "Authorization": `Bearer ${S.gist.token.trim()}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const data = await res.json();
  S.gist.id = data.id;
  S.gist.lastAt = Date.now();
  save.gist();
  return data;
}

async function gistPull() {
  if (!S.gist.token || !S.gist.id) throw new Error("Configurá token y Gist ID primero");
  const res = await fetch(`https://api.github.com/gists/${S.gist.id.trim()}`, {
    headers: { "Authorization": `Bearer ${S.gist.token.trim()}`, "Accept": "application/vnd.github+json" }
  });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const data = await res.json();
  const f = data.files && (data.files["balanza-backup.json"] || Object.values(data.files)[0]);
  if (!f || !f.content) throw new Error("El Gist está vacío");
  const parsed = JSON.parse(f.content);
  const merged = C.mergeEntries(S.entries, parsed.entries || [], S.deleted, parsed.deleted || {});
  S.entries = merged.entries;
  S.deleted = merged.deleted;
  if (parsed.profile && !S.profile) S.profile = parsed.profile;
  save.entries(); save.deleted(); save.profile();
  S.gist.lastAt = Date.now();
  save.gist();
  syncPush().catch(() => {});
  return S.entries.length;
}

// ==================== NAVEGACIÓN Y RENDER ====================
function render() {
  const has = !!S.profile;
  document.body.classList.toggle("onboarding", !has);
  const id = has ? view.tab : "welcome";
  $$(".screen").forEach(s => s.classList.toggle("on", s.id === "s-" + id));
  $("#cta").hidden = !has || view.tab !== "home";
  renderTabs();
  if (!has) return renderWelcome();
  ble.setProfile(S.profile);
  ({ home: renderHome, evolution: renderEvolution, history: renderHistory, profile: renderProfile })[view.tab]();
}

function renderTabs() {
  const items = [
    { id: "home", label: "Inicio", ic: "home" },
    { id: "evolution", label: "Evolución", ic: "trend" },
    { id: "history", label: "Historial", ic: "list" },
    { id: "profile", label: "Perfil", ic: "user" }
  ];
  $("#tabs").innerHTML = items.map(it =>
    `<button data-tab="${it.id}" class="${view.tab === it.id ? "on" : ""}">${icon(it.ic, 21)}<span>${it.label}</span></button>`
  ).join("");
  $("#cta").innerHTML = `
    <button class="cta-go" data-act="weigh-ble">
      <span class="play">${icon("bt", 19)}</span>
      <span class="cta-t">Pesarme<small>${S.settings.lastDevice ? esc(S.settings.lastDevice) : "Femmto B02 · BLE"}</small></span>
    </button>
    <button class="cta-alt" data-act="weigh-manual" aria-label="Cargar peso a mano">${icon("plus", 24)}</button>
  `;
}

// ==================== PANTALLA BIENVENIDA ====================
function renderWelcome() {
  $("#s-welcome").innerHTML = `
    <div class="welcome">
      <div>
        <div class="logo">${icon("scale", 38)}</div>
        <h1>Tu peso, <span class="grad">sin ruido.</span></h1>
        <p>Conectá tu Femmto B02 por Bluetooth, filtrá las fluctuaciones diarias con promedios reales y seguí tu evolución desde el celu y la PC.</p>
      </div>
      <button class="btn btn-primary" data-act="setup-new">Empezar</button>
      <button class="btn btn-soft" data-act="setup-sync">${icon("cloud", 19)}Ya tengo un link o código de sync</button>
    </div>`;
}

// ==================== PANTALLA INICIO ====================
function renderHome() {
  const p = S.profile;
  const sum = C.summary(S.entries);
  const nowStr = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  const days30 = filterRange(sum.days, 30);
  const sel = view.homeSelIdx >= 0 && view.homeSelIdx < days30.length ? view.homeSelIdx : days30.length - 1;
  const foc = days30[sel] || null;

  const deltaPill = sum.delta7 != null
    ? `<span class="pill ${sum.delta7 <= -0.05 ? "good" : sum.delta7 >= 0.05 ? "warn" : "soft"}">${icon(sum.delta7 <= 0 ? "down" : "up", 13)}${signed1(sum.delta7)} kg vs 7d ant.</span>`
    : sum.streak > 1 ? `<span class="pill acc">${sum.streak} días seguidos</span>` : "";

  const latest = S.entries[0] || null;
  const latestBia = S.entries.find(e => e.imp || e.fat != null) || null;
  const bmiVal = latest ? C.bmi(sum.currentTrend || latest.kg, p.height) : 0;

  const heroHtml = `
    <div class="card hero-card">
      <div class="hero-top">
        <div>
          <div class="hero-lbl">${icon("wave", 14)}Tendencia real</div>
          <div class="hero-val num">${sum.currentTrend != null ? `${dec1(sum.currentTrend)}<small>kg</small>` : `—<small>kg</small>`}</div>
        </div>
        ${deltaPill}
      </div>
      <div class="hero-sub">
        ${bmiVal ? `<span>IMC <b>${dec1(bmiVal)}</b> · ${C.bmiLabel(bmiVal)}</span>` : "<span>Subite a la balanza o cargá tu primer peso</span>"}
        ${p.goal && sum.currentTrend != null ? `<span>· Meta <b>${dec1(p.goal)} kg</b> (${signed1(sum.currentTrend - p.goal)})</span>` : ""}
      </div>
      <div class="kpi-row">
        <div class="kpi-mini">
          <span>Hoy</span>
          <b class="num">${sum.today ? dec1(sum.today.avg) : "—"}</b>
          <em>${sum.today ? (sum.today.count > 1 ? `${sum.today.count} pes. · ±${dec1(sum.today.spread)}` : fmtHour(sum.today.last.t)) : "Sin pesaje"}</em>
        </div>
        <div class="kpi-mini">
          <span>Prom. 7d</span>
          <b class="num">${sum.avg7 != null ? dec1(sum.avg7) : "—"}</b>
          <em>${sum.prevAvg7 != null ? `Ant. ${dec1(sum.prevAvg7)}` : "Prom. diario"}</em>
        </div>
        <div class="kpi-mini">
          <span>Ritmo</span>
          <b class="num">${sum.ratePerWeek != null ? signed1(sum.ratePerWeek) : "—"}</b>
          <em>${sum.ratePerWeek != null ? "kg / semana" : `${S.entries.length} registros`}</em>
        </div>
      </div>
    </div>`;

  const chartHtml = `
    <div class="card">
      <div class="card-h">
        <span class="card-t">Últimos 30 días</span>
        <button class="card-s" data-tab="evolution" style="color:var(--acc)">Ver todo →</button>
      </div>
      ${foc ? `<div class="chart-focus">
        <b class="num">${dec1(foc.avg)} <small>kg prom.</small></b>
        <span>${fmtDayShort(foc.ts)} · Tend. ${dec1(foc.trend)}${foc.count > 1 ? ` · ${dec1(foc.min)}–${dec1(foc.max)}` : ""}</span>
      </div>` : ""}
      <div data-chart="home">${UI.weightChart(days30, { metric: "weight", goal: p.goal, selectedIdx: sel, height: 170 })}</div>
      <div class="legend">
        <span><i style="background:var(--acc)"></i>Tendencia</span>
        <span><i style="background:var(--cyan)"></i>Prom. diario y rango</span>
      </div>
    </div>`;

  const todayEntries = sum.today ? [...sum.today.entries].sort((a, b) => b.t - a.t) : [];
  const todayHtml = `
    <div class="card">
      <div class="card-h">
        <span class="card-t">Pesajes de hoy</span>
        <span class="card-s">${todayEntries.length ? `${todayEntries.length} ${todayEntries.length === 1 ? "pesaje" : "pesajes"}` : "0 hoy"}</span>
      </div>
      ${todayEntries.length ? `<div class="today-list">${todayEntries.map(entryRow).join("")}</div>` : `
        <div class="empty" style="padding:18px 8px">
          <b>Todavía no te pesaste hoy</b>
          <span>Tocá "Pesarme" abajo para conectar la Femmto o "+" para cargar rápido.</span>
        </div>`}
    </div>`;

  const biaHtml = latestBia ? (() => {
    const e = enrichEntry(latestBia);
    return `
      <div class="card">
        <div class="card-h">
          <span class="card-t">Composición corporal</span>
          <span class="card-s">${fmtDayShort(e.t)}${e.imp ? ` · ${int(e.imp)} Ω` : ""}</span>
        </div>
        <div class="bia-grid">
          ${e.fat != null ? `<div class="bia-box"><div class="top-b"><span>Grasa corporal</span>${icon("flame", 15)}</div><b class="num">${dec1(e.fat)}<small>%</small></b><span>${dec1(e.kg * e.fat / 100)} kg estimados</span></div>` : ""}
          ${e.muscle != null ? `<div class="bia-box"><div class="top-b"><span>Músculo esq.</span>${icon("bolt", 15)}</div><b class="num">${dec1(e.muscle)}<small>%</small></b><span>${dec1(e.kg * e.muscle / 100)} kg</span></div>` : ""}
          ${e.water != null ? `<div class="bia-box"><div class="top-b"><span>Agua corporal</span>${icon("drop", 15)}</div><b class="num">${dec1(e.water)}<small>%</small></b><span>TBW (Sun et al.)</span></div>` : ""}
          <div class="bia-box"><div class="top-b"><span>Basal (BMR)</span>${icon("sun", 15)}</div><b class="num">${int(e.bmr || C.bmrMifflin(e.kg, p.height, p.age, p.sex))}<small>kcal</small></b><span>${e.imp ? "Katch-McArdle (Ω)" : "Mifflin-St Jeor"}</span></div>
        </div>
      </div>`;
  })() : "";

  $("#s-home").innerHTML = `
    <div class="top">
      <div>
        <div class="eyebrow">${esc(nowStr)}</div>
        <h1>Hola, ${esc(p.name.split(" ")[0])}</h1>
      </div>
      <div style="display:flex;gap:8px">
        <button class="icon-btn ${S.sync.room && !S.sync.lastErr ? "ok" : ""}" data-act="sync-now" aria-label="Sincronizar">${icon("sync", 19)}</button>
        <button class="icon-btn" data-act="open-diag" aria-label="Diagnóstico BLE">${icon("term", 19)}</button>
      </div>
    </div>
    <div class="desk-grid">
      <div class="desk-stack">${heroHtml}${chartHtml}</div>
      <div class="desk-stack">${todayHtml}${biaHtml}</div>
    </div>`;
}

function entryRow(e) {
  const parts = [];
  if (e.imp) parts.push(`${int(e.imp)} Ω`);
  if (e.fat != null) parts.push(`${dec1(e.fat)}% grasa`);
  if (e.tag) parts.push(e.tag);
  return `<button class="w-row" data-edit="${e.id}">
    <span class="w-t num">${fmtHour(e.t)}</span>
    <span class="w-mid">
      <b class="num">${dec2(e.kg)} <small>kg</small></b>
      <span>${parts.length ? esc(parts.join(" · ")) : (e.proto ? esc(e.proto) : "Solo peso")}</span>
    </span>
    <span class="w-src ${e.source === "ble" ? "ble" : ""}">${e.source === "ble" ? "BLE" : "MAN"}</span>
  </button>`;
}

// ==================== PANTALLA EVOLUCIÓN ====================
function filterRange(days, range) {
  if (!range || range === "all") return days;
  const from = C.dayStart(new Date()).getTime() - (range - 1) * 864e5;
  return days.filter(d => d.ts >= from);
}

function renderEvolution() {
  const sum = C.summary(S.entries);
  const days = filterRange(sum.days, view.range);
  const metricDays = days.filter(d => view.metric === "fat" ? d.fatAvg != null : view.metric === "imp" ? d.impAvg != null : true);
  const sel = view.selIdx >= 0 && view.selIdx < metricDays.length ? view.selIdx : metricDays.length - 1;
  const foc = metricDays[sel] || null;
  const weeks = [...sum.weeks].reverse().slice(0, 12);

  const focusStr = (() => {
    if (!foc) return "";
    if (view.metric === "fat") return `<b class="num">${dec1(foc.fatAvg)}<small>%</small></b><span>${fmtDayShort(foc.ts)} · Grasa prom.</span>`;
    if (view.metric === "imp") return `<b class="num">${int(foc.impAvg)}<small>Ω</small></b><span>${fmtDayShort(foc.ts)} · Impedancia cruda</span>`;
    return `<b class="num">${dec1(foc.avg)}<small>kg</small></b><span>${fmtDayShort(foc.ts)} · Tend. ${dec1(foc.trend)}${foc.count > 1 ? ` · ${dec1(foc.min)}–${dec1(foc.max)} (${foc.count})` : ""}</span>`;
  })();

  const periodDelta = metricDays.length >= 2 && view.metric === "weight"
    ? C.round1(metricDays[metricDays.length - 1].trend - metricDays[0].trend) : null;

  const chartCard = `
    <div class="card">
      <div class="card-h">
        <span class="card-t">Curva y tendencia</span>
        ${periodDelta != null ? `<span class="pill ${periodDelta <= -0.05 ? "good" : periodDelta >= 0.05 ? "warn" : "soft"}">${signed1(periodDelta)} kg en período</span>` : ""}
      </div>
      <div class="chips" style="margin-bottom:12px">
        ${[["weight", "Peso"], ["fat", "Grasa %"], ["imp", "Impedancia Ω"]].map(([m, l]) =>
          `<button class="chip-btn ${view.metric === m ? "on" : ""}" data-metric="${m}">${l}</button>`
        ).join("")}
      </div>
      ${foc ? `<div class="chart-focus">${focusStr}</div>` : ""}
      <div data-chart="evo">${UI.weightChart(days, { metric: view.metric, goal: S.profile.goal, selectedIdx: sel, height: 215 })}</div>
      <div class="legend">
        ${view.metric === "weight"
          ? `<span><i style="background:var(--acc)"></i>Tendencia suavizada</span><span><i style="background:var(--cyan)"></i>Promedio diario + mín/máx</span>`
          : `<span><i style="background:${view.metric === "fat" ? "var(--amb)" : "var(--vio)"}"></i>Promedio diario</span>`}
      </div>
    </div>`;

  const intra = sum.intraday;
  const fluctCard = `
    <div class="duo-grid">
      <div class="stat-tile">
        <div class="lbl">${icon("wave", 14)}Fluctuación diaria</div>
        <b class="num">${intra.avgSpread != null ? `±${dec1(intra.avgSpread)}<small>kg</small>` : "—"}</b>
        <div class="s">${intra.multiDays ? `En ${intra.multiDays} días con +2 pesajes` : "Pesate 2+ veces en un día"}</div>
      </div>
      <div class="stat-tile">
        <div class="lbl">${icon("moon", 14)}Noche vs Mañana</div>
        <b class="num">${intra.pmMinusAm != null ? `${signed1(intra.pmMinusAm)}<small>kg</small>` : "—"}</b>
        <div class="s">${intra.pmMinusAm != null ? "Diferencia típica del día" : "Requiere pesaje AM y PM"}</div>
      </div>
    </div>`;

  const weeksCard = `
    <div class="card">
      <div class="card-h">
        <span class="card-t">Promedios semanales</span>
        <span class="card-s">Media de promedios diarios</span>
      </div>
      ${weeks.length ? `<div class="wk-table">${weeks.map((w, i) => {
        const lbl = i === 0 && w.key === C.dayKey(C.weekStart(new Date()).getTime())
          ? "Esta semana"
          : `${new Date(w.startTs).toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "")} – ${new Date(w.endTs).toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "")}`;
        const dCls = w.delta == null || Math.abs(w.delta) < 0.05 ? "flat" : w.delta < 0 ? "down" : "up";
        return `<div class="wk-row">
          <div>
            <b>${esc(lbl)}</b>
            <small class="wk-sub">${w.daysCount} d · ${w.weighIns} pesajes · ${dec1(w.min)}–${dec1(w.max)}</small>
          </div>
          <div class="wk-avg num">${dec1(w.avg)} <small>kg</small></div>
          <div class="wk-d num ${dCls}">${w.delta != null ? `${signed1(w.delta)} kg` : "—"}</div>
        </div>`;
      }).join("")}</div>` : `<div class="empty"><b>Sin semanas todavía</b><span>A medida que te peses verás tu promedio semanal real.</span></div>`}
    </div>`;

  $("#s-evolution").innerHTML = `
    <div class="top">
      <div><div class="eyebrow">Análisis</div><h1>Evolución</h1></div>
    </div>
    <div style="margin-bottom:14px">
      ${UI.seg("range", [{ v: "7", label: "7D" }, { v: "30", label: "30D" }, { v: "90", label: "90D" }, { v: "all", label: "Todo" }], String(view.range))}
    </div>
    <div class="desk-grid">
      <div class="desk-stack">${chartCard}${fluctCard}</div>
      <div class="desk-stack">${weeksCard}</div>
    </div>`;
}

// ==================== PANTALLA HISTORIAL ====================
function renderHistory() {
  const days = C.dailySeries(S.entries).reverse();
  $("#s-history").innerHTML = `
    <div class="top">
      <div><div class="eyebrow">${S.entries.length} ${S.entries.length === 1 ? "registro" : "registros"}</div><h1>Historial</h1></div>
      <button class="icon-btn ok" data-act="weigh-manual" aria-label="Cargar peso">${icon("plus", 20)}</button>
    </div>
    ${days.length ? days.map(d => `
      <div class="day-grp">
        <div class="day-hd">
          <b>${esc(fmtDayFull(d.ts))}</b>
          <span class="num">Prom. ${dec1(d.avg)} kg${d.count > 1 ? `<em>${dec1(d.min)}–${dec1(d.max)} · ${d.count}x</em>` : ""}</span>
        </div>
        <div class="today-list">${[...d.entries].sort((a, b) => b.t - a.t).map(entryRow).join("")}</div>
      </div>`).join("") : `
      <div class="empty">
        ${icon("scale", 42)}
        <b>Todavía no hay pesajes</b>
        <span>Conectá la Femmto B02 desde Inicio o tocá + para cargar uno manual.</span>
      </div>`}`;
}

// ==================== PANTALLA PERFIL ====================
function renderProfile() {
  const p = S.profile;
  const syncSt = S.sync.room
    ? (S.sync.lastErr ? `<span class="rv warn">Error</span>` : `<span class="rv ok">${fmtAgo(S.sync.lastAt)}</span>`)
    : `<span class="rv">Inactivo</span>`;

  $("#s-profile").innerHTML = `
    <div class="top">
      <div><div class="eyebrow">Ajustes</div><h1>${esc(p.name)}</h1></div>
    </div>

    <div class="group-t">Datos personales (para IMC y BIA)</div>
    <div class="group">
      <button class="row" data-act="edit-name"><span class="ri">${icon("user", 18)}</span><span class="rl">Nombre</span><span class="rv">${esc(p.name)}</span>${icon("chevR", 17, "chev")}</button>
      <button class="row" data-act="edit-height"><span class="ri">${icon("ruler", 18)}</span><span class="rl">Altura</span><span class="rv">${p.height} cm</span>${icon("chevR", 17, "chev")}</button>
      <button class="row" data-act="edit-age"><span class="ri">${icon("cake", 18)}</span><span class="rl">Edad</span><span class="rv">${p.age} años</span>${icon("chevR", 17, "chev")}</button>
      <button class="row" data-act="edit-sex"><span class="ri">${icon("user", 18)}</span><span class="rl">Sexo biológico</span><span class="rv">${p.sex === "m" ? "Hombre" : p.sex === "f" ? "Mujer" : "Sin elegir"}</span>${icon("chevR", 17, "chev")}</button>
      <button class="row" data-act="edit-goal"><span class="ri">${icon("target", 18)}</span><span class="rl">Peso objetivo</span><span class="rv">${p.goal ? `${dec1(p.goal)} kg` : "Sin meta"}</span>${icon("chevR", 17, "chev")}</button>
    </div>

    <div class="group-t">Balanza Bluetooth</div>
    <div class="group">
      <button class="row" data-act="weigh-ble"><span class="ri">${icon("bt", 18)}</span><span class="rl">Conectar Femmto B02<small>${S.settings.lastDevice ? `Última: ${esc(S.settings.lastDevice)}` : "GATT + Broadcast multiprotocolo"}</small></span>${icon("chevR", 17, "chev")}</button>
      <button class="row" data-act="toggle-autosave"><span class="ri">${icon("check", 18)}</span><span class="rl">Auto-guardar al fijar peso<small>Guarda solo 1,5 s después de estabilizar</small></span><span class="rv ${S.settings.autoSaveBle ? "ok" : ""}">${S.settings.autoSaveBle ? "Sí" : "No"}</span></button>
      <button class="row" data-act="open-diag"><span class="ri">${icon("term", 18)}</span><span class="rl">Diagnóstico BLE<small>Ver bytes crudos y copiar para depurar</small></span><span class="rv">${ble.logs.length || (S.remoteDiag ? "Nube" : "0")}</span>${icon("chevR", 17, "chev")}</button>
    </div>

    <div class="group-t">Sincronización Android ↔ PC y Backups</div>
    <div class="group">
      <button class="row" data-act="sync-sheet"><span class="ri">${icon("cloud", 18)}</span><span class="rl">Sync nube (Firebase)<small>${S.sync.room ? esc(S.sync.room) : "Activar para ver en PC y celu"}</small></span>${syncSt}${icon("chevR", 17, "chev")}</button>
      <button class="row" data-act="gist-sheet"><span class="ri">${icon("shield", 18)}</span><span class="rl">Backup en GitHub Gist privado<small>${S.gist.id ? `Gist ${S.gist.id.slice(0, 8)}… · ${fmtAgo(S.gist.lastAt)}` : "Opcional con tu token personal"}</small></span>${icon("chevR", 17, "chev")}</button>
      <button class="row" data-act="export-csv"><span class="ri">${icon("download", 18)}</span><span class="rl">Exportar CSV (Excel / Sheets)</span>${icon("chevR", 17, "chev")}</button>
      <button class="row" data-act="export-json"><span class="ri">${icon("download", 18)}</span><span class="rl">Exportar copia JSON</span>${icon("chevR", 17, "chev")}</button>
      <button class="row" data-act="import-json"><span class="ri">${icon("upload", 18)}</span><span class="rl">Importar copia JSON</span>${icon("chevR", 17, "chev")}</button>
    </div>

    <p class="foot">Composición corporal calculada con fórmulas abiertas (Sun et al. 2003 / Janssen / Katch-McArdle) cuando la balanza envía impedancia (Ω).</p>
    <div class="ver">Balanza v${VERSION} · <button data-act="check-update">Buscar actualizaciones</button></div>`;
}

// ==================== FLUJO EN VIVO: PESARSE POR BLUETOOTH ====================
function openLiveWeighIn() {
  liveOpen = true;
  clearTimeout(liveState.autoTimer);
  liveState = { kg: null, locked: false, bioState: null, imp: null, fat: null, water: null, muscle: null, bone: null, bmr: null, visceral: null, proto: null, saved: false, savedId: null, autoTimer: null, rawSeen: 0 };
  $("#live").scrollTop = 0;
  $("#live").classList.add("on");
  renderLive();
  // Si Chrome ya recuerda la balanza, intentamos reconectar solos en silencio
  if (ble.supported) {
    ble.hasKnown().then(known => {
      if (known && liveOpen && ble.state === "off") {
        ble.reconnectKnown(S.settings.lastDevice).then(ok => {
          if (ok && liveOpen) renderLive();
        });
      }
    });
  }
}

async function closeLiveWeighIn() {
  clearTimeout(liveState.autoTimer);
  liveOpen = false;
  $("#live").classList.remove("on");
  const hadLogs = ble.logs.length > 0;
  await ble.stop();
  // Si hubo actividad BLE, subimos el último log diagnóstico a Firebase para poder verlo desde la PC
  if (hadLogs && S.sync.room) syncPush(true).catch(() => {});
  render();
}

function renderLive() {
  if (!liveOpen) return;
  const st = ble.state;
  const chipCls = st === "on" ? "ok" : st === "scanning" ? "scan" : st === "connecting" ? "warn" : "";
  const chipTxt = st === "on" ? `Conectada · ${ble.name}`
    : st === "scanning" ? "Escuchando anuncios BLE…"
    : st === "connecting" ? "Conectando…"
    : ble.supported ? "Listo para conectar" : "Sin Web Bluetooth acá";

  const ringCls = liveState.saved ? "locked" : liveState.locked && liveState.bioState !== "measuring" ? "locked" : liveState.kg ? "measuring" : "";
  const ringSt = liveState.saved ? "GUARDADO ✓"
    : liveState.bioState === "measuring" ? "MIDIENDO BIOIMPEDANCIA…"
    : liveState.locked ? `FIJO · ${liveState.proto || "BLE"}`
    : liveState.kg ? "MIDIENDO…"
    : st === "on" || st === "scanning" ? "SUBITE DESCALZO"
    : "DESPIERTA LA BALANZA";

  const hint = liveState.saved
    ? (liveState.bioState === "unavailable" && !liveState.fat && !liveState.imp ? "Guardado (solo peso — sin lectura de impedancia)." : "Pesaje guardado y sincronizado.")
    : liveState.bioState === "measuring"
      ? "Peso fijo. Quedate descalzo 3–5 s sin moverte mientras analiza composición corporal…"
      : !ble.supported
        ? "Esta compu/navegador no tiene Web Bluetooth. Podés cargar el peso a mano o pesarte desde Chrome en Android."
        : liveState.rawSeen > 0 && !liveState.kg
          ? `Recibí ${liveState.rawSeen} paquete(s) BLE pero el formato todavía no está mapeado. Abrí Diagnóstico para copiarlo y lo decodificamos.`
          : st === "off"
            ? "Parate un segundo en la Femmto para encender el Bluetooth y tocá Conectar."
            : "Mantenete quieto unos segundos hasta que el peso quede fijo (descalzo para bioimpedancia).";

  const biaChips = [];
  if (liveState.imp) biaChips.push(`<span class="pill acc">${int(liveState.imp)} Ω</span>`);
  const preview = liveState.kg ? enrichEntry({ ...liveState }) : null;
  if (preview && preview.fat != null) biaChips.push(`<span class="pill soft">Grasa ${dec1(preview.fat)}%</span>`);
  if (preview && preview.water != null) biaChips.push(`<span class="pill soft">Agua ${dec1(preview.water)}%</span>`);
  if (preview && preview.muscle != null) biaChips.push(`<span class="pill soft">Músculo ${dec1(preview.muscle)}%</span>`);

  const lastLog = ble.logs.length ? ble.logs[ble.logs.length - 1] : "";

  $("#live").innerHTML = `
    <div class="live-in">
      <div class="live-top">
        <span class="chip ${chipCls}"><i class="dot"></i>${esc(chipTxt)}</span>
        <div style="display:flex;gap:8px">
          <button class="icon-btn" data-act="open-diag" aria-label="Diagnóstico">${icon("term", 18)}</button>
          <button class="icon-btn" data-act="live-close" aria-label="Cerrar">${icon("x", 20)}</button>
        </div>
      </div>

      <div class="scale-stage">
        <div class="scale-ring ${ringCls}">
          <b class="num">${liveState.kg != null ? dec2(liveState.kg) : "—"}</b>
          <span class="u">kg</span>
          <span class="st">${esc(ringSt)}</span>
        </div>
        ${biaChips.length ? `<div class="live-bia">${biaChips.join("")}</div>` : ""}
        <p class="scale-hint">${esc(hint)}</p>
        ${lastLog ? `<p class="scale-hint" style="margin-top:6px;font:11.5px/1.4 ui-monospace,monospace;color:var(--t3);word-break:break-all">${esc(lastLog)}</p>` : ""}
      </div>

      <div class="live-actions">
        ${liveState.kg != null && !liveState.saved ? `<button class="btn btn-primary" data-act="live-save">${icon("check", 20)}Guardar ${dec2(liveState.kg)} kg</button>` : ""}
        ${liveState.saved ? `<button class="btn btn-primary" data-act="live-close">Listo</button>` : ""}
        ${ble.supported ? `
          <div class="live-row">
            <button class="btn ${st === "off" && !liveState.kg ? "btn-primary" : "btn-soft"} sm" data-act="ble-gatt">${icon("bt", 17)}Conectar (GATT)</button>
            <button class="btn btn-soft sm" data-act="ble-scan">${icon("radio", 17)}Broadcast</button>
          </div>` : ""}
        <button class="btn btn-ghost" data-act="live-manual">Cargar peso a mano</button>
      </div>
    </div>`;
}

function commitLiveReading() {
  if (!liveState.kg) return;
  clearTimeout(liveState.autoTimer);
  const payload = {
    kg: liveState.kg,
    imp: liveState.imp,
    fat: liveState.fat,
    water: liveState.water,
    muscle: liveState.muscle,
    bone: liveState.bone,
    bmr: liveState.bmr,
    visceral: liveState.visceral,
    source: "ble",
    proto: liveState.proto
  };
  if (liveState.saved && liveState.savedId) {
    updateEntry(liveState.savedId, payload);
    if (S.sync.room) syncPush(true).catch(() => {});
    renderLive();
    return;
  }
  const entry = addEntry(payload);
  liveState.saved = true;
  liveState.savedId = entry.id;
  if (ble.device && ble.device.name) {
    S.settings.lastDevice = ble.device.name;
    save.settings();
  }
  haptic([15, 40, 20]);
  UI.toast(`Guardado: ${dec2(entry.kg)} kg`);
  if (S.sync.room) syncPush(true).catch(() => {});
  renderLive();
}

// Eventos BLE
ble.addEventListener("state", () => { if (liveOpen) renderLive(); });
ble.addEventListener("log", e => {
  if (String(e.detail).includes("← [") || String(e.detail).includes("ADV ")) {
    liveState.rawSeen++;
    if (liveOpen && !liveState.kg) renderLive();
  }
});
ble.addEventListener("biostate", e => {
  liveState.bioState = e.detail;
  if (e.detail === "measuring" && liveState.locked && S.settings.autoSaveBle && !liveState.saved) {
    clearTimeout(liveState.autoTimer);
    liveState.autoTimer = setTimeout(() => commitLiveReading(), 8000);
  }
  if (liveOpen) renderLive();
});
ble.addEventListener("impedance", e => {
  liveState.imp = e.detail.imp;
  if (liveState.saved && liveState.savedId) commitLiveReading();
  if (liveOpen) renderLive();
});
ble.addEventListener("reading", e => {
  const r = e.detail;
  liveState.kg = r.kg;
  liveState.proto = r.proto;
  if (r.imp) liveState.imp = r.imp;
  if (r.fat != null) liveState.fat = r.fat;
  if (r.water != null) liveState.water = r.water;
  if (r.muscle != null) liveState.muscle = r.muscle;
  if (r.bone != null) liveState.bone = r.bone;
  if (r.bmr != null) liveState.bmr = r.bmr;
  if (r.visceral != null) liveState.visceral = r.visceral;

  if (r.finalComplete) {
    liveState.locked = true;
    liveState.bioState = "done";
    if (S.settings.autoSaveBle || liveState.saved) commitLiveReading();
    else if (liveOpen) renderLive();
    return;
  }

  if (r.locked && !liveState.locked) {
    liveState.locked = true;
    haptic(14);
    if (S.settings.autoSaveBle && !liveState.saved) {
      clearTimeout(liveState.autoTimer);
      // Si la balanza sigue con fase de bioimpedancia (SWAN), esperamos hasta 9 s (o guardamos al instante cuando llegue MGB-20)
      liveState.autoTimer = setTimeout(() => commitLiveReading(), r.waitBia ? 9000 : 1800);
    }
  }
  if (liveOpen) renderLive();
});

// ==================== SHEETS (SETUP, MANUAL, EDICIÓN, SYNC, GIST, DIAG) ====================
function setupProfileSheet() {
  const s = UI.sheet(`
    <div class="sheet-body">
      <h3 class="sheet-title">Tu perfil</h3>
      <p class="sheet-text">Solo para calcular IMC y composición corporal cuando la balanza mande impedancia.</p>
      <input class="field" name="name" placeholder="Tu nombre (ej. Santi)" value="Santi" autocomplete="off">
      <div class="live-row">
        <input class="field num" name="height" type="number" inputmode="numeric" placeholder="Altura cm" value="178">
        <input class="field num" name="age" type="number" inputmode="numeric" placeholder="Edad" value="30">
      </div>
      ${UI.seg("sex", [{ v: "m", label: "Hombre" }, { v: "f", label: "Mujer" }], "m")}
      <input class="field num" name="goal" type="number" step="0.1" inputmode="decimal" placeholder="Peso objetivo en kg (opcional)">
      <button class="btn btn-primary" data-go>Crear perfil</button>
    </div>`);
  let sex = "m";
  s.el.addEventListener("click", e => {
    const b = e.target.closest("[data-seg='sex'] button");
    if (!b) return;
    sex = b.dataset.v;
    const seg = b.closest(".seg");
    const i = [...seg.querySelectorAll("button")].indexOf(b);
    seg.style.setProperty("--i", i);
    seg.querySelectorAll("button").forEach((x, k) => x.classList.toggle("on", k === i));
  });
  s.el.querySelector("[data-go]").onclick = () => {
    const name = s.el.querySelector("[name=name]").value.trim() || "Santi";
    const height = Math.max(110, Math.min(230, +s.el.querySelector("[name=height]").value || 178));
    const age = Math.max(12, Math.min(100, +s.el.querySelector("[name=age]").value || 30));
    const goalVal = parseFloat(s.el.querySelector("[name=goal]").value);
    S.profile = { name, height, age, sex, goal: goalVal >= 30 && goalVal <= 220 ? C.round1(goalVal) : null, upd: Date.now() };
    save.profile();
    ensureSyncRoom();
    syncPush().catch(() => {});
    haptic(12);
    s.close();
    render();
  };
}

function joinSyncSheet() {
  const s = UI.sheet(`
    <div class="sheet-body">
      <h3 class="sheet-title">Vincular dispositivo</h3>
      <p class="sheet-text">Pegá el link o el código de sync que copiaste desde tu celular o PC.</p>
      <input class="field" name="code" placeholder="balanza-..." autocomplete="off">
      <button class="btn btn-primary" data-go>Conectar y bajar datos</button>
    </div>`);
  s.el.querySelector("[data-go]").onclick = async () => {
    const raw = s.el.querySelector("[name=code]").value.trim();
    const room = extractRoomCode(raw);
    if (!room || room.length < 16) return UI.toast("Código inválido (mínimo 16 caracteres)");
    S.sync.room = room;
    save.sync();
    const ok = await syncPullAndMerge({ silent: false });
    if (ok && !S.profile) {
      UI.toast("Sala vacía — creá tu perfil primero");
    }
    s.close();
    render();
  };
}

function extractRoomCode(raw) {
  if (!raw) return "";
  try {
    if (raw.includes("sync=")) {
      const u = new URL(raw);
      return (u.searchParams.get("sync") || "").replace(/[^a-zA-Z0-9_-]/g, "");
    }
  } catch (e) {}
  return raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

function manualWeighSheet(existing = null) {
  const lastKg = existing ? existing.kg : (S.entries[0] ? S.entries[0].kg : 80.0);
  const whole = Math.floor(lastKg);
  const dec = Math.round((lastKg - whole) * 10);
  let tag = existing ? (existing.tag || "") : "";

  const wInt = UI.wheel({ values: UI.range(35, 200, 1), index: Math.max(0, Math.min(165, whole - 35)) });
  const wDec = UI.wheel({ values: UI.range(0, 9, 1), index: Math.max(0, Math.min(9, dec)), width: "68px" });

  const body = document.createElement("div");
  body.className = "sheet-body";
  body.innerHTML = `
    <h3 class="sheet-title">${existing ? "Editar pesaje" : "Cargar peso"}</h3>
    <div class="wheels"><div class="wheel-band"></div></div>
    <div class="chips" data-tags>
      ${TAGS.map(t => `<button type="button" class="chip-btn ${tag === t ? "on" : ""}" data-tag="${t}">${t}</button>`).join("")}
    </div>
    ${existing ? `<input class="field num" name="imp" type="number" inputmode="numeric" placeholder="Impedancia Ω (opcional)" value="${existing.imp || ""}">` : ""}
    <button class="btn btn-primary" data-save>${existing ? "Guardar cambios" : "Guardar pesaje"}</button>
    ${existing ? `<button class="btn btn-danger sm" data-del>Eliminar pesaje</button>` : ""}
  `;
  const box = body.querySelector(".wheels");
  box.append(wInt.el);
  box.insertAdjacentHTML("beforeend", `<div class="wheel-sep">,</div>`);
  box.append(wDec.el);
  box.insertAdjacentHTML("beforeend", `<div class="wheel-unit">kg</div>`);

  const s = UI.sheet(body);
  requestAnimationFrame(() => { wInt.mount(); wDec.mount(); });
  body.addEventListener("click", e => {
    const tb = e.target.closest("[data-tag]");
    if (!tb) return;
    tag = tag === tb.dataset.tag ? "" : tb.dataset.tag;
    body.querySelectorAll("[data-tag]").forEach(b => b.classList.toggle("on", b.dataset.tag === tag));
  });
  body.querySelector("[data-save]").onclick = () => {
    const kg = C.round1(wInt.value + wDec.value / 10);
    if (existing) {
      const impEl = body.querySelector("[name=imp]");
      const imp = impEl && impEl.value ? Math.round(+impEl.value) : null;
      updateEntry(existing.id, { kg, tag, imp: imp && imp >= 200 && imp <= 1200 ? imp : null });
      UI.toast("Pesaje actualizado");
    } else {
      addEntry({ kg, tag, source: "manual" });
      UI.toast(`Guardado: ${dec1(kg)} kg`);
    }
    haptic(10);
    s.close();
    render();
  };
  const delBtn = body.querySelector("[data-del]");
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!(await UI.confirm({ title: "¿Eliminar pesaje?", ok: "Eliminar", danger: true }))) return;
      deleteEntry(existing.id);
      s.close();
      UI.toast("Pesaje eliminado");
      render();
    };
  }
}

function syncSheet() {
  const room = ensureSyncRoom();
  const link = shareLink(room);
  const s = UI.sheet(`
    <div class="sheet-body">
      <h3 class="sheet-title">Sync Android ↔ PC</h3>
      <p class="sheet-text">Usa tu misma base de Firebase de Paso. Abrí este link en tu compu (o celular) una sola vez y quedan sincronizados en tiempo real.</p>
      <div class="diag" style="max-height:none">${esc(link)}</div>
      <div class="live-row">
        <button class="btn btn-primary sm" data-copy>${icon("copy", 16)}Copiar link</button>
        <button class="btn btn-soft sm" data-now>${icon("sync", 16)}Sincronizar</button>
      </div>
      ${navigator.share ? `<button class="btn btn-soft sm" data-share>${icon("share", 16)}Compartir link</button>` : ""}
      <button class="btn btn-ghost" data-change>Usar otro código de sync</button>
    </div>`);
  s.el.querySelector("[data-copy]").onclick = () => copyText(link, "Link copiado — abrilo en tu PC");
  s.el.querySelector("[data-now]").onclick = async () => { await syncPullAndMerge({ silent: false, includeDiag: true }); render(); };
  const sh = s.el.querySelector("[data-share]");
  if (sh) sh.onclick = () => navigator.share({ title: "Balanza Sync", url: link }).catch(() => {});
  s.el.querySelector("[data-change]").onclick = () => { s.close(); joinSyncSheet(); };
}

function gistSheet() {
  const s = UI.sheet(`
    <div class="sheet-body">
      <h3 class="sheet-title">Backup en GitHub Gist</h3>
      <p class="sheet-text">Opcional: guardá una copia privada en tu GitHub (${esc("stdelprato")}). El token queda solo en este navegador y necesita permiso <b>gist</b>.</p>
      <input class="field" name="tok" type="password" placeholder="ghp_... (Personal Access Token)" value="${esc(S.gist.token || "")}">
      <input class="field" name="gid" placeholder="Gist ID (se genera solo al subir)" value="${esc(S.gist.id || "")}">
      <div class="live-row">
        <button class="btn btn-primary sm" data-push>${icon("upload", 16)}Subir copia</button>
        <button class="btn btn-soft sm" data-pull>${icon("download", 16)}Bajar copia</button>
      </div>
    </div>`);
  const readFields = () => {
    S.gist.token = s.el.querySelector("[name=tok]").value.trim();
    S.gist.id = s.el.querySelector("[name=gid]").value.trim();
    save.gist();
  };
  s.el.querySelector("[data-push]").onclick = async () => {
    readFields();
    try { const d = await gistPush(); UI.toast("Backup subido a Gist " + d.id.slice(0, 8)); s.close(); render(); }
    catch (e) { UI.toast("Error Gist: " + e.message); }
  };
  s.el.querySelector("[data-pull]").onclick = async () => {
    readFields();
    try { const n = await gistPull(); UI.toast(`Gist importado (${n} registros)`); s.close(); render(); }
    catch (e) { UI.toast("Error Gist: " + e.message); }
  };
}

function diagSheet() {
  const localTxt = ble.logs.length ? ble.diagnosticText() : "";
  const txt = localTxt || S.remoteDiag || "Todavía no hay registros BLE.\n\n1. Abrí la app en Chrome para Android.\n2. Tocá Pesarme → Conectar (GATT) o Broadcast.\n3. Subite a la Femmto B02.\n4. El log se guarda acá y se sincroniza a tu PC automáticamente.";
  const s = UI.sheet(`
    <div class="sheet-body">
      <h3 class="sheet-title">Diagnóstico BLE</h3>
      <p class="sheet-text">${localTxt ? "Captura local de esta sesión." : S.remoteDiag ? "Última captura BLE sincronizada desde tu celular." : "Inspector de servicios, UUIDs y tramas hex crudas."}</p>
      <pre class="diag">${esc(txt)}</pre>
      <div class="live-row">
        <button class="btn btn-primary sm" data-copy>${icon("copy", 16)}Copiar log</button>
        <button class="btn btn-soft sm" data-sync-diag>${icon("cloud", 16)}Subir / Traer</button>
      </div>
    </div>`);
  s.el.querySelector("[data-copy]").onclick = () => copyText(txt, "Diagnóstico copiado");
  s.el.querySelector("[data-sync-diag]").onclick = async () => {
    await syncPullAndMerge({ silent: false, includeDiag: true });
    s.close();
    diagSheet();
  };
}

function copyText(text, okMsg = "Copiado") {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => UI.toast(okMsg)).catch(() => fallbackCopy(text, okMsg));
  } else fallbackCopy(text, okMsg);
}
function fallbackCopy(text, okMsg) {
  const ta = document.createElement("textarea");
  ta.value = text; document.body.append(ta); ta.select();
  try { document.execCommand("copy"); UI.toast(okMsg); } catch (e) { UI.toast("No se pudo copiar"); }
  ta.remove();
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importJsonFile() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json,.json";
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const merged = C.mergeEntries(S.entries, data.entries || [], S.deleted, data.deleted || {});
      S.entries = merged.entries; S.deleted = merged.deleted;
      if (data.profile && !S.profile) S.profile = data.profile;
      save.entries(); save.deleted(); save.profile();
      syncPush().catch(() => {});
      UI.toast(`Importados (${S.entries.length} registros)`);
      render();
    } catch (e) { UI.toast("Archivo JSON inválido"); }
  };
  inp.click();
}

// ==================== EVENTOS GLOBALES ====================
document.addEventListener("click", async e => {
  // Tabs
  const tb = e.target.closest("[data-tab]");
  if (tb) {
    view.tab = tb.dataset.tab;
    haptic(5);
    render();
    return;
  }

  // Segmentado de período en Evolución
  const segBtn = e.target.closest("[data-seg='range'] button");
  if (segBtn) {
    view.range = segBtn.dataset.v === "all" ? "all" : +segBtn.dataset.v;
    view.selIdx = -1;
    haptic(4);
    renderEvolution();
    return;
  }

  // Chips de métrica en Evolución
  const mBtn = e.target.closest("[data-metric]");
  if (mBtn) {
    view.metric = mBtn.dataset.metric;
    view.selIdx = -1;
    haptic(4);
    renderEvolution();
    return;
  }

  // Tap en punto del gráfico
  const hit = e.target.closest("[data-cidx]");
  if (hit) {
    const chartBox = hit.closest("[data-chart]");
    const idx = +hit.dataset.cidx;
    if (chartBox && chartBox.dataset.chart === "home") { view.homeSelIdx = idx; renderHome(); }
    else { view.selIdx = idx; renderEvolution(); }
    haptic(4);
    return;
  }

  // Editar pesaje
  const ed = e.target.closest("[data-edit]");
  if (ed) {
    const entry = S.entries.find(x => x.id === ed.dataset.edit);
    if (entry) manualWeighSheet(entry);
    return;
  }

  // Acciones
  const actEl = e.target.closest("[data-act]");
  if (!actEl) return;
  const act = actEl.dataset.act;

  if (act === "setup-new") return setupProfileSheet();
  if (act === "setup-sync") return joinSyncSheet();
  if (act === "weigh-ble") return openLiveWeighIn();
  if (act === "weigh-manual") return manualWeighSheet();
  if (act === "live-close") return closeLiveWeighIn();
  if (act === "live-save") return commitLiveReading();
  if (act === "live-manual") { await closeLiveWeighIn(); return manualWeighSheet(); }
  if (act === "open-diag") return diagSheet();
  if (act === "sync-now") { await syncPullAndMerge({ silent: false, includeDiag: true }); return render(); }
  if (act === "sync-sheet") return syncSheet();
  if (act === "gist-sheet") return gistSheet();

  if (act === "ble-gatt") {
    try {
      await ble.pickAndConnect();
      if (ble.device && ble.device.name) { S.settings.lastDevice = ble.device.name; save.settings(); }
      if (S.sync.room) syncPush(true).catch(() => {});
      renderLive();
    } catch (err) {
      if (err && err.name !== "NotFoundError") UI.toast(err.message || "Error al conectar");
      if (S.sync.room) syncPush(true).catch(() => {});
      renderLive();
    }
    return;
  }

  if (act === "ble-scan") {
    try {
      await ble.startBroadcastScan();
      renderLive();
    } catch (err) {
      UI.toast(err.message || "Broadcast no disponible");
      if (S.sync.room) syncPush(true).catch(() => {});
      renderLive();
    }
    return;
  }

  if (act === "toggle-autosave") {
    S.settings.autoSaveBle = !S.settings.autoSaveBle;
    save.settings();
    renderProfile();
    return;
  }

  if (act === "edit-name") {
    const s = UI.sheet(`<div class="sheet-body"><h3 class="sheet-title">Nombre</h3><input class="field" value="${esc(S.profile.name)}"><button class="btn btn-primary" data-ok>Guardar</button></div>`);
    s.el.querySelector("[data-ok]").onclick = () => {
      const v = s.el.querySelector("input").value.trim();
      if (v) { S.profile.name = v; S.profile.upd = Date.now(); save.profile(); syncPush().catch(() => {}); }
      s.close(); render();
    };
    return;
  }

  if (act === "edit-height") {
    UI.pick({
      title: "Altura", unit: "cm",
      columns: [{ values: UI.range(130, 220, 1), value: S.profile.height }],
      onDone: ([v]) => { S.profile.height = v; S.profile.upd = Date.now(); save.profile(); syncPush().catch(() => {}); render(); }
    });
    return;
  }

  if (act === "edit-age") {
    UI.pick({
      title: "Edad", unit: "años",
      columns: [{ values: UI.range(14, 95, 1), value: S.profile.age }],
      onDone: ([v]) => { S.profile.age = v; S.profile.upd = Date.now(); save.profile(); syncPush().catch(() => {}); render(); }
    });
    return;
  }

  if (act === "edit-sex") {
    const s = UI.sheet(`<div class="sheet-body"><h3 class="sheet-title">Sexo biológico</h3><p class="sheet-text">Se usa en las ecuaciones de impedancia y metabolismo basal.</p><button class="btn btn-soft" data-s="m">Hombre</button><button class="btn btn-soft" data-s="f">Mujer</button></div>`);
    s.el.addEventListener("click", ev => {
      const b = ev.target.closest("[data-s]");
      if (!b) return;
      S.profile.sex = b.dataset.s; S.profile.upd = Date.now(); save.profile(); syncPush().catch(() => {}); s.close(); render();
    });
    return;
  }

  if (act === "edit-goal") {
    const base = S.profile.goal || (S.entries[0] ? Math.round(S.entries[0].kg) : 80);
    const s = UI.sheet(`<div class="sheet-body"><h3 class="sheet-title">Peso objetivo</h3><input class="field num" type="number" step="0.1" inputmode="decimal" value="${S.profile.goal || ""}" placeholder="Ej. ${base}"><button class="btn btn-primary" data-ok>Guardar</button>${S.profile.goal ? `<button class="btn btn-ghost" data-clr>Quitar meta</button>` : ""}</div>`);
    s.el.querySelector("[data-ok]").onclick = () => {
      const v = parseFloat(s.el.querySelector("input").value);
      S.profile.goal = v >= 30 && v <= 220 ? C.round1(v) : null;
      S.profile.upd = Date.now(); save.profile(); syncPush().catch(() => {}); s.close(); render();
    };
    const clr = s.el.querySelector("[data-clr]");
    if (clr) clr.onclick = () => { S.profile.goal = null; S.profile.upd = Date.now(); save.profile(); syncPush().catch(() => {}); s.close(); render(); };
    return;
  }

  if (act === "export-csv") {
    downloadFile(`balanza-${C.dayKey(Date.now())}.csv`, C.toCsv(S.entries), "text/csv;charset=utf-8");
    UI.toast("CSV descargado");
    return;
  }

  if (act === "export-json") {
    const body = JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), profile: S.profile, entries: S.entries, deleted: S.deleted }, null, 2);
    downloadFile(`balanza-backup-${C.dayKey(Date.now())}.json`, body, "application/json");
    UI.toast("Copia JSON descargada");
    return;
  }

  if (act === "import-json") return importJsonFile();

  if (act === "check-update") {
    try {
      const r = await fetch("version.json?z=" + Date.now(), { cache: "no-store" });
      const j = await r.json();
      if (j.version && j.version !== VERSION) {
        UI.toast(`Actualizando a v${j.version}…`);
        if ("caches" in window) {
          const ks = await caches.keys();
          await Promise.all(ks.map(k => caches.delete(k)));
        }
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(reg => reg.update().catch(() => {})));
        }
        setTimeout(() => location.reload(), 500);
      } else UI.toast(`Ya tenés la última versión (v${VERSION})`);
    } catch (err) { UI.toast("Sin conexión"); }
  }
});

// ==================== ARRANQUE ====================
async function boot() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // Si abrieron un link ?sync=balanza-... vinculamos automáticamente
  const qRoom = extractRoomCode(new URLSearchParams(location.search).get("sync") || "");
  if (qRoom && qRoom.length >= 16) {
    S.sync.room = qRoom;
    save.sync();
    history.replaceState(null, "", location.pathname);
    UI.toast("Sincronizando datos…");
  }

  render();
  if (S.sync.room) {
    const ok = await syncPullAndMerge({ silent: true });
    if (ok) render();
  }
}

boot();
