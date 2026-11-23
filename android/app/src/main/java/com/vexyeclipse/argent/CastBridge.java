package com.vexyeclipse.argent;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Google Cast (Chromecast) for the page, the same protocol as the desktop app's
 * electron/cast.cjs: devices are found with Android's own mDNS (NsdManager,
 * _googlecast._tcp), and each is driven over its TLS control channel (port 8009) with
 * length-prefixed protobuf CastMessages carrying JSON. Argent only launches a receiver
 * app (Jellyfin's) and passes JSON between it and the page; the receiver fetches the
 * media from the server itself. Results and events reach the page as "argent-native"
 * events whose type starts with "cast".
 */
final class CastBridge {
    private static final String NS_CONNECTION = "urn:x-cast:com.google.cast.tp.connection";
    private static final String NS_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat";
    private static final String NS_RECEIVER = "urn:x-cast:com.google.cast.receiver";
    private static final String SENDER = "sender-argent";

    private static CastBridge instance;

    static synchronized CastBridge get(Context context) {
        if (instance == null) instance = new CastBridge(context.getApplicationContext());
        return instance;
    }

    private final NsdManager nsd;
    private final ExecutorService ops = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor();
    /** id → device */
    private final Map<String, Device> devices = new ConcurrentHashMap<>();
    /** NSD service name → id, so a lost service can be dropped. */
    private final Map<String, String> serviceIds = new ConcurrentHashMap<>();
    private final Map<String, Channel> channels = new ConcurrentHashMap<>();

    private NsdManager.DiscoveryListener discovery;
    private ScheduledFuture<?> stopDiscovery;
    private final ArrayDeque<NsdServiceInfo> resolveQueue = new ArrayDeque<>();
    private boolean resolving;

    private CastBridge(Context context) {
        nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
    }

    static final class Device {
        String id;
        String name;
        String model;
        String host;
        int port;
    }

    // ---- discovery --------------------------------------------------------------------------

    /** Looks for devices for a minute after the last call; returns those known so far. */
    synchronized String scan() {
        if (discovery == null && nsd != null) {
            discovery = new NsdManager.DiscoveryListener() {
                @Override public void onStartDiscoveryFailed(String type, int code) { stopped(this); }
                @Override public void onStopDiscoveryFailed(String type, int code) { stopped(this); }
                @Override public void onDiscoveryStarted(String type) { }
                @Override public void onDiscoveryStopped(String type) { stopped(this); }
                @Override public void onServiceFound(NsdServiceInfo info) { resolve(info); }
                @Override public void onServiceLost(NsdServiceInfo info) {
                    String id = serviceIds.remove(info.getServiceName());
                    if (id != null && !channels.containsKey(id) && devices.remove(id) != null) emitDevices();
                }
            };
            try {
                nsd.discoverServices("_googlecast._tcp", NsdManager.PROTOCOL_DNS_SD, discovery);
            } catch (RuntimeException e) {
                discovery = null;
            }
        }
        if (stopDiscovery != null) stopDiscovery.cancel(false);
        stopDiscovery = timers.schedule(this::stopScan, 60, TimeUnit.SECONDS);
        return deviceList().toString();
    }

    private synchronized void stopped(NsdManager.DiscoveryListener listener) {
        if (discovery == listener) discovery = null;
    }

    private synchronized void stopScan() {
        if (discovery == null) return;
        try {
            nsd.stopServiceDiscovery(discovery);
        } catch (RuntimeException ignored) {
            // already stopped
        }
        discovery = null;
    }

    /** NsdManager resolves one service at a time (before Android 14), so they queue. */
    private synchronized void resolve(NsdServiceInfo info) {
        resolveQueue.add(info);
        resolveNext();
    }

    @SuppressWarnings("deprecation")
    private synchronized void resolveNext() {
        if (resolving || resolveQueue.isEmpty()) return;
        resolving = true;
        NsdServiceInfo next = resolveQueue.poll();
        try {
            nsd.resolveService(next, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo info, int code) { resolved(null); }
                @Override public void onServiceResolved(NsdServiceInfo info) { resolved(info); }
            });
        } catch (RuntimeException e) {
            resolving = false;
            resolveNext();
        }
    }

    private void resolved(NsdServiceInfo info) {
        if (info != null && info.getHost() != null) {
            Map<String, byte[]> txt = info.getAttributes();
            Device d = new Device();
            d.id = text(txt, "id", info.getServiceName());
            d.name = text(txt, "fn", info.getServiceName());
            d.model = text(txt, "md", "");
            d.host = info.getHost().getHostAddress();
            d.port = info.getPort() > 0 ? info.getPort() : 8009;
            serviceIds.put(info.getServiceName(), d.id);
            devices.put(d.id, d);
            emitDevices();
        }
        synchronized (this) {
            resolving = false;
            resolveNext();
        }
    }

    private static String text(Map<String, byte[]> txt, String key, String fallback) {
        byte[] v = txt == null ? null : txt.get(key);
        return v == null || v.length == 0 ? fallback : new String(v, StandardCharsets.UTF_8);
    }

    private JSONArray deviceList() {
        List<Device> list = new ArrayList<>(devices.values());
        Collections.sort(list, (a, b) -> a.name.compareToIgnoreCase(b.name));
        JSONArray out = new JSONArray();
        for (Device d : list) {
            try {
                out.put(new JSONObject().put("id", d.id).put("name", d.name).put("model", d.model));
            } catch (JSONException ignored) {
                // never for strings
            }
        }
        return out;
    }

    private void emitDevices() {
        try {
            MainActivity.sendEvent(new JSONObject().put("type", "castDevices").put("devices", deviceList()));
        } catch (JSONException ignored) {
            // never
        }
    }

    // ---- requests from the page ----------------------------------------------------------------

    interface Op {
        Object run() throws Exception;
    }

    /** Runs op off the page's thread and answers with a "castReply" event. */
    void request(String requestId, Op op) {
        ops.execute(() -> {
            JSONObject reply = new JSONObject();
            try {
                reply.put("type", "castReply").put("requestId", requestId);
                try {
                    Object result = op.run();
                    reply.put("ok", true).put("result", result == null ? JSONObject.NULL : result);
                } catch (Exception e) {
                    reply.put("ok", false).put("error", e.getMessage() == null ? e.toString() : e.getMessage());
                }
            } catch (JSONException ignored) {
                // never
            }
            MainActivity.sendEvent(reply);
        });
    }

    JSONObject launch(String id, String appId) throws Exception {
        Channel c = channel(id);
        c.launch(appId);
        return c.state();
    }

    void send(String id, String namespace, String payload, String appId) throws Exception {
        Channel c = channel(id);
        if (c.app == null && appId != null && !appId.isEmpty()) c.launch(appId);
        c.sendApp(namespace, payload);
    }

    void volume(String id, JSONObject volume) throws Exception {
        JSONObject v = new JSONObject();
        if (volume.has("level")) v.put("level", Math.max(0, Math.min(1, volume.getDouble("level"))));
        if (volume.has("muted")) v.put("muted", volume.getBoolean("muted"));
        channel(id).request(new JSONObject().put("type", "SET_VOLUME").put("volume", v));
    }

    JSONObject status(String id) throws Exception {
        Channel c = channel(id);
        c.onStatus(c.request(new JSONObject().put("type", "GET_STATUS")).optJSONObject("status"));
        return c.state().put("apps", c.apps);
    }

    void stop(String id) {
        Channel c = channels.get(id);
        if (c != null) c.stop();
    }

    private Channel channel(String id) throws IOException {
        Channel c = channels.get(id);
        if (c != null && !c.closed) return c;
        Device d = devices.get(id);
        if (d == null) throw new IOException("That device isn't on the network");
        c = new Channel(d);
        channels.put(id, c);
        try {
            c.open();
        } catch (IOException e) {
            c.close();
            throw e;
        }
        return c;
    }

    // ---- protobuf CastMessage --------------------------------------------------------------

    private static void varint(ByteArrayOutputStream out, int n) {
        while ((n & ~0x7f) != 0) {
            out.write((n & 0x7f) | 0x80);
            n >>>= 7;
        }
        out.write(n);
    }

    private static void bytesField(ByteArrayOutputStream out, int tag, String value) {
        byte[] b = value.getBytes(StandardCharsets.UTF_8);
        out.write(tag);
        varint(out, b.length);
        out.write(b, 0, b.length);
    }

    static byte[] encode(String source, String destination, String namespace, String payload) {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(0x08); body.write(0); // protocol_version CASTV2_1_0
        bytesField(body, 0x12, source);
        bytesField(body, 0x1a, destination);
        bytesField(body, 0x22, namespace);
        body.write(0x28); body.write(0); // payload_type STRING
        bytesField(body, 0x32, payload);
        byte[] b = body.toByteArray();
        byte[] framed = new byte[4 + b.length];
        framed[0] = (byte) (b.length >>> 24);
        framed[1] = (byte) (b.length >>> 16);
        framed[2] = (byte) (b.length >>> 8);
        framed[3] = (byte) b.length;
        System.arraycopy(b, 0, framed, 4, b.length);
        return framed;
    }

    /** source, destination, namespace, payload */
    static String[] decode(byte[] buf) {
        String[] msg = new String[4];
        int[] i = {0};
        while (i[0] < buf.length) {
            long key = readVarint(buf, i);
            int tag = (int) (key >>> 3);
            int wire = (int) (key & 7);
            if (wire == 0) readVarint(buf, i);
            else if (wire == 2) {
                int len = (int) readVarint(buf, i);
                String s = new String(buf, i[0], Math.min(len, buf.length - i[0]), StandardCharsets.UTF_8);
                i[0] += len;
                if (tag == 2) msg[0] = s;
                else if (tag == 3) msg[1] = s;
                else if (tag == 4) msg[2] = s;
                else if (tag == 6) msg[3] = s;
            } else if (wire == 5) i[0] += 4;
            else if (wire == 1) i[0] += 8;
            else break;
        }
        return msg;
    }

    private static long readVarint(byte[] buf, int[] i) {
        long n = 0;
        int shift = 0;
        while (i[0] < buf.length) {
            int b = buf[i[0]++] & 0xff;
            n |= (long) (b & 0x7f) << shift;
            if (b < 0x80) break;
            shift += 7;
        }
        return n;
    }

    // ---- control channel ----------------------------------------------------------------------

    private final class Channel {
        final Device device;
        final AtomicInteger requestId = new AtomicInteger(1);
        final Map<Integer, CompletableFuture<JSONObject>> pending = new ConcurrentHashMap<>();
        SSLSocket socket;
        OutputStream out;
        ScheduledFuture<?> heartbeat;
        volatile boolean closed;
        /** appId, sessionId, transportId of the joined receiver app. */
        volatile String[] app;
        volatile JSONObject volume;
        volatile JSONArray apps = new JSONArray();

        Channel(Device device) {
            this.device = device;
        }

        void open() throws IOException {
            try {
                // Cast devices present a certificate of their own; there's nothing to check it against.
                SSLContext ssl = SSLContext.getInstance("TLS");
                ssl.init(null, new TrustManager[] {new X509TrustManager() {
                    @Override public void checkClientTrusted(X509Certificate[] chain, String authType) { }
                    @Override public void checkServerTrusted(X509Certificate[] chain, String authType) { }
                    @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                }}, new SecureRandom());
                Socket plain = new Socket();
                plain.connect(new InetSocketAddress(device.host, device.port), 8000);
                socket = (SSLSocket) ssl.getSocketFactory().createSocket(plain, device.host, device.port, true);
                socket.startHandshake();
                out = socket.getOutputStream();
            } catch (IOException e) {
                throw e;
            } catch (Exception e) {
                throw new IOException(e.getMessage(), e);
            }
            send("receiver-0", NS_CONNECTION, "{\"type\":\"CONNECT\"}");
            Thread reader = new Thread(this::read, "cast-reader");
            reader.setDaemon(true);
            reader.start();
            // The device drops a sender that stays quiet for long.
            heartbeat = timers.scheduleWithFixedDelay(() -> send("receiver-0", NS_HEARTBEAT, "{\"type\":\"PING\"}"), 5, 5, TimeUnit.SECONDS);
        }

        void send(String destination, String namespace, String payload) {
            if (closed || out == null) return;
            try {
                synchronized (this) {
                    out.write(encode(SENDER, destination, namespace, payload));
                    out.flush();
                }
            } catch (IOException e) {
                close();
            }
        }

        JSONObject request(JSONObject payload) throws Exception {
            int id = requestId.getAndIncrement();
            CompletableFuture<JSONObject> reply = new CompletableFuture<>();
            pending.put(id, reply);
            send("receiver-0", NS_RECEIVER, payload.put("requestId", id).toString());
            try {
                return reply.get(20, TimeUnit.SECONDS);
            } catch (java.util.concurrent.TimeoutException e) {
                throw new IOException(payload.optString("type") + " timed out");
            } finally {
                pending.remove(id);
            }
        }

        private void read() {
            try {
                DataInputStream in = new DataInputStream(socket.getInputStream());
                while (!closed) {
                    int len = in.readInt();
                    if (len < 0 || len > 1 << 20) throw new IOException("Bad message");
                    byte[] buf = new byte[len];
                    in.readFully(buf);
                    onMessage(decode(buf));
                }
            } catch (IOException e) {
                // closed
            }
            close();
        }

        private void onMessage(String[] msg) {
            String source = msg[0], namespace = msg[2], payload = msg[3];
            JSONObject data = null;
            try {
                if (payload != null) data = new JSONObject(payload);
            } catch (JSONException ignored) {
                // not JSON
            }
            String type = data == null ? "" : data.optString("type");
            if (NS_HEARTBEAT.equals(namespace)) {
                if ("PING".equals(type)) send(source, NS_HEARTBEAT, "{\"type\":\"PONG\"}");
                return;
            }
            String[] a = app;
            if (NS_CONNECTION.equals(namespace) && "CLOSE".equals(type)) {
                if (a != null && a[2].equals(source)) appClosed();
                else if ("receiver-0".equals(source)) close();
                return;
            }
            if (NS_RECEIVER.equals(namespace) && "RECEIVER_STATUS".equals(type)) onStatus(data.optJSONObject("status"));
            if (data != null && data.has("requestId")) {
                CompletableFuture<JSONObject> reply = pending.remove(data.optInt("requestId"));
                if (reply != null) reply.complete(data);
            }
            if (a != null && a[2].equals(source) && !NS_CONNECTION.equals(namespace)) {
                try {
                    MainActivity.sendEvent(new JSONObject().put("type", "castMessage").put("id", device.id).put("namespace", namespace).put("data", payload));
                } catch (JSONException ignored) {
                    // never
                }
            }
        }

        void onStatus(JSONObject status) {
            if (status == null) return;
            JSONArray list = status.optJSONArray("applications");
            JSONArray summary = new JSONArray();
            boolean running = false;
            String[] a = app;
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject o = list.optJSONObject(i);
                if (o == null) continue;
                try {
                    summary.put(new JSONObject().put("appId", o.optString("appId")).put("name", o.optString("displayName")));
                } catch (JSONException ignored) {
                    // never
                }
                if (a != null && a[1].equals(o.optString("sessionId"))) running = true;
            }
            apps = summary;
            JSONObject v = status.optJSONObject("volume");
            if (v != null) {
                try {
                    volume = new JSONObject().put("level", v.optDouble("level", 1)).put("muted", v.optBoolean("muted"));
                } catch (JSONException ignored) {
                    // never
                }
            }
            if (a != null && !running) app = null;
            emitStatus();
        }

        JSONObject state() {
            try {
                String[] a = app;
                return new JSONObject().put("id", device.id).put("connected", !closed).put("appId", a == null ? JSONObject.NULL : a[0])
                        .put("volume", volume == null ? JSONObject.NULL : volume);
            } catch (JSONException e) {
                return new JSONObject();
            }
        }

        void emitStatus() {
            try {
                MainActivity.sendEvent(state().put("type", "castStatus"));
            } catch (JSONException ignored) {
                // never
            }
        }

        /** Starts appId if it isn't running, and joins it. */
        void launch(String appId) throws Exception {
            JSONObject status = request(new JSONObject().put("type", "GET_STATUS")).optJSONObject("status");
            JSONObject found = findApp(status, appId);
            if (found == null) {
                JSONObject reply = request(new JSONObject().put("type", "LAUNCH").put("appId", appId));
                if (!"RECEIVER_STATUS".equals(reply.optString("type"))) throw new IOException(reply.optString("reason", reply.optString("type", "Launch failed")));
                status = reply.optJSONObject("status");
                found = findApp(status, appId);
                if (found == null) throw new IOException("The receiver didn't start");
            }
            String transportId = found.optString("transportId");
            String[] a = app;
            if (a == null || !a[2].equals(transportId)) {
                app = new String[] {appId, found.optString("sessionId"), transportId};
                send(transportId, NS_CONNECTION, "{\"type\":\"CONNECT\",\"userAgent\":\"Argent\"}");
            }
            onStatus(status);
        }

        private JSONObject findApp(JSONObject status, String appId) {
            JSONArray list = status == null ? null : status.optJSONArray("applications");
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject o = list.optJSONObject(i);
                if (o != null && appId.equals(o.optString("appId"))) return o;
            }
            return null;
        }

        void sendApp(String namespace, String payload) throws IOException {
            String[] a = app;
            if (a == null) throw new IOException("Nothing is running on the device");
            send(a[2], namespace, payload);
        }

        void stop() {
            String[] a = app;
            if (a != null) {
                try {
                    request(new JSONObject().put("type", "STOP").put("sessionId", a[1]));
                } catch (Exception ignored) {
                    // closing anyway
                }
            }
            close();
        }

        void appClosed() {
            app = null;
            emitStatus();
        }

        void close() {
            if (closed) return;
            closed = true;
            if (heartbeat != null) heartbeat.cancel(false);
            try {
                if (socket != null) socket.close();
            } catch (IOException ignored) {
                // closed
            }
            for (CompletableFuture<JSONObject> reply : pending.values()) {
                try {
                    reply.complete(new JSONObject().put("type", "CLOSED"));
                } catch (JSONException ignored) {
                    // never
                }
            }
            pending.clear();
            channels.remove(device.id, this);
            app = null;
            emitStatus();
        }
    }

    /** Lets every device go (the receivers keep playing). */
    void closeAll() {
        for (Channel c : new ArrayList<>(channels.values())) c.close();
        stopScan();
    }
}
