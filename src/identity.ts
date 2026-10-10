import type { ScholarPaper } from "./serpapi.js";

export type AuthorIdentity = { name: string; key: string; scholarId?: string };

export function authorIdentity(name: string, scholarId?: string): AuthorIdentity | undefined {
  const clean = name.normalize("NFKC").toLowerCase().replace(/[.‘’'"…]/g, "").replace(/\s+/g, " ").trim();
  // Corporate authors are not individual researchers; surnames alone are ambiguous.
  if (/\b(team|intelligence|consortium|collaboration|group)\b/.test(clean)) return undefined;
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return undefined;
  return { name: name.trim(), key: clean, ...(scholarId ? { scholarId } : {}) };
}

export function identities(paper: ScholarPaper): AuthorIdentity[] {
  const entries = paper.authorIdentities ?? paper.rawAuthors.split(/[,;]/).map((name) => authorIdentity(name)).filter((a): a is AuthorIdentity => !!a);
  return [...new Map(entries.map((a) => [a.scholarId ? `id:${a.scholarId}` : a.key, a])).values()];
}

// Exact names/initials are candidate matches, not verified identity. Never fall back to surnames.
export function sharedIdentities(a: ScholarPaper, b: ScholarPaper): AuthorIdentity[] {
  return identities(a).filter((x) => identities(b).some((y) =>
    x.scholarId && y.scholarId ? x.scholarId === y.scholarId : x.key === y.key));
}

export function normalizeVenue(venue?: string): string {
  if (!venue?.trim()) return "unknown source";
  const clean = venue.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (/\barxiv\b/.test(clean)) return "arXiv (repository)";
  // Do not guess expansions of truncated journal/conference names.
  return clean.replace(/[,…\s]+$/, "");
}
