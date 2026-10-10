// Forensic analysis over a paper and its citers.
// Heuristics only — each metric is a signal, not a verdict.

import type { ScholarPaper } from "./serpapi.js";

export type ForensicsReport = {
  target: { title: string; authors: string[]; year?: number; venue?: string; citedByTotal?: number };
  citersAnalyzed: number;
  selfCite: { count: number; rate: number; papers: string[] };
  venueConcentration: { topVenue: string; topVenueShare: number; distinctVenues: number };
  authorCliques: { authors: string[]; sharedPapers: number }[];
  yearHistogram: { year: number; count: number }[];
  cartelScore: number; // 0..1, higher = more cartel-like citing behavior
  notes: string[];
};

/** Shared author surnames between two papers. */
function sharedAuthors(a: ScholarPaper, b: ScholarPaper): string[] {
  const setB = new Set(b.authors);
  return a.authors.filter((x) => setB.has(x));
}

export function analyze(target: ScholarPaper, citers: ScholarPaper[]): ForensicsReport {
  const notes: string[] = [];
  const targetAuthorSet = new Set(target.authors);

  // 1. Self-citation: citer shares at least one author surname with the target.
  const selfCited = citers.filter((c) => c.authors.some((a) => targetAuthorSet.has(a)));

  // 2. Venue concentration: share of citers in the single most common venue.
  const venueCounts = new Map<string, number>();
  for (const c of citers) {
    const v = (c.venue ?? "unknown venue").toLowerCase();
    venueCounts.set(v, (venueCounts.get(v) ?? 0) + 1);
  }
  const sortedVenues = [...venueCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topVenue = sortedVenues[0];

  // 3. Author cliques: pairs of citers sharing >=2 authors (co-author groups
  // citing the target repeatedly). Report the strongest clusters.
  const cliqueHits = new Map<string, { authors: string[]; sharedPapers: number }>();
  for (let i = 0; i < citers.length; i++) {
    for (let j = i + 1; j < citers.length; j++) {
      const shared = sharedAuthors(citers[i]!, citers[j]!).filter((a) => !targetAuthorSet.has(a));
      if (shared.length >= 2) {
        const key = [...shared].sort().join("|");
        const hit = cliqueHits.get(key) ?? { authors: shared, sharedPapers: 0 };
        hit.sharedPapers += 1;
        cliqueHits.set(key, hit);
      }
    }
  }
  const authorCliques = [...cliqueHits.values()]
    .sort((a, b) => b.sharedPapers - a.sharedPapers)
    .slice(0, 5);

  // 4. Year histogram of citations.
  const yearCounts = new Map<number, number>();
  for (const c of citers) if (c.year) yearCounts.set(c.year, (yearCounts.get(c.year) ?? 0) + 1);
  const yearHistogram = [...yearCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ year, count }));

  // 5. Cartel score: weighted blend of self-cite rate, venue concentration,
  // and clique density. Deliberately simple and explainable.
  const n = Math.max(citers.length, 1);
  const selfCiteRate = selfCited.length / n;
  const venueShare = topVenue ? topVenue[1] / n : 0;
  const cliqueDensity = Math.min(authorCliques.reduce((s, c) => s + c.sharedPapers, 0) / n, 1);
  const cartelScore = Math.round((0.45 * selfCiteRate + 0.3 * venueShare + 0.25 * cliqueDensity) * 100) / 100;

  if (citers.length < 10) notes.push("Fewer than 10 citers analyzed — metrics are noisy at this sample size.");
  if (target.citedByTotal !== undefined && citers.length < target.citedByTotal) {
    notes.push(`Analyzed ${citers.length} of ~${target.citedByTotal} total citations (bounded sample).`);
  }
  if (cartelScore >= 0.4) notes.push("Elevated cartel-like signals: check whether a small author/venue cluster drives most citations.");
  else notes.push("No strong cartel-like signals in this sample.");

  return {
    target: {
      title: target.title,
      authors: target.authors,
      year: target.year,
      venue: target.venue,
      citedByTotal: target.citedByTotal,
    },
    citersAnalyzed: citers.length,
    selfCite: {
      count: selfCited.length,
      rate: Math.round((selfCiteRate) * 100) / 100,
      papers: selfCited.slice(0, 10).map((c) => c.title),
    },
    venueConcentration: {
      topVenue: topVenue ? topVenue[0] : "n/a",
      topVenueShare: Math.round(venueShare * 100) / 100,
      distinctVenues: venueCounts.size,
    },
    authorCliques,
    yearHistogram,
    cartelScore,
    notes,
  };
}
