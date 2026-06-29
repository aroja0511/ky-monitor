require("dotenv").config();

console.log(`
=================================
KEYNUA MONITOR STARTING
PID: ${process.pid}
Time: ${new Date().toISOString()}
Node: ${process.version}
=================================
`);

process.on("SIGTERM", () => {
    console.log(`[SHUTDOWN] SIGTERM received. PID=${process.pid}`);
});

process.on("SIGINT", () => {
    console.log(`[SHUTDOWN] SIGINT received. PID=${process.pid}`);
});

process.on("exit", (code) => {
    console.log(`[SHUTDOWN] Process exiting. Code=${code}. PID=${process.pid}`);
});

const http = require("http");
const fs = require("fs");
const path = require("path");
//const cron = require("node-cron");

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

fs.mkdirSync(DATA_DIR, {
    recursive: true
});

const SCHEDULE_FILE = path.join(
    DATA_DIR,
    "keynua-runtime-schedule.json"
);

const RUN_STATE_FILE = path.join(
    DATA_DIR,
    "keynua-run-state.json"
);

fs.mkdirSync("logs", {
    recursive: true
});

try {
    if (fs.existsSync(RUN_STATE_FILE)) {
        const previousRun = JSON.parse(fs.readFileSync(RUN_STATE_FILE, "utf8"));

        if (previousRun.status === "running") {
            console.log(
                `[RECOVERY] Previous monitor run may have been interrupted. PID=${previousRun.pid}, startedAt=${previousRun.startedAt}`
            );
        }
    }
} catch (error) {
    console.log(`[RECOVERY] Could not read previous run state: ${error.message}`);
}

let isRunning = false;
let skipAlertSent = false;

let currentRunStartedAt = null;

const STALE_RUN_THRESHOLD_MS = 120 * 1000;
const MONITOR_RUN_TIMEOUT_MS = 120 * 1000;

const sentWindowEvents = new Set();

const {
    getBrowser,
    getContext
} = require("./src/services/browser");

const ensureLoggedIn = require("./src/services/auth");

const monitorLiveness = require("./src/monitors/liveness");
const monitorTranscribe = require("./src/monitors/transcribe");
const monitorFraud = require("./src/monitors/fraud");

const ENVIRONMENTS = require("./src/config/environments");

const sendPushover = require("./src/services/pushover");

const DEFAULT_WINDOWS = {
    morning: {
        start: "07:00",
        end: "09:04"
    },
    afternoon: {
        start: "13:00",
        end: "16:04"
    }
};

function readScheduleConfig() {
    try {
        const today = getMadridParts().date;

        const overrides = JSON.parse(
            fs.readFileSync(SCHEDULE_FILE, "utf8")
        );

        const activeOverrides = overrides.filter(
            x => x.endDate >= today
        );

        if (activeOverrides.length !== overrides.length) {
            console.log(
                `[SCHEDULE] Removed ${overrides.length - activeOverrides.length} expired override(s)`
            );

            saveScheduleConfig(activeOverrides);
        }

        return activeOverrides;

    } catch {
        return [];
    }
}

function saveScheduleConfig(data) {
    fs.mkdirSync(path.dirname(SCHEDULE_FILE), {
        recursive: true
    });

    fs.writeFileSync(
        SCHEDULE_FILE,
        JSON.stringify(data, null, 2)
    );
}

function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        });

        req.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });
    });
}

function isAuthorized(req) {
    if (!ADMIN_TOKEN) {
        return false;
    }

    return req.headers.authorization === `Bearer ${ADMIN_TOKEN}`;
}

http.createServer(async (req, res) => {

    const parsedUrl = new URL(
    	req.url,
    	`http://${req.headers.host}`
    );
    
    if (
        req.method === "GET" &&
        (parsedUrl.pathname === "/" || parsedUrl.pathname === "/health")
    ) {
        res.writeHead(200, {
            "Content-Type": "text/plain"
        });

        res.end("Keynua Monitor is running");
        return;
    }

    if (parsedUrl.pathname.startsWith("/admin")) {
        if (!isAuthorized(req)) {
            res.writeHead(401, {
                "Content-Type": "application/json"
            });

            res.end(
                JSON.stringify({
                    success: false,
                    error: "Unauthorized"
                })
            );

            return;
        }
    }

    if (
        req.method === "GET" &&
        parsedUrl.pathname === "/admin/monitor-window"
    ) {
        const overrides = readScheduleConfig();

        res.writeHead(200, {
            "Content-Type": "application/json"
        });

        res.end(JSON.stringify(overrides, null, 2));
        return;
    }

    if (
        req.method === "POST" &&
        parsedUrl.pathname === "/admin/monitor-window"
    ) {
        try {
            const payload = await parseRequestBody(req);

            if (!payload.startDate) {
                throw new Error("startDate is required");
            }

            if (!payload.endDate) {
                throw new Error("endDate is required");
            }

            if (!payload.window || !["morning", "afternoon"].includes(payload.window)) {
                throw new Error("window must be morning or afternoon");
            }

            if (!payload.range) {
                throw new Error("range is required. Example: 13-18");
            }

            const overrides = readScheduleConfig();
            
            const existingIndex = overrides.findIndex(
    		x =>
        		x.startDate === payload.startDate &&
        		x.endDate === payload.endDate &&
	       		x.window === payload.window
			);

            const override = {
                startDate: payload.startDate,
                endDate: payload.endDate,
                window: payload.window,
                range: payload.range,
                includeWeekends: payload.includeWeekends || false,
                createdAt:
                	existingIndex !== -1
						? overrides[existingIndex].createdAt
            			: new Date().toISOString(),
				updatedAt: new Date().toISOString()
            };
            
            let action = "created";
            
            if (existingIndex !== -1) {
            	overrides[existingIndex] = override;
            	action = "updated";
            } else {
            	overrides.push(override);
            }
            
            console.log(
				`[SCHEDULE] Override ${action}: ${payload.startDate} → ${payload.endDate} (${payload.window}) ${payload.range}`
			);

            //overrides.push(override);

            saveScheduleConfig(overrides);

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(
                JSON.stringify({
                    success: true,
                    action,
                    override
                }, null, 2)
            );

            return;

        } catch (error) {
            res.writeHead(400, {
                "Content-Type": "application/json"
            });

            res.end(
                JSON.stringify({
                    success: false,
                    error: error.message
                }, null, 2)
            );

            return;
        }
    }

    if (
        req.method === "DELETE" &&
        parsedUrl.pathname === "/admin/monitor-window"
    ) {
        saveScheduleConfig([]);

        res.writeHead(200, {
            "Content-Type": "application/json"
        });

        res.end(
            JSON.stringify({
                success: true,
                message: "All runtime schedule overrides were cleared."
            }, null, 2)
        );

        return;
    }

    res.writeHead(404, {
        "Content-Type": "text/plain"
    });

    res.end("Not Found");

}).listen(PORT, () => {
    console.log(`Health server running on port ${PORT}`);
});

function getMadridParts() {
    const now = new Date();

    const date = now.toLocaleDateString("en-CA", {
        timeZone: "Europe/Madrid"
    });

    const time = now.toLocaleTimeString("en-GB", {
        timeZone: "Europe/Madrid",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit"
    });

    const day = now.toLocaleString("en-US", {
        timeZone: "Europe/Madrid",
        weekday: "short"
    });

    return {
        date,
        time,
        day
    };
}

function timeToMinutes(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
}

function normalizeRange(range) {
    const [startRaw, endRaw] = range.split("-");

    const start =
        startRaw.includes(":") ? startRaw : `${startRaw.padStart(2, "0")}:00`;

    const endHour =
        endRaw.includes(":") ? endRaw : `${endRaw.padStart(2, "0")}:04`;

    return {
        start,
        end: endHour
    };
}

function isDateWithinRange(date, startDate, endDate) {
    return date >= startDate && date <= endDate;
}

function getActiveWindowConfig() {
    const {
        date,
        time,
        day
    } = getMadridParts();

    const isWeekend =
        day === "Sat" || day === "Sun";

    const overrides = readScheduleConfig();

    for (const override of overrides) {
        if (!isDateWithinRange(date, override.startDate, override.endDate)) {
            continue;
        }

        if (isWeekend && !override.includeWeekends) {
            continue;
        }

        const range = normalizeRange(override.range);

        const nowMinutes = timeToMinutes(time);
        const startMinutes = timeToMinutes(range.start);
        const endMinutes = timeToMinutes(range.end);

        if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) {
            return {
                source: "override",
                window: override.window,
                start: range.start,
                end: range.end,
                includeWeekends: override.includeWeekends || false
            };
        }
    }

    if (isWeekend) {
        return null;
    }

    for (const [windowName, range] of Object.entries(DEFAULT_WINDOWS)) {
        const nowMinutes = timeToMinutes(time);
        const startMinutes = timeToMinutes(range.start);
        const endMinutes = timeToMinutes(range.end);

        if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) {
            return {
                source: "default",
                window: windowName,
                start: range.start,
                end: range.end,
                includeWeekends: false
            };
        }
    }

    return null;
}

async function maybeSendWindowEvent(type, activeWindow) {
    if (!activeWindow) {
        return;
    }

    const {
        date,
        time
    } = getMadridParts();

    const eventKey =
        `${date}-${activeWindow.window}-${activeWindow.start}-${activeWindow.end}-${activeWindow.source}-${type}`;

    if (sentWindowEvents.has(eventKey)) {
        return;
    }

	const nowMinutes = timeToMinutes(time);
	const startMinutes = timeToMinutes(activeWindow.start);
	const endMinutes = timeToMinutes(activeWindow.end);

	if (
    	type === "heartbeat" &&
    	nowMinutes >= startMinutes &&
    	nowMinutes <= startMinutes + 1
	) {
    	sentWindowEvents.add(eventKey);
    	await sendHeartbeat(activeWindow.window);
	}

	if (
    	type === "flatline" &&
    	nowMinutes >= endMinutes &&
    	nowMinutes <= endMinutes + 1
	) {
    	sentWindowEvents.add(eventKey);
    	await sendFlatline(activeWindow.window);
	}
	}

function withTimeout(promise, ms, label) {
    let timeout;

    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms / 1000}s`));
        }, ms);
    });

    return Promise.race([
        promise.finally(() => clearTimeout(timeout)),
        timeoutPromise
    ]);
}

async function runMonitor() {
    const startedAt = Date.now();

    const activeWindow = getActiveWindowConfig();

    if (!activeWindow) {
        //console.log("Outside active monitoring window. Skipping monitor run.");
        return;
    }

    await maybeSendWindowEvent("heartbeat", activeWindow);

    console.log(
        `[HEALTH] PID=${process.pid} Uptime=${Math.round(process.uptime())}s`
    );

    if (isRunning) {
    	const runningFor = currentRunStartedAt
        ? Date.now() - currentRunStartedAt
        : 0;
        
        console.log(`[SKIP] Previous monitor run still active for ${(runningFor / 1000).toFixed(1)}s. PID=${process.pid}`);
        
        if (runningFor > STALE_RUN_THRESHOLD_MS) {
        	console.warn(
            	`[RECOVERY] Stale monitor run detected after ${(runningFor / 1000).toFixed(1)}s. Resetting run lock.`
        	);

        	await sendPushover(
        		"⚠️ Keynua Monitor Restarting",
				`A stale monitor run was detected after ${(runningFor / 1000).toFixed(1)}s.\nRestarting the application to clear stuck browser resources.`
    		);

    		process.exit(1);
    	}

        if (!skipAlertSent) {
            skipAlertSent = true;

            await sendPushover(
                "⚠️ Keynua Monitor Delayed",
                `A monitor cycle was skipped because the previous run is still active for ${(runningFor / 1000).toFixed(1)}s`
            );
        }

        return;
    }

    isRunning = true;
    currentRunStartedAt = Date.now();

    fs.writeFileSync(
        RUN_STATE_FILE,
        JSON.stringify({
            status: "running",
            pid: process.pid,
            startedAt: new Date().toISOString()
        }, null, 2)
    );

    console.log("Running Keynua monitor...");

    const now = new Date().toLocaleString("en-GB", {
        timeZone: "Europe/Madrid"
    });

    console.log(`\n==========`);
    console.log(`Check started: ${now} CET`);
    console.log(
        `Window: ${activeWindow.window} | ${activeWindow.start}-${activeWindow.end} | ${activeWindow.source}`
    );
    console.log(`==========`);

    let browser;
    let page;

    try {
        browser = await getBrowser();

        for (const env of ENVIRONMENTS) {
            console.log(`\n===== ${env.label} =====`);

            const context = await getContext(browser, env);

            try {
                page = await context.newPage();

                /* await page.goto(`${env.baseUrl}/liveness-detection-approval/`, {
                    waitUntil: "domcontentloaded",
    				timeout: 30000
                });

                await ensureLoggedIn(page, context, env);

                if (page.url().includes("/auth/login")) {
                    throw new Error(`[${env.label}] Still on login page after ensureLoggedIn.`);
                }
 */
                const livenessRequests = await monitorLiveness(page, env);

                for (const request of livenessRequests) {
                    await sendPushover(
                        `🚨 [${env.label}] New Liveness ${request.location} Request`,
                        `Created: ${formatKeynuaTime(request.createdAt)} CET\nRequest ID:\n${request.itemId}`
                    );
                }

                console.log(
                    `[${env.label}] Found ${livenessRequests.length} new liveness requests`
                );

                const transcribeRequests = await monitorTranscribe(page, env);

                for (const request of transcribeRequests) {
                    await sendPushover(
                        `🚨 [${env.label}] New Transcribe Request`,
                        `Created: ${formatKeynuaTime(request.createdAt)} CET\nRequest ID:\n${request.itemId}`
                    );
                }

                console.log(
                    `[${env.label}] Found ${transcribeRequests.length} new transcribe requests`
                );

                const fraudRequests = await monitorFraud(page, env);

                for (const request of fraudRequests) {
                    await sendPushover(
                        `🚨 [${env.label}] New Fraud Detection Request`,
                        `Created: ${formatKeynuaTime(request.createdAt)} CET\nRequest ID:\n${request.itemId}`
                    );
                }

                console.log(
                    `[${env.label}] Found ${fraudRequests.length} new fraud requests`
                );

            } finally {
                await context.close().catch(() => {});
            }
        }

    } catch (error) {
        console.error("Monitor error:", error);

        if (page) {
            try {
                await page.screenshot({
                    path: `logs/error-${Date.now()}.png`,
                    fullPage: true
                });
            } catch (screenshotError) {
                console.error(
                    "Failed to capture screenshot:",
                    screenshotError.message
                );
            }
        }

        await sendPushover(
            "⚠️ Keynua Monitor Error",
            error.message
        );

    } finally {
        const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[PERF] Monitor completed in ${duration}s`);

        skipAlertSent = false;
		isRunning = false;
		currentRunStartedAt = null;

        if (browser) {
            await browser.close();
        }

        await maybeSendWindowEvent("flatline", activeWindow);

        fs.writeFileSync(
            RUN_STATE_FILE,
            JSON.stringify({
                status: "completed",
                pid: process.pid,
                startedAt: new Date(startedAt).toISOString(),
                completedAt: new Date().toISOString()
            }, null, 2)
        );
    }
}

async function sendHeartbeat(windowName) {
    const now = new Date().toLocaleString("en-GB", {
        timeZone: "Europe/Madrid"
    });

    await sendPushover(
        "✅ Keynua Monitor Heartbeat",
        `Monitor is running.\nWindow: ${windowName}\nTime: ${now} CET`
    );
    
    console.log(`[HEARTBEAT] Sent for ${windowName} window at ${now} CET`);
}

async function sendFlatline(windowName) {
    const now = new Date().toLocaleString("en-GB", {
        timeZone: "Europe/Madrid"
    });

    await sendPushover(
        "🛑 Keynua Monitor Flatline",
        `${windowName} monitoring window ended.\nTime: ${now} CET`
    );
    
    console.log(`[FLATLINE] Sent for ${windowName} window at ${now} CET`);
}

console.log("Keynua monitor scheduler started");

console.log(
    "[SCHEDULER] Running every 90 seconds"
);

withTimeout(
    runMonitor(),
    MONITOR_RUN_TIMEOUT_MS,
    "Initial monitor run"
).catch(console.error);

setInterval(async () => {
    try {
    	await withTimeout(
        	runMonitor(),
        	MONITOR_RUN_TIMEOUT_MS,
        	"Scheduled monitor run"
    	);
	} catch (error) {
    	console.error("Scheduler error:", error);

    	if (String(error.message || "").includes("timed out")) {
        	await sendPushover(
            	"⚠️ Keynua Monitor Restarting",
            	"Monitor execution exceeded the timeout. Restarting the application."
        	);

        	process.exit(1);
    	}
	}
}, 90 * 1000);

function formatKeynuaTime(createdAt) {
    if (!createdAt || createdAt === "Unknown") return createdAt;

    const [datePart, timePart] = createdAt.split(" ");
    const [day, month, year] = datePart.split("/");
    const [hour, minute, second] = timePart.split(":");

    const utcDate = new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
    ));

    return utcDate.toLocaleString("en-GB", {
        timeZone: "Europe/Madrid"
    });
}