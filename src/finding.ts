import type { ForensicsReport } from "./analyze.js";
import type { ScholarPaper } from "./serpapi.js";

// Descriptive findings, not calibrated risk classes or misconduct verdicts.
export function summarizeFinding(report: ForensicsReport, citers: ScholarPaper[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const { paperIds: [a, b] } of report.authorOverlaps) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b); adjacency.get(b)!.add(a);
  }
  const seen = new Set<string>();
  let clusterSize = 0, clusterPairs = 0;
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const members = new Set<string>(), stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id); members.add(id);
      stack.push(...adjacency.get(id)!);
    }
    const pairs = report.authorOverlaps.filter((p) => p.paperIds.every((id) => members.has(id))).length;
    if (members.size > clusterSize || (members.size === clusterSize && pairs > clusterPairs)) {
      clusterSize = members.size; clusterPairs = pairs;
    }
  }
  const titles = new Map<string, number>();
  for (const c of citers) {
    const key = c.title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (key) titles.set(key, (titles.get(key) ?? 0) + 1);
  }
  const duplicateGroups = [...titles.values()].filter((count) => count > 1).length;
  const share = report.venueConcentration.topVenueShare;
  let label = "Sample summary", verdict = "No author matches detected", headline = "No candidate self-citations or co-author overlap pairs found", detail = "Missing author metadata may hide matches. Citation intent and reciprocal citations were not checked.", tone = "neutral";
  if (report.anomalyScore === null) {
    label = "Insufficient evidence"; verdict = "Insufficient evidence"; headline = "No reliable sample-level verdict available";
    detail = "The sample has fewer than 10 citers or lacks usable author identities. Missing data does not mean low risk.";
  } else if (share >= 0.5) {
    label = "Majority venue-label concentration"; tone = "attention";
    verdict = "Venue-label concentration found";
    headline = `${Number((share * 100).toFixed(1))}% of sampled citations share one venue label`;
    detail = `${Math.round(share * report.citersAnalyzed)} of ${report.citersAnalyzed} records share “${report.venueConcentration.topVenue}”. Journal policies or reporting guidelines may explain this pattern.`;
  } else if (clusterSize >= 2) {
    label = "Candidate collaboration pattern";
    verdict = "Recurring author matches found";
    headline = `${clusterSize} papers connected by candidate author overlap`;
    detail = `${clusterPairs} matching paper pair${clusterPairs === 1 ? "" : "s"} in the largest group. Shared names/IDs may reflect normal collaboration, not reciprocal citations.`;
  } else if (report.selfCite.count) {
    verdict = "Candidate self-citations found";
    headline = `${report.selfCite.count} of ${report.citersAnalyzed} citers share a candidate target author`;
    detail = "Self-citation can be legitimate. Name matches are not verified identities, and incomplete author lists may hide other matches.";
  }
  return { label, verdict, headline, detail, tone, clusterSize, clusterPairs, duplicateGroups };
}
