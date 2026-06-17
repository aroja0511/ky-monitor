const fs = require("fs");
const path = require("path");

const ensureLoggedIn = require("../services/auth");
//const waitForKeynuaReady = require("../services/waitForKeynuaReady");

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

async function extractLivenessRows(page, location) {

    const pageText = await page.locator("body").innerText();

    console.log(`[LIVENESS] URL: ${page.url()}`);
    //console.log(`[LIVENESS] Location: ${location}`);
    //console.log(`[LIVENESS] Text Preview:`);
    //console.log(pageText.slice(0, 2000));

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
    await page.goto(`${env.baseUrl}/liveness-detection-approval/`, {
        waitUntil: "networkidle"
    });
    
    await ensureLoggedIn(page, page.context(), env);

  	if (page.url().includes("/auth/login")) {
  		throw new Error(`[${env.label}] Still on login page while checking liveness.`);
  	}
	
	const spinnerVisible = await page
		.locator(".MuiCircularProgress-root")
    	.first()
    	.isVisible()
    	.catch(() => false);

	console.log(
    	`[${env.label}] Liveness High-P spinner visible before wait: ${spinnerVisible}`
	);
    
    await page.waitForTimeout(5000);
    
    const spinnerAfter = await page
    .locator(".MuiCircularProgress-root")
    .first()
    .isVisible()
    .catch(() => false);

	console.log(
    	`[${env.label}] Liveness High-P spinner AFTER wait: ${spinnerAfter}`
	);
    //await waitForKeynuaReady(page, env, "Liveness high priority");

    let rows = [];

    rows = rows.concat(await extractLivenessRows(page, "Prioridad Alta"));

 /*    const lowPriorityTab = page.locator("text=Prioridad baja");

    if (await lowPriorityTab.count()) {
        await lowPriorityTab.click();
        //await page.waitForTimeout(5000);
        await waitForKeynuaReady(page, env, "Liveness low priority");
        rows = rows.concat(await extractLivenessRows(page, "Prioridad Baja"));
    } */
    
    
    const lowPriorityTab = page.getByText(
    "Prioridad baja",
    { exact: true }
	);

	const hasLowPriorityTab = await lowPriorityTab
    	.isVisible()
    	.catch(() => false);

	if (hasLowPriorityTab) {
    	console.log(`[${env.label}] Clicking low priority tab`);

    	await lowPriorityTab.click();
    	
    	const spinnerVisible = await page
			.locator(".MuiCircularProgress-root")
    		.first()
    		.isVisible()
    		.catch(() => false);

		console.log(
    		`[${env.label}] Liveness Low-P spinner visible before wait: ${spinnerVisible}`
		);


    	await page.waitForTimeout(5000);
    	
    	
    	const spinnerAfter = await page
    		.locator(".MuiCircularProgress-root")
   			.first()
    		.isVisible()
    		.catch(() => false);

		console.log(
    		`[${env.label}] Liveness Low-P spinner AFTER wait: ${spinnerAfter}`
		);

    	/* await waitForKeynuaReady(
        	page,
        	env,
       		"Liveness low priority"
    	);
 */
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