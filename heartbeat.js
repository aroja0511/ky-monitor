require("dotenv").config();

const sendPushover = require("./src/services/pushover");

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

sendHeartbeat();