import assert from "node:assert/strict";
import { collectIntegrity, networkSignals, parseCitationWork, type CitationWork, type IntegrityEvidence } from "./integrity.js";
import { assess } from "./assessment.js";
import { analyze } from "./analyze.js";
import { renderDashboard } from "./report.js";
import type { ScholarPaper } from "./serpapi.js";

const target: ScholarPaper = { resultId: "target", title: "A real study", authors: ["example"], rawAuthors: "Alice Example", link: "https://doi.org/10.1234/target" };
const citers: ScholarPaper[] = Array.from({ length: 10 }, (_, i) => ({ resultId: `c${i}`, title: `Study ${i}`, authors: [`author${i}`], rawAuthors: `First${i} Author${i}`, venue: `Journal ${i}` }));
const report = analyze(target, citers);
const work = (doi: string, author: string, refs: string[] = []): CitationWork => ({ doi, title: doi, url: `https://doi.org/${doi}`, authors: [author], referenceCount: refs.length, references: refs.map((doi) => ({ doi })) });
const base: IntegrityEvidence = { version: 1, status: "completed", checkedAt: "2026-10-10T00:00:00Z", provider: "Crossref", requests: 1, targetDoi: "10.1234/target", retraction: { status: "not-found", urls: [] }, works: [], matchedCiters: 10, matchedCiterDois: citers.map((_, i) => `10.1234/c${i}`), requestedCiters: 10, warnings: [] };

// Older B/C papers are cited by A; later B/C papers cite A and each other's
// older papers. The paper graph is acyclic; the author-team graph cycles.
const targetWork = work("10.1234/target", "alice example", ["10.1234/b0", "10.1234/c0"]);
targetWork.referenceCount = 10;
targetWork.references.push(...Array.from({ length: 8 }, () => ({ venue: "One Journal" })));
const ring: IntegrityEvidence = { ...base, works: [targetWork, work("10.1234/b0", "bob study"), work("10.1234/c0", "carol research"), work("10.1234/b1", "bob study", ["10.1234/target", "10.1234/c0"]), work("10.1234/c1", "carol research", ["10.1234/target", "10.1234/b0"])] };
assert.equal(networkSignals(ring).ringTeams, 3);
assert.equal(networkSignals(ring).reciprocalPairs, 3);
assert.equal(assess(report, ring).level, "strong");
assert.equal(assess(report, { ...ring, works: ring.works.map((w) => ({ ...w, references: w.references.map((r) => ({ doi: r.doi })) })) }).level, "possible");
assert.equal(assess(report, { ...ring, retraction: { status: "verified", urls: ["https://doi.org/10.1234/notice"] } }).level, "retracted");
assert.equal(assess(report, { ...base, retraction: { status: "title-warning", urls: [] } }).level, "review");
assert.equal(assess(report).level, "fine");
assert.equal(assess(report).basis, "sample");
assert.equal(assess(report, { ...base, status: "unavailable" }).level, "fine");
const collaboration = { ...ring, works: ring.works.map((w) => ({ ...w, authors: [...w.authors, "shared collaborator"] })) };
assert.equal(networkSignals(collaboration).ringTeams, 0);
assert.notEqual(assess(report, collaboration).level, "strong");
assert.equal(assess(report, { ...base, works: [targetWork] }).level, "review");
const fineWorks = [work("10.1234/target", "alice example", Array.from({ length: 10 }, (_, i) => `10.1234/r${i}`)), ...citers.map((_, i) => work(`10.1234/c${i}`, `unique author${i}`, ["10.1234/target"]))];
assert.equal(assess(report, { ...base, works: fineWorks }).level, "fine");
assert.equal(assess(report, { ...base, status: "partial", works: fineWorks }).basis, "sample");
assert.equal(assess(report, { ...base, matchedCiterDois: [], works: fineWorks }).basis, "sample");
assert.equal(assess(report, { ...base, works: fineWorks.map((w, i) => i === 0 ? { ...w, authors: [] } : w) }).basis, "sample");
const hugeTarget = { ...target, citedByTotal: 1000000 };
const sample100 = Array.from({ length: 100 }, (_, i) => ({ ...citers[i % 10]!, resultId: `large-${i}`, rawAuthors: `Unique Author${i}` }));
const hugeReport = analyze(hugeTarget, sample100);
assert.equal(hugeReport.assessment?.level, "fine");
assert.equal(hugeReport.assessment?.basis, "sample");
assert.equal(analyze(hugeTarget, [...sample100, ...sample100]).citersAnalyzed, 100);
for (const n of [50, 60, 70, 100]) {
  assert.equal(analyze(hugeTarget, sample100.slice(0, n)).assessment?.level, "fine");
  assert.equal(analyze({ ...hugeTarget, citedByTotal: 1000 }, sample100.slice(0, n)).assessment?.level, "fine");
}
assert.equal(analyze(hugeTarget, sample100.map((c) => ({ ...c, venue: "One Journal" }))).assessment?.level, "review");
assert.equal(analyze(target, []).assessment?.level, "insufficient");
assert.equal(analyze(target, sample100.map((c) => ({ ...c, rawAuthors: "", authorIdentities: [] }))).assessment?.level, "insufficient");
assert.equal(parseCitationWork({ DOI: "10.1234/test", title: ["test"], author: [{ given: "J", family: "Smith" }] }).authors.length, 0);

let requests = 0;
const mock: typeof fetch = async () => {
  requests++;
  return new Response(JSON.stringify({ message: { DOI: "10.1234/target", title: [target.title], author: [{ given: "Alice", family: "Example" }], "reference-count": 1, reference: [{ DOI: "10.1234/older", "journal-title": "A Journal" }], "updated-by": [{ DOI: "10.1234/notice", type: "retraction" }] } }));
};
const verified = await collectIntegrity(target, [], { fetcher: mock, maxReferences: 0 });
assert.equal(verified.retraction.status, "verified"); assert.equal(requests, 1);
assert.equal(verified.works[0]?.referenceCount, 1);
const notice: typeof fetch = async () => new Response(JSON.stringify({ message: { DOI: "10.1234/target", title: [target.title], "update-to": [{ DOI: "10.1234/other-paper", type: "retraction" }] } }));
assert.equal((await collectIntegrity(target, [], { fetcher: notice, maxReferences: 0 })).retraction.status, "not-found");
const wrong: typeof fetch = async () => new Response(JSON.stringify({ message: { DOI: "10.1234/target", title: ["Wrong paper"], "updated-by": [{ DOI: "10.1234/notice", type: "retraction" }] } }));
assert.equal((await collectIntegrity(target, [], { fetcher: wrong })).status, "unavailable");
const failed: typeof fetch = async () => new Response("private provider body", { status: 429 });
const unavailable = await collectIntegrity(target, [], { fetcher: failed });
assert.equal(unavailable.status, "unavailable"); assert.ok(!JSON.stringify(unavailable).includes("private provider body"));
const html = renderDashboard(analyze(target, citers, verified), citers);
assert.ok(html.includes("Retracted — do not treat this paper as reliable"));
assert.ok(html.indexOf('id="assessment-title"') < html.indexOf('id="finding-title"'));
assert.ok(html.includes("https://doi.org/10.1234/notice"));
assert.ok(renderDashboard(report, citers).includes("Looks fine in the sampled citations"));
console.log("All integrity and assessment regression checks passed.");
