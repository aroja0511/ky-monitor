require("dotenv").config();

const { getBrowser, getContext, SESSION_FILE } = require("./src/services/browser");

(async () => {
  const browser = await getBrowser();
  const context = await getContext(browser);
  const page = await context.newPage();

  await page.goto("https://admin.keynua.com/auth/login/", {
    waitUntil: "networkidle"
  });

  await page.fill('input[placeholder="Email address"]', process.env.KEYNUA_USERNAME);
  await page.fill('input[placeholder="Password"]', process.env.KEYNUA_PASSWORD);
  await page.click('button:has-text("SIGN IN")');

  await page.waitForTimeout(5000);

  await context.storageState({ path: SESSION_FILE });

  console.log(`Session saved to ${SESSION_FILE}`);

  await browser.close();
})();