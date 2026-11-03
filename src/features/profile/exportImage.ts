// Renders your highest-rated titles as a shareable PNG poster grid, drawn on a canvas
// in Argent's palette, for copying to the clipboard or saving.

export interface ExportEntry {
  name: string;
  stars: number;
  year?: number;
  poster?: string;
}

const COLS = 5;
const POSTER_W = 240;
const POSTER_H = 360;
const GAP = 32;
const MARGIN = 90;
const HEADER = 230;
const CAPTION = 96;
const FOOTER = 70;
const WIDTH = MARGIN * 2 + COLS * POSTER_W + (COLS - 1) * GAP;

const DISPLAY = '"Inter Tight", "Inter", "Segoe UI", system-ui, sans-serif';
const BODY = '"Inter", "Segoe UI", system-ui, sans-serif';
const STAR = new Path2D("m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.6-5 2.6 1-5.6-4.1-3.9 5.6-.8z");

function loadImage(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  const img = new Image();
  // Jellyfin serves images with open CORS, so the canvas stays exportable.
  img.crossOrigin = "anonymous";
  img.src = url;
  return img
    .decode()
    .then(() => img)
    .catch(() => null);
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = fill;
  ctx.fill(STAR);
  ctx.restore();
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

export async function renderTopRated(opts: { title: string; subtitle: string; entries: ExportEntry[] }): Promise<Blob> {
  const { entries } = opts;
  const rows = Math.max(1, Math.ceil(entries.length / COLS));
  const height = HEADER + rows * (POSTER_H + CAPTION) + (rows - 1) * GAP + FOOTER;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  await document.fonts?.ready;
  const images = await Promise.all(entries.map((e) => loadImage(e.poster)));

  // Background: near-black with a faint silver glow at the top.
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#131417");
  bg.addColorStop(1, "#09090a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, height);
  const glow = ctx.createRadialGradient(WIDTH / 2, -200, 50, WIDTH / 2, -200, WIDTH * 0.75);
  glow.addColorStop(0, "rgb(210 214 220 / 0.14)");
  glow.addColorStop(1, "rgb(210 214 220 / 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, height);

  // Header
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#80858d";
  ctx.font = `600 15px ${BODY}`;
  ctx.letterSpacing = "3px";
  ctx.fillText("ARGENT · MEDIA PROFILE", MARGIN, 92);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#f5f6f7";
  ctx.font = `600 56px ${DISPLAY}`;
  ctx.fillText(ellipsize(ctx, opts.title, WIDTH - MARGIN * 2), MARGIN, 156);
  ctx.fillStyle = "#b4b8bf";
  ctx.font = `400 20px ${BODY}`;
  ctx.fillText(opts.subtitle, MARGIN, 192);

  entries.forEach((entry, i) => {
    const row = Math.floor(i / COLS);
    const inRow = Math.min(COLS, entries.length - row * COLS);
    // Centre a short last row.
    const offset = ((COLS - inRow) * (POSTER_W + GAP)) / 2;
    const x = MARGIN + offset + (i % COLS) * (POSTER_W + GAP);
    const y = HEADER + row * (POSTER_H + CAPTION + GAP);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, POSTER_W, POSTER_H, 14);
    ctx.clip();
    const img = images[i];
    if (img) cover(ctx, img, x, y, POSTER_W, POSTER_H);
    else {
      ctx.fillStyle = "#1d1f23";
      ctx.fillRect(x, y, POSTER_W, POSTER_H);
      ctx.fillStyle = "#b4b8bf";
      ctx.font = `600 22px ${DISPLAY}`;
      ctx.textAlign = "center";
      ctx.fillText(ellipsize(ctx, entry.name, POSTER_W - 32), x + POSTER_W / 2, y + POSTER_H / 2);
      ctx.textAlign = "left";
    }
    // Bottom fade for the score pill.
    const fade = ctx.createLinearGradient(0, y + POSTER_H - 110, 0, y + POSTER_H);
    fade.addColorStop(0, "rgb(9 9 10 / 0)");
    fade.addColorStop(1, "rgb(9 9 10 / 0.75)");
    ctx.fillStyle = fade;
    ctx.fillRect(x, y + POSTER_H - 110, POSTER_W, 110);
    ctx.restore();
    ctx.strokeStyle = "rgb(210 214 220 / 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, POSTER_W - 1, POSTER_H - 1, 14);
    ctx.stroke();

    // Rank
    ctx.fillStyle = "rgb(10 10 11 / 0.78)";
    ctx.beginPath();
    ctx.arc(x + 30, y + 30, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f6f7f8";
    ctx.font = `700 17px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), x + 30, y + 36);
    ctx.textAlign = "left";

    // Score on the poster
    ctx.font = `700 30px ${DISPLAY}`;
    const score = String(entry.stars);
    const sw = ctx.measureText(score).width;
    star(ctx, x + 14, y + POSTER_H - 46, 26, "#e6e8eb");
    ctx.fillStyle = "#f6f7f8";
    ctx.fillText(score, x + 46, y + POSTER_H - 22);
    ctx.fillStyle = "#9a9fa7";
    ctx.font = `500 16px ${BODY}`;
    ctx.fillText("/10", x + 50 + sw, y + POSTER_H - 23);

    // Caption: title, then a row of ten stars
    ctx.fillStyle = "#f5f6f7";
    ctx.font = `600 19px ${BODY}`;
    ctx.fillText(ellipsize(ctx, entry.name, POSTER_W), x, y + POSTER_H + 32);
    for (let s = 0; s < 10; s++) star(ctx, x + s * 19, y + POSTER_H + 44, 17, s < entry.stars ? "#d2d5da" : "#26282d");
    if (entry.year) {
      ctx.fillStyle = "#80858d";
      ctx.font = `400 15px ${BODY}`;
      ctx.textAlign = "right";
      ctx.fillText(String(entry.year), x + POSTER_W, y + POSTER_H + 58);
      ctx.textAlign = "left";
    }
  });

  ctx.fillStyle = "#5f636b";
  ctx.font = `500 14px ${BODY}`;
  ctx.fillText("Made with Argent", MARGIN, height - 32);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't render the image"))), "image/png"));
}

export async function copyImage(blob: Blob | Promise<Blob>) {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export function saveImage(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
