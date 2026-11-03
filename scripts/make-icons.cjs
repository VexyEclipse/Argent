// Renders the silver Jellyfin mark into the desktop app icons:
//   build/icon.png (512px, window icon) and build/icon.ico (16–256px, exe + shortcuts).
// Run with: npx electron scripts/make-icons.cjs

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const OUT = path.join(__dirname, "..", "build");
const SVG = fs.readFileSync(path.join(__dirname, "..", "public", "jellyfin-silver.svg"), "utf8");

// The silver mark on a transparent background, as used in the app itself.
const page = `<!doctype html><canvas id="c"></canvas><script>
  const svg = ${JSON.stringify(SVG)};
  window.render = async (size) => {
    const c = document.getElementById("c");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.clearRect(0, 0, size, size);
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    // Small sizes use nearly the full square so the mark stays legible.
    const pad = size * (size <= 32 ? 0.02 : 0.04);
    g.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
    return c.toDataURL("image/png").split(",")[1];
  };
</script>`;

/** ICO container with PNG-compressed images (supported since Windows Vista). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
  fs.mkdirSync(OUT, { recursive: true });
  const pngs = [];
  for (const size of SIZES) {
    const b64 = await win.webContents.executeJavaScript(`render(${size})`);
    pngs.push({ size, data: Buffer.from(b64, "base64") });
  }
  fs.writeFileSync(path.join(OUT, "icon.ico"), buildIco(pngs));
  const big = await win.webContents.executeJavaScript("render(512)");
  fs.writeFileSync(path.join(OUT, "icon.png"), Buffer.from(big, "base64"));
  console.log(`Wrote build/icon.ico (${SIZES.join(", ")}px) and build/icon.png (512px)`);
  app.quit();
});
