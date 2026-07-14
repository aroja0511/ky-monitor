const fs = require("fs");
const path = require("path");

const ensureLoggedIn = require("../services/auth");

const DEBUG_FRAUD = process.env.DEBUG_FRAUD === "true";

function getSeenFile(env) {
    return `state/${env.key}-fraud.json`;
}

function debug(env, message) {
    if (!DEBUG_FRAUD) return;
    console.log(`[FRAUD] [${env.label}] ${message}`);
}

function loadSeen(env) {
    const seenFile = getSeenFile(env);
    if (!fs.existsSync(seenFile)) return [];
    return JSON.parse(fs.readFileSync(seenFile));
}

function saveSeen(env, data) {
    const seenFile = getSeenFile(env);
    fs.mkdirSync(path.dirname(seenFile), { recursive: true });
    fs.writeFileSync(seenFile, JSON.stringify(data, null, 2));
}

async function monitorFraud(page, env) {
    const startedAt = Date.now();

    debug(env, "goto started");

    const gotoStartedAt = Date.now();

    await page.goto(`${env.baseUrl}/fraud-detection/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000
    });

    debug(env, `goto completed in ${Date.now() - gotoStartedAt}ms | URL: ${page.url()}`);

    const authStartedAt = Date.now();

    debug(env, "ensureLoggedIn started");

    //await ensureLoggedIn(page, page.context(), env);
    const authRecovered = await ensureLoggedIn(
        page,
        page.context(),
        env
    );

    if (authRecovered) {
        const error = new Error(
            `[${env.label}] Authentication recovered during Fraud. Deferring monitoring to the next pass.`
        );

        error.code = "AUTH_RECOVERED";
        throw error;
    }

    debug(env, `ensureLoggedIn completed in ${Date.now() - authStartedAt}ms | URL: ${page.url()}`);

    if (page.url().includes("/auth/login")) {
        throw new Error(`[${env.label}] Still on login page while checking fraud.`);
    }

    const readinessStartedAt = Date.now();

    debug(env, "readiness wait started");

    await page.waitForFunction(() => {
        const text = document.body.innerText || "";

        const hasRow =
            /[a-z]+:[a-f0-9-]+:item:\d+:\d+/i.test(text) ||
            /\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/.test(text);

        const isEmpty =
            /There are no pending frauds/i.test(text);

        return hasRow || isEmpty;
    }, {
        timeout: 5000
    }).then(() => {
        debug(env, `readiness completed in ${Date.now() - readinessStartedAt}ms`);
    }).catch(() => {
        console.warn(`[FRAUD] [${env.label}] Readiness timeout after ${Date.now() - readinessStartedAt}ms. Falling back to current page content.`);
    });

    const extractStartedAt = Date.now();

    debug(env, "extracting page text");

    const pageText = await page.locator("body").innerText();

    debug(env, `page text extracted in ${Date.now() - extractStartedAt}ms | length=${pageText.length}`);

    const itemIdMatches = pageText.match(
        /[a-z]+:[a-f0-9-]+:item:\d+:\d+/gi
    ) || [];

    const dateMatches = pageText.match(
        /\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/g
    ) || [];

    const rows = itemIdMatches.map((itemId, index) => ({
        itemId,
        createdAt: dateMatches[index] || "Unknown",
        type: "Fraud Detection"
    }));

    console.log(`[${env.label}] Detected fraud rows:`, rows);

    debug(env, `rows extracted: ${rows.length}`);

    const seen = loadSeen(env);
    const newRequests = rows.filter(r => !seen.includes(r.itemId));

    if (newRequests.length > 0) {
        saveSeen(env, [...seen, ...newRequests.map(r => r.itemId)]);
    }

    debug(env, `finished in ${Date.now() - startedAt}ms | newRequests=${newRequests.length}`);

    return newRequests;
}

module.exports = monitorFraud;