async function waitForKeynuaReady(page, env, label = "Page") {
  const startedAt = Date.now();
  
  const spinner = page.locator(".MuiCircularProgress-root");

try {
  await spinner.first().waitFor({
    state: "visible",
    timeout: 3000
  });

  console.log(
    `[${env.label}] ${label} spinner detected`
  );

} catch {
  console.log(
    `[${env.label}] ${label} spinner NOT detected`
  );
}

try {
  await spinner.first().waitFor({
    state: "hidden",
    timeout: 30000
  });

  console.log(
    `[${env.label}] ${label} spinner hidden`
  );

} catch {
  console.log(
    `[${env.label}] ${label} spinner hidden timeout`
  );
}

await page.waitForTimeout(750);

console.log(
  `[${env.label}] ${label} ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
);


}

module.exports = waitForKeynuaReady;