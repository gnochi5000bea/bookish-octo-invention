const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

// In-memory account status reports, keyed by username
const accounts = {};

// Per-account config (only trade.enabled is per-account)
// accountConfigs[username] = { trade: { enabled: boolean } }
const accountConfigs = {};

// Global config shared by every account
let globalConfig = {
    targetPlayer: "iiPancakes85",
    keepIndicators: ["Island Unique Hair"],
};

function getConfig(username) {
    if (!accountConfigs[username]) {
        accountConfigs[username] = { trade: { enabled: false } };
    }
    return accountConfigs[username];
}

// Full config an account polls: its own trade flag + the global settings
function getFullConfig(username) {
    const cfg = getConfig(username);
    return {
        trade: cfg.trade,
        targetPlayer: globalConfig.targetPlayer,
        keepIndicators: globalConfig.keepIndicators,
    };
}

// ── Auth config (set these as environment variables on your host) ──
// PANEL_USER / PANEL_PASS  -> browser login for you (the dashboard + global config)
// SCRIPT_TOKEN             -> secret the Lua scripts send so they can report in
const PANEL_USER   = process.env.PANEL_USER   || "admin";
const PANEL_PASS   = process.env.PANEL_PASS   || "changeme";
const SCRIPT_TOKEN = process.env.SCRIPT_TOKEN || "change-this-token";

// Constant-time-ish string compare
function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

// Does this request carry the browser Basic Auth credential?
function hasPanelAuth(req) {
    const header = req.headers["authorization"] || "";
    if (!header.startsWith("Basic ")) return false;
    let decoded = "";
    try { decoded = Buffer.from(header.slice(6), "base64").toString("utf8"); } catch { return false; }
    const i = decoded.indexOf(":");
    if (i < 0) return false;
    const user = decoded.slice(0, i);
    const pass = decoded.slice(i + 1);
    return safeEqual(user, PANEL_USER) && safeEqual(pass, PANEL_PASS);
}

// Does this request carry the script token? (header or ?token= query)
function hasScriptToken(req) {
    const headerTok = req.headers["x-script-token"];
    if (headerTok && safeEqual(headerTok, SCRIPT_TOKEN)) return true;
    const qIdx = req.url.indexOf("?token=");
    if (qIdx >= 0) {
        const tok = decodeURIComponent(req.url.slice(qIdx + 7));
        if (safeEqual(tok, SCRIPT_TOKEN)) return true;
    }
    return false;
}

const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Script-Token");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    // Strip the token query param so the rest of the router sees clean URLs
    const tokenQ = req.url.indexOf("?token=");
    const cleanUrl = tokenQ >= 0 ? req.url.slice(0, tokenQ) : req.url;

    // Endpoints the Lua scripts use — allowed with a valid script token
    const isScriptEndpoint =
        (req.method === "POST" && cleanUrl === "/api/status") ||
        (req.method === "GET"  && cleanUrl.startsWith("/api/config/")) ||
        (req.method === "POST" && cleanUrl.startsWith("/api/config/"));

    if (isScriptEndpoint) {
        if (!hasScriptToken(req)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid script token" }));
            return;
        }
        req.url = cleanUrl; // hand clean url to the router below
    } else {
        // Everything else (page, dashboard API, global config) needs browser login
        if (!hasPanelAuth(req)) {
            res.writeHead(401, {
                "WWW-Authenticate": 'Basic realm="Account Control", charset="UTF-8"',
                "Content-Type": "text/plain",
            });
            res.end("Authentication required");
            return;
        }
    }

    // POST /api/status — Lua script sends status updates
    if (req.method === "POST" && req.url === "/api/status") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                if (data.username) {
                    accounts[data.username] = { ...data, timestamp: Date.now() };
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } else {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "missing username" }));
                }
            } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "invalid json" }));
            }
        });
        return;
    }

    // GET /api/accounts — page fetches this
    if (req.method === "GET" && req.url === "/api/accounts") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(accounts));
        return;
    }

    // DELETE /api/accounts/:username — remove an account
    if (req.method === "DELETE" && req.url.startsWith("/api/accounts/")) {
        const username = decodeURIComponent(req.url.slice("/api/accounts/".length));
        if (accounts[username]) {
            delete accounts[username];
            delete accountConfigs[username];
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
        } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "not found" }));
        }
        return;
    }

    // GET /api/global — page reads global config (target player + indicators)
    if (req.method === "GET" && req.url === "/api/global") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(globalConfig));
        return;
    }

    // POST /api/global — page updates global config
    if (req.method === "POST" && req.url === "/api/global") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                if (typeof data.targetPlayer === "string") {
                    globalConfig.targetPlayer = data.targetPlayer;
                }
                if (Array.isArray(data.keepIndicators)) {
                    globalConfig.keepIndicators = data.keepIndicators;
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, config: globalConfig }));
            } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "invalid json" }));
            }
        });
        return;
    }

    // GET /api/config/:username — Lua script polls this (trade flag + global config)
    if (req.method === "GET" && req.url.startsWith("/api/config/")) {
        const username = decodeURIComponent(req.url.slice("/api/config/".length));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getFullConfig(username)));
        return;
    }

    // POST /api/config/:username — page updates trade toggle (per-account)
    if (req.method === "POST" && req.url.startsWith("/api/config/")) {
        const username = decodeURIComponent(req.url.slice("/api/config/".length));
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                const cfg = getConfig(username);
                if (data.trade !== undefined) {
                    cfg.trade = { ...cfg.trade, ...data.trade };
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, config: cfg }));
            } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "invalid json" }));
            }
        });
        return;
    }

    // Serve the page
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
            if (err) { res.writeHead(500); res.end("Error"); return; }
            res.writeHead(200, {
                "Content-Type": "text/html",
                "Cache-Control": "no-store, no-cache, must-revalidate",
            });
            res.end(data);
        });
        return;
    }

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`[Accounts Site] Running on http://localhost:${PORT}`);
});
