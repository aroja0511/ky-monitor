const fs = require("fs");

const SEEN_FILE = "state/liveness.json";

function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return [];
  return JSON.parse(fs.readFileSync(SEEN_FILE));
}

function saveSeen(data) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(data, null, 2));
}

async function monitorLiveness(page) {
  await page.goto("https://admin.keynua.com/liveness-detection-approval/", {
    waitUntil: "networkidle"
  });

  await page.waitForTimeout(3000);

  const pageText = await page.locator("body").innerText();

  const itemIdMatches = pageText.match(
    /[a-f0-9-]+:item:\d+:\d+/gi
  ) || [];

  const dateMatches = pageText.match(
    /\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/g
  ) || [];

  const rows = itemIdMatches.map((itemId, index) => ({
    itemId,
    createdAt: dateMatches[index] || "Unknown",
    type: "Liveness Detection"
  }));

  console.log("Detected liveness rows:", rows);

  const seen = loadSeen();

  const newRequests = rows.filter(r => !seen.includes(r.itemId));

  if (newRequests.length > 0) {
    saveSeen([
      ...seen,
      ...newRequests.map(r => r.itemId)
    ]);
  }

  return newRequests;
}

module.exports = monitorLiveness;