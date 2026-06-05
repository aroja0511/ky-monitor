const { getSessionFile } = require("./browser");

async function ensureLoggedIn(page, context, env) {
  const currentUrl = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");

  const isLoginPage =
    currentUrl.includes("/auth/login") ||
    /sign in/i.test(bodyText) ||
    /forgot your password/i.test(bodyText);

  if (!isLoginPage) {
    return;
  }

  console.log(`[${env.label}] Session expired. Logging in again...`);

  await page.fill('input[placeholder="Email address"]', process.env.KEYNUA_USERNAME);
  await page.fill('input[placeholder="Password"]', process.env.KEYNUA_PASSWORD);

  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    page.click('button:has-text("SIGN IN")')
  ]);

  await page.waitForTimeout(3000);

  const afterLoginUrl = page.url();
  const afterLoginText = await page.locator("body").innerText().catch(() => "");

  const stillLoginPage =
    afterLoginUrl.includes("/auth/login") ||
    /sign in/i.test(afterLoginText) ||
    /forgot your password/i.test(afterLoginText);

  if (stillLoginPage) {
    throw new Error(`[${env.label}] Login failed or session was not restored.`);
  }

  await context.storageState({
    path: getSessionFile(env)
  });

  console.log(`[${env.label}] Session refreshed.`);
}

module.exports = ensureLoggedIn;