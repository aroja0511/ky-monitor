require("dotenv").config();

const cron = require("node-cron");

const { getBrowser, getContext } = require("./src/services/browser");

const monitorLiveness = require("./src/monitors/liveness");
const monitorTranscribe = require("./src/monitors/transcribe");
const monitorFraud = require("./src/monitors/fraud");

const sendPushover = require("./src/services/pushover");

async function runMonitor() {
  console.log("Running Keynua monitor...");

  const browser = await getBrowser();

  try {
    const context = await getContext(browser);
    const page = await context.newPage();

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

    await sendPushover(
      "⚠️ Keynua Monitor Error",
      error.message
    );
  } finally {
    await browser.close();
  }
}

console.log("Keynua monitor scheduler started");


cron.schedule("*/3 7-9 * * 1-5", async () => {
  const now = new Date();
  const minutes = now.getMinutes();
  const hour = now.getHours();

  if (hour === 9 && minutes > 5) return;

  await runMonitor();
});

cron.schedule("*/3 12-16 * * 1-5", async () => {
  const now = new Date();
  const minutes = now.getMinutes();
  const hour = now.getHours();

  if (hour === 16 && minutes > 5) return;

  await runMonitor();
});