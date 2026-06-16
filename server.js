const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

// In-memory account status reports, keyed by username
const accounts = {};

// Per-account config, keyed by username
// accountConfigs[username] = { trade: { enabled: boolean } }
const accountConfigs = {};

function getConfig(username) {
    if (!accountConfigs[username]) {
        accountConfigs[username] = { trade: { enabled: false } };
    }
    return accountConfigs[username];
}

const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

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

    // GET /api/config/:username — Lua script polls this
    if (req.method === "GET" && req.url.startsWith("/api/config/")) {
        const username = decodeURIComponent(req.url.slice("/api/config/".length));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getConfig(username)));
        return;
    }

    // POST /api/config/:username — page updates trade toggle
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
