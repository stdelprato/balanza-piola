// Lógica pura sin DOM (testeable con Node): parsers BLE multiprotocolo, BIA científica, promedios diarios/semanales y tendencia EWMA.
(function (root) {
  "use strict";

  const LB_TO_KG = 0.45359237;
  const JIN_TO_KG = 0.5;
  const ST_TO_KG = 6.35029318;

  const u8 = (b, i) => b[i] & 0xff;
  const u16be = (b, i) => ((b[i] & 0xff) << 8) | (b[i + 1] & 0xff);
  const u16le = (b, i) => (b[i] & 0xff) | ((b[i + 1] & 0xff) << 8);
  const u32be = (b, i) => (((b[i] & 0xff) << 24) >>> 0) + ((b[i + 1] & 0xff) << 16) + ((b[i + 2] & 0xff) << 8) + (b[i + 3] & 0xff);
  const round1 = v => Math.round(v * 10) / 10;
  const round2 = v => Math.round(v * 100) / 100;
  const validKg = kg => Number.isFinite(kg) && kg >= 5 && kg <= 260;

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof DataView) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return new Uint8Array(input || []);
  }

  function hex(input) {
    return [...toBytes(input)].map(x => x.toString(16).padStart(2, "0").toUpperCase()).join("-");
  }

  // ==================== PARSERS BLE (GATT) ====================

  // 1. Bluetooth SIG Weight Scale Measurement (0x2A9D)
  function parseWeightScaleSig(raw) {
    const b = toBytes(raw);
    if (b.length < 3) return null;
    const flags = u8(b, 0);
    const imperial = (flags & 0x01) !== 0;
    const rawW = u16le(b, 1);
    const kg = imperial ? (rawW * 0.01) * LB_TO_KG : rawW * 0.005;
    if (!validKg(kg)) return null;
    return { proto: "SIG-2A9D", kg: round2(kg), locked: true };
  }

  // 2. Bluetooth SIG Body Composition Measurement (0x2A9C)
  function parseBodyCompSig(raw) {
    const b = toBytes(raw);
    if (b.length < 4) return null;
    const flags = u16le(b, 0);
    const imperial = (flags & 0x0001) !== 0;
    const fatPct = u16le(b, 2) * 0.1;
    let off = 4;
    if (flags & 0x0002) off += 7; // timestamp
    if (flags & 0x0004) off += 1; // user id
    let bmr = null, musclePct = null, waterKg = null, imp = null, kg = null;
    if (flags & 0x0008) { if (off + 2 <= b.length) bmr = Math.round(u16le(b, off) * 0.239006); off += 2; } // kJ -> kcal
    if (flags & 0x0010) { if (off + 2 <= b.length) musclePct = round1(u16le(b, off) * 0.1); off += 2; }
    if (flags & 0x0020) off += 2; // muscle mass
    if (flags & 0x0040) off += 2; // fat free mass
    if (flags & 0x0080) off += 2; // soft lean mass
    if (flags & 0x0100) {
      if (off + 2 <= b.length) {
        const wv = u16le(b, off);
        waterKg = imperial ? (wv * 0.01) * LB_TO_KG : wv * 0.005;
      }
      off += 2;
    }
    if (flags & 0x0200) { if (off + 2 <= b.length) imp = round1(u16le(b, off) * 0.1); off += 2; }
    if (flags & 0x0400) {
      if (off + 2 <= b.length) {
        const wv = u16le(b, off);
        kg = imperial ? (wv * 0.01) * LB_TO_KG : wv * 0.005;
      }
      off += 2;
    }
    if (!validKg(kg)) return null;
    const out = { proto: "SIG-2A9C", kg: round2(kg), locked: true };
    if (fatPct > 2 && fatPct < 75) out.fat = round1(fatPct);
    if (imp && imp >= 100 && imp <= 1500) out.imp = imp;
    if (musclePct && musclePct > 10 && musclePct < 80) out.muscle = musclePct;
    if (waterKg && waterKg > 10 && waterKg < kg) out.water = round1((waterKg / kg) * 100);
    if (bmr && bmr > 500 && bmr < 5000) out.bmr = bmr;
    return out;
  }

  // 3. Chipsea-BLE GATT (0xFFF0 / 0xFFF1 / 0xFFF2 — OKOK International)
  function decodeChipseaWeight(hi, lo, prop) {
    const unit = (prop >> 3) & 0x03;
    if (unit === 3) {
      const pounds = (hi & 0xff) * 14 + (lo & 0xff) / 10;
      return pounds * LB_TO_KG;
    }
    const raw = ((hi & 0xff) << 8) | (lo & 0xff);
    const div = ((prop >> 1) & 0x03) === 1 ? 1 : ((prop >> 1) & 0x03) === 2 ? 100 : 10;
    const val = raw / div;
    if (unit === 1) return val * JIN_TO_KG;
    if (unit === 2) return val * LB_TO_KG;
    return val;
  }

  function buildChipseaUserSync({ userId = 1, isMale = true, age = 30, heightCm = 175, now = new Date() } = {}) {
    const f = new Uint8Array(20);
    f[0] = 0xca; f[1] = 0x10; f[2] = 14; f[3] = 1;
    f[4] = now.getFullYear() % 100;
    f[5] = now.getMonth() + 1;
    f[6] = now.getDate();
    f[7] = now.getHours();
    f[8] = now.getMinutes();
    f[9] = now.getSeconds();
    f[10] = (userId >>> 24) & 0xff;
    f[11] = (userId >>> 16) & 0xff;
    f[12] = (userId >>> 8) & 0xff;
    f[13] = userId & 0xff;
    f[14] = isMale ? 1 : 0;
    f[15] = Math.max(10, Math.min(99, Math.round(age)));
    f[16] = Math.max(80, Math.min(250, Math.round(heightCm)));
    let xor = 0;
    for (let i = 1; i <= 16; i++) xor ^= f[i];
    f[17] = xor & 0xff;
    return f;
  }

  function parseChipseaFrame(raw, state = {}) {
    const b = toBytes(raw);
    if (b.length < 7 || b[0] !== 0xca) return null;
    const cls = b[1];
    if (cls === 0x10) {
      const prop = b[4];
      const locked = (prop & 0x01) !== 0;
      const kg = decodeChipseaWeight(b[5], b[6], prop);
      if (!validKg(kg)) return null;
      const out = { proto: "Chipsea-10", kg: round2(kg), locked };
      if (locked && b.length >= 18) {
        const fat = u16be(b, 7) / 10;
        const water = u16be(b, 9) / 10;
        const muscle = u16be(b, 11) / 10;
        const bmr = u16be(b, 13);
        const visceral = u16be(b, 15) / 10;
        const bone = u8(b, 17) / 10;
        if (fat > 2 && fat < 75) out.fat = round1(fat);
        if (water > 20 && water < 85) out.water = round1(water);
        if (muscle > 10 && muscle < 85) out.muscle = round1(muscle);
        if (bmr > 500 && bmr < 5000) out.bmr = bmr;
        if (visceral > 0 && visceral < 60) out.visceral = round1(visceral);
        if (bone > 0.5 && bone < 10) out.bone = round1(bone);
      }
      return out;
    }
    if (cls === 0x11) {
      const sub = b[3];
      if ((sub === 0 || sub === 1) && b.length >= 12) {
        const kg = decodeChipseaWeight(b[5], b[6], b[11]);
        if (!validKg(kg)) return null;
        return { proto: "Chipsea-11", kg: round2(kg), locked: sub === 1 };
      }
      if (sub === 18 || sub === 19) {
        const len = u8(b, 2) - 2;
        if (len < 0 || b.length < 5 + len) return null;
        const idx = u8(b, 4) >>> 4;
        const tot = u8(b, 4) & 0x0f;
        if (!tot || !idx || idx > tot) return null;
        const key = sub === 18 ? "csLive" : "csHist";
        if (!state[key] || idx === 1) state[key] = {};
        state[key][idx] = b.slice(5, 5 + len);
        if (idx !== tot) return null;
        for (let i = 1; i <= tot; i++) if (!state[key][i]) { state[key] = {}; return null; }
        let totalLen = 0;
        for (let i = 1; i <= tot; i++) totalLen += state[key][i].length;
        const p = new Uint8Array(totalLen);
        let off = 0;
        for (let i = 1; i <= tot; i++) { p.set(state[key][i], off); off += state[key][i].length; }
        state[key] = {};
        if (p.length < 23) return null;
        const prop = p[4];
        const locked = (prop & 0x01) !== 0;
        const kg = decodeChipseaWeight(p[10], p[11], prop);
        if (!validKg(kg)) return null;
        const out = { proto: "Chipsea-11M", kg: round2(kg), locked };
        if (locked) {
          const fat = u16be(p, 12) / 10;
          const water = u16be(p, 14) / 10;
          const muscle = u16be(p, 16) / 10;
          const bmr = u16be(p, 18);
          const visceral = u16be(p, 20) / 10;
          const bone = u8(p, 22) / 10;
          if (fat > 2 && fat < 75) out.fat = round1(fat);
          if (water > 20 && water < 85) out.water = round1(water);
          if (muscle > 10 && muscle < 85) out.muscle = round1(muscle);
          if (bmr > 500 && bmr < 5000) out.bmr = bmr;
          if (visceral > 0 && visceral < 60) out.visceral = round1(visceral);
          if (bone > 0.5 && bone < 10) out.bone = round1(bone);
        }
        return out;
      }
    }
    return null;
  }

  // 4. MGB / Icomon / SWAN / AIFit (0xFFB0 / 0xFFB1 write / 0xFFB2 notify)
  function buildMgbInitPackets({ isMale = true, age = 30, heightCm = 175, now = new Date() } = {}) {
    const mk = (b2, b3, b4, b5) => {
      const f = new Uint8Array(8);
      f[0] = 0xac; f[1] = 0x02;
      f[2] = b2 & 0xff; f[3] = b3 & 0xff; f[4] = b4 & 0xff; f[5] = b5 & 0xff;
      f[6] = 0xcc;
      f[7] = (f[2] + f[3] + f[4] + f[5] + f[6]) & 0xff;
      return f;
    };
    return [
      mk(0xf7, 0, 0, 0),
      mk(0xfa, 0, 0, 0),
      mk(0xfb, isMale ? 1 : 2, Math.max(10, Math.min(99, Math.round(age))), Math.max(80, Math.min(250, Math.round(heightCm)))),
      mk(0xfd, Math.max(0, now.getFullYear() - 2000), now.getMonth() + 1, now.getDate()),
      mk(0xfc, now.getHours(), now.getMinutes(), now.getSeconds()),
      mk(0xfe, 6, 0, 0) // KG = 0, LB = 1, ST = 2
    ];
  }

  function parseMgbFrame(raw, state = {}) {
    const b = toBytes(raw);
    // Streaming 8-byte: AC 02 b2 b3 b4 b5 flag chk
    if (b.length === 8 && b[0] === 0xac && b[1] === 0x02) {
      const sum = (b[2] + b[3] + b[4] + b[5] + b[6]) & 0xff;
      if (sum !== b[7]) return null;
      const flag = b[6];
      if ((flag === 0xce || flag === 0xca) && b[4] === 0 && b[5] === 0) {
        const rawW = u16be(b, 2);
        // SWAN/Femmto manda décimas de kg (ej. 985 -> 98.5 kg); otras variantes MGB mandan centésimas (ej. 9910 -> 99.10 kg)
        const kg = rawW >= 2500 ? rawW / 100 : rawW / 10;
        if (!validKg(kg)) return null;
        if (flag === 0xca) state.mgbKg = round2(kg);
        return { proto: "MGB-8", kg: round2(kg), locked: flag === 0xca, imp: state.mgbImp || null };
      }
      if (flag === 0xcb && b[2] === 0xfd && b[3] === 0x01) {
        const imp = u16be(b, 4);
        if (imp >= 100 && imp <= 1500) {
          state.mgbImp = imp;
          if (state.mgbKg) return { proto: "MGB-8", kg: state.mgbKg, locked: true, imp };
          return { proto: "MGB-8", impOnly: true, imp };
        }
      }
      return null;
    }
    // Composite 20-byte: part 1 (AC 02|03 FF ...) + part 2 (01 00 ...)
    if (b.length === 20) {
      if (b[0] === 0xac && (b[1] === 0x02 || b[1] === 0x03) && b[2] === 0xff) {
        const kg = u16be(b, 12) / 10;
        const fat = u16be(b, 16) / 10;
        if (!validKg(kg)) return null;
        state.mgbPart1 = { proto: "MGB-20", kg: round2(kg), locked: true };
        if (fat > 2 && fat < 75) state.mgbPart1.fat = round1(fat);
        return { ...state.mgbPart1 };
      }
      if (b[0] === 0x01 && b[1] === 0x00 && state.mgbPart1) {
        const m = { ...state.mgbPart1 };
        const muscle = u16le(b, 2) / 10;
        const bone = u16le(b, 6) / 10;
        const water = u16le(b, 8) / 10;
        if (muscle > 10 && muscle < 85) m.muscle = round1(muscle);
        if (bone > 0.5 && bone < 10) m.bone = round1(bone);
        if (water > 20 && water < 85) m.water = round1(water);
        state.mgbPart1 = null;
        return m;
      }
    }
    return null;
  }

  // 5. QN / Yolanda / Renpho (0xFFE0 / 0xFFE1 y 0xFFF0 / 0xFFF1)
  function parseQnFrame(raw, state = {}) {
    const b = toBytes(raw);
    if (b.length < 6) return null;
    // Frame 0x12 comunica factor de escala (byte 10: 1 -> /100, 2 -> /10)
    if (b[0] === 0x12 && b.length >= 11) {
      state.qnScale = b[10] === 2 ? 10 : 100;
      return null;
    }
    // Frame 0x10: peso en vivo / estable + resistencias r1, r2
    if (b[0] === 0x10 && b.length >= 6) {
      const rawW = u16be(b, 3);
      if (!rawW) return null;
      const scale = state.qnScale || (rawW > 2500 ? 100 : 10);
      const kg = rawW / scale;
      if (!validKg(kg)) return null;
      const locked = b[5] === 1;
      const out = { proto: "QN", kg: round2(kg), locked };
      if (locked && b.length >= 10) {
        const r1 = u16be(b, 6);
        if (r1 >= 150 && r1 <= 1500) out.imp = r1;
      }
      return out;
    }
    return null;
  }

  // ==================== PARSERS BLE (BROADCAST / ADVERTISEMENTS) ====================

  // 6. OKOK Broadcast (V20, V11, VF0, C0)
  function parseOkOkAdv(companyId, raw) {
    const b = toBytes(raw);
    // OKOK V20 (0x20CA): 19 bytes
    if (companyId === 0x20ca && b.length === 19) {
      let chk = 0x20;
      for (let i = 0; i < 12; i++) chk ^= b[i];
      if ((chk & 0xff) !== b[12]) return null;
      const locked = (b[6] & 0x01) !== 0;
      const div = (b[6] & 0x04) !== 0 ? 100 : 10;
      const kg = u16be(b, 8) / div;
      if (!validKg(kg)) return null;
      const imp = u16be(b, 10) / 10;
      const out = { proto: "OKOK-V20", kg: round2(kg), locked };
      if (locked && imp >= 100 && imp <= 1500) out.imp = round1(imp);
      return out;
    }
    // OKOK V11 (0x11CA): 23 bytes
    if (companyId === 0x11ca && b.length === 23) {
      let chk = 0xca ^ 0x11;
      for (let i = 0; i < 16; i++) chk ^= b[i];
      if ((chk & 0xff) !== b[16]) return null;
      const props = b[9];
      const divCode = (props >> 1) & 0x03;
      const div = divCode === 1 ? 1 : divCode === 2 ? 100 : 10;
      const unit = (props >> 3) & 0x03;
      const w = u16be(b, 3);
      let kg;
      if (unit === 0) kg = w / div;
      else if (unit === 1) kg = w / (div * 2);
      else if (unit === 2) kg = (w / div) * LB_TO_KG;
      else kg = (w >> 8) * ST_TO_KG + ((w & 0xff) / div) * LB_TO_KG;
      if (!validKg(kg)) return null;
      return { proto: "OKOK-V11", kg: round2(kg), locked: true };
    }
    // OKOK VF0 (0xF0FF)
    if (companyId === 0xf0ff && b.length >= 4) {
      const kg = u16be(b, 2) / 10;
      const kgSwap = (((b[3] & 0xff) << 8) | (b[2] & 0xff)) / 10;
      const picked = validKg(kgSwap) ? kgSwap : validKg(kg) ? kg : null;
      if (!picked) return null;
      return { proto: "OKOK-VF0", kg: round2(picked), locked: true };
    }
    // OKOK C0 (low byte of companyId == 0xC0)
    if ((companyId & 0xff) === 0xc0 && b.length >= 13) {
      const attr = b[6];
      const locked = (attr & 0x01) !== 0;
      const divCode = (attr >> 1) & 0x03;
      const div = divCode === 1 ? 1 : divCode === 2 ? 100 : 10;
      const unit = (attr >> 3) & 0x03;
      let kg;
      if (unit === 3) kg = b[0] * ST_TO_KG + (b[1] / div) * LB_TO_KG;
      else {
        const w = u16be(b, 0) / div;
        kg = unit === 1 ? w / 2 : unit === 2 ? w * LB_TO_KG : w;
      }
      if (!validKg(kg)) return null;
      const imp = u16be(b, 2) / 10;
      const out = { proto: "OKOK-C0", kg: round2(kg), locked };
      if (locked && imp >= 100 && imp <= 1500) out.imp = round1(imp);
      return out;
    }
    return null;
  }

  // 7. AAAx Broadcast (AAA002 / AAA007 / AAA013 / AAA07A)
  function parseAaaxAdv(companyId, raw) {
    const b = toBytes(raw);
    if (b.length < 12) return null;
    const key = (companyId >>> 8) & 0xff;
    const p = new Uint8Array(6);
    for (let i = 0; i < 6; i++) p[i] = b[6 + i] ^ key;
    const sum = (p[0] + p[1] + p[2] + p[3] + p[4]) & 0x1f;
    if (sum !== (p[5] & 0x1f)) return null;
    if (p[4] === 0xad) {
      const val = u32be(p, 0);
      const locked = (val >>> 31) === 1;
      const grams = val & 0x3ffff;
      const kg = grams / 1000;
      if (!validKg(kg)) return null;
      return { proto: "AAAx", kg: round2(kg), locked };
    }
    return null;
  }

  // 8. Xiaomi Mi Scale v1 (0x181D) / v2 (0x181B) Service Data
  function parseXiaomiServiceData(uuid16, raw) {
    const b = toBytes(raw);
    if (uuid16 === 0x181b && b.length >= 13) {
      const c0 = b[0], c1 = b[1];
      const locked = (c1 & 0x20) !== 0;
      const removed = (c1 & 0x80) !== 0;
      if (removed) return null;
      const isCatty = (c1 & 0x40) !== 0;
      const isLb = (c0 & 0x01) !== 0;
      const w = u16le(b, 11);
      const kg = isLb ? (w / 100) * LB_TO_KG : isCatty ? (w / 100) * JIN_TO_KG : w / 200;
      if (!validKg(kg)) return null;
      const out = { proto: "MiScale2", kg: round2(kg), locked };
      if ((c1 & 0x02) !== 0) {
        const imp = u16le(b, 9);
        if (imp >= 100 && imp <= 1500) out.imp = imp;
      }
      return out;
    }
    if (uuid16 === 0x181d && b.length >= 3) {
      const c0 = b[0];
      const locked = (c0 & 0x20) !== 0;
      if ((c0 & 0x80) !== 0) return null;
      const w = u16le(b, 1);
      const kg = (c0 & 0x01) ? (w / 100) * LB_TO_KG : (c0 & 0x10) ? (w / 100) * JIN_TO_KG : w / 200;
      if (!validKg(kg)) return null;
      return { proto: "MiScale1", kg: round2(kg), locked };
    }
    return null;
  }

  // Despachadores unificados
  function parseGattNotification(uuid16, raw, state = {}) {
    if (uuid16 === 0x2a9d) return parseWeightScaleSig(raw);
    if (uuid16 === 0x2a9c) return parseBodyCompSig(raw);
    if (uuid16 === 0xffb2) return parseMgbFrame(raw, state);
    if (uuid16 === 0xfff1 || uuid16 === 0xfff4) {
      return parseChipseaFrame(raw, state) || parseQnFrame(raw, state) || parseMgbFrame(raw, state);
    }
    if (uuid16 === 0xffe1 || uuid16 === 0xffe2) {
      return parseQnFrame(raw, state) || parseChipseaFrame(raw, state) || parseMgbFrame(raw, state);
    }
    // Fallback genérico en características desconocidas
    return parseChipseaFrame(raw, state) || parseMgbFrame(raw, state) || parseQnFrame(raw, state);
  }

  function parseAdvertisement({ manufacturerData, serviceData } = {}) {
    if (manufacturerData) {
      for (const [cid, data] of manufacturerData) {
        const r = parseOkOkAdv(cid, data) || parseAaaxAdv(cid, data);
        if (r) return r;
      }
    }
    if (serviceData) {
      for (const [uuid, data] of serviceData) {
        const id16 = typeof uuid === "number" ? uuid : parseInt(String(uuid).slice(4, 8), 16);
        const r = parseXiaomiServiceData(id16, data);
        if (r) return r;
      }
    }
    return null;
  }

  // ==================== COMPOSICIÓN CORPORAL (BIA CIENTÍFICA) ====================

  const bmi = (kg, cm) => (kg > 0 && cm > 0) ? round1(kg / Math.pow(cm / 100, 2)) : 0;

  function bmiLabel(b) {
    if (!b) return "";
    if (b < 18.5) return "Bajo peso";
    if (b < 25) return "Saludable";
    if (b < 30) return "Sobrepeso";
    return "Obesidad";
  }

  // Mifflin-St Jeor (cuando no hay impedancia)
  function bmrMifflin(kg, cm, age, sex) {
    if (!(kg > 0)) return 0;
    const s = sex === "m" ? 5 : sex === "f" ? -161 : -78;
    return Math.round(10 * kg + 6.25 * (cm || 175) - 5 * (age || 30) + s);
  }

  // Sun SS et al. (2003) + Janssen et al. + Katch-McArdle (mismo modelo que openScale StandardImpedanceLib)
  function biaMetrics({ kg, cm, age, sex, imp }) {
    if (!(kg >= 25 && cm >= 100 && imp >= 200 && imp <= 1200)) return null;
    const male = sex !== "f";
    const g = male ? 1 : 0;
    const h2r = (cm * cm) / imp;
    const ffm = male
      ? (-10.68 + 0.65 * h2r + 0.26 * kg + 0.02 * imp)
      : (-9.53 + 0.69 * h2r + 0.17 * kg + 0.02 * imp);
    const ffmClamped = Math.max(kg * 0.4, Math.min(kg * 0.96, ffm));
    const fatPct = Math.max(4, Math.min(60, (1 - ffmClamped / kg) * 100));
    const fatKg = kg * (fatPct / 100);
    const tbwL = male
      ? (1.2 + 0.45 * h2r + 0.18 * kg)
      : (3.75 + 0.45 * h2r + 0.11 * kg);
    const waterKg = Math.max(kg * 0.3, Math.min(kg * 0.78, 0.99513 * tbwL));
    const waterPct = (waterKg / kg) * 100;
    const smmKg = Math.max(kg * 0.18, Math.min(ffmClamped * 0.72, 0.401 * h2r + 3.825 * g - 0.071 * (age || 30) + 5.102));
    const musclePct = (smmKg / kg) * 100;
    const boneKg = (male ? 0.057 : 0.05) * ffmClamped;
    const bmr = Math.round(ffmClamped * 21.6 + 370);
    return {
      ffmKg: round1(ffmClamped),
      fatPct: round1(fatPct),
      fatKg: round1(fatKg),
      waterPct: round1(waterPct),
      waterKg: round1(waterKg),
      musclePct: round1(musclePct),
      muscleKg: round1(smmKg),
      boneKg: round1(boneKg),
      bmr
    };
  }

  // ==================== FECHAS Y ANALÍTICA DE PESO ====================

  const dayStart = d => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  function weekStart(d) {
    const x = dayStart(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function dayKey(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  function keyToDate(k) {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const avg = arr => arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : null;

  // Agrupa todos los pesajes por día: promedio diario, mín/máx, amplitud, impedancia y grasa promedio.
  function dailySeries(entries) {
    const map = new Map();
    const sorted = [...(entries || [])].filter(e => e && validKg(e.kg)).sort((a, b) => a.t - b.t);
    for (const e of sorted) {
      const k = dayKey(e.t);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    const days = [];
    for (const [key, list] of map.entries()) {
      const kgs = list.map(e => e.kg);
      const imps = list.map(e => e.imp).filter(v => v >= 200 && v <= 1200);
      const fats = list.map(e => e.fat).filter(v => v > 2 && v < 75);
      const waters = list.map(e => e.water).filter(v => v > 20 && v < 85);
      const muscles = list.map(e => e.muscle).filter(v => v > 10 && v < 85);
      const d = keyToDate(key);
      const min = Math.min(...kgs), max = Math.max(...kgs);
      days.push({
        key,
        ts: d.getTime(),
        avg: round2(avg(kgs)),
        min: round2(min),
        max: round2(max),
        spread: round2(max - min),
        count: list.length,
        first: list[0],
        last: list[list.length - 1],
        impAvg: imps.length ? round1(avg(imps)) : null,
        fatAvg: fats.length ? round1(avg(fats)) : null,
        waterAvg: waters.length ? round1(avg(waters)) : null,
        muscleAvg: muscles.length ? round1(avg(muscles)) : null,
        entries: list
      });
    }
    return days.sort((a, b) => a.ts - b.ts);
  }

  // Tendencia EWMA (suavizada para filtrar fluctuaciones diarias de agua/comida).
  function addTrend(days, alpha = 0.2) {
    if (!days.length) return [];
    let tr = days[0].avg;
    let prevTs = days[0].ts;
    return days.map((d, i) => {
      if (i > 0) {
        const gap = Math.max(1, Math.round((d.ts - prevTs) / 864e5));
        const a = 1 - Math.pow(1 - alpha, Math.min(gap, 7));
        tr = tr + a * (d.avg - tr);
        prevTs = d.ts;
      }
      return { ...d, trend: round2(tr) };
    });
  }

  // Promedios semanales = promedio de los promedios diarios (así pesarte 5 veces un día no sesga la semana).
  function weeklySeries(days) {
    const map = new Map();
    for (const d of days) {
      const ws = weekStart(d.ts);
      const wk = dayKey(ws.getTime());
      if (!map.has(wk)) map.set(wk, { key: wk, startTs: ws.getTime(), days: [] });
      map.get(wk).days.push(d);
    }
    const weeks = [...map.values()].sort((a, b) => a.startTs - b.startTs).map(w => {
      const avgs = w.days.map(d => d.avg);
      const imps = w.days.map(d => d.impAvg).filter(v => v != null);
      const fats = w.days.map(d => d.fatAvg).filter(v => v != null);
      return {
        key: w.key,
        startTs: w.startTs,
        endTs: addDays(w.startTs, 6).getTime(),
        avg: round2(avg(avgs)),
        min: round2(Math.min(...w.days.map(d => d.min))),
        max: round2(Math.max(...w.days.map(d => d.max))),
        daysCount: w.days.length,
        weighIns: w.days.reduce((a, d) => a + d.count, 0),
        impAvg: imps.length ? round1(avg(imps)) : null,
        fatAvg: fats.length ? round1(avg(fats)) : null
      };
    });
    for (let i = 0; i < weeks.length; i++) {
      weeks[i].delta = i > 0 ? round2(weeks[i].avg - weeks[i - 1].avg) : null;
    }
    return weeks;
  }

  // Fluctuación dentro del mismo día (mañana vs noche y amplitud típica).
  function intradayStats(entries) {
    const days = dailySeries(entries);
    const multi = days.filter(d => d.count >= 2);
    const avgSpread = multi.length ? round2(avg(multi.map(d => d.spread))) : null;
    const diffs = [];
    for (const d of multi) {
      const am = d.entries.filter(e => { const h = new Date(e.t).getHours(); return h >= 4 && h < 12; });
      const pm = d.entries.filter(e => { const h = new Date(e.t).getHours(); return h >= 17 && h <= 23; });
      if (am.length && pm.length) diffs.push(avg(pm.map(e => e.kg)) - avg(am.map(e => e.kg)));
    }
    return {
      multiDays: multi.length,
      avgSpread,
      pmMinusAm: diffs.length ? round2(avg(diffs)) : null
    };
  }

  // Resumen ejecutivo: hoy, promedio 7d vs 7d previos, ritmo semanal y racha.
  function summary(entries, now = new Date()) {
    const rawDays = dailySeries(entries);
    const days = addTrend(rawDays);
    const weeks = weeklySeries(days);
    const todayK = dayKey(now.getTime());
    const today = days.find(d => d.key === todayK) || null;
    const lastDay = days[days.length - 1] || null;
    const todayTs = dayStart(now).getTime();
    const d7From = todayTs - 6 * 864e5;
    const d14From = todayTs - 13 * 864e5;
    const last7 = days.filter(d => d.ts >= d7From && d.ts <= todayTs);
    const prev7 = days.filter(d => d.ts >= d14From && d.ts < d7From);
    const avg7 = last7.length ? round2(avg(last7.map(d => d.avg))) : null;
    const prevAvg7 = prev7.length ? round2(avg(prev7.map(d => d.avg))) : null;
    const delta7 = (avg7 != null && prevAvg7 != null) ? round2(avg7 - prevAvg7) : null;

    // Ritmo semanal (kg/semana) basado en tendencia de los últimos 28 días si hay >= 2 días con >= 4 días de separación
    let ratePerWeek = null;
    const d28 = days.filter(d => d.ts >= todayTs - 28 * 864e5);
    if (d28.length >= 2) {
      const spanDays = (d28[d28.length - 1].ts - d28[0].ts) / 864e5;
      if (spanDays >= 4) {
        ratePerWeek = round2(((d28[d28.length - 1].trend - d28[0].trend) / spanDays) * 7);
      }
    }

    // Racha de días consecutivos pesándose
    const daySet = new Set(days.map(d => d.key));
    let cur = dayStart(now);
    if (!daySet.has(dayKey(cur.getTime()))) cur = addDays(cur, -1);
    let streak = 0;
    while (daySet.has(dayKey(cur.getTime()))) { streak++; cur = addDays(cur, -1); }

    return {
      days,
      weeks,
      today,
      lastDay,
      currentTrend: lastDay ? lastDay.trend : null,
      avg7,
      prevAvg7,
      delta7,
      ratePerWeek,
      streak,
      intraday: intradayStats(entries)
    };
  }

  // Merge bidireccional seguro entre dispositivos (Android <-> PC) usando IDs + tombstones.
  function mergeEntries(localEntries = [], remoteEntries = [], localDeleted = {}, remoteDeleted = {}) {
    const deleted = { ...localDeleted };
    for (const [id, ts] of Object.entries(remoteDeleted || {})) {
      if (!deleted[id] || ts > deleted[id]) deleted[id] = ts;
    }
    const map = new Map();
    for (const list of [localEntries, remoteEntries]) {
      for (const e of (list || [])) {
        if (!e || !e.id || !validKg(e.kg)) continue;
        const delTs = deleted[e.id] || 0;
        const updTs = e.upd || e.t || 0;
        if (delTs >= updTs) continue;
        const cur = map.get(e.id);
        if (!cur || updTs > (cur.upd || cur.t || 0)) map.set(e.id, e);
      }
    }
    const entries = [...map.values()].sort((a, b) => b.t - a.t);
    return { entries, deleted };
  }

  function toCsv(entries) {
    const head = "fecha,hora,peso_kg,impedancia_ohm,grasa_pct,agua_pct,musculo_pct,hueso_kg,bmr_kcal,fuente,protocolo,nota";
    const rows = [...(entries || [])].sort((a, b) => a.t - b.t).map(e => {
      const d = new Date(e.t);
      const fecha = dayKey(e.t);
      const hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const note = (e.note || "").replace(/"/g, '""');
      return [
        fecha, hora, e.kg, e.imp ?? "", e.fat ?? "", e.water ?? "", e.muscle ?? "", e.bone ?? "", e.bmr ?? "",
        e.source || "manual", e.proto || "", note ? `"${note}"` : ""
      ].join(",");
    });
    return [head, ...rows].join("\n");
  }

  const api = {
    hex, toBytes, round1, round2, validKg,
    parseWeightScaleSig, parseBodyCompSig,
    buildChipseaUserSync, parseChipseaFrame,
    buildMgbInitPackets, parseMgbFrame,
    parseQnFrame,
    parseOkOkAdv, parseAaaxAdv, parseXiaomiServiceData,
    parseGattNotification, parseAdvertisement,
    bmi, bmiLabel, bmrMifflin, biaMetrics,
    dayStart, addDays, weekStart, dayKey, keyToDate,
    dailySeries, addTrend, weeklySeries, intradayStats, summary,
    mergeEntries, toCsv
  };

  if (typeof module !== "undefined") module.exports = api;
  else root.BalanzaCore = api;
})(this);
