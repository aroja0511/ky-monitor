const { chromium } = require("playwright");
const fs = require("fs");

function getSessionFile(env) {
  return `sessions/keynua-${env.key}-session.json`;
}

async function getBrowser() {
  return await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });
}

async function getContext(browser, env) {
  const sessionFile = getSessionFile(env);

  try {
    return await browser.newContext({
      storageState: sessionFile,
      viewport: {
        width: 1920,
        height: 1080
      }
    });
  } catch {
    return await browser.newContext({
      viewport: {
        width: 1920,
        height: 1080
      }
    });
  }
}

module.exports = {
  getBrowser,
  getContext,
  getSessionFile
};