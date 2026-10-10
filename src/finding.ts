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
  let label = "Sample summary", headline = "No author-overlap pairs detected", detail = "This does not rule out citation manipulation. Outgoing references, reciprocal citations, and citation intent were not checked.", tone = "neutral";
  if (report.anomalyScore === null) {
    label = "Insufficient evidence"; headline = "Not enough usable evidence to summarize";
    detail = "Retrieve at least 10 citers with usable target and citer author identities. Missing data cannot establish low risk.";
  } else if (share >= 0.5) {
    label = "Majority venue-label concentration"; tone = "attention";
    headline = `${Math.round(share * 100)}% of sampled citations share one venue label`;
    detail = `${Math.round(share * report.citersAnalyzed)} of ${report.citersAnalyzed} records are labeled “${report.venueConcentration.topVenue}”. Shared reporting guidelines or journal policies may explain this; verify full venue names.`;
  } else if (clusterSize >= 2) {
    label = "Candidate collaboration pattern";
    headline = `${clusterSize} papers connected by candidate author overlap`;
    detail = `The largest connected component contains ${clusterPairs} matching paper pair${clusterPairs === 1 ? "" : "s"}. Connections mean shared names/IDs, not citations between these papers or confirmed coordination.`;
  } else if (report.selfCite.count) {
    headline = `${report.selfCite.count} candidate self-citation matches found`;
    detail = "Candidate author matches can reflect legitimate self-citation; incomplete author lists may miss other matches.";
  }
  return { label, headline, detail, tone, clusterSize, clusterPairs, duplicateGroups };
}
