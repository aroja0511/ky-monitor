const fs = require("fs");
const path = require("path");

const SEEN_FILE = "state/fraud.json";

function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return [];
  return JSON.parse(fs.readFileSync(SEEN_FILE));
}

function saveSeen(data) {
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });

  fs.writeFileSync(SEEN_FILE, JSON.stringify(data, null, 2));
}

async function monitorFraud(page) {
  await page.goto("https://admin.keynua.com/fraud-detection/", {
    waitUntil: "networkidle"
  });

  await page.waitForTimeout(3000);

  const pageText = await page.locator("body").innerText();

  const itemIdMatches = pageText.match(
    /[a-z]+:[a-f0-9-]+:item:\d+:\d+/gi
  ) || [];

  const dateMatches = pageText.match(
    /\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/g
  ) || [];

  const rows = itemIdMatches.map((itemId, index) => ({
    itemId,
    createdAt: dateMatches[index] || "Unknown",
    type: "Fraud Detection"
  }));

  console.log("Detected fraud rows:", rows);

  const seen = loadSeen();
  const newRequests = rows.filter(r => !seen.includes(r.itemId));

  if (newRequests.length > 0) {
    saveSeen([...seen, ...newRequests.map(r => r.itemId)]);
  }

  return newRequests;
}

module.exports = monitorFraud;