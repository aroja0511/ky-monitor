const { getSessionFile } = require("./browser");

async function ensureLoggedIn(page, context, env) {
  const bodyText = await page.locator("body").innerText();
  const currentUrl = page.url();

  const isLoginPage =
    currentUrl.includes("/auth/login") ||
    bodyText.includes("Sign in") ||
    bodyText.includes("SIGN IN");

  if (!isLoginPage) {
    return;
  }

  console.log(`[${env.label}] Session expired. Logging in again...`);

  await page.fill('input[placeholder="Email address"]', process.env.KEYNUA_USERNAME);
  await page.fill('input[placeholder="Password"]', process.env.KEYNUA_PASSWORD);
  await page.click('button:has-text("SIGN IN")');

  await page.waitForTimeout(5000);

  const afterLoginUrl = page.url();
  const afterLoginText = await page.locator("body").innerText();

  if (
    afterLoginUrl.includes("/auth/login") ||
    afterLoginText.includes("Sign in") ||
    afterLoginText.includes("SIGN IN")
  ) {
    throw new Error(`[${env.label}] Login failed. Still on login page: ${afterLoginUrl}`);
  }

  await context.storageState({ path: getSessionFile(env) });

  console.log(`[${env.label}] Session refreshed.`);
}

module.exports = ensureLoggedIn;