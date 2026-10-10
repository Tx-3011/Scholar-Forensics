# Scholar Citation Forensics

Given a paper, pull its Google Scholar citation graph via SerpApi and check
whether the paper is *foundational* or *citation-cartel'd*.

## Web UI (recommended)

```bash
cp .env.example .env   # add your SERPAPI_API_KEY
npm install
npm run dev            # open http://localhost:3000
```

Enter a paper title → interactive forensics dashboard:
- **Cartel score gauge** (0 organic → 1 cartel-like) with verdict
- **Interactive citation graph** — drag nodes, hover for details; self-cites glow amber, co-author cliques link purple
- **Venue concentration bars**, **citations-by-year timeline**, citing-paper table with self-cite/clique tags
- Analyst notes + methodology

## CLI

```bash
npm run analyze -- "Attention Is All You Need" --max 40
# writes out/report.json + out/report.html (same dashboard, works from file://)
```

SerpApi cost: ~1 search to resolve + ~1 per 20 citers. A 40-citer run is ~3 searches.

## How the score works

`cartel = 0.45·selfCiteRate + 0.30·venueShare + 0.25·cliqueDensity`

- **Self-cite rate**: citers sharing an author surname with the target
- **Venue share**: fraction of citers in the single most common venue
- **Clique density**: citer pairs sharing ≥2 authors (excluding target authors)

Heuristics, not verdicts. Author matching is surname-based; tune weights on real data.

## Verify without a key

```bash
npm run typecheck
npm test   # offline fixtures: parsing, self-cite, cliques, dashboard rendering
```

## Where to take it

- **Pairwise cross-citation**: check whether citer A cites citer B (scholar `cites` on each citer's cluster). Expensive — budget it.
- **Temporal cartel plot**: `as_ylo`/`as_yhi` year windows — "was foundational, became a cartel" is the killer narrative.
- **Reference overlap**: Jaccard similarity between citers' bibliographies beats author overlap as a cartel signal.
- **Author disambiguation**: surname matching is crude — upgrade to Scholar author IDs where available.

## Files

- `src/serpapi.ts` — Scholar client: `resolvePaper`, `fetchCiters`, `normalizePaper`
- `src/analyze.ts` — heuristics → `ForensicsReport`
- `src/report.ts` — interactive single-file dashboard (no external deps)
- `src/server.ts` — web UI (`npm run dev`)
- `src/cli.ts` — CLI entry
- `src/selftest.ts` — offline fixture tests
