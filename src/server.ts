// Tiny web UI: enter a paper title, get the forensics dashboard.
// No dependencies beyond node:http. Run: npm run dev, open http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolvePaper, fetchCiters } from "./serpapi.js";
import { analyze } from "./analyze.js";
import { renderDashboard } from "./report.js";

const PORT = Number(process.env.PORT ?? 3000);
const OUT = path.join(process.cwd(), "out");

const PAGE_CSS = `body{background:#0b0f17;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;margin:0}
.wrap{max-width:640px;margin:0 auto;padding:4rem 1.25rem}
.eyebrow{font-size:.72rem;letter-spacing:.22em;color:#22d3ee;text-transform:uppercase}
h1{font-size:2rem;margin:.4rem 0 .6rem}p.sub{color:#94a3b8;margin-bottom:1.8rem}
form{background:#111826;border:1px solid #1e293b;border-radius:14px;padding:1.4rem}
label{display:block;font-size:.8rem;color:#94a3b8;margin:.9rem 0 .35rem}
input[type=text]{width:100%;background:#0b0f17;border:1px solid #1e293b;border-radius:8px;color:#e2e8f0;padding:.7rem .9rem;font-size:1rem}
input[type=text]:focus{outline:none;border-color:#22d3ee}
.row{display:flex;gap:1rem}.row>div{flex:1}
button{margin-top:1.2rem;width:100%;background:#22d3ee;color:#06202a;border:none;border-radius:8px;padding:.8rem;font-size:1rem;font-weight:700;cursor:pointer}
button:hover{background:#67e8f9}button:disabled{opacity:.5;cursor:wait}
.hint{margin-top:1rem;font-size:.8rem;color:#64748b}
.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:#fca5a5;border-radius:8px;padding:.8rem;margin-bottom:1rem}`;

function landing(error?: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scholar Forensics</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">
<div class="eyebrow">Scholar citation forensics</div>
<h1>Foundational or cartel'd?</h1>
<p class="sub">Paste a paper title. We pull its Google Scholar citation graph via SerpApi and check whether the citations look organic — or like a small club citing itself.</p>
${error ? `<div class="err">${error}</div>` : ""}
<form method="POST" action="/analyze" onsubmit="document.getElementById('go').disabled=true;document.getElementById('go').textContent='Analyzing… (up to a minute)'">
<label for="q">Paper title</label>
<input type="text" id="q" name="q" placeholder="Attention Is All You Need" required autocomplete="off">
<div class="row"><div><label for="max">Citer sample size</label><input type="text" id="max" name="max" value="40"></div></div>
<button id="go" type="submit">Run forensics</button>
</form>
<p class="hint">Costs ~1 SerpApi search to resolve + ~1 per 20 citers. Key lives in <code>.env</code>, never leaves your machine.</p>
</div></body></html>`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(landing());
      return;
    }
    if (req.method === "POST" && url.pathname === "/analyze") {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const q = (params.get("q") ?? "").trim();
      const max = Math.min(Math.max(Number(params.get("max")) || 40, 5), 100);
      if (!q) { res.writeHead(400, { "content-type": "text/html" }); res.end(landing("Enter a paper title.")); return; }
      try {
        const target = await resolvePaper(q);
        if (!target.citedByClusterId) throw new Error("No cited-by data found for this paper — try a more specific title.");
        const citers = await fetchCiters(target.citedByClusterId, max);
        const report = analyze(target, citers);
        const id = randomUUID().slice(0, 8);
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ report, citers, target, generatedAt: new Date().toISOString() }));
        res.writeHead(303, { location: `/r/${id}` });
        res.end();
      } catch (e) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(landing(`Analysis failed: ${e instanceof Error ? e.message : String(e)}`));
      }
      return;
    }
    const m = url.pathname.match(/^\/r\/([a-z0-9-]+)$/);
    if (req.method === "GET" && m) {
      const file = path.join(OUT, `${m[1]}.json`);
      if (!fs.existsSync(file)) { res.writeHead(404); res.end("Not found"); return; }
      const bundle = JSON.parse(fs.readFileSync(file, "utf8"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderDashboard(bundle.report, bundle.citers, new Date(bundle.generatedAt)));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  } catch (e) {
    res.writeHead(500);
    res.end("Server error");
  }
});

server.listen(PORT, () => console.log(`Scholar forensics UI at http://localhost:${PORT}`));
