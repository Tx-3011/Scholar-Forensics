// CLI: npm run analyze -- "paper title" [--max 40]
// Writes out/report.json and out/report.html.

import fs from "node:fs";
import path from "node:path";
import { resolvePaper, fetchCiters } from "./serpapi.js";
import { analyze } from "./analyze.js";
import { renderDashboard } from "./report.js";

async function main() {
  const args = process.argv.slice(2);
  const query = args.find((a) => !a.startsWith("--"));
  if (!query) {
    console.error('Usage: npm run analyze -- "paper title" [--max 40]');
    process.exit(1);
  }
  const maxArg = args.find((a) => a.startsWith("--max"));
  const max = maxArg ? Number(maxArg.split("=")[1] ?? args[args.indexOf(maxArg) + 1]) || 40 : 40;

  console.log(`Resolving "${query}"…`);
  const target = await resolvePaper(query);
  console.log(`Found: ${target.title}`);
  console.log(`  authors: ${target.rawAuthors || target.authors.join(", ") || "n/a"}`);
  if (target.citedByTotal !== undefined) console.log(`  cited by: ~${target.citedByTotal}`);
  if (!target.citedByClusterId) {
    console.error("Could not find a cited-by cluster id for this paper. Try a more specific title.");
    process.exit(1);
  }

  console.log(`Fetching up to ${max} citers…`);
  const citers = await fetchCiters(target.citedByClusterId, max);
  console.log(`Got ${citers.length} citers.`);

  const report = analyze(target, citers);
  const outDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ report, citers, target, generatedAt: new Date().toISOString() }, null, 2));
  fs.writeFileSync(path.join(outDir, "report.html"), renderDashboard(report, citers));
  console.log(`Wrote out/report.json and out/report.html`);
  console.log(`Cartel score: ${report.cartelScore} | self-cite rate: ${report.selfCite.rate} | top venue share: ${report.venueConcentration.topVenueShare}`);
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
