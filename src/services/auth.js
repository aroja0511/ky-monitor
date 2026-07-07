const {
    getSessionFile
} = require("./browser");

async function ensureLoggedIn(page, context, env) {
    const fallbackUrl = `${env.baseUrl}/liveness-detection-approval/`;

    const hasJwtExpiredMessage = async () => {
        const bodyText = await page
            .locator("body")
            .innerText()
            .catch(() => "");

        return (
            /JwtTokenExpired/i.test(bodyText) ||
            /credentials you provided are not valid/i.test(bodyText) ||
            /unauthorized/i.test(bodyText)
        );
    };

    const isLoginPage = async () => {
        const currentUrl = page.url();

        if (
            currentUrl.includes("/auth/login") ||
            currentUrl.includes("returnTo=")
        ) {
            return true;
        }

        if (await hasJwtExpiredMessage()) {
            return true;
        }

        const emailVisible = await page
            .locator('input[placeholder="Email address"]')
            .first()
            .isVisible()
            .catch(() => false);

        const passwordVisible = await page
            .locator('input[placeholder="Password"]')
            .first()
            .isVisible()
            .catch(() => false);

        return emailVisible || passwordVisible;
    };

    const isAppPage = async () => {
        const currentUrl = page.url();

        if (currentUrl.includes("/auth/login")) {
            return false;
        }

        if (await hasJwtExpiredMessage()) {
            return false;
        }

        const bodyText = await page
            .locator("body")
            .innerText()
            .catch(() => "");

        return (
            /liveness detection/i.test(bodyText) ||
            /manual approval/i.test(bodyText) ||
            /transcribe/i.test(bodyText) ||
            /fraud detection/i.test(bodyText) ||
            /contracts/i.test(bodyText) ||
            /reports/i.test(bodyText) ||
            /accounts/i.test(bodyText)
        );
    };

    const waitForAuthStateToSettle = async () => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < 8000) {
            if (await isLoginPage()) {
                return "login";
            }

            if (await isAppPage()) {
                return "app";
            }

            await page.waitForTimeout(500);
        }

        if (await isLoginPage()) {
            return "login";
        }

        if (await isAppPage()) {
            return "app";
        }

        return "unknown";
    };

    const recoverUnknownAuthState = async (targetUrl) => {
        console.warn(
            `[${env.label}] Auth state unknown. Reloading current page once. Current URL: ${page.url()}`
        );

        await page.reload({
            waitUntil: "domcontentloaded",
            timeout: 30000
        }).catch(async () => {
            console.warn(`[${env.label}] Reload failed. Navigating back to target URL.`);

            await page.goto(targetUrl, {
                waitUntil: "domcontentloaded",
                timeout: 30000
            });
        });

        const retryState = await waitForAuthStateToSettle();

        console.log(`[${env.label}] Auth state after reload: ${retryState}`);

        if (retryState === "app" || retryState === "login") {
            return retryState;
        }

        console.warn(
            `[${env.label}] Auth state still unknown after reload. Clearing cookies and forcing login.`
        );

        await context.clearCookies().catch(() => {});

        await page.goto(`${env.baseUrl}/auth/login`, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        const forcedLoginState = await waitForAuthStateToSettle();

        console.log(`[${env.label}] Auth state after forced login navigation: ${forcedLoginState}`);

        if (forcedLoginState !== "login") {
            throw new Error(
                `[${env.label}] Could not recover unknown auth state. Current URL: ${page.url()}`
            );
        }

        return "login";
    };

    const requestedUrl = page.url();

    const targetUrl =
        requestedUrl &&
        !requestedUrl.includes("about:blank") &&
        !requestedUrl.includes("/auth/login") ?
        requestedUrl :
        fallbackUrl;

    let authState = await waitForAuthStateToSettle();

    console.log(`[${env.label}] ensureLoggedIn URL: ${page.url()}`);
    console.log(`[${env.label}] Auth state detected: ${authState}`);

    if (authState === "app") {
        return;
    }
    
    if (authState === "unknown") {
    	authState = await recoverUnknownAuthState(targetUrl);
    	
    	if (authState === "app") {
        return;
    	}   
    }

    if (await hasJwtExpiredMessage()) {
        console.warn(
            `[${env.label}] JWT expired state detected. Clearing session before login.`
        );

        await context.clearCookies().catch(() => {});

        await page.goto(`${env.baseUrl}/auth/login`, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });
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
            url => !url.toString().includes("/auth/login"), {
                timeout: 30000
            }
        )
        .catch(() => null),

        page.click('button:has-text("SIGN IN")')
    ]);

    const postLoginState = await waitForAuthStateToSettle();

    if (postLoginState === "login") {
        throw new Error(
            `[${env.label}] Login failed. Still on login page after submitting credentials. Current URL: ${page.url()}`
        );
    }

    console.log(
        `[${env.label}] Login completed. Returning to target URL: ${targetUrl}`
    );

    await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000
    });

    const finalState = await waitForAuthStateToSettle();

    if (finalState === "login") {
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