```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃    ____        _        _          _      _                             ┃
┃   |  _ \  __ _| |_ __ _| |__  _ __(_) ___| | _____                      ┃
┃   | | | |/ _` | __/ _` | '_ \| '__| |/ __| |/ / __|                     ┃
┃   | |_| | (_| | || (_| | |_) | |  | | (__|   <\__ \                     ┃
┃   |____/ \__,_|\__\__,_|_.__/|_|  |_|\___|_|\_\___/                     ┃
┃       ___                      _                  _    ___              ┃
┃      |_ _| _ __   ___  _ __   (_) _ __  ___      / \  |_ _|             ┃
┃       | | | '_ \ / __|| '_ \  | || '__|/ _ \    / _ \  | |              ┃
┃       | | | | | |\__ \| |_) | | || |  |  __/   / ___ \ | |              ┃
┃      |___||_| |_||___/| .__/  |_||_|   \___|  /_/   \_\___|             ┃
┃                       |_|                                               ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

Infuse your Data with Databricks Genie Code AI capabilities to deliver business value.

**Version:** v1.5.3 (Production Release)
**Last Updated:** 2026-11-03

Inspire AI reads your Unity Catalog metadata and uses a 7-phase multi-model AI agent pipeline to
discover, score, and generate production-ready use cases: complete with Genie Code instruction
notebooks, documents, and presentations.

---

# Part 1: Understanding How Inspire Works

## Inspire is an AI Agent

Inspire is not a template generator. It is an **autonomous AI agent** that orchestrates multiple
large language models (Claude Opus 4.6, Sonnet 4.6, Opus 4.5, Sonnet 4.5, GPT-OSS 120B/20B) in a
**multi-model cascade** with automatic fallback. Each phase of the pipeline uses a purpose-tuned
model at a calibrated temperature (an endpoint that rejects a temperature parameter runs at its default
sampling, logged once per endpoint as `G32 TEMPERATURE_REJECTED_ADAPTED`; an endpoint whose startup
check did not finish is kept but placed after the endpoints that passed it, logged as
`LLM_ENDPOINT_PROBE_ORDER FIRED`):

- **Low temperature (0.0-0.2)** for precision-critical tasks like scoring, goal alignment filtering, and table classification
- **Medium temperature (0.2-0.4)** for balanced tasks like use case generation, domain clustering, and Genie Code instructions
- **Higher temperature (0.4-0.5)** for creative tasks like summaries and domain discovery

The agent decides which tables matter, what use cases to generate, how to score them, and produces
goal-oriented Genie Code instructions: all without touching your actual data.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     INSPIRE AI AGENT ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Unity Catalog Metadata                                               │
│   (catalogs, schemas, tables, columns)                                 │
│           │                                                            │
│           ▼                                                            │
│   ┌───────────────────────────────────────────────────────────┐        │
│   │              MULTI-MODEL CASCADE ENGINE                   │        │
│   │                                                           │        │
│   │   ┌──────────┐   ┌──────────┐   ┌──────────┐             │        │
│   │   │ Claude   │──▶│ Claude   │──▶│ Claude   │──▶ ...      │        │
│   │   │ Opus 4.6 │   │Sonnet 4.6│   │ Opus 4.5 │             │        │
│   │   └──────────┘   └──────────┘   └──────────┘             │        │
│   │        Try 1st        Try 2nd        Try 3rd              │        │
│   │                                                           │        │
│   │   If model fails ──▶ automatic fallback to next model     │        │
│   └───────────────────────────────────────────────────────────┘        │
│           │                                                            │
│           ▼                                                            │
│   ┌───────────────────────────────────────────────────────────┐        │
│   │                 7-PHASE AI PIPELINE                        │        │
│   │                                                           │        │
│   │   Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4            │        │
│   │   Init &      Generate     Cluster     Score, Dedup       │        │
│   │   Context     Use Cases    Domains     & Goal Filter      │        │
│   │                                                           │        │
│   │   Phase 5 ──▶ Phase 6 ──▶ Phase 7                         │        │
│   │   Genie Code  Artifacts    Translation                    │        │
│   │   Instructions                                            │        │
│   └───────────────────────────────────────────────────────────┘        │
│           │                                                            │
│           ▼                                                            │
│   Genie Code Notebooks, PDF Catalog, PPTX, Excel                      │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Privacy: Discovery Types (v1.3.0)

The `03_discovery_type` widget decides whether the AI may see what Inspire measures (v1.4.0).

- **Standard Discovery** (the default) reads your metadata (catalog, schema, table and column
  names, column types, comments, key constraints, tags and table properties), Unity Catalog metric
  view definitions, usage counts from `system.access.table_lineage`, Inspire's own tables, and
  aggregates over your data to decide each use case. One gate, `InspireAIGate`, masks every
  measured number in every prompt inside `AIAgent._call_ai_query` and restores it in the reply,
  so the AI sees metadata only.
- **AI Enhanced Discovery** (named Deep before v1.4.0) runs the same checks and also shows the
  aggregates to the AI: row counts, null share and approximate distinct counts, the date range of
  non-personal date columns, the most frequent values of non-personal low-cardinality text
  columns, join match rates, query-history join edges and KPI baselines.

Every customer-data read lives in one class, `DeepEvidence`. Every statement is logged and counted
in `results_json.data_access`, and every read is bounded by time and count budgets.

In both types no data row is sent to the AI, and the values of personal columns (matched by name
or by a PII tag) are never read. The `Ultra High` elite verification still checks cited tables,
columns, types and join paths against metadata alone.

---

## The 7 Phases in Detail

### Phase 1: Initialization and Context Extraction

The agent reads your Unity Catalog metadata and builds a deep understanding of your business:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   PHASE 1: INITIALIZATION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   UC Metadata Input                                                    │
│   (catalogs, schemas, tables)                                          │
│           │                                                            │
│           ├──────────────────────────┐                                 │
│           ▼                          ▼                                 │
│   ┌──────────────────┐    ┌──────────────────────┐                    │
│   │  STEP 1           │    │  STEP 2               │                   │
│   │  Business Context │    │  Generation           │                   │
│   │  Extraction       │    │  Instructions         │                   │
│   │  (temp: 0.3)      │    │  Interpreter           │                   │
│   │                   │    │  (temp: 0.2)           │                   │
│   │  - Industry       │    │                        │                   │
│   │  - Goals          │    │  Parses free-text      │                   │
│   │  - Value chain    │    │  instructions into     │                   │
│   │  - Revenue model  │    │  structured directives │                   │
│   └────────┬─────────┘    └───────────┬────────────┘                   │
│            │                          │                                │
│            ▼                          │                                │
│   ┌──────────────────┐               │                                │
│   │  STEP 3           │               │                                │
│   │  Table Filtering  │◀──────────────┘                                │
│   │  (temp: 0.2)      │                                                │
│   │                   │                                                │
│   │  Aggressively     │                                                │
│   │  filters out:     │                                                │
│   │  - System tables  │                                                │
│   │  - Audit logs     │                                                │
│   │  - Technical meta │                                                │
│   └────────┬─────────┘                                                 │
│            │                                                           │
│            ▼                                                           │
│   Business tables ready for use case generation                        │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

**Table Election** controls which tables feed into generation:

| Option                 | Behavior                                                                    |
|:-----------------------|:----------------------------------------------------------------------------|
| `Let Inspire Decides`  | AI classifies tables as transactional vs. dimensional, selects optimal set  |
| `All Tables`           | Every business table (no filtering)                                         |
| `Transactional Only`   | Only tables classified as transactional (orders, events, logs)              |

The AI uses a two-test classification:
- **Entity Test**: If a table represents a WHO, WHAT, or WHERE, it is master/reference
- **Event Test**: If each row captures a discrete business event that would not exist without that event, it is transactional

### Phase 2: Use Case Generation

This is the creative engine. Inspire generates use cases in a comprehensive discovery pass covering
structured data analytics, AI/ML, and statistical techniques:

```
┌─────────────────────────────────────────────────────────────────────────┐
│               PHASE 2: USE CASE GENERATION                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Filtered Business Tables + Business Context                          │
│   + Generation Instructions (if provided)                              │
│           │                                                            │
│           ▼                                                            │
│   ┌──────────────────────────────────────────────────────┐             │
│   │  COMPREHENSIVE DISCOVERY PASS                        │             │
│   │  (temp: 0.25)                                        │             │
│   │                                                      │             │
│   │  Covers all analytical techniques:                   │             │
│   │  - Trend analysis, anomaly detection, cohort         │             │
│   │  - ai_classify, ai_forecast, ai_query, ai_extract   │             │
│   │  - Correlation, Monte Carlo, what-if, regression     │             │
│   │  - Pareto, funnel, geospatial                        │             │
│   └──────────────────────┬───────────────────────────────┘             │
│                          │                                             │
│                          ▼                                             │
│                All Generated Use Cases                                 │
│                                                                        │
│   Each use case includes:                                              │
│   - Name, Type, Analytics Technique                                    │
│   - Statement (business challenge)                                     │
│   - Solution (using Databricks AI capabilities)                        │
│   - Business Value, Beneficiary, Sponsor                               │
│   - Tables Involved (fully qualified)                                  │
│   - Technical Design (CTE blueprint)                                   │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

**Two-pass generation**: Pass 1 runs at temperature 0.25 for near-deterministic exhaustive discovery.
Pass 2 runs at temperature 0.5 for creative gap-filling across under-represented domains and techniques.

**Quality gates enforced at generation time (D1-D19, LLM-evaluated):**
- Technical grounding (D1-D11): causal signal, cause-effect, granularity, columns present, analytical depth (Strip Test), activation (Action Test), semantic uniqueness (5-layer LLM judgment)
- Business value (D12-D14): stakeholder relevance, sponsor funding test, production-engineering test
- Principal-analyst (D15-D19): decision cadence, Monday Test, explainability, 18-month longevity, attributable $-impact
- **Zero regex, zero pattern matching** -- every gate is an LLM reasoning step

### Phase 3: Domain Clustering

The agent organizes use cases into meaningful business domains:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                PHASE 3: DOMAIN CLUSTERING                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Raw Use Cases                                                        │
│           │                                                            │
│           ▼                                                            │
│   ┌──────────────────┐                                                 │
│   │  STEP 1           │                                                │
│   │  Domain Finder    │   Clusters use cases into business domains     │
│   │  (temp: 0.5)      │   e.g. "Risk Management", "Revenue Ops"       │
│   └────────┬─────────┘                                                 │
│            │                                                           │
│            ▼                                                           │
│   ┌──────────────────┐                                                 │
│   │  STEP 2           │                                                │
│   │  Subdomain        │   Detects subdomains within each domain        │
│   │  Detector         │   e.g. "Credit Risk", "Market Risk"            │
│   │  (temp: 0.4)      │   under "Risk Management"                      │
│   └────────┬─────────┘                                                 │
│            │                                                           │
│            ▼                                                           │
│   ┌──────────────────┐                                                 │
│   │  STEP 3           │                                                │
│   │  Domain Merger    │   Merges overlapping domains to avoid          │
│   │  (temp: 0.4)      │   fragmentation                                │
│   └────────┬─────────┘                                                 │
│            │                                                           │
│            ▼                                                           │
│   ┌──────────────────┐                                                 │
│   │  STEP 4           │                                                │
│   │  Subdomain Merger │   Deduplicates subdomains across domains       │
│   │  (temp: 0.3)      │   when same subdomain appears in multiple      │
│   │                   │   domains                                      │
│   └────────┬─────────┘                                                 │
│            │                                                           │
│            ▼                                                           │
│   ┌──────────────────┐                                                 │
│   │  STEP 5           │                                                │
│   │  Domain Splitter  │   Splits oversized mega-domains into           │
│   │  (temp: 0.3)      │   balanced groups                              │
│   └────────┬─────────┘                                                 │
│            │                                                           │
│            ▼                                                           │
│   Organized Domain Tree:                                               │
│                                                                        │
│   N01 ─ Risk Management                                                │
│   ├── Credit Risk                                                      │
│   ├── Fraud Detection                                                  │
│   └── Compliance                                                       │
│   N02 ─ Revenue Operations                                             │
│   ├── Pricing Optimization                                             │
│   └── Revenue Leakage                                                  │
│   N03 ─ Customer Intelligence                                          │
│   └── ...                                                              │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

If you provide **Business Domains** in the configuration, use cases will be aligned only to those
domains. Otherwise, the AI auto-detects and clusters them.

### Phase 4: Scoring, Deduplication, Quality Bar, and Selection (v1.2.0)

Phase 4 is the single most opinionated phase in the Inspire pipeline. It is where a large, noisy,
over-generated bag of candidate use cases is reduced to the use cases that clear the bar of the
selected quality mode. All three modes (`Good`, `High`, `Ultra High`) arrive here with the same
candidates from one broad generation pass; they differ only in selection. No mode recovers
rejected use cases, tops up a small portfolio or pads it toward a target size. In v0.7.2 the phase
gained a Best-of-Best (BoB) ranking plus Stratified Trim step, used by `Good` and `High`; v1.2.0
adds the `Ultra High` elite selection; see the dedicated sections below. The high-level flow is:

```
┌────────────────────────────────────────────────────────────────────────┐
│     PHASE 4: SCORING, DEDUP, QUALITY BAR AND SELECTION (v1.2.0)        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Clustered, goal-aligned use cases (typical: 300-500 candidates)      │
│                          │                                             │
│                          ▼                                             │
│   ┌───────────────────────────────────────────────────┐                │
│   │  STEP 1: LLM SEMANTIC DEDUPLICATION (5-layer)     │                │
│   │  REVIEW_USE_CASES_PROMPT, temp 0.1                │                │
│   │  Verb, noun-synonym, entity-metric, technique     │                │
│   │  swap and table+intent duplicates collapse.       │                │
│   │  NO REGEX. NO PATTERN MATCHING. LLM JUDGMENT.     │                │
│   │  Global pass starts on the thinker and cascades   │                │
│   │  to the next model when it is slow or fails.      │                │
│   └──────────────────────┬────────────────────────────┘                │
│                          ▼                                             │
│   ┌───────────────────────────────────────────────────┐                │
│   │  STEP 2: COMBINED SCORING                         │                │
│   │  COMBINED_VALUE_QUALITY_SCORE_PROMPT, temp 0.15   │                │
│   │  VALUE 1.0-5.0 and QUALITY 1.0-5.0 in one pass,   │                │
│   │  absolute anchors, all 19 gates enforced.         │                │
│   │  Any HARD VETO caps quality=2.0. A UC with no     │                │
│   │  valid score after retries is never selected.     │                │
│   │  The only Priority source (no per-domain value    │                │
│   │  pass); each batch sees only its own tables       │                │
│   │  and their FK partners.                           │                │
│   └──────────────────────┬────────────────────────────┘                │
│                          ▼                                             │
│   ┌───────────────────────────────────────────────────┐                │
│   │  STEP 3: QUALITY BAR OF THE SELECTED MODE         │                │
│   │  Good       -> Medium, High, Very High, Ultra     │                │
│   │                High                               │                │
│   │  High       -> High, Very High, Ultra High        │                │
│   │  Ultra High -> High-or-better candidates plus a   │                │
│   │                high-value second look             │                │
│   └──────────────────────┬────────────────────────────┘                │
│                          ▼                                             │
│   ┌───────────────────────────────────────────────────┐                │
│   │  STEP 4a (Good, High): BEST-OF-BEST + TRIM        │                │
│   │  BoB scores, then one call names the idea themes; │                │
│   │  drops hard-vetoed and BoB-unscored UCs;          │                │
│   │  count > aggressive_prune_threshold (75) ->       │                │
│   │  stratified trim by idea_theme to the jittered    │                │
│   │  cap (91-110); canonical-title dedup.             │                │
│   │                                                   │                │
│   │  STEP 4b (Ultra High): ELITE SELECTION            │                │
│   │  BoB prescreen -> elite judge -> metadata         │                │
│   │  verification (one repair re-judge for a          │                │
│   │  citation slip) -> absolute bar. Near misses get  │                │
│   │  one second opinion. No quota, no cap.            │                │
│   └──────────────────────┬────────────────────────────┘                │
│                          ▼                                             │
│   ┌───────────────────────────────────────────────────┐                │
│   │  STEP 5: DOMAIN COVERAGE PICKS (every mode)       │                │
│   │  Each user-specified Business Domain left         │                │
│   │  empty gets its best scored UC, labelled          │                │
│   │  "Domain coverage pick, below bar". No            │                │
│   │  recovery, no top-up: 0 met bar -> ship the       │                │
│   │  closest candidates below the bar.                │                │
│   └──────────────────────┬────────────────────────────┘                │
│                          ▼                                             │
│   Final-rank renumber in every mode (N01 = domain of the best UC)      │
│   Selected use cases + funnel_ledger (one entry per stage)             │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**Scoring personas (v0.7.2):**
- **Combined Value + Quality scorer** (temperature 0.15): a single LLM pass that scores BOTH dimensions while enforcing all 19 gates. Any HARD VETO (D1, D2, D8, D9, D10, D12, D13, D14, D15, D16, D17, D18, D19) caps `quality_score` at 2.0 and the UC is dropped by the quality bar of every mode.
- **Value dimensions**: Strategic alignment, ROI potential, business priority fit.
- **Quality dimensions**: all 19 gates (technical grounding, business value, principal-analyst signoff).
- **Best-of-Best re-ranker (NEW)**: runs only when the portfolio is still oversized after dedup. Issues per-gate 0-10 scores (D1..D19) rather than a pass/fail veto, enabling fine-grained ranking among survivors. In `Ultra High` it is the prescreen in front of the elite judge.
- **Elite judge (v1.2.0, `Ultra High` only)**: `ULTRA_HIGH_ELITE_JUDGE_PROMPT` scores each candidate 1-10 on value, evidence, implementability and actionability against fixed anchors, with a red-team note; a deterministic metadata verification and the absolute bar decide which candidates are elite (see "Ultra High Elite Selection" below).

**Scoring retries and the dedup re-ask (v1.2.1):** the goal filter, user-domain assignment, combined scoring, Best-of-Best and the elite judge all score through one split-retry engine (`_score_with_split_retry`). Only the first attempt of a batch is cut by the straggler budget (three times the median batch time, at least 120 seconds); a timed-out batch is retried in halves, each retry with the full per-task timeout, for up to `scoring_split_retry_rounds` rounds, while an unusable answer gets one retry per use case (also when it first arrives on the retry of a timed-out batch) and stops when a second unusable answer recovers nothing. A use case still unscored after every retry is logged at ERROR and recorded in the funnel ledger. When the dedup keep-list (`REVIEW_USE_CASES_PROMPT`) is unusable, it is asked for once more with the cache bypassed before global dedup falls back to per-domain dedup or a domain keeps all of its use cases. A failed global dedup over a single group keeps all use cases instead of resending the identical request; the keep-list is read without the comma-based preamble rule (its rows have one column, so that rule deleted every kept id above a trailing note) and its id column is the majority column. An elite-judge record that is discarded is re-judged with the exact reason and the allowed verdicts, and the judge prompt names every key the parser reads, including `verdict` and `scores`. A verdict that is still above what its own scores and value tier support after that re-judge is capped at the supported verdict (`verdict_capped_from` keeps the original), so the absolute bar decides instead of the record being dropped.

**Inspire Score formula**: `quality_weight * quality_score + priority_weight * value_score` where `quality_weight=0.65` and `priority_weight=0.35`. BoB introduces an orthogonal `bob_score` (0-10) used only for Stratified Trim; it does NOT replace the Inspire Score on final artifacts.

### Best-of-Best Ranking and Stratified Trim (v0.7.2+, v0.7.3 Refinements)

#### Why This Exists: Empirical Failure of the v0.7.1 Trim

In v0.7.1 the Target-Zone Vetting step invoked `REVIEW_USE_CASES_PROMPT` as its "aggressive trim"
mechanism. That prompt was designed as a **semantic deduplicator**: it removes UCs when it can
identify a true duplicate. When the portfolio was full of good-but-different UCs, the prompt
correctly stopped removing, even when the portfolio was far over target.

The concrete failure was observed in the `tpcds_sf1` v0.7.1 validation run: after all prior steps
the portfolio contained 249 UCs vs `target_max=100`. The REVIEW prompt could not find 149 more
pairs of duplicates, so it returned the portfolio almost unchanged. The resulting artifacts were
unwieldy, domain coverage was imbalanced (a single "Forecasting" theme contained ~30% of all
UCs), and reviewers rejected the output as too large to evaluate.

Root cause: **deduplication and trimming are different problems**. Dedup answers "is this a
copy of another UC?". Trim answers "if I must ship exactly N UCs, which N should they be?". The
second question requires a ranking signal and a diversity constraint, not a dedup prompt.

v0.7.2 adds that ranking-and-diversity layer.

#### The New Pipeline (Step 5 sub-flow)

```
┌────────────────────────────────────────────────────────────────────┐
│     GOOD / HIGH SELECTION: BoB + STRATIFIED TRIM                   │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   Input: UCs that cleared the Good or High quality bar (count N)   │
│                                                                    │
│   if N > aggressive_prune_threshold (default 75):                  │
│   ┌─────────────────────────────────────────────────────┐          │
│   │ (a) Best-of-Best Scoring                            │          │
│   │     BEST_OF_BEST_SCORING_PROMPT                      │          │
│   │     Batches of 25 UCs per LLM call                  │          │
│   │     Parallelism: quality_scoring_max_workers         │          │
│   │                                                      │          │
│   │     For each UC, LLM returns:                       │          │
│   │     - 19 per-gate 0-10 scores (D1..D19)             │          │
│   │     - bob_justification_short (≤160 chars)           │          │
│   └──────────────────────┬──────────────────────────────┘          │
│                          ▼                                         │
│   ┌─────────────────────────────────────────────────────┐          │
│   │ (b) Composite BoB score                             │          │
│   │                                                      │          │
│   │ tier1 = mean(D1..D11)      # tech grounding (0-10) │          │
│   │ tier2 = mean(D12..D14)     # business value (0-10) │          │
│   │ tier3 = mean(D15..D19)     # PBA signoff (0-10)    │          │
│   │                                                      │          │
│   │ bob_score = 0.30*t1 + 0.35*t2 + 0.35*t3             │          │
│   │                                                      │          │
│   │ Hard-veto floor:                                     │          │
│   │   if any gate D1..D19 < 3: bob_score = min(bob,2.0) │          │
│   └──────────────────────┬──────────────────────────────┘          │
│                          ▼                                         │
│   ┌─────────────────────────────────────────────────────┐          │
│   │ (c) Theme assignment (v1.3.0)                       │          │
│   │     One call sees every scored UC and names the     │          │
│   │     themes of the whole portfolio: one name per     │          │
│   │     ANALYTICAL idea ("Anomaly Detection", "Demand   │          │
│   │     Forecasting"), never a business domain.         │          │
│   └──────────────────────┬──────────────────────────────┘          │
│                          ▼                                         │
│   ┌─────────────────────────────────────────────────────┐          │
│   │ (d) Stratified Trim by Idea Theme                   │          │
│   │     Budget target_max across themes proportionally, │          │
│   │     capped at theme_max_share (15%) per theme.      │          │
│   │     Within each theme, rank by bob_score DESC,      │          │
│   │     take top-K.                                      │          │
│   └──────────────────────┬──────────────────────────────┘          │
│                          ▼                                         │
│   Output: at most the jittered cap (91-110 by default)             │
│                                                                    │
│   elif N >= bob_min_threshold (default 20):                        │
│     BoB scoring only; hard-vetoed and BoB-unscored UCs dropped,    │
│     nothing trimmed                                                │
│                                                                    │
│   else:                                                            │
│     No trim. Nothing is ever recovered, topped up or padded;       │
│     below-bar fallback ships the closest candidates.               │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

#### Best-of-Best Scoring Algorithm

The prompt template `BEST_OF_BEST_SCORING_PROMPT` (registered in `PROMPT_TEMPLATES`) is a
ranking-grade scorer that encourages full decile spread (0-10) rather than clustering around a
median. Internally, the LLM is instructed:

- Score D1..D19 on a 0-10 scale, one integer per gate.
- Do not default to 5. Use the full range. A UC that fails a gate should score 0-2 on that gate;
  a UC that perfectly satisfies a gate should score 9-10.
- Emit a ≤160-character `bob_justification_short` sentence explaining why this UC is strong
  (or weak) compared to alternatives.

From v1.3.0 the scoring prompt names no idea theme; `THEME_ASSIGNMENT_PROMPT` names the themes of
all scored use cases in one call (see Idea Theme Design).

Python surface area:

- `_score_bob_batch(use_cases, batch_size=25)`: wraps the LLM invocation for a single batch and
  returns a list of parsed scoring dicts.
- `_parse_bob_response(raw_text)`: tolerant parser. Strips fenced-code wrappers
  (```json, ```), coerces missing or non-integer gate values to 5, and clamps every gate to
  [0, 10]. Raises a structured error only if the response is so malformed that no gates can be
  recovered.
- `_compose_bob_score(per_gate_scores)`: computes the tier-weighted composite and applies the
  hard-veto floor.
- `_stratified_trim_by_theme(scored_ucs, target_max, theme_max_share)`: the trim kernel.

Batching (25 UCs per call) and parallelism (up to `quality_scoring_max_workers`, default 10) are
tuned so that a 300-UC portfolio completes BoB scoring in roughly 2-3 minutes on a large-model
endpoint. 25 is small enough that the prompt fits comfortably in a 200K-token window with all
gate definitions, but large enough that the LLM can internally cross-calibrate (it sees 25 UCs
at once and uses them as anchors for the decile spread).

#### Tier-Weighted Composite: Why 0.30 / 0.35 / 0.35

The composite formula is:

```
bob_score = 0.30 * tier1_mean(D1..D11)
          + 0.35 * tier2_mean(D12..D14)
          + 0.35 * tier3_mean(D15..D19)
```

The weighting is not uniform (1/3, 1/3, 1/3) and not equal-across-gates (11/19, 3/19, 5/19):
it reflects a deliberate design choice:

1. **Tier 1 (technical grounding) is a PASS/FAIL precondition, not a differentiator.** Any UC
   reaching BoB has already survived Combined Scoring and the quality bar of its mode. It is by
   construction technically grounded. The marginal value of a t1=9 vs t1=7 UC is small because
   both are "good enough to build". Over-weighting t1 would just re-rank technically-correct
   but business-weak UCs above business-strong ones with small technical deltas.

2. **Tier 2 (business value, D12-D14) is the first real differentiator.** D13 (Sponsor Test) is
   statistically the most frequent reason a technically-grounded UC is rejected by a human
   reviewer. Investment here drives portfolio quality.

3. **Tier 3 (PBA signoff, D15-D19) is equally decisive.** D16 (Monday Test) and D19
   (Attributable Impact) are the other two top-cited reasons reviewers reject UCs. Tier 3
   captures "operability and defensibility", which Tier 2 does not.

Equal-weighting Tier 2 and Tier 3 at 0.35 each is an explicit statement that funding
(can you sell it?) and action (can you run it Monday?) are both required and neither alone
suffices. Empirically this weighting produces scores that correlate well with human reviewer
acceptance (manual grading of 25 random UCs from the tpcds_sf1 run agreed with the BoB rank
order 22/25 times).

#### Hard-Veto Floor

Even though BoB is a "soft" 0-10 ranking, a single gate scoring below 3 triggers a hard floor:

```python
if any(gate_score < 3 for gate_score in (D1..D19)):
    bob_score = min(bob_score, 2.0)
```

Rationale: D9 (Strip Test), D10 (Action Test), D16 (Monday Test), and D19 (Attributable
Impact) are each sufficient to destroy a UC's real-world usefulness. A UC that scores
t1=9, t2=9, t3=9 except for D16=1 is a research exercise, not an actionable insight. The floor
prevents tier-averaging from whitewashing that defect.

The floor is a CAP, not a fixed value. A UC with one weak gate but weak across the board
produces bob_score close to 0, not 2.0. The floor only bites when a UC is otherwise strong and
would have ranked high if the weak gate were ignored.

**v0.7.3: hard-veto pre-filter closes the "theme-floor slip-through".** In v0.7.2 a
hard-vetoed UC that was the ONLY representative of its `idea_theme` would still ship, because
the Stratified Trim's "at-least-1-per-theme" floor overrode the veto signal. v0.7.3 fixes this
by dropping all UCs with a populated `bob_hard_veto_gate` at the TOP of
`_stratified_trim_by_theme`, BEFORE grouping. The "Why" of the hard-veto remains unchanged:
some single-gate failures are individually fatal, but enforcement is now consistent: a
hard-vetoed UC never ships, even as a sole-theme representative. Any theme that loses all
members to the pre-filter is legitimately eliminated (its UCs were unshippable anyway).
Validation on `tpcds_sf1` session `1234567890000001` confirmed 13 hard-veto UCs were removed
(219 → 206) before the theme-stratified logic began, and 0 hard-veto UCs survived into the
final portfolio.

#### Stratified Trim by Idea Theme

Pseudocode:

```
function stratified_trim_by_theme(scored_ucs, target_max, theme_max_share):

    # 0. v0.7.3 pre-filter: drop hard-veto UCs BEFORE grouping by theme.
    # Previously the "1-per-theme floor" rule could override the hard-veto and
    # ship a capped-at-2.0 UC as the sole representative of its theme. Removing
    # hard-veto UCs here means any theme that loses all members is legitimately
    # eliminated rather than artificially sustained.
    #     survivors = [uc for uc in scored_ucs
    #                  if uc.get("bob_hard_veto_gate") in (None, "", "None")]
    scored_ucs = drop_hard_veto(scored_ucs)

    # 0b. v0.7.3 jitter: compute the effective cap as
    #     target_max + randint(1, target_max_jitter)
    # so the final UC count is not a suspiciously round number (e.g. 90 → 91-110).
    # v1.3.0: the draw comes from random.Random(f"{session_id}:target_max"), so a session always
    #     gets the same size and new sessions still vary
    effective_cap = target_max + randint(1, target_max_jitter)

    if len(scored_ucs) <= effective_cap:
        return scored_ucs   # already at or below effective cap

    # 1. Group UCs by idea_theme
    groups = group_by(scored_ucs, key="idea_theme")
    num_themes = len(groups)
    cap_per_theme = floor(effective_cap * theme_max_share)   # e.g. floor(100 * 0.15) = 15

    # 2. Degenerate: more themes than slots
    if num_themes >= effective_cap:
        # Rank themes by their best UC's bob_score
        ranked_themes = sorted(groups, key=lambda g: max(uc.bob_score for uc in g), reverse=True)
        # Take the top effective_cap themes; 1 UC per theme (its best)
        return [best_uc(g) for g in ranked_themes[:effective_cap]]

    # 3. Floor (v1.3.0): every theme keeps its best UC by bob_score
    ranked = {t: sorted(g, key=lambda uc: uc.bob_score, reverse=True) for t, g in groups.items()}
    keep = {t: [g[0]] for t, g in ranked.items()}
    # 4. Fill (v1.3.0): the remaining effective_cap - num_themes slots go to the strongest
    #    remaining UCs by bob_score across all themes, never above cap_per_theme per theme
    slots = effective_cap - num_themes
    for uc in sorted((uc for g in ranked.values() for uc in g[1:]), key=lambda uc: uc.bob_score, reverse=True):
        if slots == 0:
            break
        if len(keep[uc.idea_theme]) < cap_per_theme:
            keep[uc.idea_theme].append(uc)
            slots -= 1
    return [uc for t in groups for uc in keep[t]]
```

#### Stratified Trim: Worked Example

The two worked examples below show the proportional quotas used before v1.3.0. From v1.3.0 the extra
slots are not split by theme size: after one UC per theme, they go to the strongest remaining UCs
by `bob_score`, still never above `cap_per_theme` per theme. With many small themes, the old rounding
gave the whole shortfall to the largest theme, so its weakest UCs survived while strong second UCs of
small themes were cut (a `tpcds_sf1` run with 84 themes kept all 8 of its largest theme and dropped a
Ultra High-quality UC of a two-UC theme).

Suppose the dedup/filter output contains 180 UCs, `target_max=100`, `theme_max_share=0.15`
(so `cap_per_theme = 15`), and the LLM has assigned the following themes:

| Theme | Count | bob_score range |
|:------|:------|:----------------|
| Anomaly Detection | 42 | 3.1 to 8.4 |
| Demand Forecasting | 28 | 4.0 to 7.9 |
| Customer Segmentation | 21 | 2.0 to 7.5 |
| Churn Prediction | 18 | 3.2 to 7.1 |
| Revenue Leakage | 14 | 4.5 to 8.2 |
| Pricing Optimization | 12 | 3.0 to 7.8 |
| Fraud Detection | 10 | 5.0 to 8.5 |
| ... (20 more themes, avg 1.75 UCs each) | 35 | 2.0 to 6.9 |
| **TOTAL** | **180** | 2.0 to 8.5 |

Step 1: `num_themes=27`, `total=180`, `target_max=100`, `extra_budget=100-27=73`.

Step 2: Proportional quotas:
- Anomaly Detection: `min(42, 1 + round(42/180 * 73), 15) = min(42, 18, 15) = 15`
- Demand Forecasting: `min(28, 1 + round(28/180 * 73), 15) = min(28, 12, 15) = 12`
- Customer Segmentation: `min(21, 1 + round(21/180 * 73), 15) = min(21, 10, 15) = 10`
- Churn Prediction: `min(18, 1 + round(18/180 * 73), 15) = min(18, 8, 15) = 8`
- Revenue Leakage: `min(14, 1 + round(14/180 * 73), 15) = min(14, 7, 15) = 7`
- Pricing Optimization: `min(12, 1 + round(12/180 * 73), 15) = min(12, 6, 15) = 6`
- Fraud Detection: `min(10, 1 + round(10/180 * 73), 15) = min(10, 5, 15) = 5`
- 20 tail themes: 1 each = 20

Step 3: Sum = 15+12+10+8+7+6+5+20 = 83. We are 17 under target. Reconcile by adding 1 to
largest themes that still have room. Anomaly is already at cap (15). Demand can grow to 13...
14... 15 (+3). Customer to 11... 12... 13... 14... 15 (+5). Churn to 9... 10... 11... 12... 13...
14... 15 (+7). Churn fills the rest. Sum now = 100.

Step 4: Within each theme, rank by bob_score DESC and take the quota:
- Anomaly Detection: top 15 of 42 (bob_score 6.8+)
- Churn Prediction: top 15 of 18 (bob_score 4.5+)
- Customer Segmentation: top 15 of 21 (bob_score 5.0+)
- ... etc.

Final output: exactly 100 UCs, no theme exceeds 15%, no theme is fully eliminated (floor of 1).

#### Stratified Trim: v0.7.3 Worked Example (219 → 206 → 105, with Jitter)

v0.7.3 adds two behaviors on top of the v0.7.2 walkthrough above: a hard-veto pre-filter and
target-max jitter. This worked example uses the `tpcds_sf1` validation run (session
`1234567890000001`, 24 tables).

**Starting state.** Post-dedup, goal-aligned UCs: 219. Config: `target_max_use_cases=90`,
`target_max_jitter=20`, `bob_theme_max_share=0.15`.

**Step 0a: hard-veto pre-filter (NEW in v0.7.3).** 13 UCs carry a non-null
`bob_hard_veto_gate` (most commonly D16 Monday Test, with a few D19 Attributable Impact).
These are dropped before any theme grouping: 219 → 206 surviving UCs. No theme was fully
eliminated by this step because the 13 vetoed UCs were distributed across 11 different themes,
each of which retained at least one clean UC.

**Step 0b: effective cap via jitter (NEW in v0.7.3).**
`effective_cap = 90 + randint(1, 20) = 90 + 15 = 105` for this particular run. In a different
run the draw might be 91-110; the output UC count is deliberately non-round so the final
portfolio does not look like it was algorithmically capped at an exact round number.

**Step 1: group by theme.** 206 UCs distributed across 69 distinct `idea_theme` labels.
`cap_per_theme = floor(105 * 0.15) = 15`.

**Step 2: proportional budgeting.** `num_themes=69`, `extra_budget=105-69=36`. Quotas
assigned proportional to theme size, capped at `cap_per_theme=15` and floored at 1.

**Step 3: reconciliation.** Rounding drift resolved by adding/removing slots from the
largest fillable themes until `sum(quotas) == 105`.

**Step 4: select within theme.** For each theme, rank survivors by `bob_score` DESC and take
the top-quota. Zero hard-veto UCs survive (they were removed in Step 0a).

**Final state (validated).** 105 UCs, 69 themes, 0 hard-veto survivors, Phase L final-gate
17/19. See the v0.7.3 Validation Evidence table below for cross-dataset results.

#### Idea Theme Design

**Semantics.** `idea_theme` is an **analytical archetype**, not a business domain or a technique
enum. The same business domain can host many themes:

- Business domain "Risk Management" can contain themes: "Anomaly Detection" (fraud),
  "Risk Scoring" (credit), "Compliance Monitoring" (regulatory).
- Business domain "Operations" can ALSO contain theme "Anomaly Detection" (equipment failure),
  separately from Risk's anomaly theme.

This matters because the stratified trim budgets on theme, not domain. If "Anomaly Detection"
dominated the portfolio across domains (fraud + operations + quality), the old domain-cap logic
would not have caught it: five "domains" each had ten anomaly-detection UCs and looked
balanced. The theme cap flattens this cross-domain over-representation.

**Free-form labels.** The LLM generates theme strings; there is no fixed enum. This gives the
ranker freedom to discover archetypes that the Inspire designers did not anticipate. The
downside: two UCs with functionally identical analysis can get slightly different theme strings
("Customer Churn Prediction" vs "Churn Modeling") and be double-counted as different themes.

**Known issue (v0.7.2): themes are too granular.** In the tpcds_sf1 validation run, BoB produced
75 distinct themes across 100 final UCs, an average of 1.3 UCs per theme. The degenerate-case
branch (`num_themes >= target_max`) almost triggered. Many of these were near-synonyms
("Customer Lifetime Value" vs "CLV Analysis"; "Demand Forecasting" vs "Sales Forecasting"). The
stratified trim still worked (no theme exceeded 15%), but the diversity cap did less work than
intended.

**v1.3.0: one call names the themes of the whole portfolio.** Until v1.3.0 each scoring batch
of 25 use cases named its own themes, so one idea got a new name in every batch. On the TPC-DS run
behind v1.3.0, 124 scored use cases carried 70 themes, 52 of them with one use case, and the
one-per-theme floor protected 70 of the 103 trim slots whatever their score. Now the scoring
prompt names no theme. After scoring, `THEME_ASSIGNMENT_PROMPT` sees every scored use case in one
compact list (id, name, technique, main table) and returns one theme per use case from one shared
list. The code applies only ids it sent and themes of at most 6 words, merges spellings that differ
only in case, sends the use cases the answer left out to a second call that sees the themes already
used, and retries once without the cache an answer with fewer than min(8, n/6) themes. Without a
usable answer every use case takes its subdomain as its theme, so a failed call never puts the
portfolio in one bucket that the per-theme cap would cut to 15 use cases. The step logs
`[THEME-ASSIGN FIRED]` (themes, themes with one use case, largest theme), `[THEME-ASSIGN FALLBACK]`,
and a warning when more than half the themes hold one use case.

**Operator guidance.** If you see the degenerate branch fire in your logs
(`num_themes >= target_max`), it means the LLM fragmented the theme space. The trim will still
produce a portfolio of `target_max` UCs, but the theme diversity is spurious: the UCs are
essentially ranked flat-top-N with a 1-per-theme constraint. Consider raising `target_max`
temporarily, and on v1.3.0 or later read the run's `[THEME-ASSIGN]` lines first.

#### Persisted Columns

BoB writes five new columns to `__inspire_usecases` (and, by extension, to the Excel catalog):

| Column | Type | Semantics | Range |
|:-------|:-----|:----------|:------|
| `idea_theme` | STRING | LLM-assigned analytical archetype (2-4 words) | free text |
| `bob_score` | DOUBLE | Tier-weighted composite with hard-veto floor | 0.0 to 10.0 |
| `bob_tier1_score` | DOUBLE | `mean(D1..D11)`: technical grounding | 0.0 to 10.0 |
| `bob_tier2_score` | DOUBLE | `mean(D12..D14)`: business value | 0.0 to 10.0 |
| `bob_tier3_score` | DOUBLE | `mean(D15..D19)`: principal-business-analyst | 0.0 to 10.0 |

For UCs that never reach the BoB step (portfolio stayed under `aggressive_prune_threshold`), all
five columns are NULL. This is intentional: a NULL `bob_score` is a truthful signal that the UC
was not compared against a BoB-ranking field, not a data defect.

Schema migration is idempotent. On startup, `AtomicWriter` runs
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` for each column. Re-running v0.7.2 on a table
created by v0.7.1 silently upgrades the schema. Downgrade from v0.7.2 to v0.7.1 works too:
v0.7.1 simply ignores the extra columns.

### Quality Modes and Ultra High Elite Selection (v1.2.0)

#### Three Modes, One Generation Pass

| Mode | Quality bar after combined scoring | What follows |
|:-----|:-----------------------------------|:-------------|
| `Good` (default) | Medium, High, Very High, Ultra High | BoB ranking; stratified trim only above `aggressive_prune_threshold` |
| `High` | High, Very High, Ultra High | Same as `Good` |
| `Ultra High` | High, Very High, Ultra High as the candidate base, plus a high-value second look at Medium | Elite selection with an absolute bar; no quota, no cap |

Generation is identical in every mode: one generation gate (`QUALITY_GATE_HIGH`) is sent with every
generation prompt, and the mode only decides selection. Legacy labels are accepted and mapped once,
at the input boundary: `Coverage Mode (All)`, `Balanced`, `Good Quality` and `High Quality` run as
`Good`; `Strict Quality` and `Very High Quality` run as `High`. Unknown values are rejected with an
error that lists the valid options; they are never silently replaced by a default, and the keep-all
behavior of the retired `Coverage Mode (All)` no longer exists.

A goal in the Generation Instructions sets scope and alignment and exempts goal-aligned use cases
from domain and technique balance penalties. It never exempts them from the quality bar of the
selected mode.

#### Ultra High Elite Selection

1. **Candidate pool.** High-or-better use cases after combined scoring, plus a second look at
   Medium use cases with a high value score. With user-specified Business Domains, candidates are
   assigned to those domains first.
2. **BoB prescreen.** Hard-vetoed candidates and candidates below the prescreen minimum are dropped.
3. **Metadata evidence index.** Column lists with types, nullability and comments, table comments
   and types, declared and inferred keys, tags and table properties, gathered from
   `information_schema` per catalog. No row data is read.
4. **Elite judge.** `ULTRA_HIGH_ELITE_JUDGE_PROMPT` (thinker model, low temperature, small batches
   with only the batch's tables in the schema) records the decision the use case changes, its
   owner and cadence, the KPI, a value driver tied to backticked columns with no invented numbers,
   a value tier, the signal, outcome, time and entity-key columns, the join path, the Databricks
   build path and blockers, a red-team "why this fails" note, and absolute 1-10 scores for value,
   evidence, implementability and actionability.
5. **Deterministic verification.** Every cited table and column exists; each technique's roles
   are present with compatible types (a date or timestamp for temporal techniques, a numeric
   measure for the KPI, an entity key, an outcome column for supervised techniques); multi-table
   use cases have a foreign-key path.
6. **Evidence repair.** When verification rejects only the judge's own citations (a missing or
   mistyped column, a wrong time column, an unverifiable join column, a missing role) and the use
   case would otherwise be elite or a near miss, it gets one re-judge with the cache bypassed. The
   re-judge sees the exact verification failures and the real column list of every table the use
   case cites, then the new assessment is verified again. A use case whose own tables fail
   (a table missing from the metadata, a volume source, no foreign-key path) is never repaired, a
   repaired assessment is never repaired again, and data that lacks the needed column stays
   rejected. `elite_assessment.evidence_repair` records the failures and the outcome.
7. **Absolute bar.** Elite only when the verdict is elite, the use case survives the red team, all
   four scores reach the minimum (8 of 10 by default), the value tier is Transformational or
   Material, and verification passes. A use case inside the near-miss band gets one independent
   second opinion from the first healthy model other than the judge, with the cache bypassed. Every
   judge call of the run starts on one pinned model (the first healthy endpoint of
   `elite_judge_preferred_endpoints`, else the first healthy judge endpoint; another model only after
   the pinned one is demoted or unusable). Every other miss goes
   to the near-miss ledger with the exact gate it failed. A use case still unjudged after the split
   retries never passes.
8. **Overlap, coverage, clustering and ranking.** Overlapping elites keep the stronger twin; each
   user-specified Business Domain without an elite gets one domain coverage pick labelled "Domain
   coverage pick, below bar"; the final set is clustered into domains and ranked by
   `elite_score = 0.40 value + 0.25 evidence + 0.20 implementability + 0.15 actionability`
   (`ultra_high_score_weights`; each score is the mean of both opinions when a near miss got a
   second opinion), with `bob_score` as the tie-break; domain coverage picks rank after every
   elite use case.
9. **Genie Code for every elite use case and only for them** when widget `13_generate_genie_code_for` is not `0`, with strict table and column reference and numeric-claim validation and one uncached repair; domain coverage picks keep their skeleton notebook (Phase 5).

The bar is absolute: there is no quota, cap or padding when the bar is met. When zero use cases
clear the bar the run does not ship empty: it returns the near misses rejected without a fatal flaw,
ranked by elite score and labelled "below the Ultra High bar" with the check each missed, then
High-tier candidates, under a plain "0 use cases met the Ultra High bar" notice. The scores shown
are the real elite scores; nothing is invented.

#### Selection Ledger and Persistence

Every selection stage appends one ledger entry (`stage`, `in`, `out`, `drops` by reason) and logs a
`[FUNNEL]` line. The ledger is published as `results_json.funnel_ledger` and as the `Selection Funnel`
step; a zero outcome is published as `results_json.selection_outcome` and the `Quality Bar` step.
In `Ultra High` the elite stages are `elite_candidate_pool`, `elite_bob_prescreen`, `elite_judge`,
`elite_evidence_repair`, `elite_verification`, `elite_second_opinion`, `elite_overlap`,
`elite_domain_coverage` and `elite_final`, followed by `final_guard` and the late `domain_clustering`.
The elite judge's prompt events and the elite stage's started and completion events appear under the
`Elite Selection` step; the completion payload is also published as `results_json.elite_outcome`.

#### Best of Best (v1.3.0)

After selection and before strategy alignment, `_mark_best_of_best` stars up to N final use cases when the
catalog holds more than N; a smaller catalog is already the short list and is not judged. N comes
from `16_best_of_best_count` (0 to 100), else from the `best_of_best_count` category of the generation
instructions interpreter, else 20. The judging core `_judge_elite_candidates` is shared with Ultra High
selection: metadata evidence, the elite judge, verification and evidence repair, the bar, a second opinion
for near misses and decision-twin dedup. In `Ultra High` the stars reuse the selection's verdicts and
nothing is judged twice. In `Good` and `High` the core runs on copies of the final use cases whose
`bob_score` is at least `ultra_high_bob_prescreen_min`, and logs `best_of_best_judge`,
`best_of_best_evidence_repair`, `best_of_best_verification`, `best_of_best_second_opinion` and
`best_of_best_overlap`; the originals only gain `best_of_best`, `best_of_best_rank`, `best_of_best_score`
and `best_of_best_reason`, so membership, scores and order never change. `_pick_best_of_best` ranks the
passing use cases by elite score, stars the best one of each user business domain first, holds any domain
to `max(2, ceil(N x 0.25))` stars while others still have passing use cases, then fills by score. Fewer
passing use cases than N means fewer stars, never padding. `_publish_best_of_best` runs after the final
numbering and publishes `results_json.best_of_best` and the `Best of Best` step.
`__inspire_usecases` gains `quality`, `quality_mode`, `elite_status`, `elite_score`,
`elite_assessment` (JSON) and `selection_flags` (JSON).

### Phase 5: Notebooks and Genie Code Instructions (v1.2.0)

Every use case gets a notebook. Discover writes a skeleton notebook for each one (the use-case
details and a marker cell for regeneration) and captures its Genie prompt fields from live Unity
Catalog metadata. It then generates Genie Code instructions for a selected set: the top-N by final
rank (widget `13_generate_genie_code_for`, default `0`, a number or `all`), or every elite use case in
`Ultra High` (domain coverage picks keep their skeleton). With the default `0` no use case gets Genie
Code in any mode, and every use case keeps its skeleton. Route 1 and Route 2 of Generate mode
regenerate exactly the use cases the user flagged.

```
┌─────────────────────────────────────────────────────────────────────────┐
│        PHASE 5: NOTEBOOKS AND GENIE CODE INSTRUCTIONS                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Final ranked use cases + live Unity Catalog metadata                 │
│           │                                                            │
│           ├──▶ skeleton notebook for every use case                    │
│           ▼                                                            │
│   ┌──────────────────────────────────────────────────────────┐         │
│   │  GENIE INSTRUCTION GENERATOR (temp: 0.3, 8 sections)     │         │
│   │  Inputs: decision block (Ultra High assessment), tables   │         │
│   │  and columns from metadata, FK paths, execution family,   │         │
│   │  run pattern and business output, readiness and          │         │
│   │  acceptance thresholds                                   │         │
│   │  Validation: every cited table and column against live   │         │
│   │  metadata, no invented figures; one uncached repair;     │         │
│   │  strict in Ultra High (a failing instruction is dropped) │         │
│   └──────────────────────┬───────────────────────────────────┘         │
│                          ▼                                             │
│   Genie notebook (replaces the skeleton only when an instruction is    │
│   emitted): the use-case card with the copy line, the instruction and  │
│   Run controls (tagged job); Genie Code builds the rest from it        │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

**One technique registry.** `TECHNIQUE_EXECUTION_FAMILY` maps every Analytics Technique to one
execution family (A supervised scoring, B anomaly scoring, C segmentation, D recommendation,
E forecasting, F analytical refresh, G AI text processing, H optimization and simulation). The
run pattern, readiness thresholds, acceptance rules and pinned packages come from the family,
and the quality gates and the elite verification derive their technique sets from the same registry
(supervised = family A, model-training families = A-D, text = family G plus topic modeling and NLP
classification, temporal = Forecasting, Trend, Cohort and Survival Analysis). A family label that
is not a registry technique fails at import.

**Notebook cells.** Inspire writes four cells: a markdown cell with the title, a short use-case card (what it does,
the decision and the KPI when the elite assessment found them, the tables read and the business output table, with the
Best of Best star when the use case has one), a one-line disclaimer and
"Copy the cell below into Genie Code without the surrounding quotes (the `r"""` and `"""` lines), and let Genie Code implement it.";
the Genie Code instruction as a raw-string code cell (unverified names listed first,
the KPIs, key results and KPI queries appended when the run defined them); Inspire's Number helpers, directly above Run controls: the tested `is_missing`, `fmt_num`, `fmt_count`, `fmt_rank` and `keep_reasons`, which Genie Code calls inside the steps `run_use_case()` runs and never defines itself, so every number
is written by one tested copy; and Run controls, the last cell, which ends with `inspire_main()`. Genie Code builds every other
cell from the instruction, between the instruction and the Number helpers, below its `%pip` cell, which restarts Python:
each build step is a function, and `run_use_case()` runs them in order. `inspire_main()` runs `run_use_case()` once, as the
notebook's tagged Databricks job or in the session, so running the whole notebook never runs the work twice. The notebook writes only the business output table, named from the
quoted three-level `result_table`, and, for families A-D, the model `<catalog>.<schema>.<table>_model` with the
alias `champion`.

`AGENTS.md` in the notebooks root tells Genie Code the rules for every notebook; an edited notebook
or `AGENTS.md` is never overwritten. With Execution = As job (the default), the Run controls
create or update the notebook's persistent job (`dbx_inspire_ai_<slug>_<hash8>`, paused schedule at the decision cadence)
with the `dbx_inspire_ai_*` tags and run the notebook as that job, so the Inspire dashboard registers the run.
The job run returns the outcome `run_use_case()` returns (the rows written, or why the run stopped), followed by
everything `run_use_case()` printed, because a cell that calls `dbutils.notebook.exit` loses its printed output in a
job run; the launching run prints the outcome and exits with it, the results table, the run link and that log.

### Phase 6: Summary and Artifacts

```
┌─────────────────────────────────────────────────────────────────────────┐
│             PHASE 6: SUMMARY & ARTIFACTS                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   All Scored Use Cases + Genie Code Instructions                       │
│           │                                                            │
│           ├──────────┬──────────┬──────────┬──────────┐                │
│           ▼          ▼          ▼          ▼          ▼                │
│   ┌────────────┐┌─────────┐┌────────┐┌────────┐┌─────────┐           │
│   │ Notebooks  ││  PDF    ││ PPTX   ││ Excel  ││Executive│           │
│   │            ││ Catalog ││ Slides ││Catalog ││ Summary │           │
│   │ One per    ││         ││        ││        ││         │           │
│   │ domain     ││ All use ││Exec-   ││All UCs ││AI-gen   │           │
│   │ with Genie ││ cases,  ││ready   ││scores, ││narrative│           │
│   │ Code       ││ scores, ││summary ││meta    ││         │           │
│   │ instruct.  ││ domains ││slides  ││data    ││         │           │
│   └────────────┘└─────────┘└────────┘└────────┘└─────────┘           │
│                                                                        │
│   All artifacts saved to Generation Path                               │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Phase 7: Translation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                PHASE 7: TRANSLATION                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   English Artifacts                                                    │
│           │                                                            │
│           ├──────────────┬──────────────┬──────────────┐               │
│           ▼              ▼              ▼              ▼               │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │
│   │  French     │ │  German     │ │  Japanese   │ │  Arabic     │    │
│   │             │ │             │ │             │ │             │    │
│   │  Keywords   │ │  Keywords   │ │  Keywords   │ │  Keywords   │    │
│   │  (temp 0.2) │ │  (temp 0.2) │ │  (temp 0.2) │ │  (temp 0.2) │    │
│   │             │ │             │ │             │ │             │    │
│   │  Use Cases  │ │  Use Cases  │ │  Use Cases  │ │  Use Cases  │    │
│   │  (temp 0.3) │ │  (temp 0.3) │ │  (temp 0.3) │ │  (temp 0.3) │    │
│   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘    │
│                                                                        │
│   23 Languages: English, French, German, Spanish, Hindi, Chinese,      │
│   Japanese, Arabic, Portuguese, Russian, Swedish, Danish, Norwegian,   │
│   Finnish, Italian, Polish, Romanian, Ukrainian, Dutch, Korean,        │
│   Indonesian, Malay, Tamil                                             │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

**v0.7.3: multi-language filename convention.** When more than one language is requested,
Excel and Markdown artifacts now carry a `_{lang_abbr}` suffix (e.g.,
`use_cases_fr.xlsx`, `use_cases_ja.md`) so English and translated outputs don't collide in the
Generation Path. Single-language runs keep the unchanged base filename (no suffix), preserving
backward compatibility for all existing v0.7.2-era integrations that read a fixed path.

---

## Complete Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    END-TO-END INSPIRE PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────┐                                                       │
│  │ CONFIGURE   │  Business Name + UC Metadata + Inspire Database       │
│  │ (widgets)   │  + Optional: Domains, Priorities, Instructions        │
│  └──────┬──────┘                                                       │
│         │                                                              │
│         ▼                                                              │
│  ┌─────────────┐                                                       │
│  │  PHASE 1    │  Extract business context, interpret instructions,    │
│  │  Init       │  infer industry, filter technical tables              │
│  └──────┬──────┘                                                       │
│         │                                                              │
│         ▼                                                              │
│  ┌─────────────┐  Comprehensive discovery pass:                        │
│  │  PHASE 2    │  Structured + AI/ML + Statistical techniques          │
│  │  Generate   │  Quality gates enforce rigor at generation time       │
│  └──────┬──────┘                                                       │
│         │                                                              │
│         ▼                                                              │
│  ┌─────────────┐                                                       │
│  │  PHASE 3    │  Domain ──▶ Subdomain ──▶ Merge ──▶ Dedup ──▶ Split  │
│  │  Cluster    │  Business-meaningful groupings                        │
│  └──────┬──────┘                                                       │
│         │                                                              │
│         ▼                                                              │
│  ┌─────────────┐  5-layer dedup, Combined Scoring (19 gates),          │
│  │  PHASE 4    │  quality bar of the mode (Good / High / Ultra High),  │
│  │  Score      │  BoB + trim or Elite Selection, coverage picks        │
│  └──────┬──────┘                                                       │
│         │                                                              │
│         ▼                                                              │
│  ┌─────────────┐  Goal-oriented instructions for Genie Code            │
│  │  PHASE 5    │  Describes WHAT and WHY, Genie decides HOW            │
│  │  Genie Code │  Includes table refs, analytical approach, rules      │
│  └──────┬──────┘                                                       │
│         │                                                              │
│         ▼                                                              │
│  ┌─────────────┐                                                       │
│  │  PHASE 6    │  Notebooks + PDF + PPTX + Excel                       │
│  │  Artifacts  │  Executive summary generated by AI                    │
│  └──────┬──────┘                                                       │
│         │                                                              │
│         ▼                                                              │
│  ┌─────────────┐                                                       │
│  │  PHASE 7    │  Translate all artifacts into selected languages       │
│  │  Translate  │  Keywords first (accuracy), then full use cases       │
│  └──────┬──────┘                                                       │
│         │                                                              │
│         ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │                    OUTPUT                                    │       │
│  │  <generation_path>/<BusinessName>/                            │       │
│  │  ├── notebooks/                                              │       │
│  │  │   ├── AGENTS.md                 (rules for Genie Code)    │       │
│  │  │   └── <Domain>/<Subdomain>/                               │       │
│  │  │       ├── N01-U01 - <Name>.ipynb (Genie notebook)         │       │
│  │  │       └── N01-U02 - <Name>.ipynb (skeleton notebook)      │       │
│  │  └── docs/                         (catalogs: PDF, PPTX,     │       │
│  │                                     Excel, CSV, Markdown,    │       │
│  │                                     JSON, generation log)    │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## How to Run Inspire

### Quick Start

1. Import `dbx_inspire_ai_agent.ipynb` as a notebook into your Databricks workspace
2. Fill in the two required widgets:
   - **Business Name**: Your organization or project name
   - **UC Metadata**: Comma-separated Unity Catalog paths (catalogs, schemas, or tables)
3. Optionally set **Inspire Database**: A `catalog.schema` path where Inspire stores results
4. Click **Run All**
5. Find all generated artifacts in your **Generation Path** (default: `./../demos/inspire_gen/`)

### Configuration Reference

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     WIDGET CONFIGURATION MAP                            │
├──────┬────────────────────┬───────────────────────┬──────────────────────┤
│  #   │ Widget             │ Required?             │ Default              │
├──────┼────────────────────┼───────────────────────┼──────────────────────┤
│  01  │ Business Name      │ YES                   │ (empty)              │
│  02  │ UC Metadata        │ YES                   │ (empty)              │
│  03  │ Inspire Database   │ no                    │ (empty, optional)    │
│  04  │ Discovery Type     │ no                    │ Standard Discovery   │
│  05  │ Table Election     │ no                    │ Let Inspire Decides  │
│  06  │ Use Cases Quality  │ no                    │ Good                 │
│  07  │ Business Domains   │ no                    │ (auto-detected)      │
│  08  │ Business Priorities│ no                    │ Increase Revenue     │
│  09  │ Generation Instruct│ no                    │ (empty)              │
│  10  │ Generation Options │ no                    │ Genie Code Instruct. │
│  11  │ Strategic Context  │ no                    │ (empty)              │
│  12  │ Generation Path    │ no                    │ ./../demos/inspire_gen/│
│  13  │ Documents Langs    │ no                    │ English              │
│  14  │ Inspire Session ID │ no                    │ (auto-generated)     │
│  15  │ Genie Code For     │ no                    │ 5                    │
│  16  │ Best of Best Count │ no                    │ (empty) = 20         │
└──────┴────────────────────┴───────────────────────┴──────────────────────┘
```

### Generation Options

| Option                       | What It Does                                           |
|:-----------------------------|:-------------------------------------------------------|
| `Genie Code Instructions`   | Generate per-use-case Genie Code instruction notebooks  |
| `PDF Catalog`                | Professional PDF documentation per language             |
| `Presentation`               | Executive-ready PowerPoint slides per language          |

---

# Part 2: Technical Architecture -- How the Notebook Works

This part documents every class, prompt, configuration constant, and subsystem inside the
`dbx_inspire_ai_agent` notebook.

---

## All 26 Classes

The notebook defines 26 classes spanning error handling, concurrency, parsing, metadata analysis,
LLM orchestration, artifact generation, storage, and pipeline control.

### Error and Logging Classes

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 1 | `DuplicateMessageFilter` | 887 | `logging.Filter` subclass that deduplicates log messages within a configurable time window (default 1.5 seconds). Prevents repeated log spam during parallel execution. | `__init__(window_seconds=1.5)`, `filter(record)` |
| 2 | `InputTooLongError` | 6593 | `RuntimeError` subclass raised when the prompt exceeds the model's input context window. Signals the cascade to try a larger-context model or re-batch. | (inherits from RuntimeError) |
| 3 | `CascadeRebatchError` | 6601 | `RuntimeError` subclass raised when a prompt is too large for all available models. Triggers the caller to split the batch and retry with smaller chunks. | `__init__(message, target_model_name, target_model_endpoint, target_char_limit, target_output_tokens)` |
| 4 | `TruncatedResponseError` | 6623 | `RuntimeError` subclass raised when a model response is detected as incomplete (truncated). The cascade retries with higher `max_tokens` or a model with larger output capacity. | (inherits from RuntimeError) |
| 5 | `ConsoleErrorFormatter` | 6653 | `logging.Formatter` subclass that formats only ERROR-level records for clean console output. | `format(record)` |
| 6 | `FlushingStreamHandler` | 6679 | `logging.StreamHandler` subclass that calls `flush()` after every `emit()` to prevent log buffering delays. | `emit(record)` |
| 7 | `WidgetFailedToCreate` | 11677 | `Exception` subclass raised when a Lakeview dashboard widget fails validation (unsupported type, unparseable SQL, missing columns). | (inherits from Exception) |

### Retry and Concurrency Classes

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 8 | `RetryHandler` | 7651 | Generic retry wrapper with exponential backoff. Used for transient failures in SQL execution and LLM calls. | `execute_with_retry(func, max_attempts, initial_delay, backoff_factor, retryable_exceptions, logger, context)` |
| 9 | `_SafeExecutorContext` | 8047 | Context manager wrapping `ThreadPoolExecutor` with safe shutdown. Tracks submitted futures, ensures graceful cancellation on timeout or error, prevents orphaned threads. | `__init__(max_workers, thread_name_prefix, logger, name)`, `__enter__`, `__exit__`, `submit(fn, ...)`, `mark_timed_out()` |
| 10 | `ParallelExecutor` | 8109 | High-level thread-pool parallel task executor. Wraps `_SafeExecutorContext` with timeout enforcement, progress callbacks, cancellation events, and safe future result collection. | `execute_parallel(tasks, max_workers, timeout, description, on_progress, cancel_event, thread_name_prefix, name)` |

### Parsing Classes

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 11 | `CSVParser` | 8429 | Robust CSV parsing with error recovery. Handles LLM-generated CSV that may include malformed rows, extra columns, or encoding issues. | `parse_csv_string(csv_text, expected_fieldnames, logger, context, strict)`, `parse_csv_list(csv_text, logger, context)` |
| 12 | `JSONParser` | 8649 | Safe JSON loads/dumps with fallback values, logging, and context tracking. Never raises on malformed input. | `safe_loads(json_string, logger, context, fallback)`, `safe_dumps(obj, logger, context, fallback, indent, separators)` |

### Timeout and Metadata Classes

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 13 | `TimeoutHandler` | 8777 | Enforces callable timeout via thread-based execution. Used to wrap LLM calls and SQL execution that must not exceed a deadline. | `execute_with_timeout(func, timeout_seconds, logger, context, fallback)` |
| 14 | `TableSizeInfo` | 8875 | Data Transfer Object (DTO) holding metadata about a single table: column count, estimated row count, size category, and a computed memory weight used for batch optimization. | `__init__(catalog, schema, table, num_columns, estimated_row_count, size_category)`, `_calculate_memory_weight()` |
| 15 | `TableSizeAnalyzer` | 8927 | Two-pass analyzer that queries `information_schema` to gather column counts and estimated sizes for all tables, then categorizes them (small/medium/large/xlarge) for intelligent batching. | `__init__(spark, logger)`, `analyze_table_sizes_batch(table_tuples, use_info_schema_map, max_parallelism)` |
| 16 | `DynamicBatchOptimizer` | 9225 | Memory-optimized batch creation. Uses `TableSizeInfo` memory weights to pack tables into batches that fit within context windows, avoiding over-large prompts. | Batch creation and optimization methods |
| 17 | `ColumnSampler` | 9403 | Samples columns from wide tables (>250 columns) to reduce prompt size while preserving analytical value. Prioritizes columns by name patterns (IDs, dates, amounts, status fields). | Column sampling and selection methods |

### Data Loading

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 18 | `DataLoader` | 9577 | Loads Unity Catalog metadata: discovers schemas and tables, fetches column details (name, type, comment), retrieves explicit FK relationships from `information_schema`, and infers FK relationships from naming conventions. Builds the `foreign_key_graph`. | `_get_foreign_keys(catalog, schema, table)`, `infer_foreign_keys_by_naming(all_column_details)`, `merge_inferred_foreign_keys(all_column_details)`, `get_foreign_key_relations(table_tuples)` |

### Dashboard Generation

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 19 | `LakeViewDashboard` | 11685 | Fluent API for generating Databricks Lakeview dashboard JSON. Supports 16 chart types with automatic column mapping, dataset deduplication, and grid-based layout. | `page(title)`, `save_to_file(file_path)`, `validate_viz(viz_type, viz_query, viz_title)`, `add_viz(viz_type, viz_title, viz_query)`, `_add_chart(...)`, plus 16 `_build_*_spec` methods (see chart types below) |

**Supported chart types** (16 spec builders):

| Chart Type | Spec Builder | Widget Type |
|:-----------|:-------------|:------------|
| Counter | `_build_counter_spec` | `counter` |
| Table | `_build_table_spec` | `table` |
| Bar | `_build_bar_spec` | `bar` |
| Pie | `_build_pie_spec` | `pie` |
| Line | `_build_line_spec` | `line` |
| Area | `_build_area_spec` | `area` |
| Scatter | `_build_scatter_spec` | `scatter` |
| Heatmap | `_build_heatmap_spec` | `heatmap` |
| Histogram | `_build_histogram_spec` | `histogram` |
| Box Plot | `_build_box_spec` | `box` |
| Combo | `_build_combo_spec` | `combo` |
| Sankey | `_build_sankey_spec` | `sankey` |
| Pivot | `_build_pivot_spec` | `pivot` |
| Funnel | `_build_funnel_spec` | `funnel` |
| Choropleth Map | `_build_choropleth_map_spec` | `choropleth-map` |
| Symbol Map | `_build_symbol_map_spec` | `symbol-map` |

### AI Orchestration

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 20 | `AIAgentManager` | 13797 | Concurrency gate using a `BoundedSemaphore` to limit concurrent LLM calls. Tracks per-model statistics (calls, successes, timeouts, errors). Builds the full cascade for each prompt. | `__init__(max_concurrent_ai_calls, fallback_chain, logger)`, `record_call/success/timeout/error(model_name)`, `get_stats_summary()`, `build_full_cascade(prompt_name)`, `acquire()`, `release()` |
| 21 | `AIAgent` | 13909 | Core LLM orchestrator. Handles prompt formatting from templates, `ai_query` SQL execution via Spark, model cascade with automatic fallback, response parsing (CSV/JSON), LLM caching (SHA-256 keyed), truncation detection, and `CascadeRebatchError` propagation. | `__init__(spark, logger, worker_llm_config, judge_llm_config, prompt_templates, ...)`, `_call_ai_query(prompt, prompt_name, response_schema, ...)`, `run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, ...)`, `run_worker_judge(...)`, `enable_llm_cache(session_id)`, `cleanup_llm_cache()` |

### Translation

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 22 | `TranslationService` | 16295 | 23-language translation service with batch processing. Translates keywords first (for consistent terminology), then full use cases. Handles batch splitting on context overflow, CSV-based I/O with the LLM, and translation validation/fallback. | `__init__(ai_agent, logger)`, `get_translations(target_language)`, `translate_use_case_list(english_use_cases, target_language, max_parallelism, enable_parallelization)`, `_translate_batch(...)`, `_parse_translation_csv(...)` |

### Storage and Tracking

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 23 | `IntermediateStorageManager` | 20393 | Disk-based intermediate storage for pipeline checkpoints. Saves and loads domain results, phase data, and ID maps to/from JSON files on the local filesystem. Enables pipeline resumption. | `save_domain_results(domain_name, results)`, `load_domain_results(domain_name)`, `load_all_domain_results()`, `save_phase_data(phase_name, data)`, `load_phase_data(phase_name)`, `save_id_maps(...)`, `load_id_maps()` |
| 24 | `AtomicWriter` | 21209 | Session and step tracking to Delta tables. Writes pipeline progress, step events, and final results to the Inspire Database for observability, UI progress display, and pipeline resumption. Handles async flush, chunked inserts, and session finalization. | `__init__(spark, logger, inspire_database, session_id, widget_values)`, `initialize_session()`, `emit_step(stage_name, step_name, ...)`, `flush_pending(force, finalize, final_results_json)`, `finalize_pipeline(message, final_results_json, ...)` |

### Main Orchestrator

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 25 | `DatabricksInspire` | 22029 | Main orchestrator class (~20,000 lines, 90+ methods). Implements the full 7-phase pipeline: initialization, use case generation (two-pass), domain clustering (find, merge, split), scoring (value, quality, combined), deduplication, SQL generation, artifact generation (notebooks, PDF, PPTX, Excel, dashboards), executive summary, and translation. | `__init__(**kwargs)`, `run()` (main entry point), plus ~130 internal methods for each pipeline stage |

### Job Launching

| # | Class | Line | Purpose | Key Methods/Attributes |
|:--|:------|:-----|:--------|:-----------------------|
| 26 | `JobLauncher` | 42275 | Self-launching Databricks Job pattern. Creates a one-time Databricks Job that runs the notebook with the configured widget parameters, enabling headless/scheduled execution. Detects serverless vs. classic compute. | `__init__(notebook_path, widget_key_values, job_tags)`, `launch(job_name, run_name)`, `_detect_compute_type()`, `_sanitize_tag(value)` |

---

## LLM Prompts (v0.7.2, v1.2.0)

Each prompt is mapped to a `model_type` + `model_size` bucket. At runtime, the system resolves the
bucket to a concrete model endpoint via the cascade chain. The table below lists every prompt
defined in the `prompts_models` configuration. v0.7.2 adds `BEST_OF_BEST_SCORING_PROMPT` (row 15);
v1.2.0 adds `ULTRA_HIGH_ELITE_JUDGE_PROMPT` (row 16, `Ultra High` mode only) and removes
`USE_CASE_VALUE_SCORE_PROMPT` and `USE_CASE_QUALITY_SCORE_PROMPT`: combined scoring is the only scoring pass.
v1.3.0 adds `STRATEGY_ALIGNMENT_PROMPT` (row 17, after selection) and runs every grading prompt at
temperature 0. Generation, scoring, review, Best-of-Best and the elite judge receive no goals,
priorities, strategy entries, KPIs, key results or sponsors.

| # | Prompt Name | Temp | Model Type | Model Size | Stage | Purpose |
|:--|:------------|:-----|:-----------|:-----------|:------|:--------|
| 1 | `BUSINESS_CONTEXT_WORKER_PROMPT` | 0.3 | thinker | large | Business Context | Extract business context, goals, priorities and value chain; text inferred from the business name alone is labelled `[ASSUMPTION ...]` (business context, value chain, and business priorities when the user selected none), strategic initiative and revenue model come back `UNKNOWN_FROM_METADATA` (no input carries them) |
| 2 | `FILTER_BUSINESS_TABLES_PROMPT` | 0.2 | worker | large | Table Filtering | Classify tables as BUSINESS vs TECHNICAL. Precision-critical -- low temperature |
| 3 | `BASE_USE_CASE_GEN_PROMPT` | 0.25 | worker | large | Use Cases Generation | Two-pass use case generation. Pass 1 at 0.25 (exhaustive), Pass 2 at 0.5 (creative gap-fill) |
| 4 | `DOMAIN_FINDER_PROMPT` | 0.5 | worker | large | Business Domains Clustering | Cluster raw use cases into meaningful business domains |
| 5 | `SUBDOMAIN_DETECTOR_PROMPT` | 0.4 | worker | large | Business Domain Clustering | Detect subdomains within each domain (e.g., "Credit Risk" under "Risk Management") |
| 6 | `DOMAINS_MERGER_PROMPT` | 0.4 | thinker | large | Business Domains Clustering | Merge overlapping or fragmented domains to avoid redundancy |
| 7 | `SUBDOMAINS_MERGER_PROMPT` | 0.3 | thinker | large | Business Domain Clustering | Merge duplicate subdomains that appear across different domains |
| 8 | `DOMAIN_SPLITTER_PROMPT` | 0.3 | thinker | large | Business Domain Clustering | Split oversized mega-domains into smaller coherent groups |
| 9 | `COMBINED_VALUE_QUALITY_SCORE_PROMPT` | 0.0 | worker | large | Use Cases Scoring | Combined single-pass scoring for both value and quality dimensions |
| 10 | `REVIEW_USE_CASES_PROMPT` | 0.0 | worker | large | Review | 5-layer semantic deduplication. Conservative (true duplicates only, low temp) |
| 11 | `USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT` | 0.3 | worker | large | Genie Code Instructions | Write the self-contained 7-section Genie Code instruction that a user pastes into Genie Code, which builds and runs the whole notebook from it, for the Discover targets (top-N by final rank, every elite in `Ultra High`) and for flagged use cases in Generate mode; treats `[ASSUMPTION ...]` context as a hypothesis |
| 12 | `SUMMARY_GEN_PROMPT` | 0.5 | worker | large | Summary | Generate executive summary narrative |
| 13 | `KEYWORDS_TRANSLATE_PROMPT` | 0.2 | worker | tiny | Translation | Translate UI keywords and business terminology (accuracy-first) |
| 14 | `USE_CASE_TRANSLATE_PROMPT` | 0.3 | worker | tiny | Translation | Translate full use case content (names, statements, solutions, values) |
| 15 | `BEST_OF_BEST_SCORING_PROMPT` **(v0.7.2)** | 0.0 | thinker | large | BoB Ranking | Score each UC on D1..D19 with a 0-10 scale and emit a short justification (from v1.3.0 the themes come from `THEME_ASSIGNMENT_PROMPT`). Powers the Stratified Trim in Phase 4 Step 5. |
| 16 | `ULTRA_HIGH_ELITE_JUDGE_PROMPT` **(v1.2.0)** | 0.0 | thinker | large | Use Case Prioritization | `Ultra High` only. Judges each candidate against the absolute elite bar: decision, KPI, value driver tied to columns, signal/outcome/time/entity-key columns, join path, build path, red team, and 1-10 value / evidence / implementability / actionability scores. Step title "Elite Selection"; started message "Inspire has started the Ultra High elite selection". |
| 17 | `STRATEGY_ALIGNMENT_PROMPT` **(v1.3.0)** | 0.0 | worker | large | Strategy Alignment | After selection only. Aligns each final use case to at most 2 strategy entries with evidence from its own columns or KPI, lists the business priorities it serves, scores Strategic Alignment 1-5, and writes structured KPI specs, key results, measures of success and financial and non-financial benefits. Never adds, keeps or removes a use case. Step title "Aligning Use Cases to the Strategy". |
| 18 | `GENERAL_INSTRUCTION_INTERPRETER_PROMPT` | 0.0 | thinker | large | Initialization | Interpret the free-form Generation Instructions into per-prompt directives, goals, exclusions and joins |
| 19 | `GOAL_ALIGNMENT_FILTER_PROMPT` | 0.0 | worker | large | Goal Filtering | Keep only use cases that serve a goal the user stated in Generation Instructions |
| 20 | `Assign_User_Domains` | 0.0 | worker | large | Business Domains Clustering | Assign use cases to the user-specified Business Domains |
| 21 | `canonicalize_sponsor_beneficiary_roles` | 0.3 | worker | large | Review | Canonicalize sponsor and beneficiary role names |
| 22 | `PlaceholderDomainRename` | 0.3 | worker | large | Business Domains Clustering | Rename placeholder domain names to business names |
| 23 | `ENDPOINT_PROBE` | 0.0 | worker | large | Initialization | Startup probe of each serving endpoint: usability, temperature support and, from v1.3.0, strict JSON output |
| 24 | `THEME_ASSIGNMENT_PROMPT` **(v1.3.0)** | 0.0 | worker | large | Use Case Prioritization | After Best-of-Best scoring, names the idea themes of all scored use cases in one call, one theme per use case from one shared list. Left-out use cases go to a second call that sees the themes already used; an answer with too few themes is retried once without the cache; without a usable answer each use case takes its subdomain. Logs `[THEME-ASSIGN FIRED]` or `[THEME-ASSIGN FALLBACK]`. |

**Multi-entity progress prompts** (processed in batches with per-item progress tracking):
`COMBINED_VALUE_QUALITY_SCORE_PROMPT`, `REVIEW_USE_CASES_PROMPT`, `KEYWORDS_TRANSLATE_PROMPT`,
`USE_CASE_TRANSLATE_PROMPT`, `BEST_OF_BEST_SCORING_PROMPT`, `ULTRA_HIGH_ELITE_JUDGE_PROMPT`.

---

## Complete Model Configuration

| Model | Order | Type | Size | Default | Endpoint | Input Tokens | Output Tokens |
|:------|:------|:-----|:-----|:--------|:---------|:-------------|:--------------|
| claude-opus-4-6 | 1 | thinker | large | Disabled | databricks-claude-opus-4-6 | 200,000 | 128,000 |
| claude-sonnet-4-6 | 2 | worker | large | Disabled | databricks-claude-sonnet-4-6 | 200,000 | 64,000 |
| claude-opus-4-5 | 3 | thinker | large | Enabled | databricks-claude-opus-4-5 | 200,000 | 64,000 |
| claude-sonnet-4-5 | 4 | worker | large | Enabled | databricks-claude-sonnet-4-5 | 200,000 | 64,000 |
| gpt-oss-120b | 5 | worker | small | Enabled | databricks-gpt-oss-120b | 131,072 | 25,000 |
| gpt-oss-20b | 6 | worker | tiny | Enabled | databricks-gpt-oss-20b | 131,072 | 25,000 |

**Default model size by type**: `worker: large`, `thinker: large`.

**Fallback chain** (tried in order when the designated bucket has no available model):

1. thinker/large
2. worker/large
3. thinker/small
4. worker/small
5. thinker/tiny
6. worker/tiny

**Model resolution**: Each prompt specifies a `(model_type, model_size)` bucket. At runtime,
`get_model_cascade_for_prompt()` finds all enabled models matching that bucket, ordered by their
`order` field. If no model matches, the system walks the fallback chain above until it finds an
enabled model. If no model is reachable at all, a `ValueError` is raised at startup validation.

---

## Runtime Configuration Constants

All runtime constants are defined in `TECHNICAL_CONTEXT["runtime"]`:

| Constant | Value | Purpose |
|:---------|:------|:--------|
| `llm_timeout_seconds` | 300 (5 min) | Timeout for each individual LLM call via `ai_query` |
| `max_retry_attempts` | 1 | Maximum retries per model before cascading to the next |
| `default_max_parallelism` | 16 | Default max parallel workers (user-configurable) |
| `global_min_parallelism` | 4 | Absolute floor for parallelism |
| `global_max_parallelism` | 20 | Absolute ceiling for parallelism |
| `scan_parallelism` | 8 | Parallelism for initial metadata scanning |
| `metadata_parallelism` | 8 | Parallelism for metadata queries (DB connection limit) |
| `cluster_memory_gb` | 32 | Assumed cluster memory for adaptive parallelism calculations |
| `cluster_worker_count` | 2 | Assumed cluster worker count |
| `batch_processing_timeout` | 900 (15 min) | Timeout for batch processing operations |
| `batch_processing_max_attempts` | 3 | Maximum attempts for batch operations |
| `quality_scoring_batch_size` | 30 | Number of use cases per scoring batch |
| `quality_scoring_max_workers` | 10 | Max parallel workers for quality scoring |
| `pass1_temperature` | 0.25 | Generation Pass 1 temperature (exhaustive discovery) |
| `pass2_temperature` | 0.1 | Generation Pass 2 temperature (table-grounded gap filling) |
| `inspire_score_quality_weight` | 0.65 | Weight of quality score in combined Inspire Score |
| `inspire_score_priority_weight` | 0.35 | Weight of value/priority score in combined Inspire Score |
| `table_election_threshold` | 5 | Threshold for table election classification decisions |
| `table_election_transactional_tables_min` | 3 | Minimum transactional tables required for "transactional only" mode |
| `target_max_use_cases` | 90 | **(v0.7.3: now the base, not ceiling)** Base of the `Good` / `High` stratified-trim cap; the trim lands at `target_max + randint(1, target_max_jitter)`. Previously defaulted to 100 in v0.7.2 and was the exact ceiling. Not used by `Ultra High`, which has no cap. |
| `target_max_jitter` | 20 | **(v0.7.3)** Upper bound of the random add-on to `target_max_use_cases`. Effective cap = `target_max + randint(1, target_max_jitter)`, producing a non-round final count (default range 91-110). |
| `aggressive_prune_threshold` | 75 | **(v0.7.2)** In `Good` / `High`, if the count after the quality bar exceeds this, the Stratified Trim runs; below this, no trimming |
| `bob_scoring_batch_size` | 25 | **(v0.7.2)** Number of UCs per Best-of-Best LLM batch |
| `bob_theme_max_share` | 0.15 | **(v0.7.2)** Max fraction of `target_max` that any single `idea_theme` can occupy |
| `genie_regen_parallelism` | 10 | **(v0.7.3)** ThreadPoolExecutor worker count for parallel Route 1/2 Genie regeneration. Cuts 100-UC regen from ~5 hours (sequential) to ~30 minutes. Balanced against LLM endpoint rate limits; see ADR-10. |
| `ultra_high_second_look_min_value` | 8.0 | **(v1.2.0)** `Ultra High` second look: a Medium use case joins the candidate pool when its value score (Value 1-5 doubled to 0-10) reaches this |
| `ultra_high_second_look_max` | 25 | **(v1.2.0)** Most Medium use cases the second look admits, highest value first |
| `ultra_high_bob_prescreen_min` | 5.0 | **(v1.2.0)** Minimum `bob_score` (0-10) a candidate needs to reach the elite judge |
| `ultra_high_judge_batch_size` | 5 | **(v1.2.0)** Candidates per elite judge call (also used by the second opinion and the evidence repair) |
| `ultra_high_min_dimension_score` | 8 | **(v1.2.0)** Minimum 1-10 score on each of value, evidence, implementability and actionability |
| `ultra_high_near_miss_band` | 1 | **(v1.2.0)** Points below the minimum that still make a near miss, which gets one second opinion |
| `ultra_high_allowed_value_tiers` | `["Transformational", "Material"]` | **(v1.2.0)** Value tiers an elite use case may have |
| `elite_judge_preferred_endpoints` | `["databricks-claude-opus-4-8"]` | **(v1.3.0)** Endpoints the elite judge pins first, in order, when healthy (the model the elite bars were calibrated on); without one, the first healthy judge endpoint is pinned for the run |
| `ultra_high_score_weights` | `business_value` 0.40, `evidence_strength` 0.25, `implementability` 0.20, `actionability` 0.15 | **(v1.2.0)** Weights of `elite_score`; exactly these four keys, each in [0, 1], summing to 1.0 |

**v1.2.0 selection size semantics (`Good` and `High`):**

With defaults (`bob_min_threshold=20`, `aggressive_prune_threshold=75`, `target_max_use_cases=90`,
`target_max_jitter=20`), selection after the quality bar obeys this decision tree:

| Count after the quality bar | Action |
|:----------------------------|:-------|
| `count > 75` | Run Best-of-Best scoring; drop hard-vetoed UCs; run Stratified Trim to `effective_cap = 90 + randint(1, 20)` (i.e. 91-110) |
| `20 ≤ count ≤ 75` | Run Best-of-Best scoring; drop hard-vetoed UCs; no trim |
| `1 ≤ count < 20` | No BoB, no trim |
| `count = 0` (none met the bar) | Below-bar fallback: the closest candidates ship labelled "below the `<mode>` bar" with their real scores and the missed check, under a plain "0 use cases met the bar" notice; never empty |

There is no lower band: nothing is recovered from the rejection pool and nothing is topped up, in
any mode. BoB's cap is a ceiling, not a goal, and `Ultra High` has no cap at all. Each
user-specified Business Domain left empty still receives one domain coverage pick, labelled
"Domain coverage pick, below bar".

`theme_max_share=0.15` chosen because: (a) fifteen UCs of a single theme is the largest a human
reviewer can usefully compare in one sitting; (b) 1/0.15 ≈ 6.7 themes minimum, which is the
lower bound for a portfolio to feel diverse; (c) below 0.10 the trim routinely fails to allocate
the full `target_max`, because tail themes with 1-2 UCs cannot absorb the slack.

**Token-to-character ratios** (for context limit calculations):

| Language | Ratio | Usage |
|:---------|:------|:------|
| English | 4 chars/token | `TOKEN_TO_CHAR_RATIO_ENGLISH = 4` |
| Non-English | 2 chars/token | `TOKEN_TO_CHAR_RATIO_NON_ENGLISH = 2` |

**Job configuration**:

| Constant | Value | Purpose |
|:---------|:------|:--------|
| Job timeout | 14,400s (4 hours) | `timeout_seconds` in `JobLauncher` task definition |
| Workspace client retry timeout | 300s | SDK config for individual API calls |

---

## Quality Gate System -- 19 Gates (v0.7.2)

The quality gate system enforces **19 dimensions (D1-D19)** across three tiers:

- **D1-D11** -- Technical grounding (data, logic, depth)
- **D12-D14** -- Business value (would you fund it, deploy it, maintain it)
- **D15-D19** -- Sharp Principal-Business-Analyst questions (cadence, action, explainability, longevity, impact)

**v0.7.2 note: from binary veto to fine-grained score.** In earlier versions, every gate was a
pass/fail proposition: a UC either cleared a gate or was hard-vetoed. Best-of-Best scoring
(v0.7.2) introduces a second, finer-grained reading of the same 19 gates. At BoB time, each
gate is scored on a 0-10 scale. A 10 means the UC perfectly satisfies that gate; a 0 means it
utterly fails it. The binary HARD VETO is preserved as a hard-veto floor: any gate score below
3 caps the UC's composite `bob_score` at 2.0. This gives the system two complementary signals:

- **Combined Scoring (Phase 4, Step 1)**: binary gate evaluation, used to drop unsafe UCs
  before they ever reach BoB.
- **Best-of-Best (Phase 4, Step 5a)**: 0-10 per-gate scoring, used to RANK the survivors.

The ranking is necessary because at BoB time every surviving UC is "acceptable". The
differentiation is between "acceptable" and "outstanding", which a binary gate cannot express.

**Every gate is evaluated by LLM reasoning. Zero regex. Zero pattern matching. Pure LLM judgment.**

See the **The 19 Quality Gates** section in [`../readme.md`](../readme.md#the-19-quality-gates) for the complete gate specification.

### Tier 1: Technical Grounding (D1-D11)

| # | Gate | Category | Description |
|---|------|----------|-------------|
| D1 | Causal Signal Strength | Critical | Data must contain fields that directly cause or indicate the predicted outcome |
| D2 | Cause-Effect Validity | Critical | Variables must have logical, proven, industry-recognized cause-effect relationships |
| D3 | Data Granularity | Data Quality | Data must exist at the right level of detail for the analysis |
| D4 | Critical Dimensions Present | Data Quality | All critical columns required for the analysis must be present in the schema |
| D5 | Logical Possibility | Data Quality | The technical design must be logically possible with given data types and structure |
| D6 | Metric Validity | Data Quality | Claimed business metrics must actually be calculable from available fields |
| D7 | Design-Schema Match | Data Quality | Technical design must not assume columns, tables, or relationships that do not exist |
| D8 | Semantic Uniqueness | Critical (Zero Tolerance) | 5-layer duplicate detection (verb normalization, noun synonyms, entity-metric pairs, technique swap, table+intent) |
| D9 | Analytical Depth (Strip Test) | Critical | Must require genuine multi-dimensional analysis; trivial SQL is rejected |
| D10 | Activation Quality (Action Test) | Critical (Zero Tolerance) | The `Name` starts with the owner's action and names the items it picks, never a technical method |
| D11 | Domain & Technique Balance | Portfolio | Prevent one domain+technique cluster from dominating |

### Tier 2: Business Value (D12-D14), "would you actually fund this?"

| # | Gate | Persona | Question | Veto |
|---|------|---------|----------|------|
| D12 | Business Relevance & Opportunity | Business Stakeholder | Is it relevant to day-to-day operations? Does it deliver tangible value (revenue / cost / risk / opportunity)? Can you name the team or role that consumes the output? Is it a current pain or a future opportunity? | Any "no" → Hard veto |
| D13 | Sponsor Test | Sponsor / CFO | Would you fund this use case with a real budget line? Could you pitch it to the CEO without caveats? | Any "no" → Hard veto |
| D14 | Engineering Test | Production Engineer | Can it go to production on existing Databricks capabilities (`ai_query`, Delta, MLflow, Spark)? Can you support and maintain it long-term (drift, refresh, retrain) with existing team skills? Can you fix issues without bespoke infrastructure? | Any "no" → Hard veto |

### Tier 3: Principal-Business-Analyst (D15-D19), the questions a 20-year PBA asks before sign-off

| # | Gate | Question | Veto |
|---|------|----------|------|
| D15 | Decision Cadence Match | Does the data refresh cadence match the business decision cadence? Weekly decisions need at least weekly freshness. | "No" → Hard veto |
| D16 | The Monday Test | If a stakeholder reads this on Monday morning, does their Monday look different? Must name a concrete action the output triggers. | "No" → Hard veto |
| D17 | Explainability & Audit Defensibility | Can a regulator, auditor, CFO, or customer asking "how did you reach this conclusion?" get an answer in 5 minutes without proprietary magic? | "No" → Hard veto (high-stakes) |
| D18 | 18-Month Longevity | In 18 months, is this still running or abandoned? Short-term tactical patterns fail. | "No" → Hard veto |
| D19 | Attributable Impact | Can the team prove 6 months after deployment that this use case moved a measurable dollar amount? Diffuse "awareness" fails. | "No" → Hard veto |

### Quality Levels

Generation uses one gate for every quality mode: D8 (duplicates) and D9 (analytical depth) are
hard gates at generation, D10 activations are rewritten rather than skipped, and all 19 gates are
scored at Combined Scoring, where any HARD VETO caps quality_score at 2.0. The modes differ only in
selection after scoring:

| Mode | Kept After Combined Scoring | Selection |
|:-----|:----------------------------|:----------|
| **Good** (default) | Medium, High, Very High, Ultra High | BoB ranking drops hard-vetoed UCs; the stratified trim caps a very large set |
| **High** | High, Very High, Ultra High | Same as Good |
| **Ultra High** | High-or-better candidates plus a high-value second look | Elite selection against an absolute bar: value, evidence, implementability and actionability each at least 8/10 by default, value tier Transformational or Material, red team survived, metadata verification passed; no quota, no cap |

Legacy labels map to these modes: `Coverage Mode (All)`, `Balanced`, `Good Quality` and
`High Quality` run as Good; `Strict Quality` and `Very High Quality` run as High.

### D8: 5-Layer Duplicate Detection (All Levels)

1. **Layer 1 -- Verb Normalization + Suffix Strip**: Normalize verbs (Forecast/Predict/Anticipate = PREDICT; Detect/Identify/Reveal = DETECT; etc.). Strip "with [...]" suffix. If remaining core phrase matches -> DUPLICATE.
2. **Layer 2 -- Noun Synonym Detection**: Treat synonyms as identical (Revenue=Income=Sales; Cost=Expense=Spend; Churn=Attrition=Turnover; etc.). If after replacement phrases match -> DUPLICATE.
3. **Layer 3 -- Entity-Metric Pair Overlap**: Extract business entity + business metric. Same entity + same metric = DUPLICATE regardless of wording.
4. **Layer 4 -- Technique Swap on Same Problem**: Same business problem with different techniques = DUPLICATE. Keep only the most complex, highest-value version.
5. **Layer 5 -- Table Overlap + Similar Intent**: Same primary tables + similar business question = DUPLICATE.

### D9: Analytical Depth Scoring

| Score Range | Classification | Examples |
|:------------|:---------------|:---------|
| D9 <= 1.5 | TRIVIAL (auto-reject) | Date arithmetic, threshold checks, basic aggregation, single-column stats, ratio computation, sorting |
| D9 = 2.0-2.5 | WEAK (not acceptable for Very High) | Two-column correlation, simple moving averages, single-dimension grouping |
| D9 >= 3.5 | GENUINE DEPTH (minimum for acceptance) | Multi-dimensional pattern detection, cross-table correlation with derived features, time-series forecasting, ML models, simulation, network analysis |

---

## Error Handling Patterns

The notebook implements multiple layers of error handling to ensure pipeline robustness:

### Model Cascade Fallback

When an LLM call fails (timeout, error, or context overflow), the system automatically cascades
to the next model in the chain. The cascade order follows the prompt's designated bucket first,
then walks the global fallback chain: thinker/large -> worker/large -> thinker/small -> worker/small -> thinker/tiny -> worker/tiny.
A caller may start the cascade at a named model (`start_from_model`); when that model is outside the
prompt's own bucket, the cascade starts there and continues down the fallback chain from that model's
bucket. Global deduplication uses this to start on the thinker (the review prompt is a worker/large
prompt) and cascade past a slow or failing thinker instead of falling back to per-domain deduplication.

### CascadeRebatchError for Prompt Splitting

When a prompt exceeds the context window of ALL available models, `CascadeRebatchError` is raised.
The caller catches this, splits the batch into smaller chunks, and retries each chunk independently.
The error carries `target_char_limit` and `target_output_tokens` to guide the split.

### InputTooLongError for Context Overflow

Raised when a single prompt (even after splitting) is too large for the current model. The cascade
advances to a model with a larger context window. If no larger model exists, the error propagates
as a `CascadeRebatchError`.

### TruncatedResponseError for Incomplete Responses

Detected when the LLM response appears cut off (e.g., missing closing brackets, incomplete CSV
rows). The system retries with higher `max_tokens` or cascades to a model with larger output capacity.

### Thread Cancellation Propagation

Worker threads register cancellation events via `_register_thread_cancel()`. When a batch times out
or the parent detects a critical error, it sets the cancellation event, which all child threads
check via `_is_thread_cancelled()`. The `_SafeExecutorContext` handles graceful shutdown on exit.

### Safe Executor Context with Graceful Shutdown

`_SafeExecutorContext` wraps `ThreadPoolExecutor` and tracks all submitted futures. On `__exit__`
(normal or exception), it cancels pending futures and waits for running ones. The `mark_timed_out()`
method allows callers to signal timeout before exit.

### Retry with Exponential Backoff

`RetryHandler.execute_with_retry()` provides generic retry logic with configurable initial delay,
backoff factor, maximum attempts, and retryable exception types. Used for SQL execution and LLM calls.

### SQL Injection Prevention

All user-provided values passed to SQL queries use parameterized queries (`:param` syntax with
`args` dictionaries) via `execute_sql()`. Identifiers are normalized and quoted via
`normalize_identifier()` and `quote_identifier()`.

### Serverless-Safe Temp Directories

Agent-owned temp locations (the session log, the intermediate storage, the session spool, the LLM
response cache and the local log backup) go through `b17_fallback_dir` / `b17_writable_dir` /
`b17_writable_file`: when the primary `/tmp` path cannot be created or written (Databricks Serverless
restricts file creation under `/tmp`), a fresh `tempfile.mkdtemp()` directory is used and logged as
`[B17-FALLBACK]`.

### Memory Management

Explicit garbage collection via `_force_gc()` is triggered after large batch operations to prevent
memory accumulation in long-running pipelines. Called with a `reason` parameter for debug logging.

### No Fallback Scores

If scoring fails for a batch of use cases, the batch is re-sent in smaller batches with the LLM
cache bypassed. A use case still without a valid score is marked unscored and is never selected;
no fallback or midpoint score is ever written.

### Duplicate Message Filtering

`DuplicateMessageFilter` prevents log spam by suppressing identical log messages within a 1.5-second
window. Particularly useful during parallel execution where multiple threads may log the same
warnings simultaneously.

---

## Output Artifacts

| Artifact | Format | Location | Description |
|:---------|:-------|:---------|:------------|
| Use-case notebooks | `.ipynb` (Databricks notebook) | `{generation_path}/{business}/notebooks/{Domain}/{Subdomain}/{id} - {Use Case Name}.ipynb` | One notebook per use case: a skeleton (use-case details and a regeneration marker) or, when a Genie Code instruction was emitted, four cells: the title with a short use-case card and the copy line, the instruction for Genie Code (Phase 5), Inspire's Number helpers, which Genie Code calls and never defines, and Run controls, the last cell, whose `inspire_main()` runs the `run_use_case()` Genie Code builds as the notebook's tagged job; `AGENTS.md` in the notebooks root |
| PDF Catalog | `.pdf` | `{generation_path}/inspire_catalog_{lang}.pdf` | Professional PDF cataloging all use cases with executive summary, domain grouping, scoring, and disclaimers. One per language. |
| PowerPoint Presentation | `.pptx` | `{generation_path}/inspire_presentation_{lang}.pptx` | Executive-ready slides summarizing domains, priorities, and top use cases. One per language. |
| Excel Catalog | `.xlsx` | `{generation_path}/inspire_usecases.xlsx` | Spreadsheet with all use cases, scores, metadata, tables involved, and prioritization |
| Dashboard JSON | `.json` | `{generation_path}/dashboards/` | Lakeview dashboard definition files (if dashboards option enabled) |
| Executive Summary | (embedded) | Included in PDF, PPTX, and notebooks | AI-generated narrative summary of discovered use cases, domains, and business value |
| Intermediate Storage | `.json` | `{generation_path}/_intermediate/` | Pipeline checkpoint files for domain results, phase data, and ID maps (enables resumption) |
| Tracking Tables | Delta tables | `{inspire_database}.inspire_sessions`, `{inspire_database}.inspire_steps` | Session metadata, step-by-step progress events, and final results stored in Delta tables for observability |
| Use Case Tracking | Delta table | `{inspire_database}.inspire_use_cases` | All discovered use cases with full metadata, scores, and status |

---

## 22 Technique Implementation Mandates

The `TECHNIQUE_IMPLEMENTATION_GUIDANCE` dictionary defines per-technique analytical approach mandates.
Each entry specifies what ML/statistical methods MUST be used as the PRIMARY analytical engine,
what is acceptable as supplementary, and what constitutes a FAILURE (minimum bar).

| # | Technique Key | Primary Approach Mandate | Minimum Bar (FAILURE if only this) |
|:--|:-------------|:------------------------|:-----------------------------------|
| 1 | Anomaly Detection | Isolation Forest, LOF, DBSCAN, One-Class SVM, ensemble methods | Simple z-score thresholds or SQL CASE WHEN on single metric |
| 2 | Forecasting | Prophet, ARIMA/SARIMA, ai_forecast(), XGBoost/LightGBM with lag features | Simple moving averages or SQL LAG/LEAD alone |
| 3 | Classification | XGBoost/LightGBM, Random Forest, Logistic Regression, ai_classify() | SQL CASE WHEN rules or manual threshold-based classification |
| 4 | Predictive Modeling | XGBoost, LightGBM, Random Forest, Gradient Boosting with MLflow registration | SQL aggregations or rule-based scoring without trained ML model |
| 5 | Clustering | K-Means, DBSCAN, GMM, Hierarchical clustering with silhouette/elbow analysis | SQL GROUP BY or NTILE-based bucketing |
| 6 | Regression Analysis | Linear Regression (Ridge/Lasso/ElasticNet), GLM, polynomial/splines, tree-based regression | SQL CORR() function or simple ratio computation alone |
| 7 | Segmentation | K-Means on RFM features, DBSCAN, GMM, hierarchical clustering with feature engineering | SQL CASE WHEN tier assignments or NTILE-based quantile bucketing |
| 8 | Cohort Analysis | Retention matrices, Kaplan-Meier survival curves, ML-based cohort scoring, statistical comparison tests | Simple aggregation without statistical testing |
| 9 | Trend Analysis | STL decomposition, Mann-Kendall test, change-point detection, Holt-Winters smoothing | SQL LAG/LEAD or simple period-over-period percentage change |
| 10 | Correlation Analysis | Multi-dimensional correlation, partial correlation, Granger causality, PCA | Simple pairwise SQL CORR() |
| 11 | Pareto Analysis | Concentration analysis, Gini coefficient, Lorenz curve, multi-dimensional Pareto | Simple TOP N query or basic percentage calculation |
| 12 | Funnel Analysis | Stage-by-stage conversion analysis, cohort-based funnel, statistical significance testing | Simple COUNT by stage |
| 13 | Sentiment Analysis | ai_analyze_sentiment(), transformer-based classification, aspect-level extraction | Simple keyword matching or rule-based polarity |
| 14 | Document Processing | ai_parse_document(), OCR pipelines, structured extraction with validation | Simple text search or regex matching |
| 15 | Extraction | ai_extract(), NER models, structured output with schema validation | Simple regex or substring extraction |
| 16 | AI Analysis | ai_query() with expert persona, multi-step reasoning, structured JSON output | Simple prompt without context or statistical enrichment |
| 17 | Simulation | Monte Carlo simulation, scenario modeling, sensitivity analysis, what-if analysis | Simple parameter variation without statistical framework |
| 18 | Geospatial Analysis | Spatial clustering, distance-based analysis, H3 hexagonal indexing, spatial joins | Simple coordinate filtering or distance calculation |
| 19 | Survival Analysis | Kaplan-Meier estimator, Cox proportional hazards, time-to-event modeling | Simple date difference calculation |
| 20 | Recommendation | Collaborative filtering, content-based filtering, hybrid recommendation with evaluation metrics | Simple popularity-based ranking |
| 21 | Network Analysis | Graph construction, centrality measures, community detection, path analysis | Simple JOIN counting |
| 22 | Optimization | Linear/integer programming, constraint satisfaction, multi-objective optimization | Simple sorting or rule-based allocation |

Each mandate follows the pattern: the ML/statistical model produces the analytical results (scores,
predictions, clusters, etc.); `ai_query` then EXPLAINS the results, diagnoses root causes,
quantifies business impact, and generates actionable recommendations.

---

## Adaptive Parallelism

The `calculate_adaptive_parallelism()` function dynamically adjusts the number of parallel workers
based on actual data characteristics and available resources.

### Input Parameters

| Parameter | Purpose |
|:----------|:--------|
| `step_name` | Identifies the pipeline step (determines strategy) |
| `max_parallelism` | User-configured maximum (range 4-20) |
| `num_items` | Number of items to process (tables, use cases, domains) |
| `total_columns` | Total columns involved (affects prompt size) |
| `avg_prompt_chars` | Average prompt size in characters |
| `num_domains` | Number of business domains |
| `is_llm_operation` | Whether the step makes LLM calls |
| `estimated_mb_per_worker` | Estimated memory per worker (callers pass higher values for large-data steps) |

### Strategy by Step Type

**Metadata operations** (`schema_discovery`, `table_discovery`, `column_fetch`):
Fixed at `METADATA_PARALLELISM` (8) due to DB connection limits.

**File I/O operations** (`notebook_generation`, `artifact_writing`):
Scales with number of items: <=5 items uses `items+2` workers, <=15 items caps at 6, >15 items caps at 8.

**LLM operations** (all other steps):
Adaptive calculation based on workload severity:

1. **Memory ceiling**: `available_app_mb / estimated_mb_per_worker` where `available_app_mb = (cluster_memory_gb * 1024) - 17,500 MB` (Spark + OS overhead).
2. **Item-based scaling**: Reduces parallelism when processing few items (no benefit from more workers than items).
3. **Prompt-size scaling**: Reduces parallelism for large prompts (>50K chars -> 50% reduction, >100K chars -> 75% reduction) to avoid memory pressure.
4. **Domain-based scaling**: For domain-level operations, caps at `num_domains + 2`.
5. **Final clamping**: Result is clamped to `[global_min_parallelism, min(max_parallelism, global_max_parallelism, memory_ceiling)]`.

Returns a tuple of `(parallelism: int, reason: str)` for logging.

---

## Foreign Key Inference

The `DataLoader` class discovers table relationships through two complementary mechanisms.

### 1. Explicit FK Relationships

Queries `information_schema.table_constraints`, `information_schema.referential_constraints`, and
`information_schema.key_column_usage` to discover formally declared FOREIGN KEY constraints.
Results are cached in `foreign_key_graph` keyed by `(catalog, schema, table)`.

### 2. Naming-Convention-Based Inference

When explicit FK constraints do not exist (common in data lakes), `infer_foreign_keys_by_naming()`
uses common naming patterns to detect potential relationships:

**Column patterns matched** (regex):
- `^(.+)_id$` -- e.g., `customer_id` likely references `customers.id`
- `^(.+)_fk$` -- e.g., `customer_fk`
- `^(.+)_ref$` -- e.g., `order_ref`
- `^(.+)_key$` -- e.g., `product_key`
- `^fk_(.+)$` -- e.g., `fk_customer`
- `^id_(.+)$` -- e.g., `id_order`

**Table name matching**:
- Plural to singular (`orders` -> `order`)
- `-ies` to `-y` (`categories` -> `category`)
- Both forms are checked against the table inventory

**Own key match (v1.3.0)**: when no table name matches the key stem, the stem is compared with each table's own key
column, the column whose name after its short table prefix names the table or a word of it (`cd_demo_sk` in
`customer_demographics`, `ca_address_sk` in `customer_address`, `p_promo_sk` in `promotion`). It matches an exact stem
(`ss_promo_sk` -> `p_promo_sk`), a stem whose one or two extra leading letters start the target's column prefix
(`ss_cdemo_sk` -> `cd_demo_sk`, `ss_hdemo_sk` -> `hd_demo_sk`), or a stem of three or more letters that abbreviates the
key (`ss_addr_sk` -> `ca_address_sk`). The target must be unique and use the same key token and type family, and a
table's own key never links to another table (confidence 0.75). On TPC-DS this adds the 33 joins from the six fact
tables to the address, demographics and promotion tables: 59 inferred keys become 92, none changed or lost.

**Column type filtering**: Only `int`, `long`, and `string` columns are considered as FK candidates.

**Merge strategy** (`merge_inferred_foreign_keys`): Inferred relationships are added to the
`foreign_key_graph` ONLY for tables that do not already have explicit FK constraints, preventing
false positives from overriding declared relationships.

---

## Validation Evidence (v0.7.2 and v0.7.3)

### TPCDS SF1: Session `1234567890000002`

The v0.7.2 release was validated on the TPCDS SF1 Unity Catalog dataset (retail decision-support
schema, ~150 tables, ~40M rows of synthetic data). This is the same dataset that exposed the
v0.7.1 over-sized-portfolio problem, making it a direct before/after benchmark.

**End-to-end funnel:**

| Metric | Value |
|:-------|:------|
| Pre-dedup UC count (Phase 2 raw output) | 378 |
| Post-dedup + Combined Scoring | 308 |
| Post-Balanced Quality Filter (now `Good`) | 244 |
| **Post-BoB + Stratified Trim (final portfolio)** | **100** |
| Distinct idea themes | 75 |
| Largest theme | Anomaly Detection (11 UCs) |
| Avg `bob_score` | 6.7 |
| `bob_score` range | 2.0 → 8.23 |
| Tier averages | t1=7.23, t2=6.92, t3=6.23 |
| Phase L final-gate | 16/19 (L3 subdomain diversity, L12 q3 drop, L19 production readiness failed) |
| Run duration (serverless, 16 workers) | 68 min |

**Before/after comparison vs v0.7.1:**

| Metric | v0.7.1 | v0.7.2 |
|:-------|:-------|:-------|
| Final UC count | 249 (over target) | 100 (on target) |
| Largest theme share | ~30% (Forecasting) | 11% (Anomaly Detection) |
| Reviewer-declared "too many to evaluate" | Yes | No |
| Manual-review agreement on top-25 | 14/25 | 22/25 |
| Avg `bob_score` | n/a | 6.7 |

**Key observations.**

1. The trim did exactly what it was designed to do: the portfolio dropped from 244 to 100
   without sacrificing score distribution (the median surviving `bob_score` is 6.9, meaning the
   trim removed a roughly uniform slice of lower-scoring UCs rather than kneecapping any
   single theme).
2. The hard-veto floor fired on 8 UCs. All 8 had `bob_score = 2.0` and were capped not because
   of weak tier averages but because a single gate (D16 Monday Test in 6 cases; D19
   Attributable Impact in 2) scored below 3.
3. The degenerate "more themes than slots" branch did NOT fire (75 < 100) but came close.
   v0.7.3's theme merger will reduce this to ~20-25 themes and give the cap meaningful work.
4. Phase L gate regressions (L3, L12, L19 failed) are unrelated to BoB: they are
   post-generation portfolio-level sanity checks independently evaluated by the downstream
   grading agent.

### Prior Runs

Earlier calibration runs used the `airlines_ecm` and `financial_services_demo` catalogs to tune
the 0.30/0.35/0.35 weights and the 0.15 theme cap. Results summarized in
`docs/internal/bob-calibration-runs.md` (internal).

### v0.7.3 Validation Runs

v0.7.3 was validated across three catalogs of varying size to confirm the hard-veto
pre-filter, target-max jitter, and parallel Genie regen all behave correctly.

| Dataset | Tables | Final UC Count | Hard-Veto Survivors | BoB Fired? | Phase L Final-Gate | Notes |
|:--------|:-------|:---------------|:--------------------|:-----------|:-------------------|:------|
| NYC (single-table) | 1 | 30 | 0 | No (count < 75) | 18/19 | Below `aggressive_prune_threshold`; BoB correctly skipped. `bob_score` NULL across portfolio. |
| HealthVerity | 7 | 39 | 0 | No (count < 75) | 17/19 | Below threshold; BoB skipped. Clean multi-table baseline. |
| `tpcds_sf1` (session `1234567890000001`) | 24 | **105** | **0** | Yes | 17/19 | 219 post-dedup → 206 after hard-veto pre-filter → 105 after Stratified Trim with jitter. 69 distinct themes. Final count is non-round (105 vs old 100), confirming jitter is live. |

**Key observations.**

1. **Hard-veto pre-filter works.** On `tpcds_sf1`, 13 UCs were dropped in Step 0a before
   grouping; 0 hard-veto UCs made it into the final 105. Compare against v0.7.2's tpcds_sf1
   run, which shipped 8 hard-veto-capped UCs (see v0.7.2 Known Issue #1).
2. **Jitter produces non-round counts.** The tpcds_sf1 final was 105, not 100. Across multiple
   re-runs the count varied within the expected 91-110 band. This is intentional: reviewers
   had flagged "exactly 100" as a recognizable algorithmic tell.
3. **BoB correctly skipped on small portfolios.** NYC (30 UCs) and HealthVerity (39 UCs) both
   sat below `aggressive_prune_threshold=75`. The pipeline did not invoke BoB; the final
   portfolios retained NULL `bob_score` columns, which is the documented expected behavior.
4. **Parallel Genie regen cut runtime drastically.** The tpcds_sf1 105-UC run completed Route
   1/2 Genie regeneration in ~30 minutes at `genie_regen_parallelism=10`, down from an
   estimated ~5 hours at v0.7.2's sequential default.

---

## v0.7.2 Known Issues Resolved in v0.7.3

This section is candid; engineers, please read before debugging. Each issue carries a status
banner indicating whether v0.7.3 closed it.

### 1. Hard-Veto UC Can Survive the Stratified Trim (CRITICAL): RESOLVED in v0.7.3

**Status.** RESOLVED. Validated on `tpcds_sf1` session `1234567890000001`: 13 hard-veto UCs
dropped BEFORE Stratified Trim, 0 hard-veto UCs in the final portfolio.

**Approach.** Added a pre-filter at the top of `_stratified_trim_by_theme`:
`survivors = [uc for uc in scored_use_cases if uc.get("bob_hard_veto_gate") in (None, "", "None")]`.
Any theme that loses all members to this filter is legitimately eliminated (its UCs were
unshippable anyway). No change to composite-scoring math; just a surgical pre-filter so the
"1-per-theme floor" can never over-ride a hard-veto.


**Symptom.** A UC with `bob_score = 2.0` (hard-veto-capped) can land in the final portfolio.

**Root cause.** Stratified Trim enforces a floor of "at least 1 UC per theme". If a theme has
only one representative and that representative was hard-vetoed, it is the only candidate for
that theme's slot. The "at least 1 per theme" rule overrides the hard-veto signal.

**Impact.** Up to ~8 UCs per run (observed in tpcds_sf1) are kept despite being flagged unsafe.
Downstream Genie Code generation still runs on these UCs, so they appear in the final PDF and
Excel, indistinguishable at the catalog level from green-light UCs. The `bob_score` column in
the tracking table does reveal them, but most users never look at raw BoB scores.

**Fix (v0.7.3).** Pre-filter hard-veto UCs (bob_score ≤ 2.0 due to the floor) BEFORE running
Stratified Trim. Any theme that loses all members this way is legitimately eliminated; the trim
then proceeds with clean themes only. This costs nothing in portfolio size because hard-veto
UCs should not be shipped regardless.

**Workaround until v0.7.3.** After a run, manually filter the Excel catalog by
`bob_score > 2.0` (or `bob_score IS NULL` for non-BoB runs) before presenting to a customer.

### 2. Idea Themes Are Too Granular: FIXED in v1.3.0

**Symptom.** `num_themes` routinely exceeds `target_max / 4` (e.g., 75 themes for 100 UCs in
tpcds_sf1). The 15% cap barely does any work because most themes already have only 1-2 UCs.

**Root cause.** Each BoB scoring batch named its own themes without seeing the other batches, so
one idea got a new name in every batch, and free-form naming added near-synonyms on top ("CLV
Analysis" vs "Customer Lifetime Value"; "Sales Forecasting" vs "Demand Forecasting").

**Status (v1.3.0).** Fixed at the root: the scoring prompt names no theme, and one call names the
themes of the whole scored portfolio (see Idea Theme Design). The paragraphs below record the
earlier state.

**Impact.** Theme-based diversity is weaker than designed. The trim still produces a
`target_max`-sized portfolio, but the theme distribution is noisy.

**Status.** PARTIALLY MITIGATED in v0.7.3. The second-pass theme-merger did NOT ship in v0.7.3
(still tracked as a follow-up). However, target-max jitter raised the effective cap into the
91-110 band, which is now much closer to the observed theme count (~69 on tpcds_sf1), so the
per-theme 15% cap binds somewhat less often and the "theme-count dominates cap" pathology is
less disruptive in practice.

**Fix approach (v0.7.3 partial).** Raising the effective cap with jitter. A proper theme
merger remains on the v0.7.4 backlog.

**Workaround.** None currently exposed to operators. The system still works; it just does less
diversity-balancing than the pseudocode implies.

### 3. Degenerate "More Themes Than Slots" Branch Is Untested at Scale: STILL OPEN

**Symptom.** If `num_themes >= target_max`, the trim takes 1 UC per theme (the best one by
`bob_score`) and ignores the proportional/cap logic.

**Root cause.** This branch only fires when the theme-fragmentation problem (see #2) is
extreme. Not observed in any v0.7.2 validation run, so it has no real-world test data.

**Impact.** Theoretical. Could produce surprising portfolios if a future customer run pushes
the LLM into ultra-granular theming.

**Monitoring.** Log emission at trim time: watch for
`"stratified_trim: num_themes=N >= target_max=M, entering degenerate branch"`.

**Status.** Still open in v0.7.3. The `tpcds_sf1` run (69 themes at `effective_cap=105`) came
within 34 of the degenerate trigger but did not cross it. A theme-merger (planned for v0.7.4)
remains the cleanest long-term fix.

### 4. BoB Is Skipped Below `aggressive_prune_threshold`: STILL OPEN (by design)

**Symptom.** If post-dedup count is below `aggressive_prune_threshold` (default 75), the final
portfolio has NULL `bob_score` for every UC. (Superseded by `bob_min_threshold`: BoB now scores
any `Good` / `High` portfolio of at least 20 UCs; see the v1.2.0 selection size semantics.)

**Intent.** This is not a bug per se: BoB is expensive and its ranking signal is only useful
when trimming. Below the threshold there is nothing to trim. But operators may be surprised
to see a portfolio with no BoB scores at all.

**Fix (planned, not in v0.7.2).** Optionally run BoB even in the "no-op" branch for the
ranking signal alone. Tracked but de-prioritized because the ranking is only directly
actionable during trimming.

**Status.** Still open in v0.7.3. The v0.7.3 NYC (30 UCs) and HealthVerity (39 UCs) runs both
sat below the threshold and correctly skipped BoB, producing NULL `bob_score` columns. This is
intentional and documented; not a defect.

### 5. Composite Formula Is Hard-Coded: STILL OPEN

**Symptom.** 0.30/0.35/0.35 weights cannot be overridden via runtime configuration.

**Impact.** Tuning requires a code change. For operators who want to emphasize technical
grounding (tier 1) over business value, the only option is to fork.

**Fix (v0.7.3+).** Expose `bob_tier1_weight`, `bob_tier2_weight`, `bob_tier3_weight` as
`TECHNICAL_CONTEXT["runtime"]` keys with validation that they sum to 1.0. Intentionally
deferred from v0.7.2 to avoid config surface sprawl on a first release.

**Status.** Still open in v0.7.3. Weights remain hard-coded at (0.30, 0.35, 0.35) in
`_compose_bob_score`. Deferred again to avoid churn in the same release that added jitter and
parallel Genie regen.

### 6. `_parse_bob_response` Can Mask Severe LLM Failures: STILL OPEN

**Symptom.** When the LLM returns malformed JSON, the parser coerces missing gate scores to 5
and clamps out-of-range values. A completely off-the-rails response becomes a UC with all gates
= 5, bob_score = 5.0.

**Impact.** These UCs rank near the median and may survive the trim without being flagged.

**Partial mitigation.** `_parse_bob_response` raises a structured error if NO gates at all can
be recovered. So the failure mode is not silent, but partial failures (1-2 valid gates,
rest defaulted) are silent.

**Fix (v0.7.3).** Track a `bob_parse_quality` score per UC (fraction of gates actually
returned by the LLM vs. defaulted). Flag UCs below 0.8 for manual review.

**Status.** Still open in v0.7.3. `bob_parse_quality` instrumentation did NOT ship in v0.7.3.
Deferred to v0.7.4 alongside the theme-merger.

### 7. Parallelism Can Oversubscribe LLM Endpoints Under Load: MITIGATED in v0.7.3

**Symptom.** At `quality_scoring_max_workers=10` with large catalogs, the combined scoring
phase occasionally hits endpoint rate limits and cascades down the fallback chain.

**Impact.** Slower runs, but no correctness impact (cascades work).

**Mitigation.** Reduce `quality_scoring_max_workers` to 6-8 for rate-limit-sensitive endpoints.

**Status.** Mitigated (not eliminated) in v0.7.3. The new `genie_regen_parallelism=10` default
for Route 1/2 Genie regeneration was chosen explicitly to balance throughput against LLM rate
limits: see ADR-10 below. The underlying concern (combined-scoring can oversubscribe) is not
directly resolved, but the parallel Genie regen path uses the same rate-aware default, so
operators now have two clearly-named knobs (`quality_scoring_max_workers` and
`genie_regen_parallelism`) to tune independently.

---

## Architecture Decision Records (ADRs)

This section documents key v0.7.2 design decisions so future contributors understand not just
WHAT the code does but WHY it does it that way.

### ADR-001: Tier Weights 0.30 / 0.35 / 0.35

**Context.** BoB composite combines three tier means (D1..D11, D12..D14, D15..D19).

**Options considered.**

| Weighting | Rationale | Rejected Because |
|:----------|:----------|:-----------------|
| (1/3, 1/3, 1/3) | Uniform | Does not reflect that surviving UCs are already technically sound |
| Gate-proportional (11/19, 3/19, 5/19) | Each gate weighted equally | Biases toward technical checks; over-penalizes UCs with tier-2 or tier-3 weakness |
| (0.20, 0.40, 0.40) | Strongly prioritize business signals | Too aggressive; lets technically shaky UCs through if tier-2/3 are strong |
| **(0.30, 0.35, 0.35)** **CHOSEN** | Balanced toward business but respects technical baseline | Manual grading (n=25) showed 22/25 alignment with human reviewers |

**Decision.** Adopted (0.30, 0.35, 0.35). Weights are hard-coded in `_compose_bob_score`; ADR
status: **Accepted**. See Known Issue #5 for planned configurability.

### ADR-002: Hard-Veto Floor at `bob_score = 2.0`

**Context.** Even with fine-grained 0-10 gate scoring, some gate failures are individually
fatal (D9 Strip Test, D10 Action Test, D16 Monday Test, D19 Attributable Impact).

**Options considered.**

1. No floor: trust the composite. Rejected: a single D16=0 can be averaged away by nine high
   gates, producing a tier3 mean of 7 and a deceptively high composite.
2. Full rejection (drop UC entirely) on any gate < 3. Rejected: same logic as the old binary
   veto, loses the ranking signal.
3. **Cap at 2.0 (chosen).** Keeps the UC in the portfolio for visibility but ranks it below
   any UC without a hard-veto. Stratified Trim naturally excludes them except in degenerate
   single-theme cases (Known Issue #1).

**Decision.** **Accepted**. Documented in Known Issue #1 as needing refinement in v0.7.3
(pre-filter before trim).

### ADR-003: `theme_max_share = 0.15`

**Context.** The trim must cap any single theme to prevent one theme from dominating the
portfolio.

**Options considered.**

| Cap | Effect | Rejected Because |
|:----|:-------|:-----------------|
| 0.10 | Very strict diversity | Routinely fails to fill `target_max`; tail themes with 1-2 UCs can't absorb slack |
| 0.20 | Lenient | Lets a dominant theme occupy 20 of 100 slots, which reviewers flag as lopsided |
| **0.15 (chosen)** | Balanced | Reviewers consistently accept 15%; trim reliably fills 100 |

**Decision.** **Accepted**. Exposed as `bob_theme_max_share` in runtime config, so it is tunable.

### ADR-004: BoB Batch Size of 25

**Context.** BoB scoring runs batches of UCs through a single LLM call.

**Options considered.**

| Batch Size | Pros | Cons |
|:-----------|:-----|:-----|
| 10 | Simpler prompts, faster per-batch | More LLM calls; weaker cross-calibration (LLM scores each UC in isolation) |
| 50 | Stronger cross-calibration | Prompts exceed context on large-column catalogs; higher truncation risk |
| **25 (chosen)** | Fits 200K context with full gate definitions; enough anchors for decile spread | None significant |

**Decision.** **Accepted**. Exposed as `bob_scoring_batch_size`. Recommend keeping at 25
unless you have a validated reason to change.

### ADR-005: Stratified Trim vs Flat Top-N

**Context.** Simplest option would be: rank all UCs by `bob_score` DESC, take top `target_max`.

**Why it was rejected.**

1. **Single-theme dominance.** In validation runs, the top-50 `bob_score` UCs were 38
   "Anomaly Detection" UCs (anomaly detection prompts often score high because the gates
   reward clear cause-effect). A flat trim produced a portfolio reviewers dismissed as
   "one-trick".
2. **Domain coverage collapse.** Top-N trim correlates with BoB score, which correlates with
   technique maturity. Mature techniques cluster in specific domains (fraud, forecasting),
   causing whole business areas (compliance, operations analytics) to vanish from the output.
3. **Marginal value loss is small.** Swapping a 7.8 for a 7.2 in exchange for theme diversity
   is a net reviewer-positive trade.

**Decision.** Stratified Trim. **Accepted**. Flat top-N remains available as a fallback if
`bob_theme_max_share = 1.0` (cap = target_max, one theme can hold everything): not documented
as a supported config.

### ADR-006: Free-Form Theme Labels

**Context.** Themes could be an enum (fixed list of 20-30 analytical archetypes) or free-form
strings.

**Decision.** **Accepted as free-form** for v0.7.2 to allow discovery of unanticipated
archetypes. Known Issue #2 and the v0.7.3 theme-merger address the downside. A future ADR may
revisit if the merger is insufficient.

### ADR-007: Schema Migration via `ALTER TABLE ADD COLUMN IF NOT EXISTS`

**Context.** v0.7.2 adds 5 new columns to `__inspire_usecases`. Downgrade path matters because
customers may run multiple versions in parallel.

**Options considered.**

1. Recreate table with new schema. Rejected: destroys history.
2. Side table for BoB columns joined at read time. Rejected: complicates every downstream
   query.
3. **`ADD COLUMN IF NOT EXISTS`.** Accepted: idempotent, preserves history, downgrade works
   because v0.7.1 tolerates extra columns.

**Decision.** **Accepted**. Migration is performed by `AtomicWriter` on session init.

### ADR-008: BoB Does Not Replace the Inspire Score

**Context.** BoB produces a 0-10 ranking score. The existing Inspire Score is
`0.65 * quality + 0.35 * value` on a 1-5 scale.

**Options considered.**

1. Replace Inspire Score with `bob_score`. Rejected: breaks every artifact (PDF, PPTX, Excel)
   that displays Inspire Score, and breaks customer dashboards that filter on it.
2. **Keep both, use BoB only for trim.** Accepted: BoB is a backend ranking signal;
   Inspire Score remains the user-facing quality label. `bob_score` IS persisted and visible
   in raw tracking tables, but not featured in customer artifacts.

**Decision.** **Accepted**. `bob_score` appears in `__inspire_usecases` and Excel but NOT in
the PDF or PPTX. If future customer demand exists for exposing BoB in artifacts, revisit.

### ADR-9: Jitter the `target_max` Final UC Count (v0.7.3)

**Context.** v0.7.2 produced exactly `target_max_use_cases=100` UCs every run. Reviewers
consistently flagged the exact-100 count as an algorithmic tell: portfolios looked
synthesized rather than curated. Final UC counts should land on values that a human
portfolio-builder would reasonably pick.

**Options considered.**

| Option | Rationale | Rejected Because |
|:-------|:----------|:-----------------|
| Keep exact `target_max` (status quo) | Deterministic, easiest to test | Exact-100 is a visible tell; reviewers perceive auto-generation |
| Vary `target_max` by dataset size | More "authentic" | Couples portfolio size to dataset shape in a way operators can't predict |
| Randomize across a small band | Removes the round-number tell without losing predictability | None significant |
| **Additive jitter with explicit knob (chosen)** | `effective_cap = target_max + randint(1, target_max_jitter)`. Transparent, configurable, reproducible via RNG seed if needed | None |

**Decision.** **Accepted**. Default `target_max_use_cases=90` and `target_max_jitter=20`
produce a final count in [91, 110]. Operators who need a deterministic count can set
`target_max_jitter=0` (forces `randint(1, 0)` which is conventionally 1; effective cap becomes
`target_max + 1`). The base was lowered from 100 → 90 so the new upper band (110) is close to
the previous ceiling of 100, preserving artifact-size continuity.

**Rationale for the jitter floor `randint(1, jitter)` (not `randint(0, jitter)`).** Starting
at 1 guarantees `effective_cap > target_max`, which means jitter always relaxes the cap (never
tightens it). This preserves the invariant that no run ships fewer UCs than the v0.7.2
equivalent would have shipped given the same `target_max`.

### ADR-10: Parallel Route 1/2 Genie Regen Default `genie_regen_parallelism = 10` (v0.7.3)

**Context.** Route 1/2 Genie regeneration re-runs Genie Code instructions for each UC after
BoB trimming. In v0.7.2 this was sequential: 100 UCs × ~3 minutes each ≈ 5 hours. For large
catalogs with 100+ UCs the regen wall-clock dominated total pipeline runtime.

**Options considered.**

| Parallelism | Wall Clock (100 UCs) | LLM Endpoint Pressure | Verdict |
|:-----------:|:---------------------|:----------------------|:--------|
| 1 (sequential, v0.7.2) | ~5 hours | None | Unacceptable for 100-UC runs |
| 5 | ~60 minutes | Low | Safe but slow |
| **10 (chosen)** | ~30 minutes | Moderate; observed zero rate-limit cascades in v0.7.3 validation | Best balance |
| 20 | ~15-20 minutes | High; triggers fallback cascades on rate-limited endpoints | Rejected; correctness-preserved but slower due to retries |
| 40 | ~10 minutes theoretical | Very high; frequent 429s | Rejected; unpredictable wall-clock |

**Decision.** **Accepted**. `genie_regen_parallelism=10` ships as default. Implemented via
`concurrent.futures.ThreadPoolExecutor(max_workers=genie_regen_parallelism)` around the Route
1/2 regen loop. Shares the same "cascade on rate-limit" fault tolerance as combined scoring,
so correctness is preserved at higher parallelism; the 10-default is about avoiding the tax of
cascade-induced retries.

**Operator guidance.** For rate-limited endpoints (e.g., small capacity in a customer
workspace), reduce to 5-6. For dedicated large endpoints, raising to 16-20 is safe. Monitor
the regen log for "cascaded to fallback model" messages: if you see more than ~5% of UCs
cascading, you're oversubscribed.

**Interaction with `quality_scoring_max_workers`.** The two knobs control different phases
(BoB scoring vs. Genie regen) and run at different times, so they can be tuned independently.
Setting both to 10 on the same endpoint is safe because they don't contend: BoB completes
before Genie regen begins.

### ADR-11: Strategy-Blind Discovery, Alignment Only After Selection (v1.3.0)

**Context.** Until v1.2.1, goals and business priorities went into generation and scoring. A
goal could pull the model toward use cases the data did not support, and the same goal raised
the scores that decided which use cases survived.

**Options considered.**

1. Keep goals in the prompts with stronger grounding rules. Rejected: the model still optimizes
   for the goal text, and grounding checks only catch the worst cases.
2. Filter by goal after scoring. Rejected: it drops valuable use cases the strategy did not
   anticipate, and it does not stop the goal from shaping generation.
3. **Blind discovery and grading, then align after selection (chosen).** Generation, the quality
   checks, the 19 gates, Best-of-Best and the elite judge never see goals, priorities, strategy
   entries, KPIs, key results or sponsors. `STRATEGY_ALIGNMENT_PROMPT` runs on the final use
   cases only, needs column or KPI evidence for every alignment, and recomputes Value with
   Strategic Alignment at 25%.

**Decision.** **Accepted**. The alignment pass may only annotate: the agent raises an error if
the set of use cases changes. Value and Priority are computed by `compute_value_priority`, not
by the model.

### ADR-12: Discovery Type With One Data Reader (v1.3.0)

**Context.** Metadata alone cannot tell an empty table from a busy one, or a broken join from a
working one, but some customers must be able to guarantee that no data is read.

**Options considered.**

1. Always read samples. Rejected: it breaks the metadata-only guarantee customers rely on.
2. Never read data. Rejected: empty tables, single-class labels and non-matching joins produce
   use cases that cannot be built.
3. **A per-run choice with one reader (chosen).** `Standard` never reads a row; `Deep`, the
   default, computes aggregates only, in `DeepEvidence`, under time and count budgets. Personal
   columns get counts only, and no data row is sent to the AI.

**Decision.** **Accepted**. A static guard keeps every customer-data read inside `DeepEvidence`,
and a runtime guard stops it in Standard. KPI queries are built only by `DeepEvidence.kpi_sql`
from validated specs; the model never writes SQL that Inspire runs. v1.4.0 keeps the one reader
and moves the guarantee to the prompt: Standard Discovery reads aggregates to decide each use case,
and `InspireAIGate` withholds every measured number from the AI.

### ADR-13: AI Call Log In Semunity's Design (v1.3.0)

**Context.** Diagnosing a model failure needed the full request, response and attempt history,
and Inspire will run inside Semunity, which already has an AI call log.

**Decision.** **Accepted**. `_ailogs` reuses Semunity's table name, 20 columns, statuses and row
semantics with `agent = 'inspire'`: one row per attempt, a terminal `exhausted` row, no row for a
cache hit. Rows go through the existing `AtomicWriter` spool, never through a second writer, and
a log write never fails a call.

---

---

# Part 3: How to Use Inspire Generated Use Cases

## The User Journey

After Inspire finishes its 7-phase pipeline, you have a set of AI-generated use cases,
each with Genie Code instructions, scoring, and domain classification. Here is the step-by-step
journey to turn these artifacts into actionable business value.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    USER JOURNEY OVERVIEW                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐       │
│  │  STEP 1   │──▶│  STEP 2   │──▶│  STEP 3   │──▶│  STEP 4   │       │
│  │  Inspect  │   │  Review   │   │  Execute   │   │  Filter   │       │
│  │  Use Cases│   │  Genie    │   │  with      │   │  and Act  │       │
│  │           │   │  Code     │   │  Genie     │   │  on       │       │
│  │           │   │  Instruct.│   │  Code      │   │  Results  │       │
│  └───────────┘   └───────────┘   └───────────┘   └───────────┘       │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Step 1: Inspect Generated Use Cases

Open the generated notebooks and the Excel catalog. Each use case has:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  USE CASE CARD (v0.7.2)                                                │
├─────────────────────────────────────────────────────────────────────────┤
│  ID:           N01-AI03                                                │
│  Use Case:     Transaction Fraud Detection                             │
│  Description:  Detect Anomalous Transaction Patterns with              │
│                Fraud Investigation Queue                               │
│  Domain:       Risk Management                                         │
│  Subdomain:    Fraud Detection                                         │
│  Type:         Risk                                                    │
│  Technique:    Anomaly Detection                                       │
│  Idea Theme:   Anomaly Detection         (NEW in v0.7.2)               │
│  Value Score:  4.2 / 5.0                                               │
│  Quality Score:4.5 / 5.0                                               │
│  BoB Score:    7.9 / 10.0                (NEW in v0.7.2)               │
│  BoB Tier 1:   8.2 (tech grounding)      (NEW in v0.7.2)               │
│  BoB Tier 2:   8.0 (business value)      (NEW in v0.7.2)               │
│  BoB Tier 3:   7.5 (PBA signoff)         (NEW in v0.7.2)               │
│  Statement:    Undetected fraudulent transactions result in direct      │
│                revenue loss and regulatory exposure...                  │
│  Beneficiary:  Fraud Analyst                                           │
│  Sponsor:      Chief Risk Officer                                      │
│  Tables:       retail.transactions.orders,                             │
│                retail.transactions.payments,                            │
│                retail.master.customers                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

**What to look for:**
- Use cases aligned to your actual business priorities
- High value scores (4.0+) indicate strong ROI potential
- High quality scores (4.0+) indicate the data supports the analysis
- The domain/subdomain grouping helps you find related use cases fast
- `BoB Score` above 6.0 means this UC scored well in the cross-UC ranking; below 3.0 means it hit the hard-veto floor and should be spot-checked before shipping.
- `Idea Theme` identifies the ANALYTICAL archetype. Use it to group UCs by analysis style (e.g., all Anomaly Detection ideas together).
- If `BoB Score`, `Idea Theme`, and the tier scores are all NULL, the run did not trigger BoB (portfolio was small enough to skip the trim; see Phase 4 Step 5).

---

### Step 2: Review the Genie Code Instructions

Each Genie notebook carries a Genie Code instruction in 8 sections: goal, data, parameters (the widgets
the notebook creates first, with their defaults), readiness check, build steps, method and acceptance,
business output and definition of done, followed by Platform Rules that Inspire writes itself. Inspire has already
checked every cited table and column against live Unity Catalog metadata, listed their joins (declared
or inferred from column names, also when the instruction is regenerated) and added the date table of
any table that holds its time only as a key; an instruction that kept
unresolved references or unsupported figures lists them at its top and asks Genie Code to check them.

**What to verify:**
- The decision, owner and cadence in the instruction's Goal section match how the business works
- The join path, entity key, time column and outcome rule are the right ones
- The readiness and acceptance thresholds suit the decision (to change one, tell Genie Code; it never
  changes a threshold on its own)

---

### Step 3: Finish the Notebook with Genie Code

Copy the instruction cell into Genie Code and let it run. Genie Code adds the cells below the
instruction, runs the notebook on serverless compute and fixes its own code until the notebook runs
from top to bottom; its last cell prints the readiness values, the metrics against the baseline, the
rows written per priority tier, each step's elapsed seconds and a short summary for the decision
owner. A readiness stop means
the data cannot support the use case today; it is a valid outcome and the notebook writes nothing.
When no model beats its baseline ("No approved model yet"), the notebook registers no model and
writes the baseline's rows, each with the baseline model's own score, and a forecast on stale data
is written with every row flagged, so no
row is 'Act now'. Without Genie Code an engineer can build the same notebook from the instruction
by hand.

---

### Step 4: Filter and Act on Results

After Genie Code executes, your results will contain AI-generated columns. Use these to narrow
down to the rows that matter most and take action.

---

## How to Tune Inspire (v0.7.3)

Inspire is opinionated by default but exposes several knobs for operators who want to steer
the pipeline. The following table collates the most impactful levers, grouped by goal.

### Tuning by Goal

| Goal | Knob | Default | Direction | Impact |
|:-----|:-----|:--------|:----------|:-------|
| Fewer, stronger use cases | `06. Use Cases Quality` widget | `Good` | `High`, or `Ultra High` for elite use cases only | Same candidates, stricter selection; `Ultra High` can return a short list or none |
| Broadest portfolio | `06. Use Cases Quality` widget | `Good` | Keep `Good` | `Good` is the broadest mode; the keep-all Coverage mode is retired |
| Smaller, tighter final portfolio | `target_max_use_cases` | 90 | Lower (e.g., 50) | BoB trim lands at lower count |
| Preserve more candidates | `target_max_use_cases` | 90 | Raise (e.g., 150) | Larger artifacts, less diversity pressure |
| Deterministic final UC count | `target_max_jitter` | 20 | Set to 0 | Disables jitter; effective cap becomes `target_max + 1` and is constant across runs |
| Wider jitter band (more non-round final counts) | `target_max_jitter` | 20 | Raise (e.g., 30) | Effective cap floats in `[target_max+1, target_max+30]` |
| Trigger BoB earlier | `aggressive_prune_threshold` | 75 | Lower (e.g., 50) | BoB fires even on mid-sized portfolios |
| Skip BoB for mid-sized runs | `aggressive_prune_threshold` | 75 | Raise | Only very large portfolios get trimmed |
| More theme diversity in final portfolio | `bob_theme_max_share` | 0.15 | Lower (e.g., 0.10) | No theme exceeds 10% of portfolio. Watch for under-fill. |
| Let a dominant theme stay dominant | `bob_theme_max_share` | 0.15 | Raise (e.g., 0.25) | A strong theme can occupy 25% |
| Faster BoB scoring | `bob_scoring_batch_size` | 25 | Raise (up to 40) | Fewer LLM calls, but risk of truncation |
| Safer BoB scoring | `bob_scoring_batch_size` | 25 | Lower (e.g., 15) | More LLM calls, tighter prompts |
| Faster Genie regen on large endpoints | `genie_regen_parallelism` | 10 | Raise (e.g., 16-20) | Cuts regen wall-clock below 30 min; watch for rate-limit cascades |
| Safer Genie regen on rate-limited endpoints | `genie_regen_parallelism` | 10 | Lower (e.g., 5-6) | Fewer concurrent calls, longer wall-clock |
| More parallelism for BoB scoring | `quality_scoring_max_workers` | 10 | Raise (up to 20) | Watch for rate limits |
| Generate more candidates | `pass2_temperature` | 0.1 | Raise (up to 0.7) | More creative but may drop quality |
| Tighter generation | `pass1_temperature` | 0.25 | Lower | Nearly deterministic |
| Shift ranking toward quality | `inspire_score_quality_weight` | 0.65 | Raise | Quality dominates Inspire Score |
| Shift ranking toward value | `inspire_score_priority_weight` | 0.35 | Raise | Value dominates (and vice-versa) |

### Tuning Rules of Thumb

1. **Start with defaults.** Every default was tuned on multiple validation datasets. Only
   change them if you have clear reviewer feedback.
2. **Change one knob at a time.** The pipeline has many interactions; changing two knobs
   simultaneously makes attribution impossible.
3. **Always run Strip Test-level regressions.** After any change, run on `tpcds_sf1` and spot-
   check 10 random UCs against the v0.7.3 baseline (session `1234567890000001`).
4. **`target_max_use_cases` is the most impactful knob.** Most operator questions ("my
   artifacts are too big / too small") resolve by adjusting `target_max_use_cases`. Remember
   the effective cap is `target_max_use_cases + randint(1, target_max_jitter)`, so the final
   count will float within that band.
5. **Do not change `theme_max_share` without also reviewing theme-granularity issues.** See
   Known Issue #2. The cap is only meaningful when themes are reasonably coarse.
6. **Set `target_max_jitter=0` only when you need a deterministic UC count** (e.g., for
   regression tests or contractually-fixed-size deliverables). Production runs should keep the
   default jitter so the portfolio doesn't look algorithmically capped.
7. **Parallelism knobs are independent.** `quality_scoring_max_workers` (BoB scoring) and
   `genie_regen_parallelism` (Route 1/2 Genie regen) run in different phases and don't
   contend. Tune each against its own rate-limit headroom.

### Tuning via Generation Instructions

Beyond runtime knobs, the `Generation Instructions` widget accepts free-form English that
becomes first-class input to Phase 1's Instruction Interpreter. This is the preferred
mechanism for customer-specific goals:

- `"Focus on revenue growth use cases only"`: biases Phase 2 generation and activates the
  goal-alignment filter after generation; goal-aligned use cases still face the quality bar of
  the selected mode.
- `"Prioritize compliance and regulatory reporting"`: biases domain clustering and scoring.
- `"Avoid ML-heavy use cases, prefer ai_query-based analytics"`: biases technique selection.
- `"Maximum 30 use cases"`: interpreted as a `target_max` override suggestion.

Generation Instructions are the RIGHT place to encode business context; runtime knobs are for
performance and portfolio-shape tuning.

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│  Inspire is an AI Agent that:                                          │
│                                                                        │
│  1. Reads ONLY your metadata (never your data)                         │
│  2. Uses multi-model AI cascade (6 models, automatic fallback)         │
│  3. Runs a 7-phase pipeline: Init ▶ Generate ▶ Cluster ▶ Score ▶      │
│     Genie Code ▶ Artifacts ▶ Translate                                 │
│  4. Produces goal-oriented Genie Code instructions                     │
│  5. Delivers notebooks, PDFs, slides, and Excel                        │
│                                                                        │
│  Phase 4 (v0.7.2, v0.7.3 refinements, v1.2.0 modes) selects with:      │
│   - LLM Semantic Dedup                                                 │
│   - Combined Scoring (19-gate hard-veto evaluation)                    │
│   - Quality bar of the mode: Good, High or Ultra High                  │
│   - Good / High: Best-of-Best ranking + Stratified Trim by idea_theme  │
│   - Ultra High: Elite Selection against an absolute bar, no cap        │
│   - Domain coverage picks; no recovery, no top-up, no padding          │
│   - Target-max jitter: effective cap = 90 + randint(1,20) (v0.7.3)     │
│                                                                        │
│  Your job after Inspire runs:                                          │
│                                                                        │
│  1. Inspect  ──▶ find the use cases that matter to YOU                 │
│  2. Review   ──▶ verify the Genie Code instructions are sound          │
│  3. Execute  ──▶ run with Databricks Genie Code                        │
│  4. Act      ──▶ filter results and take action                        │
│                                                                        │
│  v0.7.3 highlights (additive over v0.7.2):                             │
│   - Hard-veto pre-filter fixes the theme-floor slip-through            │
│   - target_max_use_cases=90 + target_max_jitter=20 (final range 91-110)│
│   - genie_regen_parallelism=10 (Route 1/2 regen: 5h → 30m)             │
│   - Multi-language Excel/Markdown filenames carry _{lang_abbr}         │
│   - Validated on NYC (30 UCs), HealthVerity (39), tpcds_sf1 (105)      │
│                                                                        │
│  v0.7.2 baseline:                                                      │
│   - 26 classes                                                         │
│   - 18 LLM prompts (BEST_OF_BEST_SCORING_PROMPT added)                 │
│   - 22 technique mandates                                              │
│   - 19 quality gates (D1..D19)                                         │
│   - 6 models, 16 chart types, 23 languages                             │
│   - 5 new persisted columns: idea_theme, bob_score,                    │
│     bob_tier1/2/3_score                                                │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```
