const {
    getBrowser,
    getContext
} = require("./browser");

const ENVIRONMENTS = require("../config/environments");

const ensureLoggedIn = require("./auth");

const monitorLiveness = require("../monitors/liveness");
const monitorTranscribe = require("../monitors/transcribe");
const monitorFraud = require("../monitors/fraud");

const LIVE_START_CHECK_INTERVAL_MS = Number(
    process.env.LIVE_START_CHECK_INTERVAL_MS || 15000
);

const LIVE_LOOP_DELAY_MS = Number(
    process.env.LIVE_LOOP_DELAY_MS || 1000
);

const LIVE_CHECK_TIMEOUT_MS = Number(
    process.env.LIVE_CHECK_TIMEOUT_MS || 30000
);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
    let timeout;

    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms / 1000}s`));
        }, ms);
    });

    return Promise.race([
        promise.finally(() => clearTimeout(timeout)),
        timeoutPromise
    ]);
}

async function startLiveWorker(deps) {

	console.log("[LIVE] Persistent browser mode enabled");
    console.log("[LIVE] Worker initialized");
    
    const {
        getActiveWindowConfig,
        maybeSendWindowEvent,
        formatKeynuaTime,
        sendPushover
    } = deps;

    let liveLoopRunning = false;

    console.log("[LIVE] Worker initialized");

    setInterval(async () => {
        const activeWindow = getActiveWindowConfig();

        if (!activeWindow) {
            return;
        }

        if (liveLoopRunning) {
            return;
        }

        liveLoopRunning = true;

        startLiveLoop({
            activeWindow,
            getActiveWindowConfig,
            maybeSendWindowEvent,
            formatKeynuaTime,
            sendPushover,
            onStop: () => {
                liveLoopRunning = false;
            }
        }).catch(async error => {
            console.error("[LIVE] Fatal live loop error:", error);

            await sendPushover(
                "⚠️ Keynua Live Monitor Restarting",
                error.message
            );

            process.exit(1);
        });
    }, LIVE_START_CHECK_INTERVAL_MS);
}

async function startLiveLoop(options) {
    const {
        activeWindow,
        getActiveWindowConfig,
        maybeSendWindowEvent,
        formatKeynuaTime,
        sendPushover,
        onStop
    } = options;

    let browser = null;
    const resources = [];

    console.log(
        `[LIVE] Starting live loop | ${activeWindow.window} ${activeWindow.start}-${activeWindow.end} | ${activeWindow.source}`
    );

    await maybeSendWindowEvent("heartbeat", activeWindow);

    try {
        browser = await getBrowser();
        console.log("[LIVE] Chromium browser started");

        for (const env of ENVIRONMENTS) {
            const context = await getContext(browser, env);
            const page = await context.newPage();

            resources.push({
                env,
                context,
                page
            });

            console.log(`[LIVE] ${env.label} page initialized`);

            await page.goto(`${env.baseUrl}/liveness-detection-approval/`, {
                waitUntil: "domcontentloaded",
                timeout: 30000
            });

            await page.waitForTimeout(3000);

            await ensureLoggedIn(page, context, env);

            if (page.url().includes("/auth/login")) {
                throw new Error(`[${env.label}] Still on login page after live initialization.`);
            }

            console.log(`[LIVE] ${env.label} session ready`);
        }
        
        console.log("[LIVE] All environments initialized. Entering monitoring loop...");

        while (true) {
            const currentWindow = getActiveWindowConfig();

            if (!currentWindow) {
                console.log("[LIVE] Active window ended. Stopping live loop.");
                break;
            }

            const startedAt = Date.now();

            for (const resource of resources) {
                await runEnvironmentLivePass({
                    ...resource,
                    formatKeynuaTime,
                    sendPushover
                });
            }

            const duration = ((Date.now() - startedAt) / 1000).toFixed(1);

            console.log(`[LIVE] Full pass completed in ${duration}s`);

            await sleep(LIVE_LOOP_DELAY_MS);
        }
    } finally {
        for (const resource of resources) {
            await resource.page.close().catch(() => {});
            await resource.context.close().catch(() => {});
        }

        if (browser) {
            await browser.close().catch(() => {});
        }

        await maybeSendWindowEvent("flatline", activeWindow);

        if (onStop) {
            onStop();
        }

        console.log("[LIVE] Browser closed. Live loop stopped.");
    }
}

async function runEnvironmentLivePass(options) {
    const {
        env,
        page,
        formatKeynuaTime,
        sendPushover
    } = options;

    console.log(`[LIVE] ===== ${env.label} =====`);

    const livenessRequests = await withTimeout(
        monitorLiveness(page, env),
        LIVE_CHECK_TIMEOUT_MS,
        `${env.label} live liveness`
    );

    for (const request of livenessRequests) {
        await sendPushover(
            `🚨 [${env.label}] New Liveness ${request.location} Request`,
            `Created: ${formatKeynuaTime(request.createdAt)} CET\nRequest ID:\n${request.itemId}`
        );
    }

    console.log(
        `[LIVE] [${env.label}] Found ${livenessRequests.length} new liveness requests`
    );

    const transcribeRequests = await withTimeout(
        monitorTranscribe(page, env),
        LIVE_CHECK_TIMEOUT_MS,
        `${env.label} live transcribe`
    );

    for (const request of transcribeRequests) {
        await sendPushover(
            `🚨 [${env.label}] New Transcribe Request`,
            `Created: ${formatKeynuaTime(request.createdAt)} CET\nRequest ID:\n${request.itemId}`
        );
    }

    console.log(
        `[LIVE] [${env.label}] Found ${transcribeRequests.length} new transcribe requests`
    );

    const fraudRequests = await withTimeout(
        monitorFraud(page, env),
        LIVE_CHECK_TIMEOUT_MS,
        `${env.label} live fraud`
    );

    for (const request of fraudRequests) {
        await sendPushover(
            `🚨 [${env.label}] New Fraud Detection Request`,
            `Created: ${formatKeynuaTime(request.createdAt)} CET\nRequest ID:\n${request.itemId}`
        );
    }

    console.log(
        `[LIVE] [${env.label}] Found ${fraudRequests.length} new fraud requests`
    );
}

module.exports = startLiveWorker;