// Tiny web UI: enter a paper title, get the forensics dashboard.
// No dependencies beyond node:http. Run: npm run dev, open http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolvePaper, fetchCiters } from "./serpapi.js";
import { analyze } from "./analyze.js";
import { renderDashboard } from "./report.js";
import { DEFAULT_MODEL, interpret } from "./llm.js";
import { loadEnv } from "./config.js";
import { collectIntegrity } from "./integrity.js";

loadEnv();

const PORT = Number(process.env.PORT ?? 3000);
const OUT = path.join(process.cwd(), "out");

const PAGE_CSS = `*{box-sizing:border-box}body{background:#0b0f17;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;margin:0}
.wrap{max-width:640px;margin:0 auto;padding:4rem 1.25rem}
.eyebrow{font-size:.72rem;letter-spacing:.22em;color:#22d3ee;text-transform:uppercase}
h1{font-size:2rem;margin:.4rem 0 .6rem}p.sub{color:#94a3b8;margin-bottom:1.8rem}
form{background:#111826;border:1px solid #1e293b;border-radius:14px;padding:1.4rem}
label{display:block;font-size:.8rem;color:#94a3b8;margin:.9rem 0 .35rem}
input[type=text],input[type=number]{width:100%;background:#0b0f17;border:1px solid #1e293b;border-radius:8px;color:#e2e8f0;padding:.7rem .9rem;font-size:1rem}
input:focus-visible,button:focus-visible{outline:2px solid #22d3ee;outline-offset:2px}
.row{display:flex;gap:1rem}.row>div{flex:1}
button{margin-top:1.2rem;width:100%;background:#22d3ee;color:#06202a;border:none;border-radius:8px;padding:.8rem;font-size:1rem;font-weight:700;cursor:pointer}
button:hover{background:#67e8f9}button:disabled{opacity:.5;cursor:wait}
.hint{margin-top:1rem;font-size:.8rem;color:#64748b}
.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:#fca5a5;border-radius:8px;padding:.8rem;margin-bottom:1rem}`;

function landing(error?: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scholar Forensics</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">
<div class="eyebrow">Citation cartel screening</div>
<h1>Look beyond citation counts.</h1>
<p class="sub">Get an overall assessment backed by retraction records, reference-list concentration, and citation cycles between candidate author teams.</p>
${error ? `<div class="err">${escape(error)}</div>` : ""}
<form method="POST" action="/analyze" onsubmit="document.getElementById('go').disabled=true;document.getElementById('go').textContent='Checking citations and retractions…'">
<label for="q">Paper title</label>
<input type="text" id="q" name="q" placeholder="Attention Is All You Need" required autocomplete="off">
<div class="row"><div><label for="max">Citer sample size (5–100, first returned results)</label><input type="number" id="max" name="max" value="60" min="5" max="100" required></div></div>
<label for="llm"><input type="checkbox" id="llm" name="llm" value="1"> Include AI interpretation · Groq / ${escape(process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL)}</label>
<p class="hint">Optional: sends compact public metadata for up to 100 citers and calculated evidence to Groq. One paid request, with one smaller retry only for size or output truncation (at most two requests). No full papers or citation passages are read. AI cannot change the assessment.</p>
<p class="hint">Default: 60 citers; hard cap: 100. Even highly cited papers get a sample assessment. Incomplete reference checks are reported separately.</p>
<p class="hint">Includes a public Crossref metadata check: target, up to 20 sampled citers and 12 target references. No extra API key required. Sends public paper titles/DOIs; may add up to 45 seconds. Grades are screening signals, not proof of collusion.</p>
<button id="go" type="submit">Assess this paper</button>
</form>
<p class="hint">Costs ~1 SerpApi search to resolve + ~1 per 20 citers. Keys stay server-side and are sent only to their respective API providers, never included in reports.</p>
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
      const max = Math.trunc(Math.min(Math.max(Number(params.get("max")) || 60, 5), 100));
      if (!q) { res.writeHead(400, { "content-type": "text/html" }); res.end(landing("Enter a paper title.")); return; }
      try {
        const target = await resolvePaper(q);
        const citers = target.citedByClusterId ? await fetchCiters(target.citedByClusterId, max) : [];
        const integrity = await collectIntegrity(target, citers);
        const report = analyze(target, citers, integrity);
        const interpretation = await interpret(report, target, citers, params.get("llm") === "1");
        const id = randomUUID().slice(0, 8);
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ report, interpretation, citers, target, generatedAt: new Date().toISOString() }, null, 2));
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
      bundle.citers = bundle.citers.slice(0, 100);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      // Recompute legacy bundles rather than presenting the obsolete surname-based score.
      const report = analyze(bundle.target, bundle.citers, bundle.report?.integrity);
      res.end(renderDashboard(report, bundle.citers, new Date(bundle.generatedAt), bundle.interpretation));
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
