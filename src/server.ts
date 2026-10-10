import { DESIGN_CSS } from "./design.js";
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

const PAGE_CSS = DESIGN_CSS;

function landing(error?: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scholar Forensics</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">
<header class="site-header"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">s</span> Scholar Forensics</a><span class="header-note">A closer look at research</span><a class="new-search" href="#method">How it works &#8599;</a></header>
<main class="landing-layout"><section class="intro"><div class="eyebrow">Citation cartel screening</div>
<h1>Good research.<br><em>Look closer.</em></h1>
<p class="sub">Citation counts tell one story. Explore the authors, sources, and connections behind a paper to see the fuller picture.</p>
<div class="research-note"><strong>01 /</strong><p>Start with a paper. Follow the evidence.<br>Built for a more considered reading of research.</p></div></section>
<section class="search-panel" aria-labelledby="search-title"><h2 class="form-heading" id="search-title">Investigate a paper</h2><p class="form-sub">Enter its title to begin your evidence check.</p>
${error ? `<div class="err" role="alert">${escape(error)}</div>` : ""}
<form method="POST" action="/analyze" onsubmit="document.getElementById('go').disabled=true;document.getElementById('go').textContent='Checking citations and retractions…'">
<label class="field-label" for="q">Paper title</label><input type="text" id="q" name="q" placeholder="e.g. Attention Is All You Need" required autocomplete="off">
<div class="sample-row"><div><label class="field-label" for="max">Sample size</label><input type="number" id="max" name="max" value="60" min="5" max="100" required aria-describedby="sample-note"></div><p class="sample-note" id="sample-note">5–100 citing papers.<br>First returned Scholar results.</p></div>
<div class="ai-option"><label for="llm"><input type="checkbox" id="llm" name="llm" value="1"> Include AI interpretation</label><p class="hint">Optional commentary from Groq / ${escape(process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL)}. AI cannot change the assessment.</p></div>
<button id="go" type="submit"><span>Assess this paper</span><span aria-hidden="true">&#8594;</span></button>
<p class="hint">A bounded sample, with public Crossref reference and retraction checks. This may add up to 45 seconds.</p>
<details class="disclosures"><summary>Data, costs &amp; limitations</summary><p class="hint">Default: 60 citers; hard cap: 100. Even highly cited papers get a sample assessment. Incomplete reference checks are reported separately. Grades are screening signals, not proof of collusion.</p><p class="hint">Crossref checks the target, up to 20 sampled citers and 12 target references. Public paper titles and DOIs are sent to Crossref. No extra API key required.</p><p class="hint">Enabling AI sends compact public metadata for up to 100 citers and calculated evidence to Groq. One paid request, with one smaller retry only for size or output truncation (at most two requests). No full papers or citation passages are read.</p><p class="hint">Costs ~1 SerpApi search to resolve + ~1 per 20 citers. Keys stay server-side and are sent only to their respective API providers, never included in reports.</p></details>
</form></section></main>
<section class="method-strip" id="method" aria-label="How it works"><div class="method-step"><span class="step-number">01</span><div><h2>Find the paper</h2><p>Resolve your title on Google Scholar and retrieve a bounded citation sample.</p></div></div><div class="method-step"><span class="step-number">02</span><div><h2>Trace the patterns</h2><p>Explore candidate author matches, publication sources, and reference networks.</p></div></div><div class="method-step"><span class="step-number">03</span><div><h2>Read the evidence</h2><p>Review an assessment with linked sources and clearly stated limitations.</p></div></div></section>
<footer class="foot">Google Scholar via SerpApi &nbsp; / &nbsp; Crossref metadata &nbsp; / &nbsp; Evidence before conclusions</footer>
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
