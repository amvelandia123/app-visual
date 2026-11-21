// Rasteriza los iconos SVG a PNG con Playwright (solo desarrollo): npm run icons
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'icons');

// [archivo de salida, svg de origen, tamaño]
const JOBS = [
  ['icon-192.png', 'icon.svg', 192],
  ['icon-512.png', 'icon.svg', 512],
  ['icon-maskable-192.png', 'icon-maskable.svg', 192],
  ['icon-maskable-512.png', 'icon-maskable.svg', 512],
  ['apple-touch-icon.png', 'icon-maskable.svg', 180], // opaco y a sangre: iOS redondea las esquinas
  ['favicon-32.png', 'icon.svg', 32],
];

const browser = await chromium.launch();
try {
  for (const [out, src, size] of JOBS) {
    const svg = await readFile(path.join(ICONS, src), 'utf8');
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await writeFile(path.join(ICONS, out), png);
    await page.close();
    console.log(`${out} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
