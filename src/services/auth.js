const {
    getSessionFile
} = require("./browser");

async function ensureLoggedIn(page, context, env) {

    const username = process.env[env.usernameEnv];
    const password = process.env[env.passwordEnv];

    if (!username || !password) {
        throw new Error(
            `[${env.label}] Missing credentials. Expected Railway variables: ` +
            `${env.usernameEnv} and ${env.passwordEnv}`
        );
    }
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

    const waitForLoginForm = async () => {
        const emailSelector = 'input[placeholder="Email address"]';
        const passwordSelector = 'input[placeholder="Password"]';

        const isFormVisible = async () => {
            const emailVisible = await page
                .locator(emailSelector)
                .first()
                .isVisible()
                .catch(() => false);

            const passwordVisible = await page
                .locator(passwordSelector)
                .first()
                .isVisible()
                .catch(() => false);

            return emailVisible && passwordVisible;
        };

        if (await isFormVisible()) {
            return true;
        }

        const firstBodyText = await page
            .locator("body")
            .innerText()
            .catch(() => "");

        if (!firstBodyText.trim()) {
            console.log(
                `[${env.label}] Login page body is empty. Reloading login route once.`
            );

            await page.goto(`${env.baseUrl}/auth/login/`, {
                waitUntil: "domcontentloaded",
                timeout: 30000
            });
        }

        try {
            await page.waitForFunction(
                () => {
                    const email = document.querySelector(
                        'input[placeholder="Email address"]'
                    );

                    const password = document.querySelector(
                        'input[placeholder="Password"]'
                    );

                    return Boolean(email && password);
                },
                null, {
                    timeout: 15000
                }
            );

            return true;
        } catch {
            return false;
        }
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

        await page.goto(`${env.baseUrl}/auth/login/`, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        const forcedLoginState = await waitForAuthStateToSettle();

        console.log(`[${env.label}] Auth state after forced login navigation: ${forcedLoginState}`);

        if (forcedLoginState !== "login") {
            const error = new Error(
                `[${env.label}] Could not recover unknown auth state. Current URL: ${page.url()}`
            );

            error.code = "AUTH_RECOVERY_FAILED";
            throw error;
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
        return false;
    }

    if (authState === "unknown") {
        authState = await recoverUnknownAuthState(targetUrl);

        if (authState === "app") {
            console.log(
                `[${env.label}] Auth state recovered. Deferring monitoring until the next pass.`
            );

            return true;
        }
    }

    if (await hasJwtExpiredMessage()) {
        console.warn(
            `[${env.label}] JWT expired state detected. Clearing session before login.`
        );

        await context.clearCookies().catch(() => {});

        await page.goto(`${env.baseUrl}/auth/login/`, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });
    }

    console.log(`[${env.label}] Session expired. Logging in again...`);

    console.log(`[${env.label}] Login URL: ${page.url()}`);

    const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");

    console.log(
        `[${env.label}] Login page preview: ${JSON.stringify(
        bodyText.slice(0, 1000)
    	)}`
    );
    
    console.log(`[${env.label}] Body HTML length: ${ await page.locator("body").evaluate(el => el.innerHTML.length)}`);
    
    console.log(`[${env.label}] Document readyState: ${ await page.evaluate(() => document.readyState)}`);

    /*    await page.waitForSelector('input[placeholder="Email address"]', {
           timeout: 15000
       });

       await page.waitForSelector('input[placeholder="Password"]', {
           timeout: 15000
       }); */

    const loginFormReady = await waitForLoginForm();

    if (!loginFormReady) {
        const error = new Error(
            `[${env.label}] Login route loaded, but the login form did not render. ` +
            `Current URL: ${page.url()}`
        );

        error.code = "AUTH_RECOVERY_FAILED";
        throw error;
    }

    await page.fill(
        'input[placeholder="Email address"]',
        username
    );

    await page.fill(
        'input[placeholder="Password"]',
        password
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

    if (postLoginState !== "app") {
        const error = new Error(
            `[${env.label}] Login did not reach a valid app state. ` +
            `Detected state: ${postLoginState}. Current URL: ${page.url()}`
        );

        error.code = "AUTH_RECOVERY_FAILED";
        throw error;
    }

    console.log(
        `[${env.label}] Login completed. Returning to target URL: ${targetUrl}`
    );

    await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000
    });

    const finalState = await waitForAuthStateToSettle();

    if (finalState !== "app") {
        const error = new Error(
            `[${env.label}] Session was not restored after returning to the target page. ` +
            `Detected state: ${finalState}. Current URL: ${page.url()}`
        );

        error.code = "AUTH_RECOVERY_FAILED";
        throw error;
    }

    await context.storageState({
        path: getSessionFile(env)
    });

    console.log(`[${env.label}] Session refreshed.`);
    return true;
}

module.exports = ensureLoggedIn;