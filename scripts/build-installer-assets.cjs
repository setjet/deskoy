/**
 * Builds NSIS installer branding assets (sidebar + header).
 *
 * NSIS Modern UI (MUI2) expects:
 * - Sidebar image: 164×314 (BMP)
 * - Header image: 150×57 (BMP)
 *
 * This script renders crisp PNGs from SVG and writes BMPs for NSIS.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const bmp = require('bmp-js');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');

const logoPath = path.join(assets, 'logo.png');

const sidebarBmp = path.join(assets, 'installer-sidebar.bmp');
const headerBmp = path.join(assets, 'installer-header.bmp');

const SIDEBAR_W = 164;
const SIDEBAR_H = 314;
const HEADER_W = 150;
const HEADER_H = 57;

function svgSidebar() {
  // Keep this high-contrast and low-detail: NSIS assets get scaled by Windows DPI,
  // and fine detail can look blurry. Big shapes + crisp text reads best.
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIDEBAR_W}" height="${SIDEBAR_H}" viewBox="0 0 ${SIDEBAR_W} ${SIDEBAR_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#101828"/>
      <stop offset="58%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#0B1120"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect x="0" y="0" width="6" height="${SIDEBAR_H}" fill="#2563EB"/>
  <rect x="6" y="0" width="1" height="${SIDEBAR_H}" fill="#60A5FA" opacity="0.42"/>
  <path d="M20 132h124v1H20zM20 204h124v1H20zM20 260h124v1H20z" fill="#FFFFFF" opacity="0.12"/>

  <rect x="23" y="28" width="118" height="86" rx="14" fill="#FFFFFF" opacity="0.08"/>
  <rect x="38" y="43" width="88" height="56" rx="12" fill="#FFFFFF" opacity="0.10"/>

  <text x="20" y="164" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="700" fill="#F9FAFB">Deskoy</text>
  <text x="20" y="188" font-family="Segoe UI, Arial, sans-serif" font-size="10.8" font-weight="600" fill="#BFDBFE">Privacy cover for work</text>
  <text x="20" y="226" font-family="Segoe UI, Arial, sans-serif" font-size="10.5" fill="#CBD5E1">Installing app files,</text>
  <text x="20" y="242" font-family="Segoe UI, Arial, sans-serif" font-size="10.5" fill="#CBD5E1">assets, and shortcuts.</text>
  <text x="20" y="${SIDEBAR_H - 26}" font-family="Segoe UI, Arial, sans-serif" font-size="9.5" fill="#94A3B8">Setup ${process.env.npm_package_version || ''}</text>
</svg>`,
    'utf8',
  );
}

function svgHeader() {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${HEADER_W}" height="${HEADER_H}" viewBox="0 0 ${HEADER_W} ${HEADER_H}">
  <defs>
    <linearGradient id="h" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#EFF6FF"/>
      <stop offset="100%" stop-color="#FFFFFF"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#h)"/>
  <rect x="0" y="${HEADER_H - 3}" width="${HEADER_W}" height="3" fill="#2563EB"/>
  <text x="42" y="23" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="700" fill="#111827">Deskoy</text>
  <text x="42" y="39" font-family="Segoe UI, Arial, sans-serif" font-size="8.5" fill="#475569">Secure setup</text>
</svg>`,
    'utf8',
  );
}

async function maybeCompositeLogo(pipeline, targetW, targetH, size, topOffset) {
  if (!fs.existsSync(logoPath)) return pipeline;
  const logo = await sharp(logoPath)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const left = Math.max(0, Math.round((targetW - size) / 2));
  const top = Math.max(0, Math.round(topOffset));
  return pipeline.composite([{ input: logo, left, top }]);
}

async function renderBmp(svgBuf, outPath, w, h, composite) {
  let p = sharp(svgBuf).resize(w, h, { fit: 'fill' }).flatten({ background: { r: 11, g: 18, b: 36 } });
  if (composite) p = await composite(p);
  // Force opaque pixels. NSIS bitmaps with alpha can look “soft” on some Windows themes/scaling.
  const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) data[i + 3] = 255;
  const encoded = bmp.encode({
    data,
    width: info.width,
    height: info.height,
  });
  fs.writeFileSync(outPath, encoded.data);
}

async function main() {
  if (!fs.existsSync(assets)) fs.mkdirSync(assets, { recursive: true });

  await renderBmp(svgSidebar(), sidebarBmp, SIDEBAR_W, SIDEBAR_H, async (p) =>
    maybeCompositeLogo(p, SIDEBAR_W, SIDEBAR_H, 66, 38),
  );

  await renderBmp(svgHeader(), headerBmp, HEADER_W, HEADER_H, async (p) =>
    maybeCompositeLogo(p, HEADER_W, HEADER_H, 28, 14),
  );

  console.log('Wrote NSIS installer assets:', path.relative(root, sidebarBmp), 'and', path.relative(root, headerBmp));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

