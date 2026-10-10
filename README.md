# Scholar Citation-Pattern Explorer

Explore a bounded Google Scholar citation sample via SerpApi. Inspect candidate
author overlaps, publication sources, sampled publication years, and evidence
limitations. **This is exploratory screening, not a citation-cartel detector or
a misconduct verdict.**

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

Enter a paper title and choose 5–100 citers. The dashboard includes:
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
and one bounded paid request. API keys remain server-side and are transmitted
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
legitimate. This tool does not measure reciprocal citations or coordinated intent.

## Groq AI interpretation

Default model: **`openai/gpt-oss-120b`**, through Groq's OpenAI-compatible API.
No extra SDK dependency is required. `GROQ_MODEL` can override the model; choose
one supporting strict structured output and the reasoning parameter.

The optional request receives only calculated evidence and up to 100 public paper
metadata records, with search snippets capped at 700 characters each. It does not
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

One request, at most 4,096 output tokens, a 45-second timeout, and no automatic
paid retries. Cost varies with input size and Groq pricing. Missing keys, rate
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
