const fs = require("fs");
const path = require("path");

const ensureLoggedIn = require("../services/auth");
//const waitForKeynuaReady = require("../services/waitForKeynuaReady");

function getSeenFile(env) {
    return `state/${env.key}-transcribe.json`;
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

async function monitorTranscribe(page, env) {
    await page.goto(`${env.baseUrl}/transcribe/`, {
        waitUntil: "networkidle"
    });
    
    await ensureLoggedIn(page, page.context(), env);

  	if (page.url().includes("/auth/login")) {
  		throw new Error(`[${env.label}] Still on login page while checking transcribe.`);
  	}

    /* await page.waitForTimeout(5000);
    //await waitForKeynuaReady(page, env, "Transcribe");

    const pageText = await page.locator("body").innerText();
 */ 
        //console.log(`[${env.label}] Transcribe URL: ${page.url()}`);
        //console.log(`[${env.label}] Transcribe text preview:`);
        //console.log(pageText.slice(0, 2000));
	
	await page.waitForFunction(() => {
		const text = document.body.innerText || "";
		
		const hasRow =
			/[a-f0-9-]+:item:\d+:\d+/i.test(text) ||
			/\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/.test(text);
		
		const isEmpty =
			/No transcribe items are awaiting approval/i.test(text);
			
		return hasRow || isEmpty;
	}, {
		timeout: 5000
	}).catch(() => {
		console.warn("[TRANSCRIBE] Readiness timeout. Falling back to current page content.");
	});
	
	const pageText = await page.locator("body").innerText();

    const itemIdMatches = pageText.match(
        /[a-f0-9-]{8,}-[a-f0-9-]+:\d+:\d+/gi
    ) || [];

    const dateMatches = pageText.match(
        /\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/g
    ) || [];

    const rows = itemIdMatches.map((itemId, index) => ({
        itemId,
        createdAt: dateMatches[index] || "Unknown",
        type: "Transcribe"
    }));

    console.log(`[${env.label}] Detected transcribe rows:`, rows);

    const seen = loadSeen(env);
    const newRequests = rows.filter(r => !seen.includes(r.itemId));

    if (newRequests.length > 0) {
        saveSeen(env, [...seen, ...newRequests.map(r => r.itemId)]);
    }

    return newRequests;
}

module.exports = monitorTranscribe;