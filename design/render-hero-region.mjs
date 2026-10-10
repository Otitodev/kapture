import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const framesDir = mkdtempSync(resolve(tmpdir(), 'kapture-hero-'));
const source = resolve('design/hero-region-animation.html');
const output = resolve('design/store/hero-region.gif');
const siteOutput = resolve('site/public/hero-region.gif');
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(source).href);
  for (let frame = 0; frame < 50; frame++) {
    await page.evaluate((n) => window.renderFrame(n), frame);
    await page.screenshot({ path: resolve(framesDir, `frame-${String(frame).padStart(3, '0')}.png`) });
  }
  await browser.close();
  browser = undefined;
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-framerate', '20', '-i', resolve(framesDir, 'frame-%03d.png'),
    '-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', output,
  ]);
  copyFileSync(output, siteOutput);
  process.stdout.write(`Rendered ${output} and ${siteOutput}\n`);
} finally {
  if (browser) await browser.close();
  rmSync(framesDir, { recursive: true, force: true });
}
