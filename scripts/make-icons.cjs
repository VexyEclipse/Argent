// Renders the silver Jellyfin mark into the app icons:
//   build/icon.png (512px, window icon) and build/icon.ico (16–256px, exe + shortcuts),
//   the web app's home screen icons in public/,
//   and for the Android app: launcher icons (legacy and adaptive) and the TV banner.
// Run with: npx electron scripts/make-icons.cjs

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const OUT = path.join(__dirname, "..", "build");
const RES = path.join(__dirname, "..", "android", "app", "src", "main", "res");
const SVG = fs.readFileSync(path.join(__dirname, "..", "public", "jellyfin-silver.svg"), "utf8");

// Android densities: launcher icon 48dp, adaptive foreground 108dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// The silver mark, as used in the app itself: on a transparent background by default, or
// on the app's near-black (bg) with rounded corners (radius) and a wordmark (label).
const page = `<!doctype html>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@600&display=block" />
<canvas id="c"></canvas><script>
  const svg = ${JSON.stringify(SVG)};
  window.render = async ({ width, height = width, mark = width, bg, radius = 0, label }) => {
    const c = document.getElementById("c");
    c.width = width;
    c.height = height;
    const g = c.getContext("2d");
    g.clearRect(0, 0, width, height);
    if (bg) {
      g.fillStyle = bg;
      g.beginPath();
      g.roundRect(0, 0, width, height, radius);
      g.fill();
    }
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    if (label) {
      // TV banner: the mark, then the name, centred together.
      const font = "600 " + Math.round(mark * 0.62) + "px 'Inter Tight', 'Segoe UI', sans-serif";
      await document.fonts.load(font).catch(() => {});
      g.font = font;
      const gap = mark * 0.22;
      const text = g.measureText(label).width;
      const x = (width - (mark + gap + text)) / 2;
      g.drawImage(img, x, (height - mark) / 2, mark, mark);
      g.fillStyle = "#e6e8eb";
      g.textBaseline = "middle";
      g.fillText(label, x + mark + gap, height / 2 + mark * 0.03);
    } else {
      // Small sizes use nearly the full square so the mark stays legible.
      const pad = mark * (mark <= 32 ? 0.02 : 0.04);
      const x = (width - mark) / 2 + pad;
      const y = (height - mark) / 2 + pad;
      g.drawImage(img, x, y, mark - pad * 2, mark - pad * 2);
    }
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
  const render = async (spec) => Buffer.from(await win.webContents.executeJavaScript(`render(${JSON.stringify(spec)})`), "base64");
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };

  const pngs = [];
  for (const size of SIZES) pngs.push({ size, data: await render({ width: size }) });
  write(path.join(OUT, "icon.ico"), buildIco(pngs));
  write(path.join(OUT, "icon.png"), await render({ width: 512 }));
  console.log(`Wrote build/icon.ico (${SIZES.join(", ")}px) and build/icon.png (512px)`);

  // Web app (home screen) icons: the mark on the app's near-black. iOS rounds the corners itself.
  const PUBLIC = path.join(__dirname, "..", "public");
  write(path.join(PUBLIC, "apple-touch-icon.png"), await render({ width: 180, mark: 180 * 0.64, bg: "#0a0a0b" }));
  write(path.join(PUBLIC, "icon-512.png"), await render({ width: 512, mark: 512 * 0.64, bg: "#0a0a0b" }));
  console.log("Wrote public/apple-touch-icon.png (180px) and public/icon-512.png (512px)");

  for (const [density, scale] of Object.entries(DENSITIES)) {
    const icon = 48 * scale;
    const foreground = 108 * scale;
    // Legacy icon (Android 7): a rounded near-black tile. Adaptive foreground (8+): the mark
    // inside the 66dp safe zone, on the background colour set in ic_launcher.xml.
    write(path.join(RES, `mipmap-${density}`, "ic_launcher.png"), await render({ width: icon, mark: icon * 0.64, bg: "#0a0a0b", radius: icon * 0.18 }));
    write(path.join(RES, `mipmap-${density}`, "ic_launcher_foreground.png"), await render({ width: foreground, mark: foreground * 0.5 }));
  }
  // Android TV home screen banner: 320×180 at xhdpi.
  write(path.join(RES, "drawable-xhdpi", "banner.png"), await render({ width: 320, height: 180, mark: 76, bg: "#0a0a0b", label: "Argent" }));
  console.log("Wrote the Android launcher icons and TV banner to android/app/src/main/res");
  app.quit();
});
