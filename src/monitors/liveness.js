const fs = require("fs");
const path = require("path");

const ensureLoggedIn = require("../services/auth");

const DEBUG_LIVENESS =
    process.env.DEBUG_LIVENESS === "true";

function getSeenFile(env) {
    return `state/${env.key}-liveness.json`;
}

function loadSeen(env) {
    const seenFile = getSeenFile(env);

    if (!fs.existsSync(seenFile)) {
        return [];
    }

    return JSON.parse(
        fs.readFileSync(seenFile, "utf8")
    );
}

function saveSeen(env, data) {
    const seenFile = getSeenFile(env);

    fs.mkdirSync(path.dirname(seenFile), {
        recursive: true
    });

    fs.writeFileSync(
        seenFile,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

async function waitForLivenessList(
    page,
    env,
    label
) {
    try {
        await page.waitForResponse(
            response =>
                response
                    .url()
                    .includes(
                        "/liveness-detection/v1/web/list"
                    ) &&
                response.status() === 200,
            {
                timeout: 2000
            }
        );

        console.log(
            `[${env.label}] ${label} liveness list loaded`
        );

        return true;
    } catch {
        console.warn(
            `[${env.label}] ${label} liveness list response not observed. ` +
            "Continuing with page content."
        );

        return false;
    }
}

async function waitForLivenessContent(
    page,
    env,
    label
) {
    try {
        await page.waitForFunction(
            () => {
                const text =
                    document.body?.innerText || "";

                const hasRequestRow =
                    /[a-f0-9-]+:item:\d+:\d+/i.test(
                        text
                    );

                const hasRequestDate =
                    /\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/.test(
                        text
                    );

                const hasEmptyState =
                    /there are no pending/i.test(text) ||
                    /no pending liveness/i.test(text) ||
                    /no liveness requests/i.test(text) ||
                    /no requests/i.test(text);

                return (
                    hasRequestRow ||
                    hasRequestDate ||
                    hasEmptyState
                );
            },
            null,
            {
                timeout: 3000
            }
        );

        return true;
    } catch {
        console.warn(
            `[${env.label}] ${label} DOM readiness not confirmed. ` +
            "Continuing with current page content."
        );

        return false;
    }
}

async function debugLivenessPage(
    page,
    env,
    label
) {
    if (!DEBUG_LIVENESS) {
        return;
    }

    const text = await page
        .locator("body")
        .innerText()
        .catch(() => "");

    const html = await page
        .locator("body")
        .innerHTML()
        .catch(() => "");

    console.log(
        `[LIVENESS DEBUG] ${env.label} ${label} URL: ${page.url()}`
    );

    console.log(
        `[LIVENESS DEBUG TEXT] ${env.label} ${label}`
    );

    console.log(text.slice(0, 3000));

    console.log(
        `[LIVENESS DEBUG HTML] ${env.label} ${label}`
    );

    console.log(html.slice(0, 5000));
}

async function extractLivenessRows(
    page,
    location
) {
    const pageText = await page
        .locator("body")
        .innerText();

    console.log(
        `[LIVENESS] URL: ${page.url()}`
    );

    const itemIdMatches = pageText.match(
        /[a-f0-9-]+:item:\d+:\d+/gi
    ) || [];

    const dateMatches = pageText.match(
        /\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}/g
    ) || [];

    return itemIdMatches.map(
        (itemId, index) => ({
            itemId,
            createdAt:
                dateMatches[index] || "Unknown",
            type: "Liveness Detection",
            location
        })
    );
}

async function monitorLiveness(page, env) {
    if (
        DEBUG_LIVENESS &&
        !page.__livenessDebugListenerAttached
    ) {
        page.__livenessDebugListenerAttached = true;

        page.on("response", response => {
            const url = response.url();

            if (
                url.includes("liveness") ||
                url.includes("approval") ||
                url.includes("request") ||
                url.includes("item")
            ) {
                console.log(
                    `[LIVENESS RESPONSE] ` +
                    `${env.label} ` +
                    `${response.status()} ` +
                    `${url}`
                );
            }
        });
    }

    /*
     * High Priority loads automatically when the page opens,
     * so start listening before navigation.
     */
    const highListPromise =
        waitForLivenessList(
            page,
            env,
            "High priority"
        );

    try {
        await page.goto(
            `${env.baseUrl}/liveness-detection-approval/`,
            {
                waitUntil: "domcontentloaded",
                timeout: 30000
            }
        );
    } catch (error) {
        if (error.name === "TimeoutError") {
            const navigationError = new Error(
                `[${env.label}] Liveness navigation timed out. ` +
                "Retrying on the next pass."
            );

            navigationError.code =
                "MONITOR_NAVIGATION_FAILED";

            throw navigationError;
        }

        throw error;
    }

    const authRecovered = await ensureLoggedIn(
        page,
        page.context(),
        env
    );

    if (authRecovered) {
        const error = new Error(
            `[${env.label}] Authentication recovered during Liveness. ` +
            "Deferring monitoring to the next pass."
        );

        error.code = "AUTH_RECOVERED";

        throw error;
    }

    if (page.url().includes("/auth/login")) {
        throw new Error(
            `[${env.label}] Still on login page while checking liveness.`
        );
    }

    const highListReady =
        await highListPromise;

    /*
     * Only perform the DOM fallback when the network response
     * was not observed.
     */
    if (!highListReady) {
        await waitForLivenessContent(
            page,
            env,
            "High priority"
        );
    }

    await debugLivenessPage(
        page,
        env,
        "High priority"
    );

    let rows = [];

    rows = rows.concat(
        await extractLivenessRows(
            page,
            "Prioridad Alta"
        )
    );

    const lowPriorityTab = page.getByText(
        "Prioridad baja",
        {
            exact: true
        }
    );

    const hasLowPriorityTab =
        await lowPriorityTab
            .isVisible()
            .catch(() => false);

    if (hasLowPriorityTab) {
        console.log(
            `[${env.label}] Clicking low priority tab`
        );

        try {
            /*
             * Start listening before clicking because the
             * click triggers the Low Priority request.
             */
            const lowListPromise =
                waitForLivenessList(
                    page,
                    env,
                    "Low priority"
                );

            await lowPriorityTab.click({
                timeout: 3000
            });

            console.log(
                `[${env.label}] Low priority tab clicked`
            );

            const lowListReady =
                await lowListPromise;

            if (!lowListReady) {
                await waitForLivenessContent(
                    page,
                    env,
                    "Low priority"
                );
            }

            await debugLivenessPage(
                page,
                env,
                "Low priority"
            );
        } catch (error) {
            console.warn(
                `[${env.label}] Low priority tab failed: ${error.message}`
            );
        }

        rows = rows.concat(
            await extractLivenessRows(
                page,
                "Prioridad Baja"
            )
        );
    } else {
        console.warn(
            `[${env.label}] Liveness low priority tab not found.`
        );
    }

    const uniqueRows = Array.from(
        new Map(
            rows.map(row => [
                row.itemId,
                row
            ])
        ).values()
    );

    console.log(
        `[${env.label}] Detected liveness rows:`,
        uniqueRows
    );

    const seen = loadSeen(env);

    const newRequests = uniqueRows.filter(
        request =>
            !seen.includes(request.itemId)
    );

    if (newRequests.length > 0) {
        saveSeen(
            env,
            [
                ...seen,
                ...newRequests.map(
                    request => request.itemId
                )
            ]
        );
    }

    return newRequests;
}

module.exports = monitorLiveness;