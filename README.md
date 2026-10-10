# Scholar Forensics

Explore citation patterns around a paper using a bounded Google Scholar sample,
then check public Crossref reference and retraction metadata. The report puts an
evidence-based screening assessment first, with the supporting checks and sample
patterns available to inspect.

**This is an exploratory screen, not proof of coordinated misconduct, a calibrated
risk probability, or a certification that a paper is reliable.** Citation cycles,
author overlap, self-citation, and source concentration can all have legitimate
explanations.

## Run the web app

Requirements: Node.js and npm.

```powershell
Copy-Item .env.example .env  # only if you don't already have .env
npm install
npm run dev                  # http://localhost:3000
```

Add your SerpApi key to `.env`:

```dotenv
SERPAPI_API_KEY=your_serpapi_key
```

To enable optional AI interpretation, also configure Groq:

```dotenv
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-120b
```

Enter a paper title and choose a sample size from 5 to 100 (default 60). The
landing page and generated report share the same visual design. Reports include:

- An overall screening assessment with reasons, caveats, and suggested next steps.
- Crossref retraction status and deposited-reference coverage, including linked
  records and inspectable citation-network evidence when available.
- A supporting summary of incoming citation patterns in the retrieved sample.
- An interactive graph, candidate author overlaps, publication sources, years,
  and citing-paper records.
- Optional, clearly labeled AI commentary linked to an evidence catalog.

The AI option is off by default. It sends compact public-paper metadata and
calculated evidence to Groq; it does not receive API keys, local paths, full
abstracts, or citation passages, and it cannot change the deterministic metrics
or assessment. A request is bounded, with at most one smaller retry for oversized
or truncated output. Without a Groq key, the deterministic report remains usable.

## What the assessment means

Assessment rules are applied in priority order:

- **Retracted:** a DOI-linked Crossref retraction record is verified. Review the
  linked notice; retraction alone does not establish a citation cartel.
- **Retraction warning:** the title is marked retracted, but a DOI-linked record
  was not verified.
- **Strong cartel signals:** a target-connected citation cycle involves at least
  three candidate author teams, has at least 50% directed edge density and at
  least two reciprocal team pairs, and at least half of 10 or more target
  references share one deposited journal label.
- **Possible citation cartel:** a deposited-reference citation cycle connects the
  target's team and at least two other candidate teams.
- **Citation concerns — cartel not established:** a reference concentration,
  reciprocal team pair, incoming-sample signal, or majority venue label warrants
  review, without meeting the cycle rules above.
- **Looks fine in the checked evidence:** the metadata check completed with enough
  matched citers, author/reference evidence, target references, and deposited
  reference coverage, and no concern rule was triggered.
- **Looks fine in the sampled citations:** the sample has at least 10 citers,
  usable target identities, and usable author metadata for at least 80% of citers,
  with no threshold-level concern. This is sample-only; incomplete Crossref checks
  are still disclosed.
- **Insufficient evidence:** the available sample or author metadata is too limited
  for even a sample assessment. Missing metadata is not evidence of low risk.

Thresholds are screening rules, not validated against known cartel cases. A
low-concern assessment does not establish that a paper is valid or rule out
misconduct. The assessment applies to retrieved records only, never the paper's
full citation population.

## Evidence and limitations

- Scholar results are the first returned records, not a random or representative
  sample. Duplicate records may be removed, so the retrieved count can be below
  the requested size. A larger sample does not guarantee representativeness.
- Crossref checks the target, up to 20 sampled citers, and up to 12 DOI-bearing
  target references. Requests are sequential and bounded (up to 35 calls and 45
  seconds). Crossref is public and requires no additional API key. Public paper
  titles and DOIs are sent to Crossref; failures preserve the Scholar report and
  are disclosed.
- Crossref title matches must be unambiguous after normalization; approximate
  matches are rejected. Missing or undeclared references can hide citation edges.
- Author teams are candidate identities matched by ORCID or exact full names;
  ambiguous identities and incomplete author lists can affect results. Coauthors
  are grouped into teams so collaboration is not counted as multiple independent
  participants.
- Cycles are based on deposited reference DOIs, not author overlap. Older and
  newer papers can establish reciprocal behavior without circular publication
  chronology. Cycles do not establish intent, citation relevance, or coordination.
- Venue labels can be shortened or grouped. No citation-passage relevance
  analysis or field-matched statistical baseline is performed.

The dashboard focuses on the overall Crossref-backed assessment and supporting
evidence; sample statistics and author-overlap patterns are descriptive signals,
not a separate verdict.

## CLI

Run a live analysis (default sample size 60; maximum 100):

```powershell
npm run analyze -- "Attention Is All You Need" --max 40
npm run analyze -- "Attention Is All You Need" --max 40 --llm
```

This writes `out/report.json` and `out/report.html`. The HTML report is standalone
and can be opened directly in a browser. SerpApi usage is roughly one search to
resolve the title plus one per 20 citers.

Re-analyze a saved JSON bundle without additional Scholar calls:

```powershell
npm run analyze -- --from out/report.json
npm run analyze -- --from out/report.json --llm
npm run analyze -- --from out/report.json --refresh-integrity
```

Offline re-analysis reuses saved Crossref evidence unless
`--refresh-integrity` is supplied. It writes `out/report-v2.json` and
`out/report-v2.html`, preserving the original input report. Refreshed integrity
checks make public Crossref requests. Saved bundles are capped at 100 citers.

## Optional AI interpretation

The default model is **`openai/gpt-oss-120b`** through Groq's
OpenAI-compatible API. Override it with `GROQ_MODEL`; use a model that supports
strict structured output and the reasoning parameter. No additional SDK is
required.

The bounded prompt contains aggregate evidence and compact records for up to 100
sampled papers. It omits full abstracts, raw Crossref reference lists, the full
overlap-pair list, API keys, and local paths. Content is compressed to a bounded
size; one smaller-input retry is allowed only for HTTP 413 or truncated output.
Rate limits and other failures are not automatically retried. Invalid or
truncated responses are not presented as complete interpretations.

The interpretation separates reported observations, cautious inferences and
alternatives, limitations, and suggested verification steps. Claims refer to
IDs in the exported evidence catalog, but valid references do not guarantee a
claim is correct. AI must not infer citation intent, invent missing metadata,
assign cartel probabilities, or declare wrongdoing or innocence. Verify claims
against the linked sources.

## Development checks

```powershell
npm run typecheck
npm test
```

Tests run offline and mock Groq; they make no paid API calls. Coverage includes
identity matching, sample metrics, graph/report consistency, Crossref matching
and integrity signals, HTML escaping, AI request and evidence validation, opt-out,
and API failure handling.

## Project layout

- `src/server.ts` — web app and live-analysis flow.
- `src/cli.ts` — live CLI analysis and saved-bundle re-analysis.
- `src/serpapi.ts` — Scholar retrieval and normalized paper metadata.
- `src/identity.ts` — candidate author matching and source normalization.
- `src/analyze.ts` — sample metrics and report data.
- `src/integrity.ts` / `src/assessment.ts` — Crossref evidence and screening assessment.
- `src/report.ts` / `src/design.ts` — standalone report and shared UI design.
- `src/llm.ts` — optional bounded Groq interpretation and evidence validation.
- `src/selftest.ts` / `src/integrity-selftest.ts` — offline regression tests.
