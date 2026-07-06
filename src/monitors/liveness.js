const fs = require("fs");
const path = require("path");

const ensureLoggedIn = require("../services/auth");

const DEBUG_LIVENESS = process.env.DEBUG_LIVENESS === "true";

function getSeenFile(env) {
    return `state/${env.key}-liveness.json`;
}

function loadSeen(env) {
    const seenFile = getSeenFile(env);
    if (!fs.existsSync(seenFile)) return [];
    return JSON.parse(fs.readFileSync(seenFile));
}

function saveSeen(env, data) {
    const seenFile = getSeenFile(env);

    fs.mkdirSync(path.dirname(seenFile), {
        recursive: true
    });

    fs.writeFileSync(seenFile, JSON.stringify(data, null, 2));
}

async function waitForLivenessList(page, env, label) {
    try {
        await page.waitForResponse(
            response =>
                response.url().includes("/liveness-detection/v1/web/list") &&
                response.status() === 200,
            { timeout: 5000 }
        );

        console.log(`[${env.label}] ${label} liveness list loaded`);
    } catch {
        console.warn(`[${env.label}] ${label} liveness list wait timed out. Continuing with page content.`);
    }
}

async function debugLivenessPage(page, env, label) {
    if (!DEBUG_LIVENESS) return;

    const text = await page.locator("body").innerText().catch(() => "");
    const html = await page.locator("body").innerHTML().catch(() => "");

    console.log(`[LIVENESS DEBUG] ${env.label} ${label} URL: ${page.url()}`);
    console.log(`[LIVENESS DEBUG TEXT] ${env.label} ${label}`);
    console.log(text.slice(0, 3000));

    console.log(`[LIVENESS DEBUG HTML] ${env.label} ${label}`);
    console.log(html.slice(0, 5000));
}

async function extractLivenessRows(page, location) {
    const pageText = await page.locator("body").innerText();

    console.log(`[LIVENESS] URL: ${page.url()}`);

    const itemIdMatches = pageText.match(
        /[a-f0-9-]+:item:\d+:\d+/gi
    ) || [];

    const dateMatches = pageText.match(
        /\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/g
    ) || [];

    return itemIdMatches.map((itemId, index) => ({
        itemId,
        createdAt: dateMatches[index] || "Unknown",
        type: "Liveness Detection",
        location
    }));
}

async function monitorLiveness(page, env) {
    if (DEBUG_LIVENESS) {
        page.on("response", response => {
            const url = response.url();

            if (
                url.includes("liveness") ||
                url.includes("approval") ||
                url.includes("request") ||
                url.includes("item")
            ) {
                console.log(
                    `[LIVENESS RESPONSE] ${env.label} ${response.status()} ${url}`
                );
            }
        });
    }

    await page.goto(`${env.baseUrl}/liveness-detection-approval/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000
    });

    await ensureLoggedIn(page, page.context(), env);

    if (page.url().includes("/auth/login")) {
        throw new Error(`[${env.label}] Still on login page while checking liveness.`);
    }

    console.log(`[${env.label}] Waiting for High priority list`);

	try {
    	await waitForLivenessList(page, env, "High priority");

    	console.log(`[${env.label}] High priority list ready`);
	} catch (err) {
    	console.warn(
        	`[${env.label}] High priority list failed: ${err.message}`
    	);
	}

    let rows = [];

    rows = rows.concat(await extractLivenessRows(page, "Prioridad Alta"));

    const lowPriorityTab = page.getByText(
        "Prioridad baja",
        { exact: true }
    );

    const hasLowPriorityTab = await lowPriorityTab
        .isVisible()
        .catch(() => false);

    if (hasLowPriorityTab) {
        console.log(`[${env.label}] Clicking low priority tab`);

      	try {
    		const lowListPromise = waitForLivenessList(page, env, "Low priority");

    		await lowPriorityTab.click({ timeout: 3000 });
    		console.log(`[${env.label}] Low priority tab clicked`);

    		await lowListPromise;
		} catch (err) {
    		console.warn(`[${env.label}] Low priority tab failed: ${err.message}`);
    		// Continue monitoring instead of restarting the whole browser
			}

        rows = rows.concat(
            await extractLivenessRows(
                page,
                "Prioridad Baja"
            )
        );
    } else {
        console.warn(
            `[${env.label}] Liveness low priority tab not found.`
        );
    }

    const uniqueRows = Array.from(
        new Map(rows.map(row => [row.itemId, row])).values()
    );

    console.log(`[${env.label}] Detected liveness rows:`, uniqueRows);

    const seen = loadSeen(env);
    const newRequests = uniqueRows.filter(r => !seen.includes(r.itemId));

    if (newRequests.length > 0) {
        saveSeen(env, [...seen, ...newRequests.map(r => r.itemId)]);
    }

    return newRequests;
}

module.exports = monitorLiveness;