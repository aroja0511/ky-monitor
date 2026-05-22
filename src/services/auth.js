const { SESSION_FILE } = require("./browser");

async function ensureLoggedIn(page, context) {
  const bodyText = await page.locator("body").innerText();

  if (!bodyText.includes("Sign in")) {
    return;
  }

  console.log("Session expired. Logging in again...");

  await page.fill('input[placeholder="Email address"]', process.env.KEYNUA_USERNAME);
  await page.fill('input[placeholder="Password"]', process.env.KEYNUA_PASSWORD);
  await page.click('button:has-text("SIGN IN")');

  await page.waitForTimeout(5000);

  await context.storageState({ path: SESSION_FILE });

  console.log("Session refreshed.");
}

module.exports = ensureLoggedIn;