# Scholar Citation-Pattern Explorer

Screen a paper using a bounded Google Scholar sample and public Crossref reference
and retraction metadata. Reports lead with an overall assessment and evidence.
**Cartel grades are unvalidated screening rules, not proof of coordinated
misconduct or probabilities of fraud.**

## Overall assessment

Live analyses check public Crossref metadata automatically (no extra API key):
one target, up to 20 sampled citers, and up to 12 DOI-bearing target references.
Sequential requests are capped at 35 calls and 45 seconds. Public titles/DOIs are
sent to Crossref. Failures preserve the Scholar report and are disclosed. Exact
normalized titles must match unambiguously; approximate matches are rejected.

Grades, in priority order:
- **Retracted — do not treat this paper as reliable:** DOI-linked retraction
  metadata overrides a low pattern score; the notice is linked.
- **Retraction warning:** RETRACTED title without a verified DOI-linked record.
- **Strong cartel signals:** target-connected cycle of ≥3 candidate author teams,
  ≥50% directed edge density, ≥2 reciprocal pairs, and ≥50% of at least 10 target
  references sharing one deposited journal label.
- **Possible citation cartel:** target-connected cycle of ≥3 candidate teams.
- **Citation concerns — cartel not established:** concentrated references, a
  reciprocal team pair, incoming anomaly index ≥0.30, or ≥50% sampled citers
  sharing one venue label without a qualifying ring.
- **Looks fine in the checked evidence:** completed metadata retrieval, ≥10 matched
  citers with author/reference evidence, usable target authors, ≥10 target references with
  ≥80% deposited coverage, and no triggered concern rule.
- **Looks fine in the sampled citations:** no threshold-level concern, ≥10
  citers, usable target identities and usable author metadata for ≥80% of citers.
  This sample-only assessment still works when Crossref is partial or unavailable;
  missing reference/retraction checks remain disclosed separately.
- **Insufficient evidence:** too few sampled citers or too little usable author
  metadata for even a sample assessment. Large total citation counts and low
  percentage coverage never trigger this result on their own.

The hackathon default is **60 citers**, with a **hard cap of 100** in retrieval,
analysis, saved-bundle loading, dashboard rendering, and AI input. Every headline
describes the retrieved sample, never the full population of citing papers.

Edges come from deposited reference DOIs, never author overlaps. Authors match by
ORCID or exact full names; initial-only names are excluded. Coauthors merge into
candidate teams, preventing one collaborating group from counting as independent
ring participants. Cycles between teams across works allow older/newer papers to
establish reciprocal behavior without requiring circular publication chronology.
Cycles can be legitimate scholarly exchange; full names remain ambiguous and
missing reference DOIs hide edges. This is a bounded, non-random check without
citation-passage relevance analysis, coordination proof, or a field-matched
statistical baseline. Thresholds are not calibrated against real cartel cases.

Saved reports render the new assessment without network calls. To refresh Crossref
while preserving the original Scholar sample:

```powershell
npm run analyze -- --from out/report.json --refresh-integrity
```

Without that flag, offline re-analysis reuses saved Crossref evidence; older bundles
show the sample-only assessment when usable, or a title retraction warning.

## Setup and web UI

```powershell
Copy-Item .env.example .env  # only if you don't already have .env
npm install
npm run dev                 # http://localhost:3000
```

Set `SERPAPI_API_KEY` in `.env`. Optionally add:

```dotenv
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-120b
```

Enter a paper title and choose 5–100 citers (default 60). The dashboard includes:
- A prominently disclosed non-random sample and coverage percentage.
- An unvalidated **sample anomaly index**, not a probability or verdict.
- A large deterministic key-finding headline: majority venue-label share,
  largest candidate author-overlap component, self-citation matches, or
  insufficient evidence. This is a descriptive summary, not an AI verdict.
  Repeated-title groups are flagged as possible duplicate/version records.
- Candidate author matches, paper-pair overlap edges, and linked paper sources.
- Normalized source distribution, including repositories.
- Publication-year counts for sampled citers (not annual citation totals).
- Optional, explicitly labeled, source-linked AI interpretation.

The AI checkbox is **off by default**. It discloses the model, data sent to Groq,
and one bounded paid request, with one compact retry only for HTTP 413 or output
truncation (at most two requests). API keys remain server-side and are transmitted
only to their respective providers, never embedded in HTML or exported reports.

## CLI

```powershell
npm run analyze -- "Attention Is All You Need" --max 40
npm run analyze -- "Attention Is All You Need" --max 40 --llm
```

Writes `out/report.json` and `out/report.html`. The HTML opens directly as a file;
fonts use Google Fonts with local fallbacks.

Re-analyze existing data without additional Scholar calls:

```powershell
npm run analyze -- --from out/report.json
npm run analyze -- --from out/report.json --llm
```

These write `out/report-v2.json` and `out/report-v2.html`, preserving the original
input report. The original data timestamp is retained as `sourceGeneratedAt`.
Repeated re-analysis replaces the generated v2 outputs.

SerpApi costs roughly one search to resolve + one per 20 citers. A 40-citer run
is about three searches. Duplicate records are removed; actual sample size may
be smaller than requested. Results are the **first returned Scholar results**,
not a random sample. Increasing sample size does not guarantee representativeness.

## Deterministic method v2

```text
index = 0.45 × candidateSelfCiteRate
      + 0.30 × publicationVenueShare
      + 0.25 × overlapPairDensity
```

- **Author matching:** matching Scholar author IDs when both are available;
  otherwise exact normalized names/initials. Conflicting IDs do not match.
  Surnames alone and corporate/team labels are excluded. Name/initial matches
  are still ambiguous candidates, not confirmed identities. Duplicate author
  entries are removed. Full author lists are not guaranteed by Scholar snippets.
- **Publication venue share:** largest normalized publication-source bucket
  divided by all sampled citers. arXiv variants merge for display; repositories
  and missing sources do not contribute to concentration. Truncated publication
  labels remain approximate and are disclosed rather than guessed.
- **Overlap-pair density:** all citer pairs sharing at least two candidate
  identities (excluding matched target authors) / all possible citer pairs.
  The graph and table use those exact pairs, not any shared surname.
- **Insufficient evidence:** fewer than 10 citers, no usable target author
  identities, or no usable citer author identities produces no index (`null`).
- **Unvalidated:** weights and review thresholds are not calibrated against
  known cases. The index is **not comparable to the old cartel score**.

Self-citation, recurring collaboration, and source concentration can be entirely
legitimate. The Scholar metrics do not measure reciprocal citations; the separate
Crossref network checks candidate-team reciprocity. Neither measures coordinated intent.

## Groq AI interpretation

Default model: **`openai/gpt-oss-120b`**, through Groq's OpenAI-compatible API.
No extra SDK dependency is required. `GROQ_MODEL` can override the model; choose
one supporting strict structured output and the reasoning parameter.

The optional request receives calculated aggregate evidence and compact records
for all sampled papers (up to 100). Full abstracts, the O(n²) overlap-pair list,
and raw Crossref reference lists are omitted from the prompt; complete data stays
in the report JSON. Titles/authors/venues are shortened progressively to keep the
messages plus schema under 14,000 UTF-8 bytes (9,000 on a retry). Paper IDs are
retained so every sampled paper remains addressable. The prompt does not
receive API keys, local paths, or the numerical anomaly index. It cannot alter
deterministic metrics.

Output separates:
1. Reported observations.
2. Cautious AI inferences and alternative explanations.
3. Limitations.
4. Suggested verification steps.

Every item references IDs from an exported evidence catalog. Paper references link
to original URLs; metric references show the supplied data. A strict JSON schema
and runtime checks reject malformed, truncated, or unknown-reference responses.
Model, prompt version, timestamp, and actual token usage are saved in JSON/HTML.

One request with 3,072 completion tokens; only HTTP 413 or finish_reason=length
permits one smaller-input retry with 4,096 completion tokens. Completion budgets
include reasoning tokens. A 60-second overall deadline bounds both calls, with
at most 45 seconds per call. HTTP 429 is reported as a rate limit and is not
automatically retried. Failed/truncated output is never shown as a complete
interpretation. Actual usage is accumulated across successful HTTP responses;
attempt count, supplied citer count, prompt bytes, compression profile and failure
kind are exported. Byte limits are bounds, not exact tokenizer estimates.
Cost varies with input size and Groq pricing. Missing keys, rate
limits, network failures, and invalid output leave the deterministic report usable.

**Important:** search snippets are not passages citing the target. AI must not
infer citation intent, invent missing metadata, assign cartel probabilities, or
declare wrongdoing/innocence. Referencing valid evidence IDs does not prove a
claim is correct: users still need to verify the interpretation. Citation-context
classification would require a separate full-text passage retrieval pipeline.

## Offline verification

```powershell
npm run typecheck
npm test
```

Tests cover author-ID conflicts, surname collisions, duplicate authors, repository
normalization, sample warnings, complete pair counting, graph/table consistency,
HTML escaping, strict Groq request construction, evidence validation, opt-out,
missing credentials, rate limits, timeouts, and truncated completions. Tests mock
Groq and make no paid API calls.

## Files

- `src/serpapi.ts` — Scholar retrieval and normalized metadata.
- `src/identity.ts` — conservative author matching and source normalization.
- `src/analyze.ts` — deterministic metrics and evidence-quality warnings.
- `src/llm.ts` — bounded Groq interpretation and evidence validation.
- `src/config.ts` — shared `.env` loader.
- `src/report.ts` — standalone dashboard and AI evidence references.
- `src/server.ts` / `src/cli.ts` — web and CLI entry points.
- `src/selftest.ts` — offline regression tests.
