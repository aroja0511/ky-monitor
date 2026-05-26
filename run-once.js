require("dotenv").config();

const fs = require("fs");
fs.mkdirSync("logs", { recursive: true });

const { getBrowser, getContext } = require("./src/services/browser");
const ensureLoggedIn = require("./src/services/auth");

const monitorLiveness = require("./src/monitors/liveness");
const monitorTranscribe = require("./src/monitors/transcribe");
const monitorFraud = require("./src/monitors/fraud");

const sendPushover = require("./src/services/pushover");

async function runMonitor() {
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
    if (browser) {
      await browser.close();
    }
  }
}

runMonitor();