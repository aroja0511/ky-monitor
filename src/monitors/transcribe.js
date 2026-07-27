const fs = require("fs");
const path = require("path");

const ensureLoggedIn = require("../services/auth");

const DEBUG_TRANSCRIBE = process.env.DEBUG_TRANSCRIBE === "true";

function getSeenFile(env) {
    return `state/${env.key}-transcribe.json`;
}

function debug(env, message) {
    if (!DEBUG_TRANSCRIBE) return;
    console.log(`[TRANSCRIBE] [${env.label}] ${message}`);
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

async function monitorTranscribe(page, env) {
    const startedAt = Date.now();

    debug(env, "goto started");

    const gotoStartedAt = Date.now();
	
	try {
	
    	await page.goto(`${env.baseUrl}/transcribe/`, {
        	waitUntil: "domcontentloaded",
        	timeout: 30000
    	});
    } catch (error) {
    	if (error.name === "TimeoutError") {
    		const navigationError = new Error(`[${env.label}] Transcribe navigation timed out. Retrying on the next pass.`);
    		
    		navigationError.code = "MONITOR_NAVIGATION_FAILED";
			throw navigationError;
    	}
    	
    	throw error;
    }

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
            `[${env.label}] Authentication recovered during Transcribe. ` + "Deferring monitoring to the next pass."
        );

        error.code = "AUTH_RECOVERED";
        throw error;
    }

    debug(env, `ensureLoggedIn completed in ${Date.now() - authStartedAt}ms | URL: ${page.url()}`);

    if (page.url().includes("/auth/login")) {
        throw new Error(`[${env.label}] Still on login page while checking transcribe.`);
    }

    const readinessStartedAt = Date.now();

    debug(env, "readiness wait started");

    await page.waitForFunction(() => {
        const text = document.body.innerText || "";

        const hasRow =
    		/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12,16}:\d+:\d+/i.test(text) ||
    		/\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/.test(text);

        const isEmpty =
            /No transcribe items are awaiting approval/i.test(text);

        return hasRow || isEmpty;
    }, {
        timeout: 5000
    }).then(() => {
        debug(env, `readiness completed in ${Date.now() - readinessStartedAt}ms`);
    }).catch(() => {
        console.log(`[TRANSCRIBE] [${env.label}] Readiness not confirmed after ` + `${Date.now() - readinessStartedAt}ms. Continuing with current page content.`);
    });

    const extractStartedAt = Date.now();

    debug(env, "extracting page text");

    const pageText = await page.locator("body").innerText();

    debug(env, `page text extracted in ${Date.now() - extractStartedAt}ms | length=${pageText.length}`);

    const itemIdMatches = pageText.match(
        /[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12,16}:\d+:\d+/gi
    ) || [];

    const dateMatches = pageText.match(
        /\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/g
    ) || [];

    const rows = itemIdMatches.map((itemId, index) => ({
        itemId,
        createdAt: dateMatches[index] || "Unknown",
        type: "Transcribe"
    }));

	if (rows.length > 0) {
    	console.log(`[${env.label}] Detected transcribe rows:`, rows);
    }

    debug(env, `rows extracted: ${rows.length}`);

    const seen = loadSeen(env);
    const newRequests = rows.filter(r => !seen.includes(r.itemId));

    if (newRequests.length > 0) {
        saveSeen(env, [...seen, ...newRequests.map(r => r.itemId)]);
    }

    debug(env, `finished in ${Date.now() - startedAt}ms | newRequests=${newRequests.length}`);

    return newRequests;
}

module.exports = monitorTranscribe;