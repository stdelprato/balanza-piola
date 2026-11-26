// Componentes de interfaz: íconos SVG, formatos es-AR, hojas deslizables, ruedas, segmentados y gráficos interactivos.
const UI = (() => {
  "use strict";

  const P = {
    scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 10.5a4.8 4.8 0 0 1 8 0l-4 3.5z"/><path d="M12 14l2-2.5"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    bt: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
    radio: '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    drop: '<path d="M12 2.5C9.2 6.8 6 10.2 6 14a6 6 0 0 0 12 0c0-3.8-3.2-7.2-6-11.5z"/>',
    flame: '<path d="M12 2c.5 3.5 5 5.5 5 11a5 5 0 0 1-10 0c0-2.5 1-4 2.5-5.5 0 2 1 3 2 3.5C11 8 11 5 12 2z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    ruler: '<rect x="8" y="2.5" width="8" height="19" rx="2"/><path d="M8 7h3M8 11h4.5M8 15h3M8 19h4.5"/>',
    cake: '<path d="M4 21h16V13a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z"/><path d="M4 16c2 1.5 4 1.5 5.3 0s4 1.5 5.4 0 4-1.5 5.3 0M12 11V8M12 4.5v.5"/>',
    cloud: '<path d="M6.5 19h11a4.5 4.5 0 0 0 .9-8.9A6 6 0 0 0 6.8 8.3 4 4 0 0 0 6.5 19z"/>',
    sync: '<path d="M21 12a9 9 0 0 0-15.5-6.3L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15.5 6.3L21 16"/><path d="M16 16h5v5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9m-5 5 5-5 5 5M5 4h14"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    term: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m8 10 3 2.5L8 15M13 15h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5z"/>',
    up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
    down: '<path d="M12 5v14m-6-6 6 6 6-6"/>',
    wave: '<path d="M2 12h3l2.5-6 4 12 3-8 2.5 2H22"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'
  };

  const icon = (n, s = 22, cls = "") =>
    `<svg class="ic ${cls}" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ""}</svg>`;

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  const nf = d => new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const F0 = nf(0), F1 = nf(1), F2 = nf(2);
  const int = n => F0.format(Math.round(n || 0));
  const dec1 = n => F1.format(n || 0);
  const dec2 = n => F2.format(n || 0);
  const signed1 = n => (n > 0.04 ? "+" : n < -0.04 ? "−" : "") + dec1(Math.abs(n || 0));
  const signed2 = n => (n > 0.004 ? "+" : n < -0.004 ? "−" : "") + dec2(Math.abs(n || 0));

  // ---------- hojas ----------
  function sheet(content, opts = {}) {
    const root = document.getElementById("sheets");
    const bd = document.createElement("div");
    bd.className = "sheet-bd";
    const el = document.createElement("div");
    el.className = "sheet " + (opts.cls || "");
    el.innerHTML = '<div class="grab"><i></i></div>';
    if (typeof content === "string") el.insertAdjacentHTML("beforeend", content); else el.append(content);
    const z = 80 + root.children.length;
    bd.style.zIndex = z; el.style.zIndex = z + 1;
    root.append(bd, el);
    requestAnimationFrame(() => requestAnimationFrame(() => { bd.classList.add("on"); el.classList.add("on"); }));
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      bd.classList.remove("on"); el.classList.remove("on"); el.style.transform = "";
      setTimeout(() => { bd.remove(); el.remove(); }, 360);
      opts.onClose && opts.onClose();
    };
    bd.onclick = close;
    el.addEventListener("click", e => { if (e.target.closest("[data-close]")) close(); });
    const grab = el.querySelector(".grab");
    let y0 = null, dy = 0;
    const move = v => { el.style.transform = `translate(-50%, ${v}px)`; };
    grab.addEventListener("pointerdown", e => { y0 = e.clientY; dy = 0; el.style.transition = "none"; grab.setPointerCapture(e.pointerId); });
    grab.addEventListener("pointermove", e => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); move(dy); });
    const end = () => { if (y0 === null) return; y0 = null; el.style.transition = ""; if (dy > 70 || dy < 4) close(); else el.style.transform = ""; };
    grab.addEventListener("pointerup", end);
    grab.addEventListener("pointercancel", () => { y0 = null; el.style.transition = ""; el.style.transform = ""; });
    return { el, close };
  }

  function confirm({ title, text = "", ok = "Confirmar", danger = false }) {
    return new Promise(res => {
      let answered = false;
      const s = sheet(`
        <div class="sheet-body center">
          <h3 class="sheet-title">${esc(title)}</h3>
          ${text ? `<p class="sheet-text">${esc(text)}</p>` : ""}
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(ok)}</button>
          <button class="btn btn-ghost" data-close>Cancelar</button>
        </div>`, { onClose: () => { if (!answered) res(false); } });
      s.el.querySelector("[data-ok]").onclick = () => { answered = true; res(true); s.close(); };
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), 2800);
  }

  // ---------- rueda (scroll picker) ----------
  const ITEM = 44;
  function wheel({ values, index = 0, format = v => v, width = "" }) {
    const el = document.createElement("div");
    el.className = "wheel";
    if (width) el.style.flex = `0 0 ${width}`;
    el.innerHTML = `<div class="wheel-sc">${values.map((v, i) => `<div class="wheel-it" data-i="${i}">${format(v)}</div>`).join("")}</div>`;
    const sc = el.firstChild;
    const items = sc.children;
    let cur = index, raf = 0;
    const paint = () => {
      raf = 0;
      const c = sc.scrollTop / ITEM;
      const from = Math.max(0, Math.floor(c) - 5), to = Math.min(items.length - 1, Math.ceil(c) + 5);
      for (let i = from; i <= to; i++) {
        const d = i - c, a = Math.min(Math.abs(d), 3);
        items[i].style.transform = `rotateX(${(-d * 20).toFixed(1)}deg) scale(${(1 - a * 0.07).toFixed(3)})`;
        items[i].style.opacity = (1 - a * 0.3).toFixed(2);
      }
      const ni = Math.max(0, Math.min(values.length - 1, Math.round(c)));
      if (ni !== cur) { items[cur] && items[cur].classList.remove("sel"); cur = ni; items[cur].classList.add("sel"); haptic(4); }
    };
    sc.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(paint); }, { passive: true });
    sc.addEventListener("click", e => {
      const it = e.target.closest(".wheel-it");
      if (it) sc.scrollTo({ top: +it.dataset.i * ITEM, behavior: "smooth" });
    });
    const mount = () => { sc.scrollTop = cur * ITEM; items[cur] && items[cur].classList.add("sel"); paint(); };
    const sync = () => { cur = Math.max(0, Math.min(values.length - 1, Math.round(sc.scrollTop / ITEM))); };
    return { el, mount, get value() { sync(); return values[cur]; }, get index() { sync(); return cur; } };
  }

  const range = (a, b, step = 1) => {
    const out = [];
    for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  };

  function pick({ title, columns, sep = "", unit = "", onDone }) {
    const ws = columns.map(c => wheel({ values: c.values, index: Math.max(0, c.values.indexOf(c.value)), format: c.format, width: c.width }));
    const body = document.createElement("div");
    body.className = "sheet-body";
    body.innerHTML = `<h3 class="sheet-title">${esc(title)}</h3><div class="wheels"><div class="wheel-band"></div></div><button class="btn btn-primary" data-done>Listo</button>`;
    const box = body.querySelector(".wheels");
    ws.forEach((w, i) => {
      box.append(w.el);
      if (sep && i < ws.length - 1) box.insertAdjacentHTML("beforeend", `<div class="wheel-sep">${sep}</div>`);
    });
    if (unit) box.insertAdjacentHTML("beforeend", `<div class="wheel-unit">${esc(unit)}</div>`);
    const s = sheet(body);
    requestAnimationFrame(() => ws.forEach(w => w.mount()));
    body.querySelector("[data-done]").onclick = () => { haptic(10); onDone(ws.map(w => w.value)); s.close(); };
    return s;
  }

  // ---------- segmentado ----------
  function seg(name, options, value, cls = "") {
    const i = Math.max(0, options.findIndex(o => o.v === value));
    return `<div class="seg ${cls}" data-seg="${name}" data-i="${i}" style="--n:${options.length};--i:${i}">
      <i class="seg-thumb"></i>
      ${options.map((o, k) => `<button type="button" data-v="${o.v}" class="${k === i ? "on" : ""}">${o.icon ? icon(o.icon, 16) : ""}<span>${esc(o.label)}</span></button>`).join("")}
    </div>`;
  }

  // ---------- gráfico principal de evolución (diario + rango min/max + tendencia EWMA) ----------
  let gid = 0;
  function weightChart(days, { metric = "weight", goal = null, selectedIdx = -1, height = 190 } = {}) {
    const pts = days.filter(d => {
      if (metric === "fat") return d.fatAvg != null;
      if (metric === "muscle") return d.muscleAvg != null;
      if (metric === "imp") return d.impAvg != null;
      return d.avg != null;
    });
    if (!pts.length) {
      return `<div class="chart-empty">Sin datos suficientes todavía</div>`;
    }
    const W = 540, H = height, padL = 8, padR = 44, padT = 16, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const vals = [];
    for (const d of pts) {
      if (metric === "weight") { vals.push(d.min, d.max, d.trend); }
      else if (metric === "fat") vals.push(d.fatAvg);
      else if (metric === "muscle") vals.push(d.muscleAvg);
      else vals.push(d.impAvg);
    }
    if (metric === "weight" && goal && goal > 20) {
      const curMin = Math.min(...vals), curMax = Math.max(...vals);
      if (Math.abs(goal - curMin) <= 12 || Math.abs(goal - curMax) <= 12) vals.push(goal);
    }
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.16, metric === "imp" ? 12 : 0.6);
    lo -= pad; hi += pad;
    const span = hi - lo || 1;

    const minT = pts[0].ts, maxT = pts[pts.length - 1].ts;
    const spanT = Math.max(1, maxT - minT);
    const xOf = (d, i) => pts.length === 1 ? padL + plotW / 2 : padL + ((d.ts - minT) / spanT) * plotW;
    const yOf = v => padT + plotH - ((v - lo) / span) * plotH;

    // Grid horizontal (3 niveles)
    const ticks = [hi - pad * 0.4, (hi + lo) / 2, lo + pad * 0.4];
    const gridSvg = ticks.map(v => {
      const y = yOf(v);
      const lbl = metric === "imp" ? int(v) : dec1(v);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="cg-line"/>
        <text x="${W - padR + 6}" y="${(y + 3.5).toFixed(1)}" class="cg-lbl">${lbl}</text>`;
    }).join("");

    // Línea objetivo
    let goalSvg = "";
    if (metric === "weight" && goal && goal >= lo && goal <= hi) {
      const gy = yOf(goal);
      goalSvg = `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="cg-goal"/>
        <text x="${padL + 4}" y="${(gy - 5).toFixed(1)}" class="cg-goal-t">Meta ${dec1(goal)}</text>`;
    }

    const lineColor = metric === "fat" ? "#ff9f43" : metric === "muscle" ? "#4dffb8" : metric === "imp" ? "#a78bfa" : "#c6ff3d";
    const id = "wc" + (++gid);

    // Curva suave (tendencia para peso; serie directa para fat/muscle/imp)
    const valOf = d => metric === "weight" ? d.trend : metric === "fat" ? d.fatAvg : metric === "muscle" ? d.muscleAvg : d.impAvg;
    const coords = pts.map((d, i) => [xOf(d, i), yOf(valOf(d))]);
    let pathD = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
      const [x0, y0] = coords[i - 1], [x1, y1] = coords[i], mx = (x0 + x1) / 2;
      pathD += ` C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    const areaD = coords.length > 1
      ? `${pathD} L${coords[coords.length - 1][0].toFixed(1)},${(padT + plotH).toFixed(1)} L${coords[0][0].toFixed(1)},${(padT + plotH).toFixed(1)} Z`
      : "";

    // Whiskers de fluctuación intradía + puntos diarios
    const sel = selectedIdx >= 0 && selectedIdx < pts.length ? selectedIdx : pts.length - 1;
    const markers = pts.map((d, i) => {
      const x = xOf(d, i);
      const val = metric === "weight" ? d.avg : valOf(d);
      const y = yOf(val);
      const isSel = i === sel;
      let whisker = "";
      if (metric === "weight" && d.count >= 2 && d.spread > 0.05) {
        whisker = `<line x1="${x.toFixed(1)}" y1="${yOf(d.max).toFixed(1)}" x2="${x.toFixed(1)}" y2="${yOf(d.min).toFixed(1)}" class="cg-whisk${isSel ? " on" : ""}"/>`;
      }
      const dotR = isSel ? 5.5 : (pts.length > 40 ? 2.2 : 3.2);
      const dotCls = metric === "weight" ? "cg-dot" : "cg-dot alt";
      const hitW = Math.max(14, plotW / Math.max(pts.length, 6));
      return `${whisker}
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" class="${dotCls}${isSel ? " on" : ""}" style="--mc:${lineColor}"/>
        ${isSel ? `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}" class="cg-sel"/>` : ""}
        <rect x="${(x - hitW / 2).toFixed(1)}" y="${padT}" width="${hitW.toFixed(1)}" height="${plotH}" fill="transparent" data-cidx="${i}" class="cg-hit"/>`;
    }).join("");

    // Etiquetas eje X (primero, medio, último)
    const fmtX = ts => new Date(ts).toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "");
    const xLbls = pts.length === 1
      ? `<text x="${xOf(pts[0], 0).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="cg-xl">${fmtX(pts[0].ts)}</text>`
      : [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
          .filter((v, idx, a) => a.indexOf(v) === idx)
          .map((idx, pos, arr) => {
            const anchor = pos === 0 ? "start" : pos === arr.length - 1 ? "end" : "middle";
            return `<text x="${xOf(pts[idx], idx).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" class="cg-xl">${fmtX(pts[idx].ts)}</text>`;
          }).join("");

    return `<svg class="w-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lineColor}" stop-opacity=".26"/><stop offset="1" stop-color="${lineColor}" stop-opacity="0"/></linearGradient></defs>
      ${gridSvg}
      ${goalSvg}
      ${areaD ? `<path d="${areaD}" fill="url(#${id})"/>` : ""}
      ${coords.length > 1 ? `<path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="2.8" stroke-linecap="round"/>` : ""}
      ${markers}
      ${xLbls}
    </svg>`;
  }

  return { icon, esc, haptic, int, dec1, dec2, signed1, signed2, sheet, confirm, toast, wheel, range, pick, seg, weightChart };
})();
