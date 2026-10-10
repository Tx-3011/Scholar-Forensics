// Exploratory screening only: collaboration and concentration do not establish misconduct.
import type { ScholarPaper } from "./serpapi.js";
import { identities, normalizeVenue, sharedIdentities } from "./identity.js";

export type ForensicsReport = {
  schemaVersion: 2;
  target: { title: string; authors: string[]; year?: number; venue?: string; citedByTotal?: number };
  citersAnalyzed: number;
  selfCite: { count: number; rate: number; papers: string[]; paperIds: string[] };
  venueConcentration: { topVenue: string; topVenueShare: number; distinctVenues: number; eligiblePapers: number; excludedPapers: number };
  authorOverlaps: { authors: string[]; paperIds: [string, string] }[];
  overlapDensity: number;
  yearHistogram: { year: number; count: number }[];
  anomalyScore: number | null;
  evidenceQuality: { coveragePercent: number | null; sampling: string; authorMatching: string; unverifiedAuthorLists: number; missingAuthors: number; missingVenues: number; truncatedVenues: number; missingYears: number; warnings: string[] };
  notes: string[];
};

export function analyze(target: ScholarPaper, citers: ScholarPaper[]): ForensicsReport {
  const n = citers.length;
  const selfCited = citers.filter((c) => sharedIdentities(target, c).length > 0);
  const authorOverlaps: ForensicsReport["authorOverlaps"] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const shared = sharedIdentities(citers[i]!, citers[j]!).filter((a) =>
      !identities(target).some((t) => a.scholarId && t.scholarId ? a.scholarId === t.scholarId : a.key === t.key));
    if (shared.length >= 2) authorOverlaps.push({ authors: shared.map((a) => a.name), paperIds: [citers[i]!.resultId, citers[j]!.resultId] });
  }
  const venues = new Map<string, number>();
  let excludedPapers = 0;
  for (const c of citers) {
    const venue = normalizeVenue(c.venue);
    // Broad repositories and missing venues are displayed, but do not raise the index.
    if (venue === "arXiv (repository)" || venue === "unknown source") { excludedPapers++; continue; }
    venues.set(venue, (venues.get(venue) ?? 0) + 1);
  }
  const top = [...venues.entries()].sort((a, b) => b[1] - a[1])[0];
  const venueShare = n ? (top?.[1] ?? 0) / n : 0;
  const selfRate = n ? selfCited.length / n : 0;
  const overlapDensity = n > 1 ? authorOverlaps.length / (n * (n - 1) / 2) : 0;
  const years = new Map<number, number>();
  for (const c of citers) if (c.year) years.set(c.year, (years.get(c.year) ?? 0) + 1);
  const missingAuthors = citers.filter((c) => !identities(c).length).length;
  const missingVenues = citers.filter((c) => !c.venue).length;
  const truncatedVenues = citers.filter((c) => /…|\.\.\./.test(c.venue ?? "")).length;
  const unverifiedAuthorLists = [target, ...citers].filter((c) => c.authorListComplete !== true).length;
  const coveragePercent = target.citedByTotal && target.citedByTotal > 0 ? n / target.citedByTotal * 100 : null;
  const warnings = [
    "First returned Google Scholar results, not a random or representative sample. More results do not eliminate selection bias.",
    "Exact names/initials are candidate identity matches; only matching Scholar IDs provide stronger identity evidence. Surnames alone are not matched.",
    "Co-author overlap and self-citation can be legitimate. Reciprocal citations, citation intent, and misconduct are not measured.",
    "The index weights and thresholds are unvalidated. This is not a probability or a verdict.",
  ];
  if (unverifiedAuthorLists) warnings.push(`Complete author lists are not verified for ${unverifiedAuthorLists} of ${n + 1} papers, including the target when applicable; self-citation may be undercounted.`);
  if (truncatedVenues) warnings.push(`${truncatedVenues} citer venue labels are truncated; distinct-source counts remain approximate.`);
  if (missingAuthors || missingVenues) warnings.push(`Missing usable individual authors: ${missingAuthors}; missing venues: ${missingVenues}. Missing data is not evidence of low risk.`);
  if (n < 10) warnings.push("Fewer than 10 citers: insufficient evidence for an index.");
  const hasAuthorEvidence = identities(target).length > 0 && missingAuthors < n;
  if (n >= 10 && !hasAuthorEvidence) warnings.push("No usable target or citer author identities: no index can be computed reliably.");
  return {
    schemaVersion: 2,
    target: { title: target.title, authors: target.authors, year: target.year, venue: target.venue, citedByTotal: target.citedByTotal },
    citersAnalyzed: n,
    selfCite: { count: selfCited.length, rate: selfRate, papers: selfCited.map((c) => c.title), paperIds: selfCited.map((c) => c.resultId) },
    venueConcentration: { topVenue: top?.[0] ?? "No eligible publication venue", topVenueShare: venueShare, distinctVenues: venues.size, eligiblePapers: n - excludedPapers, excludedPapers },
    authorOverlaps,
    overlapDensity,
    yearHistogram: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count })),
    anomalyScore: n < 10 || !hasAuthorEvidence ? null : Math.round((0.45 * selfRate + 0.30 * venueShare + 0.25 * overlapDensity) * 1000) / 1000,
    evidenceQuality: { coveragePercent, sampling: "First returned Scholar results (non-random)", authorMatching: "Scholar IDs when both available; otherwise exact names/initials (candidate only)", unverifiedAuthorLists, missingAuthors, missingVenues, truncatedVenues, missingYears: citers.filter((c) => !c.year).length, warnings },
    notes: [n ? `Analyzed ${n}${target.citedByTotal !== undefined ? ` of ~${target.citedByTotal}` : ""} citations. Findings apply only to this retrieved sample.` : "No citing papers retrieved; no conclusion can be drawn.", "Year counts are publication years of sampled citers, not the target's annual citation totals."],
  };
}
