const fs = require("fs");
const path = require("path");

function getSeenFile(env) {
  return `state/${env.key}-fraud.json`;
}

function loadSeen(env) {
  const seenFile = getSeenFile(env);

  if (!fs.existsSync(seenFile)) return [];

  return JSON.parse(fs.readFileSync(seenFile));
}

function saveSeen(env, data) {
  const seenFile = getSeenFile(env);

  fs.mkdirSync(path.dirname(seenFile), { recursive: true });
  fs.writeFileSync(seenFile, JSON.stringify(data, null, 2));
}

async function monitorFraud(page, env) {
  await page.goto(`${env.baseUrl}/fraud-detection/`, {
    waitUntil: "networkidle"
  });

  await page.waitForTimeout(7000);

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

  console.log(`[${env.label}] Detected fraud rows:`, rows);

  const seen = loadSeen(env);
  const newRequests = rows.filter(r => !seen.includes(r.itemId));

  if (newRequests.length > 0) {
    saveSeen(env, [...seen, ...newRequests.map(r => r.itemId)]);
  }

  return newRequests;
}

module.exports = monitorFraud;