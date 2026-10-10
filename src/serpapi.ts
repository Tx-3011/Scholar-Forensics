// Minimal SerpApi Google Scholar client.
// Docs: https://serpapi.com/google-scholar-api
// Only two operations the base needs: resolve a paper, page through its citers.

export type ScholarPaper = {
  resultId: string;
  title: string;
  link?: string;
  authors: string[]; // normalized "surname" tokens, lowercase
  rawAuthors: string;
  year?: number;
  venue?: string;
  snippet?: string;
  citedByTotal?: number;
  citedByClusterId?: string;
};

type Json = Record<string, unknown>;

const ENDPOINT = "https://serpapi.com/search.json";

import fs from "node:fs";
import path from "node:path";

function getKey(): string {
  // Minimal .env support without a dependency.
  try {
    const envPath = path.join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const m = line.match(/^\s*SERPAPI_API_KEY\s*=\s*(.+?)\s*$/);
        if (m && !process.env.SERPAPI_API_KEY) process.env.SERPAPI_API_KEY = m[1];
      }
    }
  } catch { /* env optional */ }
  const key = (process.env.SERPAPI_API_KEY ?? "").trim();
  if (!key) throw new Error("SERPAPI_API_KEY is not set. Put it in .env (see .env.example) or the environment.");
  return key;
}

async function callSerpApi(params: Record<string, string>): Promise<Json> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("engine", "google_scholar");
  url.searchParams.set("api_key", getKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const payload = (await res.json()) as Json;
  if (!res.ok || typeof payload.error === "string") {
    throw new Error(`SerpApi error: ${typeof payload.error === "string" ? payload.error : `HTTP ${res.status}`}`);
  }
  return payload;
}

function asRecord(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}

function parseAuthors(item: Json): { authors: string[]; raw: string } {
  const pub = asRecord(item.publication_info);
  // Prefer a structured authors array when present.
  const structured = (pub.authors ?? (item as Json).authors) as unknown;
  let raw = "";
  if (Array.isArray(structured)) {
    raw = structured.map((a) => (typeof a === "string" ? a : asRecord(a).name)).filter(Boolean).join(", ");
  }
  if (!raw) {
    const summary = typeof pub.summary === "string" ? pub.summary : "";
    // "A Smith, B Jones - Journal Name, 2021" -> author part is before " - "
    raw = summary.split(" - ")[0] ?? "";
  }
  const authors = raw
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map(normalizeAuthor);
  return { authors, raw };
}

/** "J. Smith" / "Smith, John" -> "smith" (surname token, lowercase). */
export function normalizeAuthor(name: string): string {
  const cleaned = name.replace(/[."']/g, "").trim().toLowerCase();
  if (!cleaned) return "";
  if (cleaned.includes(",")) return cleaned.split(",")[0]!.trim().split(/\s+/).pop() ?? "";
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function parseYearVenue(item: Json): { year?: number; venue?: string } {
  const pub = asRecord(item.publication_info);
  const summary = typeof pub.summary === "string" ? pub.summary : "";
  const yearMatch = summary.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : undefined;
  // Venue: text between " - " and the year, if present.
  let venue: string | undefined;
  const dashParts = summary.split(" - ");
  if (dashParts.length > 1) {
    venue = dashParts[1]!.replace(/\b(19|20)\d{2}\b/, "").replace(/[,\s]+$/, "").trim() || undefined;
  }
  return { year, venue };
}

function parseCitedBy(item: Json): { total?: number; clusterId?: string } {
  const inline = asRecord(asRecord(item.inline_links).cited_by);
  const total = typeof inline.total === "number" ? inline.total : undefined;
  let clusterId: string | undefined;
  if (typeof inline.link === "string") {
    try {
      clusterId = new URL(inline.link).searchParams.get("cites") ?? undefined;
    } catch { /* ignore */ }
  }
  // Fallback: some responses carry the cluster id on the result itself.
  if (!clusterId && typeof (item as Json).result_id === "string") clusterId = undefined;
  return { total, clusterId };
}

export function normalizePaper(item: Json): ScholarPaper {
  const { authors, raw } = parseAuthors(item);
  const { year, venue } = parseYearVenue(item);
  const { total, clusterId } = parseCitedBy(item);
  return {
    resultId: String((item as Json).result_id ?? (item as Json).link ?? Math.random().toString(36).slice(2)),
    title: String((item as Json).title ?? "Untitled"),
    link: typeof (item as Json).link === "string" ? ((item as Json).link as string) : undefined,
    authors,
    rawAuthors: raw,
    year,
    venue,
    snippet: typeof (item as Json).snippet === "string" ? ((item as Json).snippet as string) : undefined,
    citedByTotal: total,
    citedByClusterId: clusterId,
  };
}

/** Resolve a paper title to the top Scholar result. */
export async function resolvePaper(query: string): Promise<ScholarPaper> {
  const payload = await callSerpApi({ q: query, num: "5" });
  const results = (payload.organic_results ?? []) as Json[];
  if (!results.length) throw new Error(`No Scholar results for "${query}".`);
  return normalizePaper(results[0]!);
}

/**
 * Page through the "cited by" list of a Scholar cluster.
 * Stops at `maxResults` or when a page comes back empty.
 */
export async function fetchCiters(clusterId: string, maxResults = 40): Promise<ScholarPaper[]> {
  const citers: ScholarPaper[] = [];
  const pageSize = 20;
  for (let start = 0; start < maxResults; start += pageSize) {
    const payload = await callSerpApi({ cites: clusterId, num: String(pageSize), start: String(start) });
    const results = (payload.organic_results ?? []) as Json[];
    if (!results.length) break;
    for (const r of results) citers.push(normalizePaper(r));
    if (citers.length >= maxResults) break;
    await new Promise((r) => setTimeout(r, 1200)); // be polite to the API
  }
  return citers.slice(0, maxResults);
}
