require("dotenv").config();

console.log(`
=================================
KEYNUA MONITOR STARTING
PID: ${process.pid}
Time: ${new Date().toISOString()}
Node: ${process.version}
=================================
`);

const http = require("http");

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain"
    });
    res.end("Keynua Monitor is running");
}).listen(PORT, () => {
    console.log(`Health server running on port ${PORT}`);
});

const fs = require("fs");
fs.mkdirSync("logs", {
    recursive: true
});

const cron = require("node-cron");

let isRunning = false;
let skipAlertSent = false;

const {
    getBrowser,
    getContext
} = require("./src/services/browser");
const ensureLoggedIn = require("./src/services/auth");

const monitorLiveness = require("./src/monitors/liveness");
const monitorTranscribe = require("./src/monitors/transcribe");
const monitorFraud = require("./src/monitors/fraud");

const ENVIRONMENTS = require("./src/config/environments");

const sendPushover = require("./src/services/pushover");

async function runMonitor() {

    const startedAt = Date.now();

    const madridDay = new Date().toLocaleString("en-US", {
        timeZone: "Europe/Madrid",
        weekday: "short"
    });

    if (madridDay === "Sat" || madridDay === "Sun") {
        console.log("Weekend detected, skipping monitor run");
        return;
    }

    console.log(
        `[HEALTH] PID=${process.pid} Uptime=${Math.round(process.uptime())}s`
    );

    if (isRunning) {

        console.log("Previous monitor run still active. Skipping this cycle.");

        if (!skipAlertSent) {

            skipAlertSent = true;

            await sendPushover(
                "⚠️ Keynua Monitor Delayed",
                "A monitor cycle was skipped because the previous run is still active."
            );
        }

        return;
    }

    isRunning = true;



    console.log("Running Keynua monitor...");

    const now = new Date().toLocaleString("en-GB", {
        timeZone: "Europe/Madrid"
    });

    console.log(`\n==========`);
    console.log(`Check started: ${now} CET`);
    console.log(`==========`);

    let browser;
    let page;

    try {
        browser = await getBrowser();
        const context = await getContext(browser);
        page = await context.newPage();

        /* await page.goto("https://admin.keynua.com/liveness-detection-approval/", {
            waitUntil: "networkidle"
        });

        await ensureLoggedIn(page, context); */

        for (const env of ENVIRONMENTS) {

            console.log(`\n===== ${env.label} =====`);
            
            const context = await getContext(browser, env);
            page = await context.newPage();
            
            await page.goto(`${env.baseUrl}/liveness-detection-approval/`, {
            	waitUntil: "networkidle"
			});

			await ensureLoggedIn(page, context);

            const livenessRequests = await monitorLiveness(page, env);

            for (const request of livenessRequests) {
                await sendPushover(
                    `🚨 [${env.label}] New Liveness ${request.location} Request`,
                    `Created: ${formatKeynuaTime(request.createdAt)} CET
					Request ID:
					${request.itemId}`
                );
            }

            console.log(
                `[${env.label}] Found ${livenessRequests.length} new liveness requests`
            );

            const transcribeRequests = await monitorTranscribe(page, env);

            for (const request of transcribeRequests) {
                await sendPushover(
                    `🚨 [${env.label}] New Transcribe Request`,
                    `Created: ${formatKeynuaTime(request.createdAt)} CET
					Request ID:
					${request.itemId}`
                );
            }

            console.log(
                `[${env.label}] Found ${transcribeRequests.length} new transcribe requests`
            );

            const fraudRequests = await monitorFraud(page, env);

            for (const request of fraudRequests) {
                await sendPushover(
                    `🚨 [${env.label}] New Fraud Detection Request`,
                    `Created: ${formatKeynuaTime(request.createdAt)} CET
					Request ID:
					${request.itemId}`
                );
            }

            console.log(
                `[${env.label}] Found ${fraudRequests.length} new fraud requests`
            );
            await context.close();
        }

    } catch (error) {

        console.error("Monitor error:", error);

        if (page) {
            try {
                await page.screenshot({
                    path: `logs/error-${Date.now()}.png`,
                    fullPage: true
                });
            } catch (screenshotError) {
                console.error(
                    "Failed to capture screenshot:",
                    screenshotError.message
                );
            }
        }

        await sendPushover(
            "⚠️ Keynua Monitor Error",
            error.message
        );

    } finally {

        const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`Monitor completed in ${duration}s`);

        skipAlertSent = false;

        isRunning = false;

        if (browser) {
            await browser.close();
        }
    }
}

async function sendHeartbeat() {

    const now = new Date().toLocaleString("en-GB", {
        timeZone: "Europe/Madrid"
    });

    await sendPushover(
        "✅ Keynua Monitor Heartbeat",
        `Monitor is running.
		Time: ${now} CET`
    );
}

async function sendFlatline(period) {

    const now = new Date().toLocaleString("en-GB", {
        timeZone: "Europe/Madrid"
    });

    await sendPushover(
        "🛑 Keynua Monitor Flatline",
        `${period} monitoring window ended.
		Time: ${now} CET`
    );
}

console.log("Keynua monitor scheduler started");

// runMonitor();

cron.schedule("*/2 7-8 * * 1-5", async () => {
    await runMonitor();
}, {
    timezone: "Europe/Madrid"
});

cron.schedule("0,2,4 9 * * 1-5", async () => {
    await runMonitor();
}, {
    timezone: "Europe/Madrid"
});

cron.schedule("*/2 13-15 * * 1-5", async () => {
    await runMonitor();
}, {
    timezone: "Europe/Madrid"
});

cron.schedule("0,2,4 16 * * 1-5", async () => {
    await runMonitor();
}, {
    timezone: "Europe/Madrid"
});

cron.schedule("0 7 * * 1-5", async () => {
    await sendHeartbeat();
}, {
    timezone: "Europe/Madrid"
});

cron.schedule("0 13 * * 1-5", async () => {
    await sendHeartbeat();
}, {
    timezone: "Europe/Madrid"
});

cron.schedule("4 9 * * 1-5", async () => {
    await sendFlatline("Morning");
}, {
    timezone: "Europe/Madrid"
});

cron.schedule("4 16 * * 1-5", async () => {
    await sendFlatline("Afternoon");
}, {
    timezone: "Europe/Madrid"
});

function formatKeynuaTime(createdAt) {
    if (!createdAt || createdAt === "Unknown") return createdAt;

    const [datePart, timePart] = createdAt.split(" ");
    const [day, month, year] = datePart.split("/");
    const [hour, minute, second] = timePart.split(":");

    const utcDate = new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
    ));

    return utcDate.toLocaleString("en-GB", {
        timeZone: "Europe/Madrid"
    });
}