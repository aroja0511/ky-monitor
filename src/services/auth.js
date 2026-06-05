const { getSessionFile } = require("./browser");

async function ensureLoggedIn(page, context, env) {
  const targetUrl = `${env.baseUrl}/liveness-detection-approval/`;

  const isLoginPage = async () => {
    const currentUrl = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");

    return (
      currentUrl.includes("/auth/login") ||
      /sign in/i.test(bodyText) ||
      /forgot your password/i.test(bodyText)
    );
  };

  if (!(await isLoginPage())) {
    return;
  }

  console.log(`[${env.label}] Session expired. Logging in again...`);

  await page.fill('input[placeholder="Email address"]', process.env.KEYNUA_USERNAME);
  await page.fill('input[placeholder="Password"]', process.env.KEYNUA_PASSWORD);

  await page.click('button:has-text("SIGN IN")');
  await page.waitForTimeout(5000);

  await page.goto(targetUrl, {
    waitUntil: "networkidle"
  });

  if (await isLoginPage()) {
    throw new Error(`[${env.label}] Login failed or session was not restored.`);
  }

  await context.storageState({
    path: getSessionFile(env)
  });

  console.log(`[${env.label}] Session refreshed.`);
}

module.exports = ensureLoggedIn;