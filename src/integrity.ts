import type { ScholarPaper } from "./serpapi.js";
import { normalizeVenue } from "./identity.js";

type Json = Record<string, any>;
export type CitationWork = {
  doi: string; title: string; url: string; authors: string[];
  referenceCount: number; references: { doi?: string; venue?: string }[];
};
export type IntegrityEvidence = {
  version: 1; status: "completed" | "partial" | "unavailable";
  checkedAt: string; provider: "Crossref"; requests: number;
  targetDoi?: string; retraction: { status: "verified" | "title-warning" | "not-found" | "unknown"; urls: string[] };
  works: CitationWork[]; matchedCiters: number; requestedCiters: number;
  matchedCiterDois: string[];
  warnings: string[];
};

export function titleKey(title: string): string {
  return title.replace(/^\s*(?:\[.*?\]\s*)?(?:retracted\s*:\s*)?/i, "")
    .normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function doiKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const doi = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : undefined;
}
function linkDoi(link?: string): string | undefined {
  if (!link) return undefined;
  try { return doiKey(decodeURIComponent(link.match(/10\.\d{4,9}\/.+?(?=[?#]|$)/)?.[0] ?? "")); }
  catch { return undefined; }
}
export function parseCitationWork(item: Json): CitationWork {
  return {
    doi: doiKey(item.DOI) ?? "", title: item.title?.[0] ?? "Untitled", url: `https://doi.org/${doiKey(item.DOI) ?? ""}`,
    // Full given names only; initial/surname collisions cannot create network links.
    authors: [...new Set<string>((item.author ?? []).map((a: Json) => {
      if (a.ORCID) return `orcid:${String(a.ORCID).replace(/^https?:\/\/orcid.org\//, "")}`;
      if (!a.given || !a.family || String(a.given).replace(/[^\p{L}]/gu, "").length < 3) return "";
      return `${a.given} ${a.family}`.normalize("NFKC").toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
    }).filter(Boolean))],
    referenceCount: Number(item["reference-count"] ?? item["references-count"] ?? item.reference?.length ?? 0),
    references: (item.reference ?? []).map((r: Json) => ({ doi: doiKey(r.DOI), venue: typeof r["journal-title"] === "string" ? r["journal-title"] : undefined })),
  };
}

/** Bounded free metadata lookup; no publisher crawling and no arbitrary URL fetches. */
export async function collectIntegrity(target: ScholarPaper, citers: ScholarPaper[], options: {
  fetcher?: typeof fetch; timeoutMs?: number; maxCiters?: number; maxReferences?: number;
} = {}): Promise<IntegrityEvidence> {
  const evidence: IntegrityEvidence = {
    version: 1, status: "completed", checkedAt: new Date().toISOString(), provider: "Crossref", requests: 0,
    retraction: { status: /^\s*(?:\[.*?\]\s*)?retracted\s*:/i.test(target.title) ? "title-warning" : "unknown", urls: target.link ? [target.link] : [] },
    works: [], matchedCiters: 0, requestedCiters: 0, matchedCiterDois: [], warnings: [],
  };
  const deadline = Date.now() + (options.timeoutMs ?? 45000);
  const fetcher = options.fetcher ?? fetch;
  async function request(path: string): Promise<Json> {
    if (evidence.requests >= 35 || Date.now() >= deadline) throw new Error("Metadata request budget exhausted");
    evidence.requests++;
    const response = await fetcher(`https://api.crossref.org/works${path}`, {
      headers: { accept: "application/json", "user-agent": "ScholarForensics/0.2 (citation pattern screening)" },
      signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))),
    });
    if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
    return (await response.json() as Json).message;
  }
  const cache = new Map<string, Json>();
  async function byDoi(doi: string) {
    if (!cache.has(doi)) cache.set(doi, await request(`/${encodeURIComponent(doi)}`));
    return cache.get(doi)!;
  }
  async function resolve(paper: ScholarPaper): Promise<Json | undefined> {
    const doi = linkDoi(paper.link);
    const candidates = doi ? [await byDoi(doi)] : (await request(`?query.title=${encodeURIComponent(paper.title.replace(/^RETRACTED:\s*/i, ""))}&rows=5`)).items ?? [];
    // Reject approximate title matches and ambiguous same-title records.
    const matches = candidates.filter((x: Json) => titleKey(x.title?.[0] ?? "") === titleKey(paper.title));
    const unique = [...new Map<string, Json>(matches.map((x: Json) => [doiKey(x.DOI) ?? "", x])).values()];
    if (unique.length !== 1 || !doiKey(unique[0]!.DOI)) return undefined;
    cache.set(doiKey(unique[0]!.DOI)!, unique[0]!);
    return unique[0];
  }
  try {
    const item = await resolve(target);
    if (!item) throw new Error("No unambiguous exact-title Crossref match for the target");
    const work = parseCitationWork(item);
    evidence.targetDoi = work.doi;
    evidence.works.push(work);
    // updated-by points from the original work to a notice. update-to on a
    // notice points to another work and must never mark the notice retracted.
    const updates = [...(item["updated-by"] ?? []).filter((u: Json) => u.type === "retraction"),
      ...(item["update-to"] ?? []).filter((u: Json) => u.type === "retraction" && doiKey(u.DOI) === work.doi)];
    evidence.retraction = updates.length
      ? { status: "verified", urls: [...new Set<string>(updates.map((u: Json) => `https://doi.org/${doiKey(u.DOI) ?? work.doi}`))] }
      : { status: evidence.retraction.status === "title-warning" ? "title-warning" : "not-found", urls: [work.url] };
    const selected = citers.slice(0, Math.min(options.maxCiters ?? 20, 20));
    evidence.requestedCiters = selected.length;
    // Sequential requests respect the public API and the overall timeout.
    for (const paper of selected) {
      if (Date.now() >= deadline) break;
      try {
        const match = await resolve(paper);
        if (match) {
          const citerWork = parseCitationWork(match);
          evidence.matchedCiters++; evidence.matchedCiterDois.push(citerWork.doi); evidence.works.push(citerWork);
        }
      } catch { evidence.warnings.push("Some citing-paper metadata requests failed or timed out."); }
    }
    // Inspect older target references too: author-team reciprocity needs both
    // directions, which an incoming-citations-only sample cannot supply.
    const referenceDois = [...new Set(work.references.map((r) => r.doi).filter((d): d is string => !!d))]
      .filter((d) => !evidence.works.some((w) => w.doi === d)).slice(0, Math.min(options.maxReferences ?? 12, 12));
    for (const doi of referenceDois) {
      if (Date.now() >= deadline) break;
      try { evidence.works.push(parseCitationWork(await byDoi(doi))); }
      catch { evidence.warnings.push("Some target-reference metadata requests failed or timed out."); }
    }
    if (evidence.matchedCiters < selected.length || Date.now() >= deadline || evidence.warnings.length) evidence.status = "partial";
    evidence.warnings.push("Bounded, non-random network: target, first 20 citers at most, and first 12 DOI-bearing target references at most. Unmatched papers and missing reference DOIs hide edges.");
    evidence.warnings.push("Crossref reference lists may be incomplete. Exact full-name matches remain candidate identities; reciprocal citations can be legitimate.");
    if (evidence.retraction.status === "not-found") evidence.warnings.push("No registered retraction found is not proof that a paper has never been retracted.");
  } catch (error) {
    evidence.status = "unavailable";
    // Fixed messages avoid exporting provider data or local details.
    evidence.warnings.push(error instanceof Error && error.message.startsWith("Crossref HTTP") ? error.message : "Target metadata could not be resolved or the metadata service timed out.");
  }
  evidence.works = [...new Map(evidence.works.map((w) => [w.doi, w])).values()];
  evidence.warnings = [...new Set(evidence.warnings)];
  return evidence;
}

export function networkSignals(evidence?: IntegrityEvidence) {
  const works = evidence?.works ?? [];
  const parent = new Map<string, string>();
  const root = (a: string): string => { const p = parent.get(a); if (!p || p === a) return a; const r = root(p); parent.set(a, r); return r; };
  for (const w of works) for (const a of w.authors) { if (!parent.has(a)) parent.set(a, a); }
  // Merge collaborating authors into teams so a single research group cannot
  // masquerade as multiple independent participants in a citation ring.
  for (const w of works) for (const a of w.authors.slice(1)) parent.set(root(a), root(w.authors[0]!));
  const teams = new Map(works.filter((w) => w.authors.length).map((w) => [w.doi, root(w.authors[0]!)]));
  const edges = new Set<string>();
  const paperEdges: { from: string; to: string }[] = [];
  for (const w of works) for (const ref of w.references) {
    if (!ref.doi || !teams.has(w.doi) || !teams.has(ref.doi)) continue;
    const a = teams.get(w.doi)!, b = teams.get(ref.doi)!;
    if (a !== b) { edges.add(JSON.stringify([a, b])); paperEdges.push({ from: w.doi, to: ref.doi }); }
  }
  const targetTeam = teams.get(evidence?.targetDoi ?? "");
  const adj = new Map<string, Set<string>>(), rev = new Map<string, Set<string>>();
  for (const edge of edges) {
    const [a, b] = JSON.parse(edge) as [string, string];
    if (!adj.has(a)) adj.set(a, new Set()); if (!rev.has(b)) rev.set(b, new Set());
    adj.get(a)!.add(b); rev.get(b)!.add(a);
  }
  function reachable(start: string | undefined, graph: Map<string, Set<string>>) {
    const seen = new Set<string>(), todo = start ? [start] : [];
    while (todo.length) { const a = todo.pop()!; if (seen.has(a)) continue; seen.add(a); todo.push(...(graph.get(a) ?? [])); }
    return seen;
  }
  const forward = reachable(targetTeam, adj), backward = reachable(targetTeam, rev);
  const ring = new Set([...forward].filter((a) => backward.has(a)));
  let internalEdges = 0, reciprocalPairs = 0;
  for (const edge of edges) {
    const [a, b] = JSON.parse(edge) as [string, string];
    if (ring.has(a) && ring.has(b)) { internalEdges++; if (a < b && edges.has(JSON.stringify([b, a]))) reciprocalPairs++; }
  }
  const target = works.find((w) => w.doi === evidence?.targetDoi);
  const venues = new Map<string, number>();
  for (const ref of target?.references ?? []) if (ref.venue) { const k = normalizeVenue(ref.venue); venues.set(k, (venues.get(k) ?? 0) + 1); }
  const top = [...venues.entries()].sort((a, b) => b[1] - a[1])[0];
  const refCount = Math.max(target?.referenceCount ?? 0, target?.references.length ?? 0);
  return {
    teamCount: new Set(teams.values()).size, ringTeams: ring.size > 1 ? ring.size : 0,
    ringDensity: ring.size > 1 ? internalEdges / (ring.size * (ring.size - 1)) : 0, reciprocalPairs,
    paperEdges, referenceCount: refCount, depositedReferences: target?.references.length ?? 0,
    topReferenceVenue: top?.[0], topReferenceVenueCount: top?.[1] ?? 0,
    topReferenceVenueShare: refCount ? (top?.[1] ?? 0) / refCount : 0,
    referenceVenueKnown: [...venues.values()].reduce((a, b) => a + b, 0),
    worksWithReferences: works.filter((w) => w.references.some((r) => r.doi) && w.authors.length).length,
    citersWithReferences: works.filter((w) => evidence?.matchedCiterDois?.includes(w.doi) && w.references.some((r) => r.doi) && w.authors.length).length,
    targetTeamUsable: !!targetTeam,
  };
}
