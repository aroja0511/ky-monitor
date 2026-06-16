async function waitForKeynuaReady(page, env, label = "Page") {
  const startedAt = Date.now();

  const spinner = page.locator(".MuiCircularProgress-root");

  await spinner.first().waitFor({
    state: "visible",
    timeout: 3000
  }).catch(() => {});

  await spinner.first().waitFor({
    state: "hidden",
    timeout: 30000
  }).catch(() => {});

  await page.waitForTimeout(750);

  console.log(
    `[${env.label}] ${label} ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  );
}

module.exports = waitForKeynuaReady;