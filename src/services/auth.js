const { getSessionFile } = require("./browser");

async function ensureLoggedIn(page, context, env) {
    const requestedUrl = page.url();
    const fallbackUrl = `${env.baseUrl}/liveness-detection-approval/`;

    const targetUrl =
        requestedUrl &&
        !requestedUrl.includes("about:blank") &&
        !requestedUrl.includes("/auth/login")
            ? requestedUrl
            : fallbackUrl;

    const isLoginPage = async () => {
        const currentUrl = page.url();

        if (
            currentUrl.includes("/auth/login") ||
            currentUrl.includes("returnTo=")
        ) {
            return true;
        }

        const emailInputVisible = await page
            .locator('input[placeholder="Email address"]')
            .first()
            .isVisible()
            .catch(() => false);

        if (emailInputVisible) {
            return true;
        }

        const passwordInputVisible = await page
            .locator('input[placeholder="Password"]')
            .first()
            .isVisible()
            .catch(() => false);

        return passwordInputVisible;
    };

    const loginDetected = await isLoginPage();

    console.log(`[${env.label}] ensureLoggedIn URL: ${page.url()}`);
    console.log(`[${env.label}] Login page detected: ${loginDetected}`);

    if (!loginDetected) {
        return;
    }

    console.log(`[${env.label}] Session expired. Logging in again...`);

    await page.waitForSelector('input[placeholder="Email address"]', {
        timeout: 15000
    });

    await page.waitForSelector('input[placeholder="Password"]', {
        timeout: 15000
    });

    await page.fill(
        'input[placeholder="Email address"]',
        process.env.KEYNUA_USERNAME
    );

    await page.fill(
        'input[placeholder="Password"]',
        process.env.KEYNUA_PASSWORD
    );

    await Promise.all([
        page
            .waitForURL(
                url => !url.toString().includes("/auth/login"),
                { timeout: 30000 }
            )
            .catch(() => null),

        page.click('button:has-text("SIGN IN")')
    ]);

    await page.waitForTimeout(2000);

    if (await isLoginPage()) {
        throw new Error(
            `[${env.label}] Login failed. Still on login page after submitting credentials. Current URL: ${page.url()}`
        );
    }

    console.log(`[${env.label}] Login submit completed. Returning to target URL: ${targetUrl}`);

    await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000
    });

    await page.waitForTimeout(2000);

    if (await isLoginPage()) {
        throw new Error(
            `[${env.label}] Login failed or session was not restored after returning to target page. Current URL: ${page.url()}`
        );
    }

    await context.storageState({
        path: getSessionFile(env)
    });

    console.log(`[${env.label}] Session refreshed.`);
}

module.exports = ensureLoggedIn;