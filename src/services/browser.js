const { chromium } = require("playwright");

const SESSION_FILE = "sessions/keynua-session.json";

async function getBrowser() {
  return await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });
}

async function getContext(browser) {
  try {
    return await browser.newContext({
		storageState: SESSION_FILE,
 		viewport: {
    		width: 1920,
    		height: 1080
    	}
    });
  } catch {
    return await browser.newContext();
  }
}

module.exports = {
  getBrowser,
  getContext,
  SESSION_FILE
};