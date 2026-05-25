require("dotenv").config();

const http = require("http");

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Keynua Monitor is running");
}).listen(PORT, () => {
  console.log(`Health server running on port ${PORT}`);
});

const fs = require("fs");
fs.mkdirSync("logs", { recursive: true });

const cron = require("node-cron");

let isRunning = false;

const { getBrowser, getContext } = require("./src/services/browser");
const ensureLoggedIn = require("./src/services/auth");

const monitorLiveness = require("./src/monitors/liveness");
const monitorTranscribe = require("./src/monitors/transcribe");
const monitorFraud = require("./src/monitors/fraud");

const sendPushover = require("./src/services/pushover");

async function runMonitor() {
	if (isRunning) {
  		console.log("Previous monitor run still active. Skipping this cycle.");
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

  const browser = await getBrowser();
  let page;

  try {
    const context = await getContext(browser);
    page = await context.newPage();

    await page.goto("https://admin.keynua.com/liveness-detection-approval/", {
      waitUntil: "networkidle"
    });

    await ensureLoggedIn(page, context);

    const livenessRequests = await monitorLiveness(page);

    for (const request of livenessRequests) {
      await sendPushover(
        "🚨 New Liveness Request",
        `Created: ${request.createdAt}

Request ID:
${request.itemId}`
      );
    }

    console.log(`Found ${livenessRequests.length} new liveness requests`);

    const transcribeRequests = await monitorTranscribe(page);

    for (const request of transcribeRequests) {
      await sendPushover(
        "🚨 New Transcribe Request",
        `Created: ${request.createdAt}

Request ID:
${request.itemId}`
      );
    }

    console.log(`Found ${transcribeRequests.length} new transcribe requests`);

    const fraudRequests = await monitorFraud(page);

    for (const request of fraudRequests) {
      await sendPushover(
        "🚨 New Fraud Detection Request",
        `Created: ${request.createdAt}

Request ID:
${request.itemId}`
      );
    }

    console.log(`Found ${fraudRequests.length} new fraud requests`);
  } catch (error) {
    console.error("Monitor error:", error);

    if (page) {
      try {
        await page.screenshot({
          path: `logs/error-${Date.now()}.png`,
          fullPage: true
        });
      } catch (screenshotError) {
        console.error("Failed to capture screenshot:", screenshotError.message);
      }
    }

    await sendPushover(
      "⚠️ Keynua Monitor Error",
      error.message
    );
  } finally {
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

console.log("Keynua monitor scheduler started");
//runMonitor();

cron.schedule("*/3 7-8 * * 1-5", async () => {
  await runMonitor();
}, {
  timezone: "Europe/Madrid"
});

cron.schedule("0,3 9 * * 1-5", async () => {
  await runMonitor();
}, {
  timezone: "Europe/Madrid"
});

cron.schedule("*/3 13-15 * * 1-5", async () => {
  await runMonitor();
}, {
  timezone: "Europe/Madrid"
});

cron.schedule("0,3 16 * * 1-5", async () => {
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