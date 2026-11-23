// Google Cast (Chromecast) for the desktop app. Electron's Chromium has no Cast support,
// so this speaks the protocol itself: Cast devices are found over mDNS
// (_googlecast._tcp), and each is driven over its TLS control channel (port 8009) with
// length-prefixed protobuf CastMessages carrying JSON. Argent only launches a receiver
// app (Jellyfin's) and passes JSON between it and the page; the receiver fetches the
// media from the server itself.
//
// Plain Node (no Electron imports), so it can be tried from a script.

const dgram = require("node:dgram");
const os = require("node:os");
const tls = require("node:tls");
const { EventEmitter } = require("node:events");

const NS = {
  connection: "urn:x-cast:com.google.cast.tp.connection",
  heartbeat: "urn:x-cast:com.google.cast.tp.heartbeat",
  receiver: "urn:x-cast:com.google.cast.receiver",
};
const SENDER = "sender-argent";
const SERVICE = "_googlecast._tcp.local";

const events = new EventEmitter();

// ---- protobuf CastMessage -------------------------------------------------------------

function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

const field = (tag, value) => (Buffer.isBuffer(value) ? Buffer.concat([Buffer.from([tag]), varint(value.length), value]) : Buffer.from([tag, value]));

/** A framed CastMessage: 4-byte big-endian length, then the protobuf. */
function encode(source, destination, namespace, payload) {
  const body = Buffer.concat([
    field(0x08, 0), // protocol_version CASTV2_1_0
    field(0x12, Buffer.from(source)),
    field(0x1a, Buffer.from(destination)),
    field(0x22, Buffer.from(namespace)),
    field(0x28, 0), // payload_type STRING
    field(0x32, Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))),
  ]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

function decode(buf) {
  const msg = {};
  let i = 0;
  const readVarint = () => {
    let n = 0;
    let shift = 0;
    for (;;) {
      const b = buf[i++];
      n += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return n;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const key = readVarint();
    const tag = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      const v = readVarint();
      if (tag === 5) msg.payloadType = v;
    } else if (wire === 2) {
      const len = readVarint();
      const bytes = buf.subarray(i, i + len);
      i += len;
      if (tag === 2) msg.source = bytes.toString();
      else if (tag === 3) msg.destination = bytes.toString();
      else if (tag === 4) msg.namespace = bytes.toString();
      else if (tag === 6) msg.payload = bytes.toString();
    } else if (wire === 5) i += 4;
    else if (wire === 1) i += 8;
    else break;
  }
  return msg;
}

// ---- mDNS discovery ---------------------------------------------------------------------

/** id → { id, name, model, host, port, seen } */
const devices = new Map();
let sockets = [];
let queryTimer = null;
let scanningUntil = 0;

/**
 * One question: PTR _googlecast._tcp.local, class IN. Asked of the multicast group with
 * the "unicast response" bit set, and of each address nearby as a plain query from a
 * random port, which a device must answer straight back (RFC 6762 §6.7). The second is
 * what works on most PCs: Windows Firewall drops answers it can't match to something we
 * sent (always on a network marked Public), and a device's reply to a multicast question
 * often goes to the group or comes from an address we never wrote to.
 */
function dnsQuery(unicastBit) {
  const labels = SERVICE.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  const id = (Math.random() * 0xffff) | 0;
  const header = Buffer.from([id >> 8, id & 0xff, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([header, ...labels, Buffer.from([0, 0, 12, unicastBit ? 0x80 : 0, 1])]);
}

function readName(buf, offset) {
  const parts = [];
  let jumped = false;
  let next = offset;
  for (let guard = 0; guard < 64 && offset < buf.length; guard++) {
    const len = buf[offset];
    if (len === 0) {
      if (!jumped) next = offset + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) next = offset + 2;
      offset = ((len & 0x3f) << 8) | buf[offset + 1];
      jumped = true;
      continue;
    }
    parts.push(buf.toString("utf8", offset + 1, offset + 1 + len));
    offset += 1 + len;
  }
  return { name: parts.join("."), next };
}

function parseAnswer(buf, rinfo) {
  if (buf.length < 12) return;
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let o = 12;
  for (let q = 0; q < qd; q++) o = readName(buf, o).next + 4;
  const ptr = [];
  const srv = new Map();
  const txt = new Map();
  const a = new Map();
  for (let r = 0; r < total && o < buf.length; r++) {
    const { name, next } = readName(buf, o);
    o = next;
    const type = buf.readUInt16BE(o);
    const len = buf.readUInt16BE(o + 8);
    const data = o + 10;
    o = data + len;
    const key = name.toLowerCase();
    if (type === 12 && key === SERVICE.toLowerCase()) ptr.push(readName(buf, data).name);
    else if (type === 33) srv.set(key, { port: buf.readUInt16BE(data + 4), target: readName(buf, data + 6).name.toLowerCase() });
    else if (type === 1 && len === 4) a.set(key, `${buf[data]}.${buf[data + 1]}.${buf[data + 2]}.${buf[data + 3]}`);
    else if (type === 16) {
      const map = {};
      for (let t = data; t < data + len; ) {
        const l = buf[t];
        const s = buf.toString("utf8", t + 1, t + 1 + l);
        const eq = s.indexOf("=");
        if (eq > 0) map[s.slice(0, eq)] = s.slice(eq + 1);
        t += 1 + l;
      }
      txt.set(key, map);
    }
  }
  let changed = false;
  // A device usually answers with everything at once; when it doesn't, its source address
  // and the standard port are what's left.
  const instances = ptr.length ? ptr : [...txt.keys()].filter((k) => k.endsWith(`.${SERVICE.toLowerCase()}`));
  for (const instance of instances) {
    const key = instance.toLowerCase();
    const t = txt.get(key) || {};
    const s = srv.get(key);
    const id = t.id || instance;
    const known = devices.get(id);
    const device = {
      id,
      name: t.fn || known?.name || instance.split(".")[0],
      model: t.md || known?.model || "",
      host: (s && a.get(s.target)) || rinfo.address,
      port: s?.port || known?.port || 8009,
      seen: Date.now(),
    };
    if (!known || known.name !== device.name || known.host !== device.host || known.port !== device.port) changed = true;
    devices.set(id, device);
  }
  if (changed) events.emit("devices", listDevices());
}

function openSockets() {
  if (sockets.length) return;
  // The usual mDNS port, joined on each network, hears replies sent to the group when the
  // firewall lets them in.
  const listener = dgram.createSocket({ type: "udp4", reuseAddr: true });
  listener.on("message", parseAnswer);
  listener.on("error", () => listener.close());
  listener.bind(5353, () => {
    for (const { address } of localNetworks()) {
      try {
        listener.addMembership("224.0.0.251", address);
      } catch {
        /* that network doesn't do multicast */
      }
    }
  });
  sockets.push(listener);
  // One socket per network, so queries go out on each of them (Windows would pick one).
  for (const net of localNetworks()) {
    const s = dgram.createSocket({ type: "udp4" });
    s.on("message", parseAnswer);
    s.on("error", () => s.close());
    s.bind(0, net.address, () => {
      try {
        s.setMulticastInterface(net.address);
      } catch {
        /* ignore */
      }
    });
    s.query = (sweep) => {
      s.send(dnsQuery(true), 5353, "224.0.0.251", () => {});
      const targets = new Set([...devices.values()].map((d) => d.host).filter((h) => sameNetwork(h, net)));
      if (sweep) for (const host of hostsOf(net)) targets.add(host);
      const query = dnsQuery(false);
      for (const host of targets) s.send(query, 5353, host, () => {});
    };
    sockets.push(s);
  }
}

const toInt = (ip) => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
const toIp = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

function localNetworks() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => ({ address: i.address, netmask: i.netmask }));
}

function sameNetwork(host, net) {
  const mask = toInt(net.netmask);
  return ((toInt(host) & mask) >>> 0) === ((toInt(net.address) & mask) >>> 0);
}

/** Every other address on the network, or on its /24 when the network is larger. */
function hostsOf(net) {
  const mask = Math.max(toInt(net.netmask), toInt("255.255.255.0")) >>> 0;
  const base = (toInt(net.address) & mask) >>> 0;
  const size = 2 ** 32 - mask;
  const own = toInt(net.address);
  const hosts = [];
  for (let n = base + 1; n < base + size - 1; n++) if (n !== own) hosts.push(toIp(n));
  return hosts;
}

function closeSockets() {
  for (const s of sockets) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  sockets = [];
}

let round = 0;
function sendQueries() {
  // The sweep (a few hundred tiny packets) every third round; known devices every round.
  const sweep = round++ % 3 === 0;
  for (const s of sockets) {
    try {
      s.query?.(sweep);
    } catch {
      /* socket not ready yet */
    }
  }
}

/** Looks for Cast devices for a while (a minute after the last call). */
function scan() {
  scanningUntil = Date.now() + 60_000;
  openSockets();
  if (!queryTimer) {
    let n = 0;
    const tick = () => {
      if (Date.now() > scanningUntil) {
        queryTimer = null;
        closeSockets();
        return;
      }
      sendQueries();
      // Quick at first, then every 10 s; devices unheard for 3 minutes are dropped.
      queryTimer = setTimeout(tick, n++ < 3 ? 1000 * n : 10_000);
      const stale = [...devices.values()].filter((d) => Date.now() - d.seen > 180_000 && !channels.has(d.id));
      if (stale.length) {
        stale.forEach((d) => devices.delete(d.id));
        events.emit("devices", listDevices());
      }
    };
    queryTimer = setTimeout(tick, 300);
  } else sendQueries();
  return listDevices();
}

const listDevices = () => [...devices.values()].map(({ id, name, model }) => ({ id, name, model })).sort((x, y) => x.name.localeCompare(y.name));

// ---- control channel ----------------------------------------------------------------------

/** id → Channel */
const channels = new Map();

class Channel {
  constructor(device) {
    this.device = device;
    this.requestId = 1;
    this.pending = new Map();
    this.app = null; // { appId, sessionId, transportId }
    this.volume = null;
    this.buffer = Buffer.alloc(0);
    this.ready = new Promise((resolve, reject) => {
      const socket = tls.connect({ host: device.host, port: device.port, rejectUnauthorized: false, timeout: 8000 }, () => {
        socket.setTimeout(0);
        this.send("receiver-0", NS.connection, { type: "CONNECT" });
        resolve();
      });
      socket.on("data", (d) => this.onData(d));
      socket.on("timeout", () => socket.destroy(new Error("Timed out")));
      socket.on("error", (e) => reject(e));
      socket.on("close", () => this.closed());
      this.socket = socket;
    });
    // The device drops a sender that stays quiet for long.
    this.heartbeat = setInterval(() => this.send("receiver-0", NS.heartbeat, { type: "PING" }), 5000);
  }

  send(destination, namespace, payload) {
    if (!this.socket.destroyed) this.socket.write(encode(SENDER, destination, namespace, payload));
  }

  request(namespace, payload, destination = "receiver-0") {
    const requestId = this.requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${payload.type} timed out`));
      }, 20_000);
      this.pending.set(requestId, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.send(destination, namespace, { ...payload, requestId });
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + len) break;
      const msg = decode(this.buffer.subarray(4, 4 + len));
      this.buffer = this.buffer.subarray(4 + len);
      this.onMessage(msg);
    }
  }

  onMessage(msg) {
    let data;
    try {
      data = JSON.parse(msg.payload ?? "null");
    } catch {
      data = msg.payload;
    }
    if (msg.namespace === NS.heartbeat) {
      if (data?.type === "PING") this.send(msg.source, NS.heartbeat, { type: "PONG" });
      return;
    }
    if (msg.namespace === NS.connection && data?.type === "CLOSE") {
      if (this.app && msg.source === this.app.transportId) this.appClosed();
      else if (msg.source === "receiver-0") this.socket.destroy();
      return;
    }
    if (msg.namespace === NS.receiver && data?.type === "RECEIVER_STATUS") this.onStatus(data.status);
    const reply = data && typeof data === "object" ? this.pending.get(data.requestId) : null;
    if (reply) {
      this.pending.delete(data.requestId);
      reply(data);
    }
    if (this.app && msg.source === this.app.transportId && msg.namespace !== NS.connection) {
      events.emit("message", { id: this.device.id, namespace: msg.namespace, data: msg.payload });
    }
  }

  onStatus(status) {
    this.apps = (status?.applications ?? []).map((a) => ({ appId: a.appId, name: a.displayName }));
    if (status?.volume) this.volume = { level: status.volume.level, muted: status.volume.muted };
    const running = this.app && (status?.applications ?? []).find((a) => a.sessionId === this.app.sessionId);
    if (this.app && !running) this.appClosed();
    events.emit("status", this.state());
  }

  state() {
    return { id: this.device.id, connected: !this.socket.destroyed, appId: this.app?.appId ?? null, volume: this.volume };
  }

  /** Starts appId if it isn't running, and joins it. */
  async launch(appId) {
    await this.ready;
    let status = (await this.request(NS.receiver, { type: "GET_STATUS" })).status;
    let app = (status?.applications ?? []).find((a) => a.appId === appId);
    if (!app) {
      const reply = await this.request(NS.receiver, { type: "LAUNCH", appId });
      if (reply.type !== "RECEIVER_STATUS") throw new Error(reply.reason || reply.type || "Launch failed");
      status = reply.status;
      app = (status?.applications ?? []).find((a) => a.appId === appId);
      if (!app) throw new Error("The receiver didn't start");
    }
    if (this.app?.transportId !== app.transportId) {
      this.app = { appId, sessionId: app.sessionId, transportId: app.transportId };
      this.send(app.transportId, NS.connection, { type: "CONNECT", userAgent: "Argent" });
    }
    this.onStatus(status);
  }

  sendApp(namespace, payload) {
    if (!this.app) throw new Error("Nothing is running on the device");
    this.send(this.app.transportId, namespace, payload);
  }

  async setVolume(volume) {
    await this.ready;
    const v = {};
    if (typeof volume.level === "number") v.level = Math.max(0, Math.min(1, volume.level));
    if (typeof volume.muted === "boolean") v.muted = volume.muted;
    await this.request(NS.receiver, { type: "SET_VOLUME", volume: v });
  }

  async stop() {
    if (this.app) await this.request(NS.receiver, { type: "STOP", sessionId: this.app.sessionId }).catch(() => {});
    this.close();
  }

  appClosed() {
    this.app = null;
    events.emit("status", this.state());
  }

  close() {
    this.socket.destroy();
  }

  closed() {
    clearInterval(this.heartbeat);
    for (const reply of this.pending.values()) reply({ type: "CLOSED" });
    this.pending.clear();
    if (channels.get(this.device.id) === this) channels.delete(this.device.id);
    this.app = null;
    events.emit("status", { id: this.device.id, connected: false, appId: null, volume: this.volume });
  }
}

async function channel(id) {
  let c = channels.get(id);
  if (c && !c.socket.destroyed) return c;
  const device = devices.get(id);
  if (!device) throw new Error("That device isn't on the network");
  c = new Channel(device);
  channels.set(id, c);
  try {
    await c.ready;
  } catch (e) {
    c.close();
    throw e;
  }
  return c;
}

module.exports = {
  events,
  scan,
  devices: listDevices,
  async launch(id, appId) {
    const c = await channel(id);
    await c.launch(appId);
    return c.state();
  },
  /** Sends to the receiver app, joining it again (or starting it) after a reconnect. */
  async send(id, namespace, payload, appId) {
    const c = await channel(id);
    if (!c.app && appId) await c.launch(appId);
    c.sendApp(namespace, payload);
  },
  async volume(id, volume) {
    const c = await channel(id);
    await c.setVolume(volume);
  },
  /** What's running on the device and its volume (connects to ask). */
  async status(id) {
    const c = await channel(id);
    c.onStatus((await c.request(NS.receiver, { type: "GET_STATUS" })).status);
    return { ...c.state(), apps: c.apps };
  },
  async stop(id) {
    await channels.get(id)?.stop();
  },
  /** Leaves the receiver running and lets the device go (on quit). */
  closeAll() {
    for (const c of channels.values()) c.close();
    closeSockets();
  },
  _test: { encode, decode, dnsQuery, parseAnswer },
};
