// Motor Web Bluetooth multiprotocolo para balanzas inteligentes (Femmto B02 / AIFit / OKOK / Chipsea / Icomon / QN / SIG).
// Soporta conexión GATT nativa + escaneo pasivo de advertisements (si el navegador soporta requestLEScan / watchAdvertisements)
// + modo diagnóstico completo que captura servicios, características y tramas hex crudas.
class ScaleBLE extends EventTarget {
  constructor() {
    super();
    this.state = "off"; // off | connecting | scanning | on
    this.mode = null;   // gatt | broadcast
    this.device = null;
    this.server = null;
    this.scan = null;
    this.protoState = {};
    this.logs = [];
    this.rawPackets = [];
    this.lastReading = null;
    this.profile = { isMale: true, age: 30, heightCm: 175 };
    this._onAdv = e => this.handleAdvertisement(e);
  }

  // Servicios más comunes en balanzas OEM chinas + Bluetooth SIG estándar
  static OPTIONAL_SERVICES = [
    0x181d, // Weight Scale (SIG)
    0x181b, // Body Composition (SIG)
    0x180a, // Device Information
    0x180f, // Battery
    0xffb0, // MGB / Icomon / SWAN / AIFit
    0xfff0, // Chipsea-BLE / QN Type 2 / OKOK GATT
    0xffe0, // QN Type 1 / Yolanda / AiLink
    0xff00, // Genérico OEM
    0xfe95, // Xiaomi
    0xfee0, // Variantes OEM
    0xf0a0, // Elink / AiLink
    0xae00, // QN nuevo
    0x1810  // Blood Pressure / multi-health
  ];

  get supported() { return !!(navigator.bluetooth); }
  get canScan() { return !!(navigator.bluetooth && navigator.bluetooth.requestLEScan); }
  get active() { return this.state === "on" || this.state === "scanning"; }
  get name() { return (this.device && this.device.name) || "Femmto B02"; }

  setProfile(p) {
    if (!p) return;
    this.profile = {
      isMale: p.sex !== "f",
      age: p.age || 30,
      heightCm: p.height || 175
    };
  }

  log(msg) {
    const t = new Date().toLocaleTimeString("es-AR", { hour12: false });
    const line = `${t}  ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 150) this.logs.shift();
    this.dispatchEvent(new CustomEvent("log", { detail: line }));
  }

  recordPacket(source, hexStr) {
    const key = `${source}:${hexStr}`;
    const last = this.rawPackets[this.rawPackets.length - 1];
    if (last && last.key === key && Date.now() - last.t < 800) return;
    this.rawPackets.push({ t: Date.now(), key, source, hex: hexStr });
    if (this.rawPackets.length > 60) this.rawPackets.shift();
  }

  // Selector de dispositivo + conexión GATT (funciona out-of-the-box en Chrome Android)
  async pickAndConnect() {
    if (!this.supported) {
      this.log("✗ navigator.bluetooth no existe en este navegador");
      throw new Error("Este navegador no soporta Web Bluetooth. Abrí la app en Chrome para Android.");
    }
    await this.stop();
    this.protoState = {};
    this.lastReading = null;
    this.log("Abriendo selector Bluetooth (todos los dispositivos)...");
    try {
      const d = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ScaleBLE.OPTIONAL_SERVICES
      });
      this.log(`Elegiste: "${d.name || "(sin nombre)"}" [${d.id}]`);
      this.useDevice(d);
      await this.connectGatt();
    } catch (e) {
      this.log(`✗ Selector/GATT (${e.name || "Error"}): ${e.message || e}`);
      this.set("off");
      throw e;
    }
  }

  // Reconecta sin volver a abrir el selector si Chrome ya recuerda la balanza
  async reconnectKnown(preferredName) {
    try {
      if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return false;
      const list = await navigator.bluetooth.getDevices();
      if (!list.length) return false;
      const d = (preferredName && list.find(x => x.name === preferredName)) || list[0];
      this.useDevice(d);
      await Promise.race([
        this.connectGatt(),
        new Promise((_, no) => setTimeout(() => no(new Error("Tiempo agotado (subite a la balanza para despertarla)")), 7000))
      ]);
      return true;
    } catch (e) {
      this.log(`Reconexión rápida falló: ${e.message}`);
      this.set("off");
      return false;
    }
  }

  async hasKnown() {
    try {
      return !!(navigator.bluetooth && navigator.bluetooth.getDevices && (await navigator.bluetooth.getDevices()).length);
    } catch (e) { return false; }
  }

  useDevice(d) {
    if (this.device === d) return;
    this.device = d;
    d.addEventListener("gattserverdisconnected", () => {
      this.log("Balanza desconectada");
      if (this.mode === "gatt") this.set("off");
    });
  }

  async connectGatt() {
    this.mode = "gatt";
    this.set("connecting");
    this.log(`Conectando GATT a "${this.device.name || "(sin nombre)"}" [${this.device.id}]...`);

    // En paralelo: si watchAdvertisements existe, también escuchamos advertisements por si es broadcast-only
    if (typeof this.device.watchAdvertisements === "function") {
      try {
        this.device.removeEventListener("advertisementreceived", this._onAdv);
        this.device.addEventListener("advertisementreceived", this._onAdv);
        this.device.watchAdvertisements().catch(() => {});
        this.log("watchAdvertisements() activado en paralelo");
      } catch (e) {}
    }

    const server = await this.device.gatt.connect();
    this.server = server;
    const services = await server.getPrimaryServices();
    this.log(`Conectada · ${services.length} servicio(s) encontrados`);

    let subscribed = 0;
    const writeTargets = {};

    for (const svc of services) {
      const sShort = shortUuid(svc.uuid);
      let chars = [];
      try { chars = await svc.getCharacteristics(); } catch (e) {
        this.log(`  svc ${sShort}: error al listar (${e.message})`);
        continue;
      }
      const cDesc = chars.map(c => `${shortUuid(c.uuid)}[${propsStr(c.properties)}]`).join(", ");
      this.log(`  svc ${sShort}: ${cDesc}`);

      for (const ch of chars) {
        const cShort = shortUuid(ch.uuid);
        const cNum = parseInt(cShort, 16);
        if (ch.properties.write || ch.properties.writeWithoutResponse) {
          writeTargets[cShort] = ch;
        }
        if (ch.properties.notify || ch.properties.indicate) {
          try {
            ch.addEventListener("characteristicvaluechanged", e => this.onNotify(cShort, cNum, e.target.value));
            await ch.startNotifications();
            subscribed++;
          } catch (e) {
            this.log(`  ✗ notify ${cShort}: ${e.message}`);
          }
        }
      }
    }

    this.log(`Suscripto a ${subscribed} característica(s)`);
    await this.sendProtocolHandshakes(writeTargets);
    this.set("on");
  }

  // Envía handshakes seguros según las características descubiertas (MGB 0xFFB1, Chipsea 0xFFF2)
  async sendProtocolHandshakes(targets) {
    const C = BalanzaCore;
    if (targets["ffb1"]) {
      this.log("Detectado servicio MGB/Icomon (FFB1) → enviando init + perfil");
      const pkts = C.buildMgbInitPackets(this.profile);
      for (const p of pkts) {
        try {
          await writeChar(targets["ffb1"], p);
          this.log(`  → FFB1 ${C.hex(p)}`);
          await delay(90);
        } catch (e) {
          this.log(`  ✗ FFB1 write: ${e.message}`);
          break;
        }
      }
    }
    if (targets["fff2"]) {
      const name = (this.device && this.device.name || "").toLowerCase();
      // Solo enviamos userSync Chipsea si es Chipsea/OKOK/sin nombre (para no confundir QN)
      if (!name.includes("qn-") && !name.includes("renpho")) {
        const sync = C.buildChipseaUserSync(this.profile);
        try {
          await writeChar(targets["fff2"], sync);
          this.log(`  → FFF2 Chipsea sync ${C.hex(sync)}`);
        } catch (e) {
          this.log(`  ✗ FFF2 write: ${e.message}`);
        }
      }
    }
  }

  onNotify(cShort, cNum, dv) {
    const C = BalanzaCore;
    const h = C.hex(dv);
    this.recordPacket(`GATT:${cShort}`, h);
    this.log(`← [${cShort}] ${h}`);
    const parsed = C.parseGattNotification(cNum, dv, this.protoState);
    if (parsed) this.emitReading(parsed);
  }

  // Escaneo pasivo de BLE Advertisements (para balanzas broadcast-only como OKOK C0 / V20 / AAAx)
  async startBroadcastScan() {
    if (!this.supported) {
      this.log("✗ navigator.bluetooth no disponible");
      throw new Error("Este navegador no soporta Web Bluetooth.");
    }
    if (!this.canScan) {
      this.log("✗ requestLEScan no disponible (falta flag chrome://flags/#enable-experimental-web-platform-features)");
      throw new Error("Activá chrome://flags/#enable-experimental-web-platform-features en Chrome Android para Broadcast.");
    }
    await this.stop();
    this.mode = "broadcast";
    this.protoState = {};
    this.lastReading = null;
    this._seenAdv = new Map();
    this.set("scanning");
    this.log("Iniciando escaneo pasivo de anuncios BLE (broadcast)...");
    try {
      navigator.bluetooth.removeEventListener("advertisementreceived", this._onAdv);
      navigator.bluetooth.addEventListener("advertisementreceived", this._onAdv);
      this.scan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
      this.log("Escuchando TODOS los anuncios BLE cercanos · subite a la balanza");
    } catch (e) {
      this.log(`✗ Broadcast (${e.name || "Error"}): ${e.message || e}`);
      this.set("off");
      throw e;
    }
  }

  handleAdvertisement(ev) {
    const C = BalanzaCore;
    const name = (ev.device && ev.device.name) || "";
    const devId = (ev.device && ev.device.id) || "?";
    const mEntries = [];
    const sEntries = [];
    if (ev.manufacturerData) {
      ev.manufacturerData.forEach((dv, cid) => mEntries.push([cid, C.toBytes(dv)]));
    }
    if (ev.serviceData) {
      ev.serviceData.forEach((dv, uuid) => sEntries.push([uuid, C.toBytes(dv)]));
    }

    const rssi = ev.rssi ?? -60;
    const hasPayload = mEntries.length > 0 || sEntries.length > 0 || !!name;
    // En modo broadcast registramos cualquier dispositivo cercano (RSSI >= -82) deduplicado por payload
    if (hasPayload && (rssi >= -82 || this.mode === "gatt")) {
      const mStr = mEntries.map(([cid, d]) => `M:${cid.toString(16).padStart(4, "0").toUpperCase()}=${C.hex(d)}`).join(" ");
      const sStr = sEntries.map(([u, d]) => `S:${shortUuid(u)}=${C.hex(d)}`).join(" ");
      const sig = `${devId}|${name}|${mStr}|${sStr}`;
      if (!this._seenAdv) this._seenAdv = new Map();
      const prevAt = this._seenAdv.get(sig) || 0;
      if (Date.now() - prevAt > 3000) {
        this._seenAdv.set(sig, Date.now());
        const summary = `ADV "${name || "?"}" rssi:${ev.rssi ?? "?"} ${mStr} ${sStr}`.trim();
        this.recordPacket("ADV", summary);
        this.log(summary);
      }
    }

    const parsed = C.parseAdvertisement({ manufacturerData: mEntries, serviceData: sEntries });
    if (parsed) {
      if (name && !this.device) this.device = ev.device;
      this.emitReading(parsed);
    }
  }

  emitReading(r) {
    if (r.bioState) {
      this.log(r.bioState === "measuring" ? "⚡ Midiendo bioimpedancia (quedate descalzo)..." : "ℹ Sin lectura de bioimpedancia (FD-FF)");
      this.dispatchEvent(new CustomEvent("biostate", { detail: r.bioState }));
      return;
    }
    if (r.impOnly) {
      this.log(`⚡ Impedancia recibida: ${r.imp} Ω`);
      this.dispatchEvent(new CustomEvent("impedance", { detail: r }));
      return;
    }
    this.lastReading = { ...r, at: Date.now() };
    this.log(`✓ ${r.proto}: ${r.kg} kg${r.imp ? ` · ${r.imp} Ω` : ""}${r.fat ? ` · ${r.fat}% grasa` : ""}${r.finalComplete ? " [COMPLETO]" : r.locked ? " [FIJO]" : " [midiendo]"}`);
    this.dispatchEvent(new CustomEvent("reading", { detail: this.lastReading }));
  }

  async stop() {
    if (this.scan) {
      try { this.scan.stop(); } catch (e) {}
      this.scan = null;
    }
    try { navigator.bluetooth && navigator.bluetooth.removeEventListener("advertisementreceived", this._onAdv); } catch (e) {}
    if (this.device) {
      try { this.device.removeEventListener("advertisementreceived", this._onAdv); } catch (e) {}
      try { if (this.device.gatt && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (e) {}
    }
    this.server = null;
    this.mode = null;
    this.set("off");
  }

  set(s) {
    if (this.state !== s) {
      this.state = s;
      this.dispatchEvent(new Event("state"));
    }
  }

  diagnosticText() {
    const dev = this.device ? `${this.device.name || "(sin nombre)"} [${this.device.id}]` : "ninguno";
    const env = `${navigator.userAgent}\nWebBT: ${this.supported} · requestLEScan: ${this.canScan} · getDevices: ${!!(navigator.bluetooth && navigator.bluetooth.getDevices)}`;
    return [
      `=== BALANZA BLE DIAG ===`,
      `Fecha: ${new Date().toISOString()}`,
      `Dispositivo: ${dev}`,
      `Modo: ${this.mode || "-"} · Estado: ${this.state}`,
      env,
      `--- Log (${this.logs.length}) ---`,
      ...this.logs
    ].join("\n");
  }
}

function shortUuid(u) {
  const s = String(u).toLowerCase();
  return s.endsWith("-0000-1000-8000-00805f9b34fb") ? s.slice(4, 8) : s;
}
function propsStr(p) {
  const a = [];
  if (p.read) a.push("R");
  if (p.write) a.push("W");
  if (p.writeWithoutResponse) a.push("Wn");
  if (p.notify) a.push("N");
  if (p.indicate) a.push("I");
  return a.join(",");
}
async function writeChar(ch, bytes) {
  if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) {
    return ch.writeValueWithoutResponse(bytes);
  }
  return ch.writeValueWithResponse ? ch.writeValueWithResponse(bytes) : ch.writeValue(bytes);
}
const delay = ms => new Promise(r => setTimeout(r, ms));
