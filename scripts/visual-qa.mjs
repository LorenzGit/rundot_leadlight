#!/usr/bin/env node
/**
 * Headless visual QA.
 *
 * Boots a dev server, drives the game through every screen at four real device
 * viewports, and writes PNGs to `tmp/visual-qa/`. The run FAILS on any page or
 * console error, because the failure mode this game is most exposed to — a Pixi
 * scene that throws while generating its glass textures — leaves a blank canvas
 * with the React shell still painted on top. That is invisible to a glance and
 * obvious here.
 *
 *   node scripts/visual-qa.mjs            all viewports
 *   node scripts/visual-qa.mjs --phone    just the tall phone
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = process.cwd();
const outputDir = path.join(root, "tmp", "visual-qa");
const PORT = 5397;

const VIEWPORTS = [
    { name: "phone-tall", width: 393, height: 852, scale: 2 },
    { name: "phone-short", width: 360, height: 640, scale: 2 },
    { name: "tablet", width: 820, height: 1180, scale: 2 },
    { name: "desktop", width: 1440, height: 900, scale: 1 },
];

const SCREENS = [
    { name: "01-menu", screen: "" },
    { name: "02-atelier", screen: "atelier" },
    { name: "03-daily-glass", screen: "daily-rewards" },
    { name: "04-daily-work", screen: "daily-quests" },
    { name: "05-record", screen: "stats" },
    { name: "06-settings", screen: "settings" },
];

/**
 * Play real moves by dragging cuts from the tray onto the panel.
 *
 * Every position comes from `__gameQa.geometry()`, which asks the live scene.
 * Computing it from the viewport instead lands on empty bench: in `vite dev`
 * the SDK mock reports a phone-shaped safe area, which shifts the whole layout
 * by tens of design units.
 */
const PLAY_MOVES = `(async () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return "no canvas";

    // Both halves of the drag must land on the canvas: Pixi's federated events
    // pair pointerdown/pointerup on the same root, and a pointerup delivered to
    // window never completes the gesture.
    const send = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: "touch", clientX: x, clientY: y,
        bubbles: true, cancelable: true, isPrimary: true,
    }));
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let played = 0;
    for (let move = 0; move < MOVES; move++) {
        let geometry = null;
        for (let attempt = 0; attempt < 25; attempt++) {
            geometry = globalThis.__gameQa?.geometry();
            if (geometry?.firstLegalDrop && geometry.tray.some(Boolean)) break;
            await wait(150);
        }
        if (!geometry?.firstLegalDrop) break;
        const drop = geometry.firstLegalDrop;
        const from = geometry.tray[drop.slot];
        if (!from) break;

        send("pointerdown", from.clientX, from.clientY);
        await wait(40);
        // Move in steps: a single jump can be read as a stray event rather than
        // a drag, and the ghost never updates.
        for (let step = 1; step <= 6; step++) {
            const t = step / 6;
            send("pointermove", from.clientX + (drop.clientX - from.clientX) * t,
                                from.clientY + (drop.clientY - from.clientY) * t);
            await wait(25);
        }
        send("pointerup", drop.clientX, drop.clientY);
        await wait(320);
        played += 1;
    }
    return played > 0 ? "played:" + played : "no legal drop";
})()`;

function playScript(moves) {
    return PLAY_MOVES.replace("MOVES", String(moves));
}

/**
 * The gates a screenshot cannot cover: audio actually starts and actually
 * stops, the host lifecycle freezes the game, settings survive a reload, and
 * the bench is still playable with reduced motion on.
 */
async function checkBehaviour(page, problems) {
    const note = (message) => problems.push(`behaviour: ${message}`);

    await page.goto(`http://localhost:${PORT}/?screen=game&qa=1`, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__gameQa !== undefined, null, { timeout: 10_000 });

    // --- audio starts, and muting actually silences the synth ---------------
    await page.evaluate(() => globalThis.__gameQa.unlockAudio());
    await page.waitForTimeout(900);
    let audio = (await page.evaluate(() => globalThis.__gameQa.snapshot())).audio;
    if (audio.contextState !== "running") note(`audio context is "${audio.contextState}", expected running`);
    if (!audio.ambienceRunning) note("the ambience scheduler never started after unlocking");

    await page.evaluate(() => globalThis.__gameQa.setSetting("musicEnabled", false));
    await page.waitForTimeout(600);
    if ((await page.evaluate(() => globalThis.__gameQa.snapshot())).audio.ambienceRunning) {
        note("the ambience scheduler is still running while muted");
    }
    await page.evaluate(() => globalThis.__gameQa.setSetting("musicEnabled", true));

    // --- host lifecycle: hiding the page must suspend audio -----------------
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(600);
    audio = (await page.evaluate(() => globalThis.__gameQa.snapshot())).audio;
    if (audio.contextState === "running") note("audio kept running while the page was hidden");
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(600);
    audio = (await page.evaluate(() => globalThis.__gameQa.snapshot())).audio;
    if (audio.contextState !== "running") note(`audio did not resume when the page came back (${audio.contextState})`);

    // --- settings and progress survive a reload -----------------------------
    await page.evaluate(async () => {
        await globalThis.__gameQa.setSetting("reducedMotion", true);
        await globalThis.__gameQa.setSetting("hapticsEnabled", false);
        await globalThis.__gameQa.setSetting("quality", "low");
        globalThis.__gameQa.grantShards(500);
        await globalThis.__gameQa.setSetting("bestScore", 4321);
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__gameQa !== undefined, null, { timeout: 10_000 });
    const restored = await page.evaluate(() => globalThis.__gameQa.snapshot());
    if (restored.reducedMotion !== true) note("reduced motion did not persist across a reload");
    if (restored.bestScore !== 4321) note(`best score did not persist (got ${restored.bestScore})`);
    if (!(restored.shards >= 500)) note(`shards did not persist (got ${restored.shards})`);

    // --- reduced motion is still playable -----------------------------------
    await page.goto(`http://localhost:${PORT}/?screen=game&qa=1`, { waitUntil: "load" });
    await page.waitForTimeout(900);
    const progressed = await page.evaluate(playScript(3));
    if (!String(progressed).startsWith("played")) note(`reduced motion could not drive the bench (${progressed})`);
    const reduced = await page.evaluate(() => globalThis.__gameQa.snapshot());
    if (!(Number(reduced.movesPlayed) > 0)) note("no placement completed with reduced motion enabled");
    await page.screenshot({ path: path.join(outputDir, "20-reduced-motion.png") });

    // Leave the profile as it was found so a later run starts clean.
    await page.evaluate(async () => {
        await globalThis.__gameQa.setSetting("reducedMotion", false);
        await globalThis.__gameQa.setSetting("hapticsEnabled", true);
        await globalThis.__gameQa.setSetting("quality", "high");
    });
}

const onlyPhone = process.argv.includes("--phone");
const viewports = onlyPhone ? VIEWPORTS.slice(0, 1) : VIEWPORTS;

fs.mkdirSync(outputDir, { recursive: true });

const server = await createServer({
    configFile: path.join(root, "vite.config.js"),
    logLevel: "silent",
    server: { port: PORT, strictPort: true },
});
await server.listen();

let browser;
const problems = [];
let shots = 0;

try {
    // Headless Chromium blocks audio until a user gesture, and there is no real
    // gesture here. Allowing autoplay is what makes the audio assertions above
    // measure the actual synth graph rather than a permanently locked context.
    browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

    for (const viewport of viewports) {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: viewport.scale,
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => problems.push(`${viewport.name}: page error: ${error.stack ?? error.message}`));
        page.on("console", (message) => {
            if (message.type() !== "error") return;
            problems.push(`${viewport.name}: console error: ${message.text()}`);
        });

        for (const shot of SCREENS) {
            const query = shot.screen ? `?screen=${shot.screen}&qa=1` : "?qa=1";
            await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: "load" });
            await page.waitForTimeout(800);
            await page.screenshot({ path: path.join(outputDir, `${viewport.name}-${shot.name}.png`) });
            shots += 1;

            // Long screens hide their tail below the fold, and the tail is where
            // the products and the safety notes live. Photograph the bottom too,
            // or half of a scrolling screen is never reviewed.
            const scrolled = await page.evaluate(() => {
                const region = document.querySelector("[data-testid='screen-scroll-region']");
                if (!region || region.scrollHeight <= region.clientHeight + 8) return false;
                region.scrollTop = region.scrollHeight;
                return true;
            });
            if (scrolled) {
                await page.waitForTimeout(300);
                await page.screenshot({ path: path.join(outputDir, `${viewport.name}-${shot.name}-end.png`) });
                shots += 1;
            }
        }

        // The Run Bits surface only appears after the player's first finished
        // run (DESIGN.md §6.1). A fresh profile therefore shows an empty
        // Workshop, which means the required monetization surface would never
        // be reviewed at all. Seed the run count and photograph it.
        await page.goto(`http://localhost:${PORT}/?screen=atelier&qa=1`, { waitUntil: "load" });
        await page.waitForFunction(() => globalThis.__gameQa !== undefined, null, { timeout: 10_000 });
        await page.evaluate(async () => {
            await globalThis.__gameQa.setSetting("runsPlayed", 5);
            await globalThis.__gameQa.setSetting("shards", 2_000);
        });
        await page.waitForTimeout(600);
        await page.evaluate(() => {
            const region = document.querySelector("[data-testid='screen-scroll-region']");
            if (region) region.scrollTop = region.scrollHeight;
        });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}-07-workshop.png`) });
        shots += 1;

        const offers = await page.evaluate(() =>
            [...document.querySelectorAll(".shop-card")].map((card) => ({
                name: card.querySelector("h3")?.textContent ?? "",
                price: card.querySelector("button")?.textContent ?? "",
            })),
        );
        if (offers.length !== 3) {
            problems.push(`${viewport.name}: expected 3 Run Bits offers after 5 runs, found ${offers.length}`);
        }
        for (const offer of offers) {
            if (!/RB/.test(offer.price)) {
                problems.push(`${viewport.name}: offer "${offer.name}" shows no RB price ("${offer.price}")`);
            }
        }

        // The bench itself, dealt and part-played.
        await page.goto(`http://localhost:${PORT}/?screen=game&qa=1`, { waitUntil: "load" });
        await page.waitForTimeout(1_000);
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}-10-bench-fresh.png`) });
        shots += 1;

        const played = await page.evaluate(playScript(9));
        if (!String(played).startsWith("played")) {
            problems.push(`${viewport.name}: could not drive the bench (${played})`);
        }
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}-11-bench-played.png`) });
        shots += 1;

        // Driving the bench must actually change the game, not merely not crash.
        // Without this the harness would happily pass on a scene that ignores
        // every drag — which is exactly the bug it exists to catch.
        const snapshot = await page.evaluate(() => globalThis.__gameQa?.snapshot() ?? null);
        if (!snapshot) problems.push(`${viewport.name}: QA contract did not install`);
        else {
            if (!(Number(snapshot.movesPlayed) > 0)) {
                problems.push(`${viewport.name}: drags did not place anything (${snapshot.movesPlayed} moves)`);
            }
            if (!(Number(snapshot.score) > 0)) {
                problems.push(`${viewport.name}: placements scored nothing (${snapshot.score})`);
            }
            console.log(
                `  ${viewport.name}: renderer=${snapshot.renderer} moves=${snapshot.movesPlayed} score=${snapshot.score}`,
            );
        }

        // Prove the renderer actually produced a frame.
        //
        // Reading the canvas back in-page does NOT work: without
        // preserveDrawingBuffer a WebGL/WebGPU canvas is empty to drawImage,
        // which would report a false blank on a perfectly good frame. Compare
        // compressed screenshot sizes instead — a genuinely blank region is a
        // flat colour and compresses to almost nothing, while a leaded panel
        // with glass in it cannot.
        const clip = {
            x: viewport.width * 0.15,
            y: viewport.height * 0.3,
            width: viewport.width * 0.7,
            height: viewport.height * 0.25,
        };
        const region = await page.screenshot({ clip });
        if (region.length < 3_000) {
            problems.push(`${viewport.name}: the panel looks blank (${region.length} bytes of detail)`);
        }

        // The firing choreography. It is the most expensive thing in the game
        // to look at and the hardest to reach deliberately, so a screenshot
        // only ever catches one by luck. Seed it and photograph it mid-beat.
        await page.evaluate(() => globalThis.__gameQa?.previewFiring([3], [5], 4));
        await page.waitForTimeout(130);
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}-14-firing.png`) });
        shots += 1;
        await page.waitForTimeout(900);

        // The two cards a player only reaches by finishing a run. Seeding them
        // is the only way they get reviewed on every pass rather than whenever
        // somebody happens to play a run to its end by hand.
        await page.evaluate(() => globalThis.__gameQa?.grantShards(400));
        await page.evaluate(() => globalThis.__gameQa?.forceStuck());
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}-12-stuck.png`) });
        shots += 1;

        await page.evaluate(() => globalThis.__gameQa?.forceResults());
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}-13-results.png`) });
        shots += 1;

        await context.close();
    }

    // The behaviour gates only need running once; the phone viewport is the one
    // that matters and running them four times just costs wall clock.
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(`behaviour: page error: ${error.stack ?? error.message}`));
    page.on("console", (message) => {
        if (message.type() === "error") problems.push(`behaviour: console error: ${message.text()}`);
    });
    await checkBehaviour(page, problems);
    shots += 1;
    await context.close();
} finally {
    await browser?.close();
    await server.close();
}

console.log(`\nWrote ${shots} screenshots to ${path.relative(root, outputDir)}`);
if (problems.length > 0) {
    console.error(`\nVisual QA failed (${problems.length}):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
}
console.log("Visual QA passed: every screen rendered, drags placed glass, and no page or console errors.");
