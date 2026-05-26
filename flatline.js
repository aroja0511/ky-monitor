require("dotenv").config();

const sendPushover = require("./src/services/pushover");

const period = process.argv[2] || "Monitoring";

async function sendFlatline() {
  const now = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/Madrid"
  });

  await sendPushover(
    "🛑 Keynua Monitor Flatline",
    `${period} monitoring window ended.

Time: ${now} CET`
  );
}

sendFlatline();