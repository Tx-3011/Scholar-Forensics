// CLI supports both live retrieval and offline re-analysis of saved bundles.
import fs from "node:fs";
import path from "node:path";
import { resolvePaper, fetchCiters, type ScholarPaper } from "./serpapi.js";
import { analyze } from "./analyze.js";
import { renderDashboard } from "./report.js";
import { interpret } from "./llm.js";
import { collectIntegrity, type IntegrityEvidence } from "./integrity.js";

async function main() {
  const args = process.argv.slice(2);
  let query: string | undefined, from: string | undefined, max = 60, llm = false, refreshIntegrity = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--llm") llm = true;
    else if (arg === "--refresh-integrity") refreshIntegrity = true;
    else if (arg === "--from" || arg.startsWith("--from=")) from = arg.includes("=") ? arg.slice(7) : args[++i];
    else if (arg === "--max" || arg.startsWith("--max=")) max = Number(arg.includes("=") ? arg.slice(6) : args[++i]);
    else if (!arg.startsWith("--") && !query) query = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if ((!query && !from) || (query && from) || !Number.isInteger(max) || max < 5 || max > 100) {
    throw new Error('Usage: npm run analyze -- "paper title" [--max 5..100] [--llm] OR npm run analyze -- --from out/report.json [--refresh-integrity] [--llm]');
  }
  let target: ScholarPaper, citers: ScholarPaper[];
  let sourceGeneratedAt: string | undefined;
  let integrity: IntegrityEvidence | undefined;
  if (from) {
    const bundle = JSON.parse(fs.readFileSync(path.resolve(from), "utf8"));
    if (!bundle.target?.title || !Array.isArray(bundle.citers)) throw new Error("Saved bundle must contain target and citers.");
    target = bundle.target;
    citers = bundle.citers.slice(0, 100);
    sourceGeneratedAt = bundle.generatedAt;
    integrity = bundle.report?.integrity;
    console.log(`Re-analyzing ${citers.length} saved citers; no Scholar API calls.`);
    if (refreshIntegrity) {
      console.log("Refreshing Crossref retraction and reference evidence…");
      integrity = await collectIntegrity(target, citers);
    }
  } else {
    console.log(`Resolving "${query}"…`);
    target = await resolvePaper(query!);
    console.log(`Found: ${target.title}. Fetching up to ${max} citers…`);
    citers = target.citedByClusterId ? await fetchCiters(target.citedByClusterId, max) : [];
    console.log("Checking Crossref retractions and deposited reference network (up to 45 seconds)…");
    integrity = await collectIntegrity(target, citers);
  }
  const report = analyze(target, citers, integrity);
  if (llm) console.log("Requesting source-linked Groq interpretation (one bounded request)…");
  const interpretation = await interpret(report, target, citers, llm);
  const generatedAt = new Date();
  const outDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  // Preserve the original evidence bundle when re-analyzing existing output.
  const prefix = from ? "report-v2" : "report";
  fs.writeFileSync(path.join(outDir, `${prefix}.json`), JSON.stringify({ report, interpretation, citers, target, generatedAt: generatedAt.toISOString(), ...(sourceGeneratedAt ? { sourceGeneratedAt } : {}) }, null, 2));
  fs.writeFileSync(path.join(outDir, `${prefix}.html`), renderDashboard(report, citers, generatedAt, interpretation));
  console.log(`Wrote out/${prefix}.json and out/${prefix}.html`);
  console.log(`Sample anomaly index: ${report.anomalyScore ?? "N/A"} (unvalidated) | author-overlap pairs: ${report.authorOverlaps.length}`);
  console.log(`Assessment: ${report.assessment!.title}`);
  console.log(`AI: ${interpretation.status}${interpretation.message ? ` — ${interpretation.message}` : ""}`);
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
