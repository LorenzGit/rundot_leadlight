#!/usr/bin/env node
/**
 * README screenshots, taken from the real game.
 *
 * Boots the dev server, plays a handful of real moves through the QA contract
 * so the board is not empty, and writes one shot per orientation. Regenerate
 * with `node scripts/capture-screenshots.mjs` whenever the look changes — a
 * README showing art the game no longer has is worse than no README image.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const PORT = 5453;
const outputDir = path.join(process.cwd(), "docs", "screenshots");
const SHOTS = [
    { name: "gameplay.png", width: 393, height: 852, moves: 9 },
    { name: "gameplay-landscape.png", width: 880, height: 412, moves: 9 },
];

fs.mkdirSync(outputDir, { recursive: true });
const server = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true } });
await server.listen();
const browser = await chromium.launch();

for (const shot of SHOTS) {
    const context = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/?qa=1`, { waitUntil: "load" });
    await page.waitForTimeout(2200);
    await page.locator(".play-button").first().click();
    await page.waitForFunction(() => (globalThis.__gameQa?.geometry?.()?.tray ?? []).filter(Boolean).length >= 3, {
        timeout: 20000,
    });

    for (let move = 0; move < shot.moves; move++) {
        const geometry = await page.evaluate(() => globalThis.__gameQa.geometry());
        if (!geometry?.firstLegalDrop) break;
        const from = geometry.tray[geometry.firstLegalDrop.slot];
        await page.evaluate(
            ({ f, t }) => {
                const canvas = document.querySelector("canvas");
                const send = (type, x, y) =>
                    canvas.dispatchEvent(
                        new PointerEvent(type, {
                            pointerId: 1,
                            pointerType: "mouse",
                            clientX: x,
                            clientY: y,
                            bubbles: true,
                            isPrimary: true,
                        }),
                    );
                send("pointerdown", f.clientX, f.clientY);
                for (let step = 1; step <= 6; step++) {
                    send(
                        "pointermove",
                        f.clientX + ((t.clientX - f.clientX) * step) / 6,
                        f.clientY + ((t.clientY - f.clientY) * step) / 6,
                    );
                }
                send("pointerup", t.clientX, t.clientY);
            },
            { f: from, t: geometry.firstLegalDrop },
        );
        await page.waitForTimeout(420);
    }

    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputDir, shot.name), animations: "disabled" });
    console.log(`wrote docs/screenshots/${shot.name}`);
    await context.close();
}

await browser.close();
await server.close();
