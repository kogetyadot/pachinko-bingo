import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const OUT_DIR = path.resolve('/home/antigravity/pachinko-bingo/verify_shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Regex matching OS standard pictographic emojis (allowing clean geometric arrows/symbols if any, though we prefer SVG)
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

async function assertInViewport(page, selector, viewport, label) {
  const loc = page.locator(selector).first();
  const visible = await loc.isVisible().catch(() => false);
  if (!visible) {
    throw new Error(`[${label}] Expected ${selector} to be visible`);
  }
  const box = await loc.boundingBox();
  if (!box) {
    throw new Error(`[${label}] Could not get boundingBox for ${selector}`);
  }
  if (
    box.x < -1 ||
    box.y < -1 ||
    box.x + box.width > viewport.width + 2 ||
    box.y + box.height > viewport.height + 2
  ) {
    throw new Error(
      `[${label}] Element ${selector} out of viewport (${viewport.width}x${viewport.height}): ${JSON.stringify(box)}`
    );
  }
  return box;
}

async function checkNoOverflowAndNoEmoji(page, label) {
  const audit = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth,
      scrollH: doc.scrollHeight,
      clientH: doc.clientHeight,
      text: document.body.innerText || '',
    };
  });
  if (audit.scrollW > audit.clientW + 2 || audit.scrollH > audit.clientH + 2) {
    throw new Error(
      `[${label}] Viewport overflow detected: scroll=${audit.scrollW}x${audit.scrollH} vs client=${audit.clientW}x${audit.clientH}`
    );
  }
  const emojis = audit.text.match(EMOJI_REGEX);
  if (emojis && emojis.length > 0) {
    throw new Error(`[${label}] Forbidden OS emoji found in UI text: ${emojis.join(', ')}`);
  }
}

async function run() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome',
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
    ],
  });

  const errors = [];
  const failedRequests = [];
  const summary = {};

  try {
    // =========================================================================
    // 1. Desktop Verification (1280x720)
    // =========================================================================
    const desktopVp = { width: 1280, height: 720 };
    const ctxDesktop = await browser.newContext({ viewport: desktopVp, deviceScaleFactor: 1 });
    const page = await ctxDesktop.newPage();

    page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`CONSOLE_ERROR: ${msg.text()}`);
    });
    page.on('requestfailed', (req) => {
      const errText = req.failure()?.errorText || 'unknown';
      // Ignore benign aborted media range requests when switching tracks/screens
      if (!errText.includes('ERR_ABORTED')) {
        failedRequests.push(`REQ_FAIL: ${req.url()} (${errText})`);
      }
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failedRequests.push(`HTTP_${res.status()}: ${res.url()}`);
    });

    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    await checkNoOverflowAndNoEmoji(page, 'Desktop Title');
    await assertInViewport(page, '#btn-start-standard', desktopVp, 'Desktop Title');
    await assertInViewport(page, '#tab-title-glossary', desktopVp, 'Desktop Title');
    await page.screenshot({ path: path.join(OUT_DIR, '01_title_desktop.png') });

    // Verify embedded Title Glossary tab on Desktop
    await page.click('#tab-title-glossary');
    await page.waitForTimeout(200);
    await checkNoOverflowAndNoEmoji(page, 'Desktop Title Glossary');
    await assertInViewport(page, '#title-panel-glossary', desktopVp, 'Desktop Title Glossary');
    await assertInViewport(page, '#btn-start-standard', desktopVp, 'Desktop Title Glossary');
    await page.screenshot({ path: path.join(OUT_DIR, '15_title_glossary_desktop.png') });
    await page.click('#tab-title-howto');
    await page.waitForTimeout(150);

    // Check title attract video status
    summary.titleVideo = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v
        ? { src: v.currentSrc || v.src, readyState: v.readyState, videoWidth: v.videoWidth, paused: v.paused }
        : null;
    });

    // Toggle audio buttons
    if (await page.locator('#btn-toggle-bgm').isVisible().catch(() => false)) {
      await page.click('#btn-toggle-bgm');
      await page.waitForTimeout(100);
      await page.click('#btn-toggle-bgm');
    }
    if (await page.locator('#btn-toggle-se').isVisible().catch(() => false)) {
      await page.click('#btn-toggle-se');
      await page.waitForTimeout(100);
      await page.click('#btn-toggle-se');
    }

    // Start Standard Run
    await page.click('#btn-start-standard');
    await page.waitForTimeout(600);
    await checkNoOverflowAndNoEmoji(page, 'Desktop Gameplay Initial');
    await assertInViewport(page, 'canvas', desktopVp, 'Desktop Gameplay');
    await assertInViewport(page, '#btn-launch', desktopVp, 'Desktop Gameplay');
    await page.screenshot({ path: path.join(OUT_DIR, '02_gameplay_desktop_initial.png') });

    // Verify Desktop Sound Mixer popover & close button
    await page.click('#btn-sound-mixer-desktop');
    await page.waitForTimeout(200);
    await assertInViewport(page, '#slider-bgm-vol', desktopVp, 'Desktop Sound Mixer');
    await assertInViewport(page, '#btn-close-sound-mixer', desktopVp, 'Desktop Sound Mixer');
    await page.screenshot({ path: path.join(OUT_DIR, '14_sound_mixer_desktop.png') });
    await page.click('#btn-close-sound-mixer');
    await page.waitForTimeout(150);

    // Fire several shots at varied launch powers (Left, Bukkomi, Right-Hit)
    for (const pwr of [0.24, 0.48, 0.86]) {
      await page.evaluate((p) => {
        window.__GAME_DEBUG__?.setPower(p);
      }, pwr);
      await page.click('#btn-launch');
      await page.waitForTimeout(380);
    }
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT_DIR, '03_gameplay_desktop_action.png') });

    // Measure FPS during active multi-ball simulation
    summary.desktopFps = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        function tick() {
          frames++;
          if (performance.now() - t0 >= 800) {
            resolve(Math.round((frames * 1000) / (performance.now() - t0)));
          } else {
            requestAnimationFrame(tick);
          }
        }
        requestAnimationFrame(tick);
      });
    });

    // Trigger Stage 1 Clear cleanly via debug helper to test Stage Clear -> Shop -> Board Customize flow
    await page.evaluate(() => {
      window.__GAME_DEBUG__?.forceStageClear();
    });
    await page.waitForTimeout(1100);
    await checkNoOverflowAndNoEmoji(page, 'Desktop Stage Clear');
    await page.screenshot({ path: path.join(OUT_DIR, '04_stage_clear_desktop.png') });

    await page.click('#btn-goto-shop');
    await page.waitForTimeout(500);
    await checkNoOverflowAndNoEmoji(page, 'Desktop Shop');
    await page.screenshot({ path: path.join(OUT_DIR, '05_shop_desktop.png') });

    // Buy first affordable offer or grant medals & buy a pin + relic
    await page.evaluate(() => {
      window.__GAME_DEBUG__?.grantMedals(250);
    });
    await page.waitForTimeout(150);
    const buyBtns = page.locator('[data-shop-offer-id]');
    const buyCount = await buyBtns.count();
    for (let i = 0; i < Math.min(3, buyCount); i++) {
      const btn = buyBtns.nth(i);
      if (await btn.isEnabled().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(150);
      }
    }

    // Switch to board tune tab if present, auto-optimize pins, capture screenshot
    const boardTab = page.locator('#tab-board-tune:visible, #tab-shop-board:visible').first();
    if (await boardTab.isVisible().catch(() => false)) {
      await boardTab.click();
      await page.waitForTimeout(300);
    }
    if (await page.locator('#btn-auto-pins:visible').first().isVisible().catch(() => false)) {
      await page.locator('#btn-auto-pins:visible').first().click();
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: path.join(OUT_DIR, '06_board_tune_desktop.png') });

    // Advance to Stage 2 and showcase Overdrive + Fever inflation showcase!
    await page.locator('#btn-next-stage:visible').first().click();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__GAME_DEBUG__?.triggerInflationShowcase();
    });
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(OUT_DIR, '07_fever_overdrive_desktop.png') });

    // Verify Victory screen
    await page.evaluate(() => {
      window.__GAME_DEBUG__?.forceVictory();
    });
    await page.waitForTimeout(500);
    await checkNoOverflowAndNoEmoji(page, 'Desktop Victory');
    await page.screenshot({ path: path.join(OUT_DIR, '08_victory_desktop.png') });

    await ctxDesktop.close();

    // =========================================================================
    // 2. Smartphone Portrait Verification (390x844 & 375x667)
    // =========================================================================
    const mobileVp = { width: 390, height: 844 };
    const ctxMobile = await browser.newContext({
      viewport: mobileVp,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const mPage = await ctxMobile.newPage();
    mPage.on('pageerror', (err) => errors.push(`MOBILE_PAGEERROR: ${err.message}`));
    mPage.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`MOBILE_CONSOLE_ERROR: ${msg.text()}`);
    });

    await mPage.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await mPage.waitForTimeout(800);
    await checkNoOverflowAndNoEmoji(mPage, 'Mobile Title 390x844');
    await assertInViewport(mPage, '#btn-start-standard', mobileVp, 'Mobile Title 390x844');
    await assertInViewport(mPage, '#tab-title-glossary', mobileVp, 'Mobile Title 390x844');
    await mPage.screenshot({ path: path.join(OUT_DIR, '09_title_mobile.png') });

    // Verify embedded Title Glossary tab on Mobile (390x844)
    await mPage.tap('#tab-title-glossary');
    await mPage.waitForTimeout(200);
    await checkNoOverflowAndNoEmoji(mPage, 'Mobile Title Glossary 390x844');
    await assertInViewport(mPage, '#title-panel-glossary', mobileVp, 'Mobile Title Glossary 390x844');
    await assertInViewport(mPage, '#btn-start-standard', mobileVp, 'Mobile Title Glossary 390x844');
    await mPage.screenshot({ path: path.join(OUT_DIR, '16_title_glossary_mobile.png') });
    await mPage.tap('#tab-title-howto');
    await mPage.waitForTimeout(150);

    await mPage.tap('#btn-start-standard');
    await mPage.waitForTimeout(500);
    await checkNoOverflowAndNoEmoji(mPage, 'Mobile Gameplay 390x844');
    await assertInViewport(mPage, 'canvas', mobileVp, 'Mobile Gameplay 390x844');
    const mobileLaunchSelector = (await mPage.locator('#btn-launch-mobile').isVisible().catch(() => false))
      ? '#btn-launch-mobile'
      : '#btn-launch';
    await assertInViewport(mPage, mobileLaunchSelector, mobileVp, 'Mobile Gameplay 390x844');
    await mPage.tap(mobileLaunchSelector);
    await mPage.waitForTimeout(550);
    await mPage.screenshot({ path: path.join(OUT_DIR, '10_gameplay_mobile.png') });

    // Verify Sound Volume Mixer Popover & Sliders on Mobile
    await mPage.tap('#btn-sound-mixer-mobile');
    await mPage.waitForTimeout(250);
    await assertInViewport(mPage, '#slider-bgm-vol', mobileVp, 'Mobile Sound Mixer');
    await assertInViewport(mPage, '#slider-se-vol', mobileVp, 'Mobile Sound Mixer');
    await mPage.locator('#slider-bgm-vol').fill('40');
    await mPage.locator('#slider-se-vol').fill('50');
    await mPage.waitForTimeout(150);
    await mPage.screenshot({ path: path.join(OUT_DIR, '13_sound_mixer_mobile.png') });
    await mPage.tap('#btn-close-sound-mixer');
    await mPage.waitForTimeout(200);

    // Mobile Stage Clear & Shop verification
    await mPage.evaluate(() => {
      window.__GAME_DEBUG__?.forceStageClear();
    });
    await mPage.waitForTimeout(1100);
    await checkNoOverflowAndNoEmoji(mPage, 'Mobile Stage Clear 390x844');
    await mPage.screenshot({ path: path.join(OUT_DIR, '17_stage_clear_mobile.png') });
    await mPage.tap('#btn-goto-shop');
    await mPage.waitForTimeout(450);
    await checkNoOverflowAndNoEmoji(mPage, 'Mobile Shop 390x844');
    await mPage.screenshot({ path: path.join(OUT_DIR, '11_shop_mobile.png') });

    // Compact iPhone SE (375x667) check
    const compactVp = { width: 375, height: 667 };
    await mPage.setViewportSize(compactVp);
    await mPage.locator('#btn-next-stage:visible').first().tap();
    await mPage.waitForTimeout(500);
    await checkNoOverflowAndNoEmoji(mPage, 'Mobile Compact 375x667');
    await assertInViewport(mPage, 'canvas', compactVp, 'Mobile Compact 375x667');
    const compactLaunchSelector = (await mPage.locator('#btn-launch-mobile').isVisible().catch(() => false))
      ? '#btn-launch-mobile'
      : '#btn-launch';
    await assertInViewport(mPage, compactLaunchSelector, compactVp, 'Mobile Compact 390->375x667');

    // Assert zero badge overlap in 375px compact mobile marquee
    const badgeBoxes = await Promise.all(
      ['#mm-stage-badge', '.mm-medal-badge', '#mm-mult-badge', '#mm-card-level'].map((s) =>
        mPage.locator(s).first().boundingBox()
      )
    );
    for (let i = 0; i < badgeBoxes.length; i++) {
      for (let j = i + 1; j < badgeBoxes.length; j++) {
        const a = badgeBoxes[i];
        const b = badgeBoxes[j];
        if (a && b) {
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (overlapX > 1 && overlapY > 1) {
            throw new Error(`375x667 mobile marquee badge overlap detected: ${JSON.stringify({ a, b })}`);
          }
        }
      }
    }

    await mPage.screenshot({ path: path.join(OUT_DIR, '12_gameplay_compact_375x667.png') });

    await ctxMobile.close();
  } finally {
    await browser.close();
  }

  console.log('=== VERIFICATION SUMMARY ===');
  console.log(JSON.stringify({ summary, errors, failedRequests }, null, 2));

  if (errors.length > 0 || failedRequests.length > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('E2E Verification Failed:', err);
  process.exit(1);
});
