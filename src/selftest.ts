// Offline self-test: validates normalization + analysis against
// SerpApi-shaped fixtures. No API key needed.
import "./integrity-selftest.js";
import { normalizePaper, normalizeAuthor, resolvePaper, fetchCiters } from "./serpapi.js";
import { analyze } from "./analyze.js";
import { renderDashboard } from "./report.js";
import { summarizeFinding } from "./finding.js";
import { authorIdentity, identities, normalizeVenue, sharedIdentities } from "./identity.js";
import { compactPrompt, evidenceCatalog, interpret, validateClaims } from "./llm.js";

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
check("candidate overlap detected", report.authorOverlaps.length === 1 && report.authorOverlaps[0]!.authors.includes("P Kumar"));
check("year histogram", report.yearHistogram.some((y) => y.year === 2019 && y.count === 2));
check("small sample has no index", report.anomalyScore === null);
check("overlap density uses possible paper pairs", report.overlapDensity === 1 / 15);
check("html renders", renderDashboard(report, citers).includes("Sample anomaly index") && renderDashboard(report, citers).includes("Citation graph") && renderDashboard(report, citers).length > 5000);

const normalize = (title: string, summary: string) => normalizePaper(citer(title, summary));
const deepseek = normalize("DeepSeek", "A Liu, B Wang - arXiv preprint arXiv …, 2024");
const yolo = normalize("YOLO", "A Wang, H Chen, L Liu, K Chen - NeurIPS, 2024");
const vggt = normalize("VGGT", "J Wang, M Chen - CVPR, 2025");
check("different initials do not match common surnames", sharedIdentities(deepseek, yolo).length === 0 && sharedIdentities(vggt, yolo).length === 0);
check("corporate authors and surnames alone are excluded", !authorIdentity("G Team") && !authorIdentity("P Intelligence") && !authorIdentity("Wang"));
check("punctuation and Unicode names normalize", authorIdentity("J. Clavié")?.key === authorIdentity("J Clavié")?.key);
const duplicated = normalize("Duplicate names", "H Chen, H Chen, A Wang - CVPR, 2025");
check("duplicate authors do not inflate overlap", identities(duplicated).length === 2 && sharedIdentities(duplicated, vggt).length === 0);
const idPaper = (id: string, name: string) => normalizePaper({ result_id: id, title: id, publication_info: { authors: [{ name, author_id: id }], summary: "CVPR, 2025" } });
check("conflicting Scholar IDs override matching names", sharedIdentities(idPaper("one", "J Wang"), idPaper("two", "J Wang")).length === 0);
check("matching Scholar IDs survive name variants", sharedIdentities(idPaper("same", "J Wang"), idPaper("same", "John Wang")).length === 1);
check("structured surname-first name preserved", idPaper("smith", "Smith, John").authorIdentities?.[0]?.key === "smith, john");
check("structured surname-first surname parsed once", idPaper("smith", "Smith, John").authors.join(",") === "smith");
check("arXiv variants merge", normalizeVenue(deepseek.venue) === normalizeVenue("arXiv preprint arXiv:2405.21060"));
const repositoryReport = analyze(target, [deepseek, { ...deepseek, resultId: "arxiv2", venue: "arXiv:2405.21060" }]);
check("repositories do not raise venue concentration", repositoryReport.venueConcentration.topVenueShare === 0 && repositoryReport.venueConcentration.excludedPapers === 2);
const empty = analyze(target, []);
check("empty data does not imply low risk", empty.anomalyScore === null && empty.selfCite.rate === 0);
check("coverage and unverified metadata disclosed", report.evidenceQuality.coveragePercent === 6 / 120000 * 100 && report.evidenceQuality.unverifiedAuthorLists === 7);
const many = Array.from({ length: 12 }, (_, i) => ({ ...normalize(`Related ${i}`, "P Kumar, R Singh - ICML, 2024"), resultId: `many${i}` }));
const manyReport = analyze(target, many);
check("all matching pairs count, no top-five truncation", manyReport.authorOverlaps.length === 66 && manyReport.overlapDensity === 1 && manyReport.anomalyScore === 0.55);
check("missing identities cannot produce low-risk index", analyze({ ...target, rawAuthors: "", authorIdentities: [] }, many).anomalyScore === null);
check("local component is surfaced despite global pair dilution", summarizeFinding(manyReport, many).clusterSize === 12 && summarizeFinding(manyReport, many).clusterPairs === 66);
const majorityReport = { ...manyReport, venueConcentration: { ...manyReport.venueConcentration, topVenueShare: 0.525 }, anomalyScore: 0.17 };
check("majority venue headline is precise and independent of small index", summarizeFinding(majorityReport, many).headline.startsWith("52.5%") && summarizeFinding(majorityReport, many).verdict === "Venue-label concentration found" && summarizeFinding(majorityReport, many).tone === "attention");
check("duplicate titles are disclosed without altering evidence", summarizeFinding(report, [deepseek, { ...deepseek, resultId: "version2" }]).duplicateGroups === 1);
check("insufficient evidence takes precedence over venue share", summarizeFinding({ ...majorityReport, anomalyScore: null }, many).label === "Insufficient evidence");
check("headline and accessible drill-down links render", renderDashboard(majorityReport, many).includes('id="finding-title"') && renderDashboard(majorityReport, many).includes('href="#sources-section"') && !renderDashboard(majorityReport, many).includes("LIMITED MEASURED SIGNALS"));
check("overlap verdict does not imply reciprocal citations", summarizeFinding({ ...manyReport, venueConcentration: { ...manyReport.venueConcentration, topVenueShare: 0.1 } }, many).verdict === "Recurring author matches found");
const unmatchedReport = { ...manyReport, authorOverlaps: [], selfCite: { count: 0, rate: 0, papers: [], paperIds: [] }, venueConcentration: { ...manyReport.venueConcentration, topVenueShare: 0.1 } };
check("no-match verdict does not declare innocence", summarizeFinding(unmatchedReport, many).verdict === "No author matches detected");
check("self-citation verdict remains candidate-only", summarizeFinding({ ...unmatchedReport, selfCite: report.selfCite }, many).verdict === "Candidate self-citations found");
check("sample verdict precedes secondary score and includes caveat", renderDashboard(majorityReport, many).indexOf('id="finding-title"') < renderDashboard(majorityReport, many).indexOf("Sample anomaly index") && renderDashboard(majorityReport, many).includes("Pattern finding, not a misconduct verdict."));
const graphReport = analyze(target, [deepseek, yolo, vggt]);
const graphHtml = renderDashboard(graphReport, [deepseek, yolo, vggt]);
check("graph and table use exact pair membership", !graphHtml.includes('"clique":true') && !graphHtml.includes('90,"clique"'));
check("graph includes inspector and accessible view controls", graphHtml.includes('id="graph-paper"') && graphHtml.includes('aria-label="Zoom in"') && graphHtml.includes('aria-live="polite"') && graphHtml.includes('id="graph-reset"'));
check("graph explains dual signals and distinct edge meanings", graphHtml.includes('Both signals') && graphHtml.includes('Dashed purple edges are candidate author overlaps, not citations between papers'));
check("graph settles without perpetual animation or random layout", !graphHtml.includes('requestAnimationFrame') && !graphHtml.includes('Math.random()'));
const emptyGraphHtml = renderDashboard(empty, []);
check("empty graph retains target and reports zero citers", emptyGraphHtml.includes('One paper. 0 citing connections.') && emptyGraphHtml.includes('No citing papers in this sample'));
const hostile = { ...deepseek, title: '</script><script>alert("x")</script>', rawAuthors: "<img src=x onerror=alert(1)>", link: "javascript:alert(1)" };
const hostileHtml = renderDashboard(analyze(target, [hostile]), [hostile]);
check("untrusted HTML and script data escaped", !hostileHtml.includes(hostile.title) && !hostileHtml.includes('href="javascript:') && hostileHtml.includes("\\u003c/script>"));

const evidence = evidenceCatalog(report, target, citers);
const claims = { observations: [{ text: "Six sampled papers.", evidenceIds: ["R1"] }], interpretations: [{ text: "Collaboration may be legitimate.", evidenceIds: ["R4"] }], limitations: [{ text: "Non-random sample; no citation passages.", evidenceIds: ["R1", "P1"] }], nextSteps: [{ text: "Verify author identities.", evidenceIds: ["R2"] }] };
check("valid evidence-linked AI response accepted", validateClaims(claims, evidence).observations[0]?.evidenceIds[0] === "R1");
let rejected = false;
try { validateClaims({ ...claims, observations: [{ text: "Invented citation", evidenceIds: ["P999"] }] }, evidence); } catch { rejected = true; }
check("fabricated evidence IDs rejected", rejected);
rejected = false;
try { validateClaims({ ...claims, cartelProbability: 0.9 }, evidence); } catch { rejected = true; }
check("extra AI verdict fields rejected", rejected);

let requests = 0;
const mockFetch: typeof fetch = async (_url, init) => {
  requests++;
  const request = JSON.parse(String(init?.body));
  check("Groq model and strict schema configured", request.model === "openai/gpt-oss-120b" && request.response_format.json_schema.strict === true);
  check("bounded request excludes AI score and keys from evidence", request.max_completion_tokens === 3072 && !request.messages[1].content.includes("test-key") && !request.messages[1].content.includes("anomalyScore"));
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(claims) } }], usage: { prompt_tokens: 100, completion_tokens: 200 } }));
};
const disabled = await interpret(report, target, citers, false, { apiKey: "test-key", fetcher: mockFetch });
check("AI opt-out sends no request", disabled.status === "skipped" && requests === 0);
const noKey = await interpret(report, target, citers, true, { apiKey: "", fetcher: mockFetch });
check("missing key preserves report without request", noKey.status === "unavailable" && requests === 0);
const ai = await interpret(report, target, citers, true, { apiKey: "test-key", model: "openai/gpt-oss-120b", fetcher: mockFetch });
check("AI provenance and token usage saved", ai.status === "completed" && ai.usage?.completionTokens === 200 && !!ai.promptVersion);
const aiHtml = renderDashboard(report, citers, new Date(), ai);
check("AI disclosure and source anchors rendered", aiHtml.includes("AI-generated") && aiHtml.includes('href="#evidence-R1"') && aiHtml.includes('id="evidence-R1"'));
const badReferences: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...claims, observations: [{ text: "Wrong", evidenceIds: ["bogus"] }] }) } }] }));
check("invalid AI references fall back safely", (await interpret(report, target, citers, true, { apiKey: "test-key", fetcher: badReferences })).status === "unavailable");
const limited: typeof fetch = async () => new Response("secret-provider-response", { status: 429 });
const rateLimit = await interpret(report, target, citers, true, { apiKey: "test-key", fetcher: limited });
check("rate limits do not fail deterministic report or leak bodies", rateLimit.status === "unavailable" && rateLimit.message?.includes("429") === true && !JSON.stringify(rateLimit).includes("secret-provider-response"));
const timeout: typeof fetch = async () => { throw new DOMException("timeout", "TimeoutError"); };
check("timeout falls back safely", (await interpret(report, target, citers, true, { apiKey: "test-key", fetcher: timeout })).status === "unavailable");
const truncated: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: JSON.stringify(claims) } }] }));
check("truncated completions rejected", (await interpret(report, target, citers, true, { apiKey: "test-key", fetcher: truncated })).status === "unavailable");

const hundredCiters = Array.from({ length: 100 }, (_, i) => ({ ...citers[0]!, resultId: `large-${i}`, title: `${i} ${"Long title ".repeat(100)}`, rawAuthors: "Researcher Fullname ".repeat(100), snippet: "Do not send this oversized abstract ".repeat(1000) }));
const hundredReport = analyze(target, hundredCiters);
const hundredEvidence = evidenceCatalog(hundredReport, target, hundredCiters);
const compact = compactPrompt(hundredEvidence);
check("100-citer prompt bounded including schema", compact.promptBytes <= 14000 && compact.citationsSupplied === 100 && !JSON.stringify(compact.messages).includes("oversized abstract"));
check("compact retry keeps all 100 citers", compactPrompt(hundredEvidence, 9000).citationsSupplied === 100);
let boundedCalls = 0;
const sizeRetry: typeof fetch = async (_url, init) => {
  boundedCalls++;
  const request = JSON.parse(String(init?.body));
  const input = JSON.parse(request.messages[1].content);
  check("AI sees every sampled citer on each attempt", input.papers.length === 101 && input.papers.some((p: string[]) => p[0] === "P100"));
  if (boundedCalls === 1) return new Response("provider-private-body", { status: 413 });
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(claims) } }] }));
};
const recoveredSize = await interpret(hundredReport, target, hundredCiters, true, { apiKey: "test-key", fetcher: sizeRetry });
check("413 recovers with exactly one compact retry", recoveredSize.status === "completed" && recoveredSize.requestInfo?.attempts === 2 && recoveredSize.requestInfo.citationsSupplied === 100 && boundedCalls === 2);
let lengthCalls = 0;
const lengthRetry: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: ++lengthCalls === 1 ? "length" : "stop", message: { content: JSON.stringify(claims) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
const recoveredLength = await interpret(report, target, citers, true, { apiKey: "test-key", fetcher: lengthRetry });
check("truncation retry accumulates actual token usage", recoveredLength.status === "completed" && lengthCalls === 2 && recoveredLength.usage?.completionTokens === 40);
let persistentSizeCalls = 0;
const persistentSize: typeof fetch = async () => { persistentSizeCalls++; return new Response("private", { status: 413 }); };
check("size retries stop at two requests", (await interpret(hundredReport, target, hundredCiters, true, { apiKey: "test-key", fetcher: persistentSize })).failureKind === "size" && persistentSizeCalls === 2);

// Retrieval regressions: empty citation pages must preserve prior results,
// while authentication/rate-limit failures must remain errors.
const originalFetch = globalThis.fetch;
const originalSerpKey = process.env.SERPAPI_API_KEY;
process.env.SERPAPI_API_KEY = "offline-test-key";
try {
  let scholarCalls = 0;
  globalThis.fetch = async () => {
    scholarCalls++;
    return new Response(JSON.stringify(scholarCalls === 1
      ? { organic_results: [targetRaw] }
      : { error: "Google hasn't returned any results for this query." }));
  };
  const retained = await fetchCiters("cluster1", 40);
  check("empty later Scholar page preserves retrieved citers", retained.length === 1 && scholarCalls === 2);
  check("empty first Scholar citation page returns no citers", (await fetchCiters("cluster1", 40)).length === 0);
  let searchMessage = "";
  try { await resolvePaper("Missing paper"); } catch (e) { searchMessage = (e as Error).message; }
  check("missing target explains title search and is not a quality result", searchMessage.includes("No Scholar paper found") && searchMessage.includes("not a paper-quality result"));
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429 });
  let apiMessage = "";
  try { await fetchCiters("cluster1", 40); } catch (e) { apiMessage = (e as Error).message; }
  check("real Scholar API failures still throw", apiMessage.includes("Rate limit exceeded"));
  let cappedPages = 0;
  globalThis.fetch = async (url) => {
    cappedPages++;
    const start = Number(new URL(String(url)).searchParams.get("start"));
    return new Response(JSON.stringify({ organic_results: Array.from({ length: 20 }, (_, i) => ({ ...targetRaw, result_id: `cap-${start + i}`, link: `https://example.com/cap-${start + i}`, inline_links: {} })) }));
  };
  const cappedCiters = await fetchCiters("cluster1", 200);
  check("Scholar retrieval hard-caps at 100 and five pages", cappedCiters.length === 100 && cappedPages === 5);
} finally {
  globalThis.fetch = originalFetch;
  if (originalSerpKey === undefined) delete process.env.SERPAPI_API_KEY;
  else process.env.SERPAPI_API_KEY = originalSerpKey;
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All self-test checks passed.");
