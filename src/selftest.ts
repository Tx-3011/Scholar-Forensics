// Offline self-test: validates normalization + analysis against
// SerpApi-shaped fixtures. No API key needed.
import { normalizePaper, normalizeAuthor } from "./serpapi.js";
import { analyze } from "./analyze.js";
import { renderDashboard } from "./report.js";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(cond ? `  ok: ${name}` : `  FAIL: ${name}`);
  if (!cond) failures++;
}

const targetRaw = {
  result_id: "cluster1",
  title: "Attention Is All You Need",
  link: "https://arxiv.org/abs/1706.03762",
  publication_info: { summary: "A Vaswani, N Shazeer, N Parmar - Advances in Neural Information Processing Systems, 2017" },
  snippet: "We propose the Transformer…",
  inline_links: { cited_by: { total: 120000, link: "https://scholar.google.com/scholar?cites=cluster1&hl=en" } },
};

function citer(title: string, summary: string, extra: Record<string, unknown> = {}) {
  return {
    result_id: `c-${title.slice(0, 8)}`,
    title,
    link: "https://example.com/paper",
    publication_info: { summary },
    snippet: "…",
    ...extra,
  };
}

const target = normalizePaper(targetRaw as never);
check("target authors parsed", target.authors.includes("vaswani") && target.authors.includes("shazeer"));
check("target year parsed", target.year === 2017);
check("cited-by cluster id parsed", target.citedByClusterId === "cluster1");
check("cited-by total parsed", target.citedByTotal === 120000);
check("normalizeAuthor surname", normalizeAuthor("J. Smith") === "smith" && normalizeAuthor("Smith, John") === "smith");

const citers = [
  citer("BERT", "J Devlin, M Chang, K Lee - NAACL, 2019"),
  citer("Transformer-XL", "Z Dai, Z Yang, Y Yang, J Carbonell - ACL, 2019"),
  citer("Follow-up by Vaswani", "A Vaswani, L Jones - arXiv, 2020"), // self-cite
  citer("Clique paper 1", "P Kumar, R Singh, T Lee - ICML, 2021"),
  citer("Clique paper 2", "P Kumar, R Singh, A Rao - ICML, 2022"), // shares kumar+singh
  citer("No year paper", "X Unknown"),
].map((r) => normalizePaper(r as never));

const report = analyze(target, citers);
check("self-cite detected", report.selfCite.count === 1 && Math.abs(report.selfCite.rate - 1 / 6) < 0.01);
check("venue concentration", report.venueConcentration.topVenue.includes("icml"));
check("clique detected", report.authorCliques.length === 1 && report.authorCliques[0]!.authors.includes("kumar"));
check("year histogram", report.yearHistogram.some((y) => y.year === 2019 && y.count === 2));
check("cartel score in range", report.cartelScore >= 0 && report.cartelScore <= 1);
check("html renders", renderDashboard(report, citers).includes("Cartel score") && renderDashboard(report, citers).includes("Citation graph") && renderDashboard(report, citers).length > 5000);

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All self-test checks passed.");
