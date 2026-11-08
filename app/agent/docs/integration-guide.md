# Inspire AI Integration Guide

**Version:** v1.5.0
**Audience:** Application Developers And Services Consuming Inspire AI Outputs
**Last Updated:** 2026-11-03

This is the single source of truth for integrating Inspire progress and outputs into your app UI. It covers the complete Delta-backed telemetry surface, final output catalog, runtime parameters, and version-specific behavioral notes integrators must handle to render a trustworthy, forward-compatible experience.

> **v1.3.0 For Integrators** (Sections 2.1-2.5, 5.1, 8.7, 8.15, 8.16, 9, 11.1, 11.6, 11.8, 19.10): three new widgets (`03_discovery_type`, `10_strategic_context`, `16_best_of_best_count`); `__inspire_session` gains `discovery_type` and `strategic_context`; `__inspire_step` gains `event_id`; `__inspire_usecases` gains 14 columns; two new tables, `__inspire_feedback` (written by the App, read by the agent) and `_ailogs` (every LLM call attempt, Semunity's design); `results_json` gains 12 top-level keys and 15 per-use-case keys; a new stage, `Strategy Alignment`, and a new failed step of the same name; a new step, `Best of Best` (Section 8.16), and a new failed step of the same name. Every change is additive: rows written by v1.2.1 read the new columns as NULL, and step rows keep their shape, statuses and progress rules.

> **v1.2.1 For Integrators** (Section 19.9): no table, column, widget or `results_json` change; the `elite_assessment` JSON gains one optional key, `verdict_capped_from`. A worker step that the pipeline itself cancels and re-sends now ends `ended_warning` instead of `ended_error`, a dedup re-ask adds a `<step>_Reask` step, timed-out scoring batches are retried instead of dropped, and ERROR log lines are kept for outcomes that degraded.
>
> **v1.2.0 Highlights For Integrators** (details in Sections 2.3, 5.2, 7, 8.14, 9.2, 11, 14, 19.8):
>
> - **Quality Modes:** `use_cases_quality` takes `"Good"` (default), `"High"` or `"Ultra High"`. Legacy labels are still accepted and stored as their canonical mode (Section 9.2). Apps should add the `"Ultra High"` option.
> - **One Generation Pass, No Padding:** every mode generates the same candidate set and differs only in selection. Recovery, minimum top-up and the target-zone floor are removed; when nothing clears the bar the session ships the closest candidates labelled `"below the <mode> bar"` (with a plain `"0 use cases met the <mode> bar"` notice) instead of padding or shipping empty.
> - **Ultra High Elite Selection:** an elite stage (`ULTRA_HIGH_ELITE_JUDGE_PROMPT`) keeps only use cases that clear an absolute bar; no quota, no cap. Every elite use case gets Genie Code.
> - **New Step Events** under `Use Case Prioritization`: `Quality Bar`, `Selection Funnel`, `Elite Selection` (Section 8.14).
> - **New `results_json` Keys:** `funnel_ledger`, `selection_outcome` and, in `Ultra High`, `elite_outcome` (Section 11.7).
> - **New `__inspire_usecases` Columns:** `quality`, `quality_mode`, `elite_status`, `elite_score`, `elite_assessment` (JSON), `selection_flags` (JSON) (Section 2.3). `code_structure_mandate` is now filled for every row.
> - **Atomic Session Replace:** a session's `__inspire_usecases` rows are replaced in one Delta transaction; readers never see a partly written session (Section 2.3.1).
> - **Run Outcome Keys:** `results_json.failed_steps` and `results_json.translation_gaps` report failed artifact steps and translated text left in English; `results_json.metadata_unavailable` (always present) lists tables whose metadata could not be loaded and `results_json.llm_endpoint_health` (always present) the unusable endpoints. Failed steps, translation gaps or lost tables make the final `Inspire pipeline completed` step `ended_warning` with `Completed with warnings: ...` (Sections 8.1, 11.8).
> - **One Scoring Pass, Final-Rank Ids:** `USE_CASE_VALUE_SCORE_PROMPT` and `USE_CASE_QUALITY_SCORE_PROMPT` are removed; `COMBINED_VALUE_QUALITY_SCORE_PROMPT` is the only scoring prompt and `Priority` is its absolute priority. Ids before selection are provisional; every mode renumbers the final list in final-rank order (`N01` is the domain of the best use case). `result_table` is a quoted three-level name (Section 11.6).
> - **Genie Code Notebooks Redesigned:** every use case gets a notebook; a Genie Code notebook is a tested skeleton in sections 0-12 whose only open cells are marked `GENIE SLOT`, with a per-family harness, a readiness gate, evaluation against a baseline and a final contract check. Each notebook runs as its own persistent, tagged job `dbx_inspire_ai_<slug>_<hash8>` that Inspire never deletes; `dbx_inspire_ai_run_type` is `training`, `inference` or `analysis`. Discover generates Genie Code for the top-N use cases by final rank (widget `13_generate_genie_code_for`), and in `Ultra High` for every elite use case only (Sections 17.H, 17.I).
> - **ISO 639-1 File Codes:** per-language artifact names use ISO 639-1 codes; Swedish, Polish, Dutch, Indonesian, Malay and Chinese (Mandarin) changed from `sw`, `po`, `du`, `in`, `ma`, `ch` to `sv`, `pl`, `nl`, `id`, `ms`, `zh` (Section 19.7). Scores that were never computed read `Not scored` in the Excel, CSV and Markdown catalogs.
>
> **v0.7.3 Highlights For Integrators** (details in Sections 14, 17, 18, 19, 20):
>
> - **Hard-Veto Survivors Resolved:** The stratified trim now drops hard-veto use cases BEFORE trimming. `bob_score = 2.0` should be rare to impossible in the final v0.7.3+ portfolio. The warning-badge UI pattern (Section 17.F) now applies only to legacy v0.7.2 sessions.
> - **Target-Max Jitter (Non-Round Portfolio Sizes):** Default portfolios now land in the `91-110` range instead of exactly `100`. `target_max_use_cases` is now the base (default changed from 100 to **90**) and `target_max_jitter` (default **20**) is added on top. Apps expecting exactly 100 UCs will see varying counts.
> - **Multi-Language Filenames:** Multi-language runs now produce per-language artifacts (`readme_<lang_abbr>.md`, `<business>-dbx_inspire_<lang_abbr>.xlsx`). Single-language runs retain the legacy filenames.
> - **Parallel Genie Regeneration:** Route 1/2 Genie Code regeneration now runs in parallel (default concurrency 10, configurable via `genie_regen_parallelism`). Apps polling the step table may observe out-of-order `(idx/total)` counters: this is expected.
>
> **Carried Forward From v0.7.2** (details in Sections 2.3, 5.2, 8.13, 14, 17):
>
> - Five columns on `__inspire_usecases` (`idea_theme`, `bob_score`, `bob_tier1_score`, `bob_tier2_score`, `bob_tier3_score`): populated only when aggressive vetting fires.
> - Two step events under the `Use Case Prioritization` stage: `Best Of Best Ranking` and `LLM Aggressive Consolidation`.
> - Prompt title `BEST_OF_BEST_SCORING_PROMPT` ("Inspire Is Ranking Use Cases By Every Quality Gate For Fine-Grained Prioritization").
> - `idea_theme` is free-form LLM text; apps MUST NOT treat it as a closed enum until the planned canonicalization pass ships.

## 1) Integration Scope

Read only these tracking tables:

- `<inspire_db>.__inspire_session`
- `<inspire_db>.__inspire_step`
- `<inspire_db>.__inspire_usecases` (internal tracking/log table)
- `<inspire_db>.__inspire_implement` (Implement with Genie: one row per wizard spec version)

All tables are Delta tables created automatically when Inspire runs. Your app never writes to `__inspire_step`: it only writes back an ACK on `__inspire_session.processing_status`.

**Write Boundaries:**

| Table | Integrator Read | Integrator Write |
|---|---|---|
| `__inspire_session` | Always | Only the `processing_status` ACK column (`'ready' → 'done'`) |
| `__inspire_step` | Always | Never |
| `__inspire_usecases` | Always | Only `generate_genie_code_instruction` (Route 1 regen opt-in, set via UI) |
| `__inspire_implement` | Always | Insert spec rows (`status='queued'`). On a row it inserted: set `implement_run_id` to the run it started, set `status_message` to that run's URL while the row is still `queued`, and set a still-`queued` row to `failed` with the reason when the run could not start. The agent writes status, asset ids, widgets and every other column. |

Any other write is a protocol violation and may cause the pipeline to stall, double-fire, or corrupt the completion handshake.

## 2) Core Table Schemas

### 2.1 `__inspire_session`

```sql
CREATE TABLE IF NOT EXISTS <inspire_db>.__inspire_session (
    session_id          BIGINT,       -- Unique session identifier (epoch-based or user-provided)
    widget_values       VARIANT,      -- JSON: all widget inputs that launched this session
    processing_status   STRING,       -- State machine: 'done' | 'ready'
    completed_percent   DOUBLE,       -- 0.0 → 100.0 progress (integer-style increments, finalized to 100)
    create_at           TIMESTAMP,    -- Session creation time (UTC)
    last_updated        TIMESTAMP,    -- Last flush time (UTC)
    completed_on        TIMESTAMP,    -- NULL while running; set when pipeline finishes
    inspire_json        VARIANT,      -- JSON: intermediate pipeline metadata (last_flush timestamps)
    results_json        VARIANT       -- JSON: final output catalog (populated on completion only)
) USING DELTA
```

v1.3.0 adds two STRING columns, migrated with `ALTER TABLE ... ADD COLUMN`: `discovery_type` (`Deep` or `Standard`; from v1.4.0 `AI Enhanced Discovery` or `Standard Discovery`) and `strategic_context` (the parsed customer strategy tree as compact JSON; empty when the run had no strategic context). Sessions written before v1.3.0 read both as NULL; treat a NULL `discovery_type` as `Standard`, since those runs never read data.

A `Generate Use Cases` run on a session that already has a row (Route 1, which the Inspire App's Genie buttons start) attaches to that row: it only updates `last_updated`, so the row keeps the Discover run's `results_json`, `inspire_json`, settings, `create_at` and `completed_on` (`[SESSION-ATTACH FIRED]`). Before v1.3.0 the regeneration rewrote the row with its own small payload, so a session lost its results after one Genie regeneration, and a regeneration that stopped early left it without `completed_on`. A Generate run writes its logs beside the Discover run's logs instead of over them: `session_<sid>/log_generate_<UTC yyyymmdd_HHMMSS>.log`, `ailogs_generate_<stamp>.jsonl` and `docs/generation_log_generate_<stamp>.txt`.

A `Generate Use Cases` run that finds nothing to regenerate fails, and its error says why: no tracking row of its session is flagged and no notebook is marked, the scan of the tracking table or of a notebook failed (with the error), or the marked notebooks match no tracking row. Before v1.3.0 such a run ended SUCCESS. An App that flags rows before it starts the run sees this only when the flags did not land.

### 2.2 `__inspire_step`

```sql
CREATE TABLE IF NOT EXISTS <inspire_db>.__inspire_step (
    session_id          BIGINT,       -- FK to __inspire_session.session_id
    step_id             BIGINT,       -- Unique step identifier (epoch-ms + monotonic counter)
    last_updated        TIMESTAMP,    -- When this step was flushed to Delta (UTC)
    stage_name          STRING,       -- Business-friendly stage title (e.g. "Use Case Design")
    step_name           STRING,       -- Stable action title (e.g. "Generating Use Cases")
    sub_step_name       STRING,       -- Live status text (e.g. "In progress: use cases generation")
    progress_increment  DOUBLE,       -- Integer-style delta (minimum 1, never 0)
    message             STRING,       -- Richer narrative sentence for display
    status              STRING,       -- 'started' | 'ended_success' | 'ended_warning' | 'ended_error'
    result_json         VARIANT       -- JSON: structured payload (schema varies by phase, see Section 8)
) USING DELTA
```

v1.3.0 adds `event_id STRING`, used only to de-duplicate a step row that the writer re-sends after a failed flush. Row content, statuses, stage and step names and the `progress_increment` rules are unchanged; ignore the column or treat it as an opaque key.

### 2.3 `__inspire_usecases` (Internal Tracking/Log Table)

```sql
CREATE TABLE IF NOT EXISTS <inspire_db>.__inspire_usecases (
    session_id                          BIGINT,
    id                                  STRING,
    use_case                            STRING,
    short_name                          STRING,
    updated_at                          TIMESTAMP,
    -- v0.7.0+: Genie Code Regeneration Flags
    generate_genie_code_instruction     STRING,   -- 'Yes' | 'No'; if 'Yes' in Route 2, UC is re-genie'd on next run
    has_genie_code                      STRING,   -- 'Y' | 'N' from v0.7.6+ (was 'Yes' | 'No' in v0.7.3 and earlier). Pre-existing rows keep their legacy value.
    directly_involved_schema            STRING,   -- Scoped schema snippet used during regeneration
    code_structure_mandate              STRING,   -- Genie Code structure mandate cached per use case; filled for every row from v1.2.0
    -- v0.7.2+: Best Of Best (BoB) Scoring And Idea Theme
    idea_theme                          STRING,   -- 2-4 word analytical archetype (e.g. 'Anomaly Detection'); NULL if BoB did not run
    bob_score                           DOUBLE,   -- Composite BoB score in [0,10]; 2.0 is a hard-veto sentinel; NULL if BoB did not run
    bob_tier1_score                     DOUBLE,   -- Mean of gates D1-D11 (technical grounding); NULL if BoB did not run
    bob_tier2_score                     DOUBLE,   -- Mean of gates D12-D14 (business value); NULL if BoB did not run
    bob_tier3_score                     DOUBLE,   -- Mean of gates D15-D19 (PBA sign-off); NULL if BoB did not run
    -- v1.2.0+: Quality Modes And Elite Selection
    quality                             STRING,   -- Quality label from combined scoring ('Ultra High' ... 'Ultra Low')
    quality_mode                        STRING,   -- The session's quality mode: 'Good' | 'High' | 'Ultra High'
    elite_status                        STRING,   -- 'ELITE' when the use case cleared the 'Ultra High' bar; 'DOMAIN_COVERAGE_PICK' in any mode for a domain coverage pick
    elite_score                         DOUBLE,   -- 'Ultra High' elite score (default weights 0.40 value + 0.25 evidence + 0.20 implementability + 0.15 actionability); NULL otherwise
    elite_assessment                    STRING,   -- JSON: elite judge assessment, metadata verification, second opinion and evidence repair; in 'Good' and 'High' only for use cases that passed every elite test, otherwise NULL outside 'Ultra High'
    selection_flags                     STRING,   -- JSON: selection flags, e.g. a domain coverage pick and its reason
    -- v1.3.0+: Strategy Alignment, KPIs, Benefits, Foundations And Feedback Key
    strategy_alignment                  STRING,   -- JSON: up to 2 alignments, each {id, path, evidence}
    strategy_path                       STRING,   -- Aligned entries' paths joined with '; ', or 'Not aligned' with a customer strategy
    kpis                                STRING,   -- JSON: structured KPI specs with the read-only query and, in Deep, the measured baseline
    expected_key_results                STRING,   -- JSON: key results, source 'strategy' (the customer's own) or 'proposed'
    measures_of_success                 STRING,   -- One measure per line
    financial_benefits                  STRING,   -- One benefit per line
    non_financial_benefits              STRING,   -- One benefit per line
    data_evidence                       STRING,   -- JSON (Deep only): row counts, date ranges and join match rates of the use case's tables
    foundation_ids                      STRING,   -- Comma-separated shared data foundation IDs ('F1', 'F2', ...)
    use_case_key                        STRING    -- '<normalized title>|<first table, lowercase>' (max 300 chars); the key of __inspire_feedback. Copy it, never recompute it
) USING DELTA
```

#### 2.3.1 v0.7.x Feature-Flag Columns (Consolidated)

The `__inspire_usecases` table accumulates feature-flag columns version-by-version. Inspire uses idempotent `ALTER TABLE ... ADD COLUMN` migrations so that:

- Pre-existing rows are preserved.
- Older-session rows will contain `NULL` for columns introduced after their session ran.
- Apps MUST handle NULL values for every versioned column listed below.

| Column | Introduced | Type | Semantics | NULL Handling |
|---|---|---|---|---|
| `generate_genie_code_instruction` | v0.7.0 | STRING | `'Yes'` / `'No'` user request for Genie Code regeneration on next run | Treat NULL as `'No'` |
| `has_genie_code` | v0.7.0 (values changed v0.7.6) | STRING | `Y` / `N` from v0.7.6+; `Yes` / `No` in v0.7.3 and earlier. Pre-existing rows keep legacy value. | Treat NULL as `N`; accept both `Y`/`Yes` as true |
| `directly_involved_schema` | v0.7.0 | STRING | Scoped schema snippet used during regeneration | Treat NULL as "not yet scoped" |
| `idea_theme` | v0.7.2 | STRING | LLM-assigned 2-4 word analytical archetype (e.g. "Anomaly Detection", "Demand Forecasting"). Free-form, NOT an enum. | Treat NULL as "theme not assigned" (BoB did not fire) |
| `bob_score` | v0.7.2 | DOUBLE | Composite 0-10 BoB score. Exactly `2.0` is a hard-veto floor sentinel. | Treat NULL as "not scored" (BoB did not fire) |
| `bob_tier1_score` | v0.7.2 | DOUBLE | Mean of gates D1-D11 (technical grounding) | Treat NULL as "not scored" |
| `bob_tier2_score` | v0.7.2 | DOUBLE | Mean of gates D12-D14 (business value) | Treat NULL as "not scored" |
| `bob_tier3_score` | v0.7.2 | DOUBLE | Mean of gates D15-D19 (PBA sign-off) | Treat NULL as "not scored" |
| `quality` | v1.2.0 | STRING | Quality label from combined scoring: `Ultra High`, `Very High`, `High`, `Medium`, `Low`, `Very Low`, `Ultra Low` | Treat NULL as "not recorded" (pre-v1.2.0 row) |
| `quality_mode` | v1.2.0 | STRING | The session's canonical quality mode: `Good`, `High` or `Ultra High` (legacy labels are stored as their canonical mode) | Treat NULL as a pre-v1.2.0 row; read `__inspire_session.use_cases_quality` instead |
| `elite_status` | v1.2.0 | STRING | `ELITE` marks a use case that cleared the `Ultra High` bar; `DOMAIN_COVERAGE_PICK` (any mode) marks a use case kept only so a user-specified Business Domain is not empty; render it as "Domain coverage pick, below bar" | Treat NULL / empty as "no elite decision" |
| `elite_score` | v1.2.0 | DOUBLE | `Ultra High` ranking score: the weighted sum of the 1-10 value, evidence, implementability and actionability scores (`ultra_high_score_weights`, default 0.40 / 0.25 / 0.20 / 0.15). When a near miss got a second opinion, each score is the mean of the two opinions | Treat NULL as "not judged" (always NULL in `Good` and `High`) |
| `elite_assessment` | v1.2.0 | STRING (JSON) | The elite judge's per-use-case assessment (decision, KPI, cited columns, build path, `runtime_assumptions`, `fatal_flaws` as `{category, explanation}` objects, red team and `red_team_category`, scores, verdict; `red_team_verdict` is derived: `fatal` when `fatal_flaws` is not empty; from v1.2.1 `verdict_capped_from` holds the judge's original verdict when it stayed above what its own scores and value tier support after the corrective re-judge and was capped, NULL otherwise) with `verification` (the metadata check, including `time_via_join` and `entity_key_basis`), `failed_gates`, `second_opinion` and `evidence_repair` (the verification failures that triggered the one repair re-judge, and its `outcome`: `passed`, `failed` or `unjudged`) | Treat NULL as "not judged"; parse tolerantly |
| `selection_flags` | v1.2.0 | STRING (JSON) | Selection flags for the use case, for example a domain coverage pick and its reason, or a below-bar fallback label ("below the `<mode>` bar") with the check it missed when it ships only because no use case met the bar | Treat NULL as "no flags"; parse tolerantly |
| `code_structure_mandate` | v0.7.x (filled for every row from v1.2.0) | STRING | Run pattern and business output layout the Genie Code instruction is written from, cached for regeneration: the execution family, its run pattern, pinned packages, the AI endpoint, the business output table with its columns, the action text per priority tier and the rules the instruction is written to, such as column names that are never a DataFrame method, date windows and numbers in text (Section 17.I). Rows written before v1.3.0 hold the contracts of the retired GENIE SLOT functions; when a use case has none, it is built from its notebook spec at write time | Treat NULL as a pre-v1.2.0 row |
| `strategy_alignment` | v1.3.0 | STRING (JSON) | Up to 2 alignments to strategy entries, each `{id, path, evidence}`; `evidence` names the use case's own columns or KPI | Treat NULL as a pre-v1.3.0 row; parse tolerantly |
| `strategy_path` | v1.3.0 | STRING | The aligned entries' verbatim paths (`Pillar > Objective`) joined with `; `; `Not aligned` when a customer strategy exists and nothing aligned; NULL with the built-in goals and no match | Treat NULL as "not aligned"; group NULL with `Not aligned` |
| `kpis` | v1.3.0 | STRING (JSON) | Up to 3 KPI specs: `name`, `kpi_id` (set when it comes from the customer's strategy), `direction`, `unit`, `metric_view`/`measure` or `aggregation`/`table`/`column`, `filter_column`/`filter_value`, `time_column`/`window_days`, `computable`, `query` (built by Inspire, read-only; a SUM, AVG, MIN, MAX, ratio or measure returns a DOUBLE, and a SUM, AVG, MIN or MAX over a column that is not a number is not computable) and `baseline` (`{value, window_days, measured_on}` in Deep, NULL in Standard) | Treat NULL as "no KPIs" |
| `expected_key_results` | v1.3.0 | STRING (JSON) | Key results `{id, statement, kpi_id, source}`; `source` is `strategy` (the customer's own wording) or `proposed` (at most 2) | Treat NULL as "none" |
| `measures_of_success` | v1.3.0 | STRING | Up to 3 measures, one per line | Treat NULL as "none" |
| `financial_benefits` | v1.3.0 | STRING | Up to 3 benefits, one per line; figures come only from the user or a measured baseline, otherwise a bracketed placeholder | Treat NULL as "none" |
| `non_financial_benefits` | v1.3.0 | STRING | Up to 3 benefits, one per line | Treat NULL as "none" |
| `data_evidence` | v1.3.0 | STRING (JSON) | Deep only: per table `{rows, sampled, date_ranges}` and the observed join match rates of the use case's tables | Treat NULL as "no data read" (Standard or pre-v1.3.0) |
| `foundation_ids` | v1.3.0 | STRING | Comma-separated IDs of the shared data foundations the use case belongs to (`results_json.foundations`) | Treat NULL as "none" |
| `use_case_key` | v1.3.0 | STRING | Stable identity across runs: normalized title, `|`, first table of `tables_involved` in lowercase; at most 300 characters | Treat NULL as a pre-v1.3.0 row; feedback cannot target it |
| `best_of_best` | v1.3.0 | STRING | `Y` when the use case is starred as Best of Best (Section 8.16), `N` otherwise | Treat NULL as "not marked" (pre-v1.3.0 or the star judge failed) |
| `best_of_best_rank` | v1.3.0 | STRING | Star rank from 1; NULL when not starred | Cast to INT to sort; never sort it as text |
| `best_of_best_score` | v1.3.0 | STRING | Elite score out of 10 for every use case the elite judge scored | Cast to DOUBLE; NULL means not judged |
| `best_of_best_reason` | v1.3.0 | STRING | Why the use case is starred, or the test it failed (`did not pass: ...`, each test named with its code in parentheses) | Show as text; treat NULL as "not marked" |

**Regeneration Interlock:** When Route 1 (DB-flag) or Route 2 (notebook-flag) regeneration runs, the same transaction sets `generate_genie_code_instruction='No'` and `has_genie_code='Y'` (v0.7.6+; wrote `'Yes'` in v0.7.3 and earlier). Apps reading mid-flight are guaranteed a consistent snapshot thanks to Delta's ACID transaction guarantees.

**Session Replace Interlock (v1.2.0):** every column of a session's rows, including the five BoB columns, is written by one atomic session replace: the rows are staged in `<inspire_db>.__inspire_usecases_stage_<session_id>`, then a single Delta `replaceWhere session_id = <session_id>` overwrite swaps them in and the staging table is dropped. Readers see either the previous rows or the new ones, never a session with rows missing. A failed replace keeps the previous rows and is recorded in `results_json.failed_steps` (`step = "Tracking Table"`). If the table could not be migrated to the current columns, the session is written without the missing columns and `Tracking Table Migration` is recorded. Table names are quoted in every statement, so catalog and schema names that need quoting (for example with a hyphen) work.

See Section 17 ("BoB Scoring And Idea Themes") for the full behavioral contract, recommended UI patterns, and example integration queries.

### 2.4 `__inspire_feedback` (v1.3.0, Written By The App)

```sql
CREATE TABLE IF NOT EXISTS <inspire_db>.__inspire_feedback (
    session_id      BIGINT,     -- Session whose use case the user reviewed
    business_name   STRING,     -- Matched case-insensitively to the next run's business name
    use_case_id     STRING,     -- Display id at review time (N##-U##); informational only
    use_case_key    STRING,     -- Copied from __inspire_usecases.use_case_key; the matching key
    use_case_title  STRING,
    status          STRING,     -- 'accepted' | 'rejected' | 'planned' | 'implemented'
    reason          STRING,     -- Optional free text
    updated_by      STRING,
    updated_at      TIMESTAMP
) USING DELTA
```

The agent creates the table when it is missing and only reads it. Append one row per decision; the latest row per `use_case_key` and business wins. On the next run for the same business, a use case whose latest status is `rejected` is excluded before alignment (`results_json.excluded_by_feedback`, funnel stage `feedback_exclusion`); `accepted`, `planned` and `implemented` use cases carry `Feedback Status` and appear in `results_json.portfolio_history`. For `implemented` use cases with a stored KPI spec, Deep measures the KPI now against its baseline and Standard writes the query only (`results_json.value_tracking`). Bind every value as a SQL parameter when writing.

### 2.5 `_ailogs` (v1.3.0, Every LLM Call Attempt)

The same table design as Semunity's AI call log, with `agent = 'inspire'`. Inspire creates it with `CLUSTER BY (session_id, agent)` and the comment "Append-only log of every LLM call attempt with full request and response."

| Column | Type | Meaning |
|---|---|---|
| `ailogs_id` | STRING | Unique row id |
| `request_id` | STRING | Shared by every attempt of one logical call |
| `session_id` | BIGINT | The run's session id |
| `attempt` | INT | 1 for the first attempt, then 2, 3, ... |
| `agent` | STRING | Always `inspire` |
| `prompt` | STRING | Prompt name, for example `STRATEGY_ALIGNMENT_PROMPT` |
| `endpoint` | STRING | Serving endpoint the statement was sent to |
| `temperature` | DOUBLE | Temperature sent, NULL when none was sent |
| `parameters` | STRING | JSON of the parameters sent (`max_tokens`, `response_format`, `temperature`) |
| `request` | STRING | Full request text |
| `response` | STRING | Full response text, or the error for a failed attempt |
| `request_length`, `response_length` | BIGINT | Characters |
| `request_tokens`, `response_tokens` | BIGINT | Estimated as characters / 3.2 |
| `status` | STRING | `success`, `failed`, `timedout`, `exhausted` or `hedged` |
| `start_time`, `end_time` | TIMESTAMP | Attempt start and end |
| `request_hash` | STRING | SHA-256 of the request text |
| `server_ingested_at` | TIMESTAMP | When the row was written |

Row semantics: one row per attempt, written exactly once. A call whose attempts all fail adds one terminal `exhausted` row. A cache hit writes no row. `hedged` belongs to the shared vocabulary; Inspire does not hedge requests, so it never writes it. Endpoint probes that run before the session exists are buffered and written once the session starts. A log write never fails or delays an LLM call: rows are spooled and inserted in byte-capped chunks, a chunk that keeps failing is quarantined after 5 tries, and at the end of the run an `[AILOGS CHECK]` line reports the checks and row counts (`results_json.ailogs_check`). Without an `inspire_database`, the rows go to `ailogs.jsonl`, which the live log streamer copies next to the live log. A permission error is never retried: when the run's identity may not write `_ailogs` (or `__inspire_step`), the writer logs one `[SPOOL-DENIED FIRED]` warning naming the table and stops sending its rows, which stay in the local spool. The AI call log spool is then copied next to the live log as `ailogs.jsonl`, and the check `rows_reach_the_table` fails, as it does when rows were quarantined. To log to the table, grant `MODIFY` on it to every identity that runs Inspire against the same `inspire_database`.

### 2.6 `__inspire_implement` (Implement with Genie)

The App inserts one row per wizard submission (`status='queued'`) and records the run it starts in `implement_run_id`. When that run cannot start, the App sets the still-queued row to `failed` with the reason. The agent owns every later update: `status`, asset ids and urls, `genie_widgets`, `data_profiles`, `suggested_schedule`, `asset_status`, `result_rows`, `job_id`, `last_preview_run_id`, `notebook_path`. Submit `15_operation = Implement Use Cases` with `14_session_id`, `inspire_implement_use_case` and `inspire_implement_spec_version`. Old versions stay, which is History.

`status` is one of `queued`, `filling`, `previewing`, `building_outputs`, `ready`, `ready_with_warnings`, `failed`. While a row is in an active status, the App rejects a new spec for that use case (409), unless the version stalled: its run (`implement_run_id`) ended while the row was still active, or, when that run cannot be read, the row has had no update for longer than an Implement run may hold its lock (4 hours). The Studio shows a stalled version as stopped, with the reason, and a new spec may replace it. A later spec must set `based_on_version` to the last built version.

`asset_status.notebook` records the use case notebook as Inspire last wrote it: `modified_at` (workspace modification time, epoch ms) and `spec_version`. A version that rebuilds the notebook (the first build, or a data or config change) first compares the notebook's current `modified_at` with that record. A change Inspire did not make is a user edit: the version ends `failed` without touching the notebook and adds `state: "edited"` and `edited_at` to the entry. To rebuild over those edits, submit the next spec with `confirm_notebook_overwrite: true`. The flag applies to the version that carries it, so never copy it into a later spec. Before its first write, a rebuilding version adds `rewriting: {spec_version, run_id}` to the entry. When that run stops before recording the notebook, the next version treats changes made before the run ended as Inspire's own.

## 3) READY/DONE Handshake Protocol

Inspire uses a cooperative flush protocol. Your app must implement this loop:

```
┌──────────────┐     poll every 5s      ┌──────────────────────┐
│  Your App    │ ────────────────────►   │  __inspire_session   │
│  (consumer)  │                         │                      │
│              │  ◄──── read status ──── │  processing_status   │
│              │                         │                      │
│  if 'ready': │                         │                      │
│   1. read    │  ◄──── read steps ───── │  __inspire_step      │
│      new     │                         │                      │
│      steps   │                         │                      │
│   2. render  │                         │                      │
│   3. ACK     │  ────── UPDATE ──────►  │  SET status='done'   │
│              │                         │                      │
│  if          │                         │                      │
│  completed_on│                         │                      │
│  IS NOT NULL:│  ◄──── read results ─── │  results_json        │
│   stop poll  │                         │                      │
└──────────────┘                         └──────────────────────┘
```

**Rules:**

1. Poll `__inspire_session` every 5 seconds.
2. If `processing_status = 'ready'`, read new step rows, render them, then ACK by setting `processing_status = 'done'`.
3. Continue until `completed_on IS NOT NULL`.
4. Do **not** ACK `done` before render succeeds: this gates the next flush.

**State Machine:**

```
 Session Init        Flush Events         App ACK
    │                    │                    │
    ▼                    ▼                    ▼
  'done'  ──────►   'ready'  ──────►   'done'  ──────►  'ready' ...
    │                                                       │
    │                  Pipeline Complete                     │
    │                       │                               │
    ▼                       ▼                               ▼
                   'ready' + completed_on IS NOT NULL
                   (final state: stop polling)
```

## 4) Progress Contract

- `progress_increment` is integer-oriented in behavior (minimum 1, never 0).
- `completed_percent` is maintained as integer-style progress during the run, capped at 99 until finalization.
- On pipeline completion, `completed_percent` is set to exactly `100.0`.

**UI Guidance:**

- Use `__inspire_session.completed_percent` as the progress-bar source of truth.
- Treat `progress_increment` as a per-event delta for animation/display only.
- Progress only increments on `ended_success` status steps (started steps have `progress_increment = 0`).

## 5) Story Contract for UI Columns

The three display columns have strict semantic roles:

| Column | Role | Behavior |
|--------|------|----------|
| `stage_name` | Section title | Changes infrequently; groups related steps |
| `step_name` | Stable action title | One per logical operation; remains constant for started/ended pair |
| `sub_step_name` | Live status text | Frequently changing; shows "In progress:", "Completed:", etc. |
| `message` | Richer narrative | Full sentence explaining what Inspire is doing. A pipeline step that ends `ended_warning` or `ended_error` appends its cause after a colon, for example `Inspire has completed metadata load with caution: 2 table(s) could not be loaded and are not analysed: <table> (<reason>); ...` (v1.2.0); prompt steps keep the narrative only |

### 5.1 Stage Name Mapping

Internal pipeline stages are mapped to business-friendly names:

| Internal Stage | UI Stage Name |
|---|---|
| `Pipeline` | `Inspire Journey` |
| `Initialization` | `Setup` |
| `Business Context` | `Business Understanding` |
| `Table Filtering` | `Data Preparation` |
| `Use Cases Generation` | `Use Case Design` |
| `Business Domains Clustering` | `Domain Mapping` |
| `Business Domain Clustering` | `Domain Mapping` |
| `Use Cases Scoring` | `Use Case Prioritization` |
| `Review` | `Use Case Prioritization` |
| `Goal Filtering` | `Goal Filtering` |
| `Strategy Alignment` (v1.3.0) | `Strategy Alignment` |
| `Genie Code Instructions` | `Implementation Planning` |
| `Summary` | `Executive Readout` |
| `Document Generation` | `Executive Readout` |
| `Excel Generation` | `Executive Readout` |
| `Artifact Writing` | `Executive Readout` |
| `Translation` | `Localization` |

### 5.2 Prompt-Level Step Titles

Each AI prompt maps to a user-facing stage and step title:

| Prompt | Stage | Step Title |
|---|---|---|
| `BUSINESS_CONTEXT_WORKER_PROMPT` | Business Understanding | Understanding Business Priorities |
| `GENERAL_INSTRUCTION_INTERPRETER_PROMPT` | Business Understanding | Interpreting Generation Instructions |
| `FILTER_BUSINESS_TABLES_PROMPT` | Data Preparation | Selecting Business Tables |
| `BASE_USE_CASE_GEN_PROMPT` | Use Case Design | Generating Use Cases |
| `DOMAIN_FINDER_PROMPT` | Domain Mapping | Mapping Business Domains |
| `SUBDOMAIN_DETECTOR_PROMPT` | Domain Mapping | Refining Business Subdomains |
| `DOMAINS_MERGER_PROMPT` | Domain Mapping | Consolidating Overlapping Domains |
| `SUBDOMAINS_MERGER_PROMPT` | Domain Mapping | Deduplicating Subdomains Across Domains |
| `DOMAIN_SPLITTER_PROMPT` | Domain Mapping | Rebalancing Oversized Domains |
| `COMBINED_VALUE_QUALITY_SCORE_PROMPT` | Use Case Prioritization | Ranking Use Cases |
| `REVIEW_USE_CASES_PROMPT` | Use Case Prioritization | Reviewing and Removing Duplicates |
| `BEST_OF_BEST_SCORING_PROMPT` *(v0.7.2)* | Use Case Prioritization | Best Of Best Ranking |
| `ULTRA_HIGH_ELITE_JUDGE_PROMPT` *(v1.2.0, `Ultra High` only)* | Use Case Prioritization | Elite Selection |
| `GOAL_ALIGNMENT_FILTER_PROMPT` | Goal Filtering | Filtering Use Cases by Goal Alignment |
| `STRATEGY_ALIGNMENT_PROMPT` *(v1.3.0, after selection)* | Strategy Alignment | Aligning Use Cases to the Strategy |
| `USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT` | Implementation Planning | Generating Genie Code Instructions |
| `SUMMARY_GEN_PROMPT` | Executive Readout | Building Executive Summary |
| `KEYWORDS_TRANSLATE_PROMPT` | Localization | Translating Business Keywords |
| `USE_CASE_TRANSLATE_PROMPT` | Localization | Translating Use Cases |

### 5.3 Example Row (started event)

```json
{
  "session_id":         1234567890000000003,
  "step_id":            1772380000123,
  "last_updated":       "2026-03-01T18:13:30",
  "stage_name":         "Use Case Design",
  "step_name":          "Generating Use Cases",
  "sub_step_name":      "In progress: use cases generation",
  "progress_increment": 1,
  "message":            "Inspire has started generating business use cases",
  "status":             "started",
  "result_json": {
    "event_at":    "2026-03-01T18:13:30.123456+00:00",
    "entity_id":   "BASE_USE_CASE_GEN_PROMPT:Use_Cases:N01",
    "step_name":   "Use_Cases:N01",
    "prompt_name": "BASE_USE_CASE_GEN_PROMPT"
  }
}
```

## 6) Status Semantics

### 6.1 Status Values

| `status` | Meaning | UI Color |
|---|---|---|
| `started` | Step is currently in progress | Blue / in-progress spinner |
| `ended_success` | Step completed successfully | Green / check mark |
| `ended_warning` | Step completed with caveats (e.g. rebatch, empty response), or, from v1.2.1, an LLM worker step that the pipeline itself cancelled and re-sent (a straggler retry) | Amber / warning icon |
| `ended_error` | Step failed; may need attention. From v1.2.1 a worker step cancelled by the pipeline itself never ends `ended_error` | Red / error icon |

### 6.2 Step Lifecycle

Every step follows a `started` → `ended_*` lifecycle. The same `step_id` is reused for the `started` and `ended_*` pair when possible:

```
started (progress_increment = 0)
    │
    ├──► ended_success (progress_increment = N)
    │
    ├──► ended_warning (progress_increment = 0 or N)
    │
    └──► ended_error   (progress_increment = 0 or 1)
```

## 7) Story Naming Guidance

Use business-friendly text only (no internal technical terms in visible labels).

**Expected Tone:**

- Clear for non-technical business users.
- Stable step titles, dynamic sub-step updates.
- Message should explain what Inspire is doing in plain language.

**Started messages per prompt (used in `message` field):**

| Prompt | Started Message |
|---|---|
| `BUSINESS_CONTEXT_WORKER_PROMPT` | Inspire has started understanding business priorities and strategic goals |
| `GENERAL_INSTRUCTION_INTERPRETER_PROMPT` | Inspire has started interpreting generation instructions |
| `FILTER_BUSINESS_TABLES_PROMPT` | Inspire has started inspecting business tables for relevance |
| `BASE_USE_CASE_GEN_PROMPT` | Inspire has started generating business use cases |
| `DOMAIN_FINDER_PROMPT` | Inspire has started organizing use cases into business domains |
| `SUBDOMAIN_DETECTOR_PROMPT` | Inspire has started refining domains into subdomains |
| `DOMAINS_MERGER_PROMPT` | Inspire has started consolidating overlapping domains |
| `SUBDOMAINS_MERGER_PROMPT` | Inspire has started deduplicating subdomains across domains |
| `DOMAIN_SPLITTER_PROMPT` | Inspire has started rebalancing oversized domains |
| `COMBINED_VALUE_QUALITY_SCORE_PROMPT` | Inspire has started ranking use cases by combined value and quality |
| `REVIEW_USE_CASES_PROMPT` | Inspire has started reviewing use cases to remove overlap and improve quality |
| `BEST_OF_BEST_SCORING_PROMPT` *(v0.7.2)* | Inspire is ranking use cases by every quality gate for fine-grained prioritization |
| `ULTRA_HIGH_ELITE_JUDGE_PROMPT` *(v1.2.0)* | Inspire has started the Ultra High elite selection |
| `GOAL_ALIGNMENT_FILTER_PROMPT` | Inspire has started filtering use cases that do not align with user-specified goal |
| `USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT` | Inspire has started generating Genie Code instructions |
| `SUMMARY_GEN_PROMPT` | Inspire has started creating the executive summary |
| `KEYWORDS_TRANSLATE_PROMPT` | Inspire has started translating business terminology |
| `USE_CASE_TRANSLATE_PROMPT` | Inspire has started translating use case outcomes |

## 8) `result_json` Schemas by Phase

Every `result_json` payload contains these base fields:

```json
{
  "event_at":    "2026-03-01T18:13:30.123456+00:00",
  "entity_id":   "<prompt_name>:<context_key>",
  "step_name":   "<step_name>",
  "prompt_name": "<PROMPT_NAME>"
}
```

Session ids inside `result_json` are decimal text, so a JavaScript reader keeps every digit of a 19-digit id; the `session_id` column of the table stays BIGINT. Rows written by earlier versions hold the id as a number: read it as text, for example `CAST(result_json:session_id AS STRING)`, never through a JavaScript number.

The rest of the schema depends on the pipeline phase. Treat `result_json` as tolerant JSON: always check for key existence before access.

### 8.1 Pipeline Lifecycle Events

**Pipeline Start** (`stage_name = "Inspire Journey"`):

```json
{
  "event_at":       "...",
  "entity_id":      "...",
  "step_name":      "Execution",
  "prompt_name":    "Pipeline",
  "operation_mode": "Discover Use Cases",
  "session_id":     "2222222222222222222"
}
```

**Database Setup** (`stage_name = "Setup"`):

```json
{
  "event_at":   "...",
  "entity_id":  "...",
  "step_name":  "Database Setup",
  "database":   "my_catalog._inspire"
}
```

**Pipeline Complete** (`stage_name = "Inspire Journey"`):

```json
{
  "event_at":    "...",
  "entity_id":   "...",
  "step_name":   "Inspire pipeline completed",
  "session_id":  "2222222222222222222"
}
```

The event is `ended_success` with `message = "Completed"` when every artifact step succeeded and every table's metadata loaded. When `results_json` carries `failed_steps` or `translation_gaps`, or `metadata_unavailable.count` is above 0 (Section 11.8), it is `ended_warning` with a message that names them, for example `"Completed with warnings: 2 table(s) without metadata were not analysed: cat.sch.ledger (timeout after 3 attempt(s): ...); cat.sch.payroll (DESCRIBE permission denied: ...); 1 artifact step(s) failed: Presentation (French)"`. The session still completes (`completed_on` set, `completed_percent = 100`): render it as completed with warnings, not as a failure.

**Pipeline Error** (`status = "ended_error"`):

```json
{
  "event_at":    "...",
  "entity_id":   "...",
  "step_name":   "Execution",
  "session_id":  "2222222222222222222"
}
```

### 8.2 Business Context Extraction

**Started** (`prompt_name = "BUSINESS_CONTEXT_WORKER_PROMPT"`):

```json
{
  "event_at":             "...",
  "entity_id":            "BUSINESS_CONTEXT_WORKER_PROMPT:Business_Context_Worker",
  "step_name":            "Business_Context_Worker",
  "prompt_name":          "BUSINESS_CONTEXT_WORKER_PROMPT",
  "schema_chars":         45200,
  "fk_chars":             3100,
  "strategic_goals_chars": 250
}
```

**Ended Success:**

```json
{
  "event_at":        "...",
  "entity_id":       "BUSINESS_CONTEXT_WORKER_PROMPT:Business_Context_Worker",
  "step_name":       "Business_Context_Worker",
  "prompt_name":     "BUSINESS_CONTEXT_WORKER_PROMPT",
  "response_type":   "json",
  "response_chars":  8500,
  "json": {
    "business_context":      "...",
    "strategic_goals":       ["..."],
    "business_priorities":   ["..."],
    "strategic_initiative":  "...",
    "value_chain":           "...",
    "revenue_model":         "..."
  }
}
```

**Pipeline-level completion for business context:**

```json
{
  "business_domains_count": 5,
  "strategic_goals_count":  3
}
```

### 8.3 Use Case Generation

Applies to: `BASE_USE_CASE_GEN_PROMPT`

**Started:**

```json
{
  "event_at":              "...",
  "entity_id":             "BASE_USE_CASE_GEN_PROMPT:Use_Cases:N01",
  "step_name":             "Use_Cases:N01",
  "prompt_name":           "BASE_USE_CASE_GEN_PROMPT",
  "schema_chars":          45200,
  "use_cases_input_count": 0,
  "domain_name":           ""
}
```

**Ended Success:**

```json
{
  "event_at":         "...",
  "entity_id":        "BASE_USE_CASE_GEN_PROMPT:Use_Cases:N01",
  "step_name":        "Use_Cases:N01",
  "prompt_name":      "BASE_USE_CASE_GEN_PROMPT",
  "response_type":    "raw",
  "response_chars":   12500,
  "use_cases_count":  15,
  "is_truncated":     false,
  "use_cases": [
    {
      "id":              "1",
      "name":            "Forecast Monthly Revenue with Economic Context",
      "short_name":      "Forecast Revenue Trends",
      "business_domain": "",
      "subdomain":       "",
      "type":            "Risk",
      "priority":        ""
    }
  ]
}
```

`use_cases_count` (like `rows_count` and `scored_count` in the sections below) counts only answer rows that have the header's shape: a row that is short of its columns, or carries unexplained extra values, is left out, as the pipeline's own parser rejects it and logs `[CSV-ROW misaligned]` with a count per reason. `is_truncated` is `true` only when more than 200 such rows came back and the list in the payload was capped; it does not describe the LLM answer.

### 8.4 Domain Clustering

Applies to: `DOMAIN_FINDER_PROMPT`, `SUBDOMAIN_DETECTOR_PROMPT`, `DOMAINS_MERGER_PROMPT`, `SUBDOMAINS_MERGER_PROMPT`, `DOMAIN_SPLITTER_PROMPT`

**Started:**

```json
{
  "event_at":              "...",
  "entity_id":             "DOMAIN_FINDER_PROMPT:Domain_Finder",
  "step_name":             "Domain_Finder",
  "prompt_name":           "DOMAIN_FINDER_PROMPT",
  "use_cases_input_count": 42,
  "domain_name":           ""
}
```

**Ended Success:**

```json
{
  "event_at":       "...",
  "entity_id":      "DOMAIN_FINDER_PROMPT:Domain_Finder",
  "step_name":      "Domain_Finder",
  "prompt_name":    "DOMAIN_FINDER_PROMPT",
  "response_type":  "json",
  "response_chars": 3200,
  "domains_count":  5,
  "domains": [
    {
      "domain_name": "Customer Analytics",
      "use_case_ids": ["1", "3", "7", "12"]
    }
  ]
}
```

### 8.5 Scoring & Prioritization

Applies to: `COMBINED_VALUE_QUALITY_SCORE_PROMPT`, `REVIEW_USE_CASES_PROMPT`

**Started:**

```json
{
  "event_at":              "...",
  "entity_id":             "COMBINED_VALUE_QUALITY_SCORE_PROMPT:Combined_Scoring:batch_1",
  "step_name":             "Combined_Scoring:batch_1",
  "prompt_name":           "COMBINED_VALUE_QUALITY_SCORE_PROMPT",
  "batch_rows":            30,
  "use_cases_input_count": 30
}
```

**Ended Success:**

```json
{
  "event_at":       "...",
  "entity_id":      "COMBINED_VALUE_QUALITY_SCORE_PROMPT:Combined_Scoring:batch_1",
  "step_name":      "Combined_Scoring:batch_1",
  "prompt_name":    "COMBINED_VALUE_QUALITY_SCORE_PROMPT",
  "response_type":  "raw",
  "response_chars": 9800,
  "scored_count":   30,
  "is_truncated":   false,
  "scored_use_cases": [
    {
      "id":          "1",
      "name":        "Forecast Monthly Revenue with Economic Context",
      "short_name":  "Forecast Revenue Trends",
      "priority":    "Very High",
      "value":       "4.58",
      "feasibility": "3.9",
      "quality":     "Very High"
    }
  ],
  "priorities": [
    {
      "id":       "1",
      "priority": "Very High"
    }
  ]
}
```

### 8.6 Goal Alignment Filtering

Applies to: `GOAL_ALIGNMENT_FILTER_PROMPT`

**Started:**

```json
{
  "event_at":              "...",
  "entity_id":             "GOAL_ALIGNMENT_FILTER_PROMPT:Goal_Alignment_Check",
  "step_name":             "Goal_Alignment_Check",
  "prompt_name":           "GOAL_ALIGNMENT_FILTER_PROMPT",
  "use_cases_input_count": 30
}
```

**Ended Success:**

```json
{
  "event_at":       "...",
  "entity_id":      "GOAL_ALIGNMENT_FILTER_PROMPT:Goal_Alignment_Check",
  "step_name":      "Goal_Alignment_Check",
  "prompt_name":    "GOAL_ALIGNMENT_FILTER_PROMPT",
  "response_type":  "raw",
  "response_chars": 2000,
  "use_cases_count": 25
}
```

### 8.7 Genie Code Instructions

Applies to: `USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT`

**Started:**

```json
{
  "event_at":     "...",
  "entity_id":    "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT:Genie_Instruction_Generator:uc_42",
  "step_name":    "Genie_Instruction_Generator:uc_42",
  "prompt_name":  "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT",
  "schema_chars": 45200,
  "domain_name":  "Customer Analytics"
}
```

**Ended Success:**

```json
{
  "event_at":       "...",
  "entity_id":      "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT:Genie_Instruction_Generator:uc_42",
  "step_name":      "Genie_Instruction_Generator:uc_42",
  "prompt_name":    "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT",
  "response_type":  "raw",
  "response_chars": 4500
}
```

**Per-use-case Genie wave rows (v1.3.0 fields):** the `Wave <n> - <id>` rows of stage `Genie Code Instructions` carry the full use case payload. From v1.3.0 it also has `strategy_alignment`, `strategy_path`, `kpis`, `expected_key_results`, `measures_of_success`, `financial_benefits`, `non_financial_benefits`, `data_evidence`, `foundation_ids` and `use_case_key`, named like their `__inspire_usecases` columns. JSON fields keep their structure, list fields are arrays of strings, and a field the use case does not have is `null`.

### 8.8 Summary

Applies to: `SUMMARY_GEN_PROMPT`

**Ended Success:**

```json
{
  "event_at":       "...",
  "entity_id":      "SUMMARY_GEN_PROMPT:Executive_Summary",
  "step_name":      "Executive_Summary",
  "prompt_name":    "SUMMARY_GEN_PROMPT",
  "response_type":  "raw",
  "response_chars": 6000,
  "rows": [],
  "rows_count":     0,
  "is_truncated":   false
}
```

### 8.9 Translation

Applies to: `KEYWORDS_TRANSLATE_PROMPT`, `USE_CASE_TRANSLATE_PROMPT`

**Started:**

```json
{
  "event_at":         "...",
  "entity_id":        "USE_CASE_TRANSLATE_PROMPT:Translate_Arabic",
  "step_name":        "Translate_Arabic",
  "prompt_name":      "USE_CASE_TRANSLATE_PROMPT",
  "target_language":  "Arabic",
  "domain_name":      "Customer Analytics"
}
```

**Ended Success:**

```json
{
  "event_at":       "...",
  "entity_id":      "USE_CASE_TRANSLATE_PROMPT:Translate_Arabic",
  "step_name":      "Translate_Arabic",
  "prompt_name":    "USE_CASE_TRANSLATE_PROMPT",
  "response_type":  "raw",
  "response_chars": 15000,
  "rows_count":     42,
  "is_truncated":   false,
  "rows": [
    {
      "No": "1",
      "Name": "...",
      "short_name": "...",
      "Business Domain": "...",
      "Subdomain": "..."
    }
  ]
}
```

### 8.10 Artifact Writing

**Ended Success:**

```json
{
  "event_at":  "...",
  "entity_id": "...",
  "job_name":  "PDF_Generation"
}
```

**Ended Error:**

```json
{
  "event_at":  "...",
  "entity_id": "...",
  "job_name":  "PDF_Generation",
  "error":     "Truncated error message (max 300 chars)"
}
```

Every failed artifact step is also recorded once in `results_json.failed_steps` (Section 11.8) and makes the final `Inspire pipeline completed` event `ended_warning` (Section 8.1).

### 8.11 Warning Events

Warning events use a unique step_name with a timestamp suffix to avoid collision:

```json
{
  "event_at":    "...",
  "entity_id":   "...",
  "step_name":   "Use_Cases:N01__warning_1709323456789_3",
  "prompt_name": "BASE_USE_CASE_GEN_PROMPT"
}
```

### 8.12 Error Events (Generic)

```json
{
  "event_at":    "...",
  "entity_id":   "...",
  "step_name":   "Genie_Instruction_Generator:uc_42",
  "prompt_name": "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT",
  "error":       "Truncated error message (max 300 chars)"
}
```

### 8.13 BoB Scoring Events (v0.7.2+)

Two new step-event tuples are emitted during Phase 4 when the aggressive-vetting threshold triggers (by default when the running UC count exceeds `aggressive_prune_threshold = 75`). Both are scoped to the `Use Case Prioritization` stage.

#### 8.13.1 Best Of Best Ranking: Started

- `stage_name`: `"Use Case Prioritization"`
- `step_name`: `"Best of Best Ranking"`
- `status`: `"started"`
- `prompt_name`: `"BEST_OF_BEST_SCORING_PROMPT"`

```json
{
  "event_at":    "2026-04-20T14:22:10.111222+00:00",
  "entity_id":   "BEST_OF_BEST_SCORING_PROMPT:BoB_Ranking",
  "step_name":   "BoB_Ranking",
  "prompt_name": "BEST_OF_BEST_SCORING_PROMPT",
  "ucs":         132,
  "batches":     6,
  "target_max":  100
}
```

| Field | Type | Description |
|---|---|---|
| `ucs` | int | Number of use cases entering the BoB scoring pass (after the standard Combined/Review pass) |
| `batches` | int | Number of LLM batches (governed by `bob_scoring_batch_size`, default 25) |
| `target_max` | int | The `target_max_use_cases` parameter the subsequent trim aims for (default 100) |

#### 8.13.2 Best Of Best Ranking: Complete

- `stage_name`: `"Use Case Prioritization"`
- `step_name`: `"Best of Best Ranking"`
- `status`: `"ended_success"`
- `prompt_name`: `"BEST_OF_BEST_SCORING_PROMPT"`

```json
{
  "event_at":    "2026-04-20T14:25:48.445566+00:00",
  "entity_id":   "BEST_OF_BEST_SCORING_PROMPT:BoB_Ranking",
  "step_name":   "BoB_Ranking",
  "prompt_name": "BEST_OF_BEST_SCORING_PROMPT",
  "scored":      132,
  "total":       132
}
```

| Field | Type | Description |
|---|---|---|
| `scored` | int | Number of use cases successfully scored across D1-D19 |
| `total` | int | Number of use cases submitted for scoring (`scored < total` indicates LLM batch failures that survived the retries; those BoB-unscored use cases are excluded from selection, never kept as best-effort) |

#### 8.13.3 LLM Aggressive Consolidation: Complete

Emitted after the stratified trim that consumes the BoB scores and collapses over-populated `idea_theme` buckets.

- `stage_name`: `"Use Case Prioritization"`
- `step_name`: `"LLM Aggressive Consolidation"`
- `status`: `"ended_success"`

```json
{
  "event_at":    "2026-04-20T14:26:52.889900+00:00",
  "entity_id":   "LLM_AGGRESSIVE_CONSOLIDATION:Stratified_Trim",
  "step_name":   "Stratified_Trim",
  "before":      132,
  "after":       100,
  "target_max":  100
}
```

| Field | Type | Description |
|---|---|---|
| `before` | int | Number of use cases entering the stratified trim |
| `after` | int | Number of use cases surviving the trim (should typically equal `target_max` when over-threshold; may be larger if hard-veto survivors keep the count elevated; see Section 18 known issue) |
| `target_max` | int | Parameter used for the trim (default 100, configurable via `target_max_use_cases`) |

#### 8.13.4 Integration Notes For BoB Events

- Both events are **optional** in a session: they only fire when aggressive vetting triggers. Apps MUST tolerate sessions without these events.
- The `Best Of Best Ranking` step is idempotent and singular per session: a single started/ended_success pair.
- The `LLM Aggressive Consolidation` step may emit an `ended_warning` if the LLM-driven trim partially fails; the pipeline falls back to a deterministic score-sort trim.
- Because the BoB columns are written via `MERGE INTO` after the `ended_success` of `Best Of Best Ranking`, apps should delay any UI that depends on `bob_score` until AFTER observing the `ended_success` for `BoB_Ranking`. A short (~2s) client-side debounce is recommended to absorb Delta read-after-write latency.
- See Section 17 for the detailed scoring model, tier semantics, and recommended UI patterns.

### 8.14 Selection Events (v1.2.0)

Three step events report how the selected quality mode shaped the final portfolio. All are scoped to the `Use Case Prioritization` stage. Pipeline-level steps store a story-form `step_name` (for example `"Inspire is working on quality bar"`), so identify them by `result_json` keys rather than by parsing the text.

#### 8.14.1 Quality Bar: Zero Accepted

Emitted once, with `status = "ended_warning"`, when no use case met the bar of the selected mode. The session still completes successfully, and instead of shipping empty it returns the closest candidates labelled "below the `<mode>` bar" with their real scores and the check each missed (`Good`: candidates that passed the hard gates; `High`: Medium, then Low; `Ultra High`: near misses rejected without a fatal flaw, ranked by elite score, then High-tier), so the run is not wasted.

- `stage_name`: `"Use Case Prioritization"`
- `step_name`: `"Inspire is working on quality bar"`
- `sub_step_name`: `"Completed with caution: zero accepted"`

```json
{
  "event_at":      "2026-10-01T10:12:44.120000+00:00",
  "entity_id":     "...",
  "accepted":      0,
  "mode":          "High",
  "message":       "0 use cases met the High bar",
  "near_miss": [
    {
      "No":              "N02-AI04",
      "Name":            "Forecast Weekly Demand by Store",
      "Business Domain": "Operations",
      "Inspire Score":   6.4,
      "Quality":         "Medium",
      "bob_score":       null,
      "reason":          "quality 'Medium' is below the High bar"
    }
  ],
  "funnel_ledger": [ { "stage": "quality_filter", "in": 12, "out": 0, "drops": { "Medium": 12 } } ]
}
```

| Field | Type | Description |
|---|---|---|
| `accepted` | int | Always `0` for this event |
| `mode` | string | The canonical quality mode of the session |
| `message` | string | Human-readable outcome: `"0 use cases met the <mode> bar"` |
| `near_miss` | array | Up to 10 best-scored rejected use cases (by elite score, then Inspire Score, then `bob_score`), each with the reason it was not selected; in `Ultra High` an entry also carries `elite_score` and `failed_gates`, and its `Business Domain` comes from the clustering of the final set (empty only in a zero-elite run, where nothing is clustered) |
| `funnel_ledger` | array | The selection ledger at the time of the event (Section 11.7) |

#### 8.14.2 Selection Funnel: Ledger

Emitted with `status = "ended_success"` once selection is complete, in every mode.

- `stage_name`: `"Use Case Prioritization"`
- `step_name`: `"Inspire is working on selection funnel"`
- `sub_step_name`: `"Completed: ledger"`

```json
{
  "event_at":      "...",
  "entity_id":     "...",
  "funnel_ledger": [
    { "stage": "combined_scoring",      "in": 180, "out": 176, "drops": { "unscored": 4 } },
    { "stage": "quality_filter",        "in": 176, "out": 131, "drops": { "Low": 39, "Medium": 6 } },
    { "stage": "domain_coverage_picks", "in": 98,  "out": 99,  "drops": {} }
  ]
}
```

Each ledger entry has `stage` (string), `in` and `out` (int counts) and `drops` (object of drop reason to count; zero counts are omitted). `llm_dedup` drops are `llm_duplicate`; `phase_g_gates` and `phase_q_gates` drops are keyed by the gate that dropped them (for example `G2_name_uniqueness`, `Q1`, `Q3`), so they add up to `in - out`; `elite_overlap` drops are `duplicate` and `decision_twin` (the same decision on another channel's table). Stage names are stable identifiers such as `table_reference_filter`, `goal_alignment`, `llm_dedup`, `combined_scoring`, `quality_filter`, `bob_scoring`, `bob_hard_veto`, `stratified_trim`, `canonical_title_dedup`, `domain_coverage_picks` and `final_guard`. No mode logs a `value_scoring` stage any more (the per-domain value pass is removed). `Ultra High` sessions skip the early `domain_clustering` stage, replace the stages from `quality_filter` to `domain_coverage_picks` with the elite stages `elite_candidate_pool`, `elite_bob_prescreen`, `elite_judge`, `elite_evidence_repair`, `elite_verification`, `elite_second_opinion`, `elite_overlap`, `elite_domain_coverage` and `elite_final`, then log `final_guard` and a late `domain_clustering` (only the final set is clustered). In `Good` and `High`, the Best of Best star judge (Section 8.16) logs `best_of_best_judge`, `best_of_best_evidence_repair`, `best_of_best_verification`, `best_of_best_second_opinion` and `best_of_best_overlap` after `final_guard`; they mark use cases and never change the selection. Treat the list as open: render unknown stage names verbatim.

#### 8.14.3 Elite Selection (`Ultra High` Only)

The prompt-level events of `ULTRA_HIGH_ELITE_JUDGE_PROMPT` use the step title `"Elite Selection"` and the started message `"Inspire has started the Ultra High elite selection"`. They appear only in `Ultra High` sessions. Like every prompt event, the payload carries the base fields of Section 8; treat any further keys as tolerant JSON.

The elite stage also emits two pipeline-level events with `step_name` `"Inspire is working on elite selection"`: a `started` event, then a completion event with `status = "ended_success"` when at least one use case met the bar, or `"ended_warning"` when none did. The completion `result_json` is the elite outcome, also published as `results_json.elite_outcome` (Section 11.7):

| Field | Type | Description |
|---|---|---|
| `mode` | string | Always `"Ultra High"` |
| `elite` | int | Use cases that met the Ultra High bar |
| `coverage_picks` | int | Domain coverage picks added below the bar |
| `message` | string | For example `"3 use cases met the Ultra High bar; 1 domain coverage pick(s) ship labelled below bar"` |
| `candidate_pool` | int | Candidates that entered the elite stage |
| `judged` | int | Candidates with a valid elite judge assessment |
| `unjudged` | int | Candidates still without a valid assessment after the split retries (never selected) |
| `second_opinion_model` | string or null | The model that gave near misses their second opinion |
| `near_miss` | array | Best judged use cases below the bar, each with `failed_gates` (for example `verification`, `red_team` for a fatal flaw, `value_tier`, `score:<dimension>`, `judge_verdict`, and `second_opinion_average_below_bar` or `second_opinion_reject` when a second opinion did not confirm a near miss) and the reason, which names the fatal flaws |

#### 8.14.4 Integration Notes For Selection Events

- `Quality Bar` appears only when zero use cases were accepted. Its absence is the normal state.
- A session with a `Quality Bar` event still ships use cases: the below-bar fallback set appears in `results_json` labelled "below the `<mode>` bar", and the same zero-accepted payload (the plain notice plus the missed-check reasons) is carried under `results_json.selection_outcome`.
- Counts are reported, never targeted: there is no minimum portfolio size in any mode, and `Ultra High` has no maximum.

### 8.15 Strategy Alignment Events (v1.3.0)

Stage `Strategy Alignment` runs after selection, the feedback exclusion and the dedup review, and before Genie Code, the summary, translation and the writers. Its `STRATEGY_ALIGNMENT_PROMPT` batches report like every worker prompt (Section 8.1, step title "Aligning Use Cases to the Strategy"). The pass ends with one row, step `Strategy Alignment`, sub-step `Complete`:

```json
{
  "aligned":        14,
  "total":          20,
  "gaps":           2,
  "fallbacks":      0,
  "sponsor_roster": {"kept": 11, "owns": 6, "parent": 2, "root": 1}
}
```

| Field | Meaning |
|---|---|
| `aligned` / `total` | Final use cases with at least one evidenced alignment, out of all final use cases |
| `gaps` | Strategy entries no data-backed use case supports |
| `fallbacks` | Use cases that kept placeholder KPIs and benefits after the retries; when above 0 the row is `ended_warning` and `results_json.failed_steps` gets a `Strategy Alignment` entry |
| `sponsor_roster` | Use cases per sponsor assignment method when the strategy has a sponsor roster (`{}` without one): `kept` (the sponsor was already a roster role), `owns` (the roster role that owns the aligned entry), `parent` (the owner of the nearest parent entry), `domain` (the owner of the business domain), `llm_pick` (the model's pick, limited to roster ids), `root` (the top of the roster) |

The pass never adds or removes a use case; the agent stops with an error if the set changed.

### 8.16 Best of Best Events (v1.3.0)

Right before `Strategy Alignment`, Inspire stars up to N final use cases as Best of Best. N comes from widget `16_best_of_best_count` (0 to 100), else from the generation instructions, else 20. Stars are only marked when the catalog holds more than N use cases; a smaller catalog is already the short list, so nothing is judged and `short_list` is `true`. A use case is starred only when it passed every test of the Ultra High elite judge (value tier, the four dimensions at 8 or more, verified columns and joins, the red team, a second opinion for a near miss); the highest elite scores win, the best of each user business domain first, and no domain takes more than a quarter of the stars while others still have passing use cases. In `Ultra High` the stars reuse the selection's verdicts; in `Good` and `High` the judge runs on copies of the final use cases, so their scores and order never change, and every use case that passes keeps the verified assessment in `elite_assessment` (with no `elite_status` or `elite_score`, so the Good and High exports keep their columns), which the Genie notebook card, the Genie Code instruction and the job schedule read. After the final numbering, one row is written: stage `Use Case Prioritization`, step `Best of Best`, `ended_success` (or `ended_warning` when nothing passed), with this `result_json`:

```json
{
  "target":    20,
  "source":    "default",
  "mode":      "Good",
  "short_list": false,
  "judged":    84,
  "passed":    2,
  "starred":   2,
  "ids":       ["N03-U01", "N01-U04"],
  "near_miss": [{"No": "N02-U02", "Name": "...", "Business Domain": "Pricing", "best_of_best_score": 7.9, "reason": "did not pass: evidence strength score (score:evidence_strength)"}]
}
```

| Field | Meaning |
|---|---|
| `target` / `source` | The number asked for, and where it came from: `widget`, `generation instructions` or `default` |
| `short_list` | `true` when the catalog holds N or fewer use cases, so nothing was judged or starred |
| `judged` / `passed` | Use cases the elite judge scored, and how many passed every test |
| `starred` / `ids` | Use cases starred, at most `target` and at most `passed`; ids in star order |
| `near_miss` | Up to 10 judged use cases that failed a test, by elite score, each with the test it failed |

When the star judge fails, a `Best of Best` entry goes to `results_json.failed_steps`, the run continues and no use case is starred. The same object is published as `results_json.best_of_best` and in the JSON catalog.

## 9) `widget_values` JSON Schema

Stored in `__inspire_session.widget_values` at session initialization. This captures all input parameters:

```json
{
  "business":                    "Contoso",
  "inspire_database":            "my_catalog._inspire",
  "operation_mode":              "Discover Use Cases",
  "table_election_mode":         "Let Inspire Decides",
  "use_cases_quality":           "Good",
  "discovery_type":              "Deep",
  "strategic_context":           "",
  "best_of_best_count":          "",
  "generation_instructions":     "Focus on fraud detection, join orders with customers on customer_id",
  "business_priorities":         "Increase Revenue,Optimize Operations",
  "business_domains":            "Sales,Marketing,Finance",
  "catalogs":                    "my_catalog",
  "schemas":                     "my_catalog.sales,my_catalog.marketing",
  "tables":                      "",
  "generate":                    "Genie Code Instructions,PDF Catalog",
  "generation_path":             "./../demos/inspire_gen/",
  "output_language":             "English",
  "technical_exclusion_strategy": "Aggressive",
  "json_file_path":              "",
  "session_id":                  "1234567890000000003"
}
```

| Field | Type | Description |
|---|---|---|
| `business` | string | Business/company name for the analysis |
| `inspire_database` | string | Target catalog.schema for result tables (e.g. `my_catalog._inspire`) |
| `operation_mode` | string | `"Discover Use Cases"` or `"Generate Use Cases"` |
| `table_election_mode` | string | `"Let Inspire Decides"`, `"All Tables"`, or `"Transactional Only"` |
| `use_cases_quality` | string | Canonical quality mode: `"Good"`, `"High"`, or `"Ultra High"` (legacy labels are stored as their canonical mode); see 9.2 |
| `discovery_type` | string | v1.3.0, widget `03_discovery_type`. From v1.4.0: `"Standard Discovery"` (default; aggregates decide each use case and none reaches the AI) or `"AI Enhanced Discovery"` (the AI also sees the aggregates). The v1.3.0 values `"Standard"` and `"Deep"` (also `"Deep Discovery"`, `"AI Enhanced"`) are still accepted and mapped. Matching is case-insensitive; an empty value means `"Standard Discovery"`; any other value stops the run |
| `strategic_context` | string | v1.3.0, widget `10_strategic_context`: the raw widget text, inline JSON or a Workspace or Volumes path starting with `/`; empty for none. The parsed tree is stored in the session column `strategic_context` and in `results_json.strategic_context` |
| `best_of_best_count` | string | v1.3.0, widget `16_best_of_best_count`: empty (20, or the number in the generation instructions) or a whole number from 0 to 100; any other value stops the run |
| `technical_exclusion_strategy` | string | Always `"Aggressive"`: technical and system tables are always filtered out; no other strategy is accepted |
| `generation_instructions` | string | Free-text instructions parsed by AI into structured directives; see 9.1 |
| `business_priorities` | string | Comma-separated priorities (e.g. `"Increase Revenue,Optimize Operations"`) |
| `business_domains` | string | Comma-separated top-level domains (Inspire discovers subdomains) |
| `catalogs` | string | Comma-separated Unity Catalog catalog names |
| `schemas` | string | Comma-separated catalog.schema paths |
| `tables` | string | Comma-separated catalog.schema.table paths (when user-selected) |
| `generate` | string | Comma-separated artifact types to produce |
| `generation_path` | string | Workspace path for output artifacts |
| `output_language` | string | Comma-separated output languages (e.g. `"English,Arabic"`) |
| `json_file_path` | string | Optional: path to pre-existing JSON catalog for docs-only mode |
| `generate_genie_code_for` | string | Widget `13_generate_genie_code_for`: how many use cases get Genie Code during Discover, by final rank (a non-negative integer or `all`, default `0`); `0` means no use case in any mode, and any other value gives every elite use case in `Ultra High` (Section 17.H) |
| `session_id` | string | User-provided or auto-generated session ID |

### 9.1 `generation_instructions`: Context Categories (v0.7.0+)

The **single** `08_generation_instructions` widget is a free-form textarea the user fills to steer generation. An LLM (`GENERAL_INSTRUCTION_INTERPRETER_PROMPT`) extracts **seven categories** from it. Zero new widgets; user writes naturally. If the user didn't mention a category, it's left empty and the pipeline runs as-if not provided.

| # | Category | Extracted As | Example User Phrase | Downstream Effect |
|---|---|---|---|---|
| 1 | **Table Joins** | list of `{left_table, right_table, join_columns, join_type}` | "join orders with customers on customer_id" | Genie Code prompts treat tables as pre-joined |
| 2 | **Goal Setting** | `{has_goal, goal_description, strategic_goal_match}` | "focus on fraud detection" | Goal Alignment Filter removes UCs that don't serve the goal |
| 3 | **Forced Techniques** | list of `{technique, context}` | "use XGBoost for all classification" | Generator prefers the named technique |
| 4 | **Table Ignores** | list of `{pattern, type}` | "ignore tables starting with __log" | Filter prompt rejects matching tables as TECHNICAL |
| 5 | **Construct Exclusions** *(v0.7.0)* | list of strings | "we don't have a loyalty program", "no NPS survey data" | Any UC referencing excluded constructs is rejected in Review + Combined scoring |
| 6 | **Change-Management Posture** *(v0.7.0)* | `conservative` / `balanced` / `experimental` / `crisis-response` | "we're conservative about production changes" | Conservative → every Solution names a rollback trigger; experimental → every Solution names a pilot scope |
| 7 | **Data Characteristics** *(v0.7.0)* | `{table_name: description}` | "claims table has no labeled fraud outcomes" | Technique selection respects these: no supervised ML on un-labeled tables |

**App UI guidance:** do NOT add one widget per category. Keep the single textarea and allow the user to type naturally. The interpreter LLM disambiguates.

**Verifying extraction:** query the `__inspire_step` table where `prompt_name = 'GENERAL_INSTRUCTION_INTERPRETER_PROMPT'`; `result_json` contains the extracted categories.

**Goals and the quality bar:** a goal sets the scope and alignment of the portfolio. Goal-aligned use cases are scored high on strategic alignment and are never penalized for domain or technique balance, but a goal never exempts a use case from the quality bar of the selected mode.

### 9.2 `use_cases_quality`: Quality Mode Contract (v1.2.0)

The `05_use_cases_quality` notebook parameter selects the quality mode. All modes run the same broad generation pass and differ only in selection.

| Canonical Value | Selection |
|---|---|
| `Good` (default) | Keeps use cases with Quality `Medium`, `High`, `Very High` or `Ultra High`; Best-of-Best ranking and, for very large sets, the stratified theme trim |
| `High` | Keeps use cases with Quality `High`, `Very High` or `Ultra High`; same ranking and trim |
| `Ultra High` | High-or-better candidates (plus a high-value second look) go through the elite stage; only use cases that clear the absolute elite bar are kept; no quota, no cap |

**Accepted legacy labels** (behavior-preserving, matched case-insensitively after trimming spaces):

| Input | Runs As |
|---|---|
| `Coverage Mode (All)` | `Good` |
| `Balanced` | `Good` |
| `Good Quality` | `Good` |
| `High Quality` | `Good` |
| `Strict Quality` | `High` |
| `Very High Quality` | `High` |

**Contract rules:**

1. `Ultra High` is reached only by sending `"Ultra High"` (any case). No legacy label maps to it.
2. An empty value runs the default `Good`.
3. Any other value fails widget validation before the pipeline starts. The run exits with a message that names the value, the valid options and every accepted legacy label, for example: `'Use Cases Quality' (05_use_cases_quality): Use Cases Quality 'Premium' is not supported. Valid options: 'Good', 'High', 'Ultra High'. Accepted legacy labels: ...`.
4. Inspire stores the canonical value: `__inspire_session.use_cases_quality`, `widget_values.use_cases_quality` and `__inspire_usecases.quality_mode` always hold `Good`, `High` or `Ultra High`, never a legacy label.
5. The keep-all behavior of the retired `Coverage Mode (All)` no longer exists; that label now runs as `Good`.

**App guidance:** offer exactly `Good`, `High` and `Ultra High`. Apps that still send legacy labels keep working unchanged.

## 10) `inspire_json` Schema

Updated on each flush. Contains intermediate pipeline metadata:

**During run:**

```json
{
  "last_flush": "2026-03-01 18:15:45"
}
```

**On completion (same as `results_json`):**

See Section 11.

## 11) `results_json`: Final Output Catalog Schema

When the pipeline completes, `results_json` contains the full use case catalog. This is the primary output for downstream consumption.

```json
{
  "business_name":     "Contoso",
  "title":             "Contoso Use Cases Catalog",
  "executive_summary": "This document outlines 42 high-value analytical use cases...",
  "domains_summary":   "Customer Analytics: 12 use cases, Revenue Optimization: 8 use cases, ...",
  "column_registry":   { "<column_id>": "<catalog.schema.table.column>, <description>" },
  "table_registry":    { "<table_id>": "<catalog.schema.table>" },
  "metadata": {
    "catalogs":        ["my_catalog"],
    "schemas":         ["my_catalog.sales", "my_catalog.marketing"],
    "generation_path": "./../demos/inspire_gen/"
  },
  "domains": [
    {
      "domain_name": "Customer Analytics",
      "summary":     "Domain: Customer Analytics with 12 use cases",
      "use_cases":   [ "<use_case_object>", "..." ]
    }
  ]
}
```

### 11.1 Top-Level Fields

| Field | Type | Description |
|---|---|---|
| `business_name` | string | Company/business name |
| `title` | string | Catalog title (`"<business_name> Use Cases Catalog"`) |
| `executive_summary` | string | AI-generated executive summary text |
| `domains_summary` | string | Comma-separated domain counts (e.g. `"Customer Analytics: 12 use cases, ..."`) |
| `column_registry` | object | Map of column IDs to `"<FQN>, <description>"` strings |
| `table_registry` | object | Map of table IDs to fully-qualified table names |
| `metadata` | object | Input metadata (catalogs, schemas, generation_path) |
| `domains` | array | Array of domain objects, each containing use cases |
| `funnel_ledger` | array | *(v1.2.0)* Selection ledger, one entry per stage; see 11.7 |
| `selection_outcome` | object | *(v1.2.0)* Present only when 0 use cases met the bar of the selected mode; see 11.7 |
| `elite_outcome` | object | *(v1.2.0)* `Ultra High` only: the elite stage outcome; see 11.7 |
| `failed_steps` | array | *(v1.2.0)* Present only when an artifact step failed; see 11.8 |
| `translation_gaps` | object | *(v1.2.0)* Present only when a translated document kept text in English; see 11.8 |
| `metadata_unavailable` | object | *(v1.2.0)* Always present: `count` and `tables` (`table`, `reason`) for every table whose metadata could not be loaded; see 11.8 |
| `llm_endpoint_health` | object | *(v1.2.0)* Always present: `unusable` (endpoint → reason), `temperature_unsupported` and `probed` endpoint lists, and from v1.3.0 `json_format` (endpoints that passed the strict JSON output check) and `demoted` (endpoints moved to the end of every cascade after 3 timeouts in the run); see 11.8 |
| `discovery_type` | string | *(v1.3.0)* `AI Enhanced Discovery` or `Standard Discovery` from v1.4.0 (`Deep` or `Standard` before); a docs-only run reports the type the catalog was built with (`Standard Discovery` for catalogs written before v1.3.0) |
| `data_access` | object | *(v1.3.0)* What was read: `discovery_type`, `tables_read` (sorted names), `tables_read_count`, `statements`, `statements_by_status`, `tables_skipped` (table → `denied`, `timeout`, `cancelled` or `failed`; a skipped table stays Standard), `pii_columns_excluded`, `seconds`, `rows_sent_to_ai` (always 0) and from v1.4.0 `aggregates_sent_to_ai` (`false` in Standard Discovery, whose reads only decide the use cases) |
| `usage_signals` | object | *(v1.3.0)* `available`, `reason` (when not available), `tables_with_reads`, `co_used_pairs`, `metric_views` |
| `strategic_context` | object | *(v1.3.0)* The tree the run aligned to: `source` (`customer` or `builtin`), `levels`, `strategy` (entries with `id`, `name`, `level`, `kpis`, `key_results`, `children`), `priorities`, `sponsors`, `labels` |
| `strategy_coverage` | object | *(v1.3.0)* `source`, `levels`, `use_cases`, `aligned`, `not_aligned`, `entries` (per entry: `id`, `path`, `level`, `use_cases` including children, `direct`), `gaps` (entries no data-backed use case supports), `priorities` (per priority: `priority`, `use_cases`) and `priority_gaps` |
| `foundations` | array | *(v1.3.0)* Shared data foundations in rank order: `id` (`F1` ...), `rank`, `name`, `tables`, `joins` (`left`, `right`, `source`: `foreign key` or `observed in queries`), `use_cases`, `use_case_count`, `summed_inspire_score`. No dates or durations |
| `delivery_order` | array | *(v1.3.0)* Use case ids, foundation first, then by Inspire Score |
| `portfolio_history` | array | *(v1.3.0)* Feedback carried from earlier runs: `use_case_key`, `title`, `status`, `reason`, `session_id` (decimal text, or null), `updated_at`, `primary_table` |
| `excluded_by_feedback` | array | *(v1.3.0)* Use cases dropped because the user rejected them; the same fields plus `use_case_id` |
| `value_tracking` | array | *(v1.3.0)* Implemented use cases: `use_case_key`, `title`, `kpi`, `baseline`, `current` (`{value, measured_on}`), `change`, `query`, `status` (`measured`, `query_only` or `unavailable`) |
| `ailogs_check` | object | *(v1.3.0)* The run-end `[AILOGS CHECK]` report on the AI call log |
| `best_of_best` | object | *(v1.3.0)* The Best of Best outcome (Section 8.16): `target`, `source`, `mode`, `short_list`, `judged`, `passed`, `starred`, `ids` (starred use case ids in star order) and `near_miss` |

### 11.2 `column_registry` Schema

Maps short IDs to full column info. Used for compact storage: use case fields reference column IDs instead of full names.

```json
{
  "c001": "my_catalog.sales.orders.order_id, Unique order identifier",
  "c002": "my_catalog.sales.orders.customer_id, FK to customers table",
  "c003": "my_catalog.sales.orders.total_amount, Order total in USD"
}
```

### 11.3 `table_registry` Schema

Maps short IDs to fully-qualified table names:

```json
{
  "t001": "my_catalog.sales.orders",
  "t002": "my_catalog.sales.customers",
  "t003": "my_catalog.marketing.campaigns"
}
```

### 11.4 `metadata` Schema

```json
{
  "catalogs":        ["my_catalog"],
  "schemas":         ["my_catalog.sales", "my_catalog.marketing"],
  "generation_path": "./../demos/inspire_gen/"
}
```

### 11.5 Domain Object Schema

```json
{
  "domain_name": "Customer Analytics",
  "summary":     "Domain: Customer Analytics with 12 use cases",
  "use_cases":   []
}
```

### 11.6 Use Case Object Schema (within `domains[].use_cases[]`)

Each use case object contains the full lifecycle of fields: from generation through scoring to instructions:

```json
{
  "No":                          "1",
  "Name":                        "Forecast Monthly Revenue with Economic Context",
  "short_name":                  "Monthly Revenue Forecast",
  "Business Domain":             "Customer Analytics",
  "Subdomain":                   "Revenue Forecasting",
  "type":                        "Risk",
  "Analytics Technique":         "Forecasting",
  "Statement":                   "The business lacks visibility into future revenue trends...",
  "Solution":                    "Leverage Databricks AI capabilities to build a forecasting model...",
  "Business Value":              "Enables proactive planning with 15-20% improvement in forecast accuracy...",
  "Beneficiary":                 "CFO, Revenue Operations Team",
  "Sponsor":                     "Chief Financial Officer",
  "Business Priority Alignment": "Increase Revenue",
  "Tables Involved":             "t001, t002",
  "Primary Table":               "t001",
  "Quality":                     "Very High",
  "Priority":                    "Very High",
  "Technical Design":            "CTE1: SELECT DISTINCT + LIMIT 10. CTE2: simulated external data...",
  "result_table":                "`catalog`.`schema`.`_inspire_n01_u01_revenue_forecast_monthly`"
}
```

| Field | Type | Present | Description |
|---|---|---|---|
| `No` | string | Always | Unique use case identifier (e.g. `"1"`, `"42"`) |
| `Name` | string | Always | Description (long-form use case statement) |
| `short_name` | string | Always | Use Case (short, assertive business title) |
| `Business Domain` | string | After domain clustering | Top-level business domain |
| `Subdomain` | string | After subdomain detection | Refined subdomain within the domain |
| `type` | string | Always | Category: `"Problem"`, `"Risk"`, `"Opportunity"`, or `"Improvement"` |
| `Analytics Technique` | string | Always | e.g. `"Forecasting"`, `"Classification"`, `"Anomaly Detection"` |
| `Statement` | string | Always | Problem/opportunity statement |
| `Solution` | string | Always | Proposed solution using Databricks capabilities |
| `Business Value` | string | Always | Expected business impact |
| `Beneficiary` | string | Always | Role/team that benefits |
| `Sponsor` | string | Always | Executive sponsor role |
| `Business Priority Alignment` | string | After scoring | Which business priority this aligns to |
| `Tables Involved` | string | Always | Comma-separated table IDs (references `table_registry`) |
| `Primary Table` | string | After processing | First table from Tables Involved |
| `Quality` | string | After scoring | Quality label: `"Ultra High"`, `"Very High"`, `"High"`, `"Medium"`, `"Low"`, `"Very Low"`, `"Ultra Low"` |
| `Priority` | string | After scoring | Priority label (same scale as Quality) |
| `Technical Design` | string | Always | CTE-level technical design hint for instruction generation |
| `result_table` | string | After processing | Quoted three-level result table name, `` `catalog`.`schema`.`_inspire_<id>_<name>` `` (placeholder `` `main`.`_inspire` `` without an Inspire Database) |
| `Strategy Alignment` | array | *(v1.3.0)* After selection | Up to 2 `{id, path, evidence}` alignments |
| `Strategy Path` | string | *(v1.3.0)* After selection | Aligned paths joined with `; `, `Not aligned` with a customer strategy, empty with the built-in goals and no match |
| `KPIs` | array | *(v1.3.0)* After selection | KPI specs (Section 2.3.1, column `kpis`) |
| `Expected Key Results` | array | *(v1.3.0)* After selection | `{id, statement, kpi_id, source}` with `source` `strategy` or `proposed` |
| `Measures of Success` | array | *(v1.3.0)* After selection | Up to 3 strings |
| `Financial Benefits` | array | *(v1.3.0)* After selection | Up to 3 strings; figures only from the user or a measured baseline |
| `Non-Financial Benefits` | array | *(v1.3.0)* After selection | Up to 3 strings |
| `Data Evidence` | object | *(v1.3.0)* Deep only | `tables` (per table `rows`, `sampled`, `date_ranges`) and `joins` (observed match rates) |
| `Foundations` | array | *(v1.3.0)* After foundations | Ids of the foundations the use case belongs to |
| `Feedback Status` | string | *(v1.3.0)* With feedback | `accepted`, `planned` or `implemented` from `__inspire_feedback` |
| `use_case_key` | string | *(v1.3.0)* Always | Stable identity across runs (Section 2.3.1) |
| `best_of_best` | string | *(v1.3.0)* After marking | `Y` or `N` (Section 8.16) |
| `best_of_best_rank` | int | *(v1.3.0)* Starred only | Star rank from 1 |
| `best_of_best_score` | number | *(v1.3.0)* Judged only | Elite score out of 10 |
| `best_of_best_reason` | string | *(v1.3.0)* After marking | Why it is starred, or the test it failed |
| `_source_session_id` | string | Use cases picked for Genie Code | The session of the use case row, as decimal text; catalogs written by earlier versions hold a number, which the agent reads back as the same digits |

`results_json` holds the English use cases. In translated documents, Inspire-written KPI names and proposed key results are translated, and the customer's own KPI names and key results keep their wording.

**Notes:**
- `Tables Involved` and `Primary Table` may contain either column/table registry IDs (e.g. `"t001"`) or full FQNs depending on whether ID compression was applied.
- Fields like `generated` and `validated` are intentionally excluded from the JSON output (they are tracked in notebooks only).
- PDF/PPT catalogs intentionally hide `Quality Reasons` while retaining quality score/label.

### 11.7 `funnel_ledger`, `selection_outcome` And `elite_outcome` (v1.2.0)

`funnel_ledger` lists every selection stage in pipeline order. It is published in every session that reaches selection:

```json
[
  { "stage": "llm_dedup",         "in": 214, "out": 192, "drops": {} },
  { "stage": "combined_scoring",  "in": 180, "out": 176, "drops": { "unscored": 4 } },
  { "stage": "quality_filter",    "in": 176, "out": 131, "drops": { "Low": 39, "Medium": 6 } },
  { "stage": "bob_hard_veto",     "in": 131, "out": 124, "drops": { "D16": 5, "D13": 2 } },
  { "stage": "final_guard",       "in": 99,  "out": 99,  "drops": {} }
]
```

| Field | Type | Description |
|---|---|---|
| `stage` | string | Stable stage identifier; treat the set as open and render unknown names verbatim |
| `in` | int | Use cases entering the stage |
| `out` | int | Use cases leaving the stage |
| `drops` | object | Drop reason → count, for reasons with a non-zero count |

`selection_outcome` is present only when 0 use cases met the bar. It carries the same payload as the `Quality Bar` step (Section 8.14.1): `accepted` (0), `mode`, `message`, `near_miss` and `funnel_ledger`. Render it as a valid below-bar result, not an error: the run shipped the closest candidates labelled "below the `<mode>` bar" with the check each missed, under a plain "no use case met the bar" notice.

`elite_outcome` is present in every `Ultra High` session that reaches selection, including a zero-elite outcome. It carries the payload of the `Elite Selection` completion event (Section 8.14.3): `mode`, `elite`, `coverage_picks`, `message`, `candidate_pool`, `judged`, `unjudged`, `second_opinion_model` and `near_miss`.

#### 11.7.1 Ultra High Run-To-Run Stability

`Ultra High` keeps only use cases that clear an absolute bar, so the elite set is **not** a fixed-size list and is **not guaranteed identical across re-runs of the same inputs**. Both the size of the elite set and its borderline members vary run to run. Two things drive this: the broad generation pass is an LLM, so the candidate pool differs between runs, and the elite judge itself samples the candidates it accepts. That sampling cannot be pinned down because the judge endpoint rejects the `temperature` parameter and so cannot be forced to be deterministic; across the release pairs the judge's acceptance rate ranged from 15% to 38% of candidates, and the same `tpcds_sf1` corpus returned 13 and 11 elites on build `33f73ed`, 35 and 30 on build `ef38882`, and 8 on the final build `a5ae0a9`.

Measured on repeat runs, idea-level overlap (same decision and outcome, ignoring the wording of the title) was about **17-18%**: the two `bakehouse` runs shared **2 ideas** out of 7 and 7, and the two `tpcds_sf1` reruns shared **10 ideas** out of 35 and 30. The highest-scored picks recur; the borderline picks turn over. Integrator guidance:

- Do not key UI state, links or cached records on the elite `id` set, or on the elite count, being the same between two sessions; match on the use case's decision and owning domain, and treat the highest-scored picks as the stable anchor.
- When a stable shortlist matters, run `Ultra High` twice and intersect the results; ideas present in both runs are the durable core.
- `elite_outcome.elite` is the count for that session only; render it as an observed result, never as a target the next run will reproduce.

### 11.8 `failed_steps`, `translation_gaps`, `metadata_unavailable` And `llm_endpoint_health` (v1.2.0)

`failed_steps` and `translation_gaps` are absent when nothing failed. `metadata_unavailable` and `llm_endpoint_health` are always present. Any failed step, translation gap or lost table (`metadata_unavailable.count > 0`) makes the final `Inspire pipeline completed` event `ended_warning` (Section 8.1); the session still completes. Lost tables are also named in an `ended_warning` `Metadata Load` step under the `Data Preparation` stage (`result_json`: `count`, `tables`).

```json
{
  "metadata_unavailable": {
    "count": 1,
    "tables": [ { "table": "cat.sch.ledger", "reason": "timeout after 3 attempt(s): metadata query timed out" } ]
  },
  "llm_endpoint_health": {
    "unusable": { "databricks-example-endpoint": "Endpoint databricks-example-endpoint is not supported for batch inference" },
    "temperature_unsupported": ["databricks-other-endpoint"],
    "probed": ["databricks-example-endpoint", "databricks-other-endpoint"]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `metadata_unavailable.count` | int | Number of tables (or schemas, `catalog.schema.*`) whose metadata could not be loaded; they are not analysed |
| `metadata_unavailable.tables[].table` | string | The table, or `catalog.schema.*` / `catalog.*.*` when a whole schema or catalog listing failed |
| `metadata_unavailable.tables[].reason` | string | Why it could not be loaded, at most 300 characters |
| `llm_endpoint_health.unusable` | object | Endpoint → reason for every endpoint that cannot serve `ai_query`; every cascade skips it |
| `llm_endpoint_health.temperature_unsupported` | array | Endpoints that reject the temperature parameter; their calls run at the endpoint's default sampling |
| `llm_endpoint_health.probed` | array | Endpoints probed at startup |
| `llm_endpoint_health.json_format` | array | *(v1.3.0)* Endpoints that returned valid JSON with a strict JSON `responseFormat` at startup; only these get `responseFormat` on the JSON prompts |
| `llm_endpoint_health.demoted` | array | *(v1.3.0)* Endpoints that timed out 3 times in the run (runtime key `llm_endpoint_demote_after_timeouts`), in the order they were demoted; every cascade tries them after the other endpoints for the rest of the run |

```json
{
  "failed_steps": [
    { "step": "Presentation", "language": "French", "error": "Presentation (French) cannot be generated: 'pip install python-pptx' failed with exit code 1" },
    { "step": "Tracking Table", "language": "", "error": "..." }
  ],
  "translation_gaps": {
    "French": { "use_cases": 2, "untranslated_use_cases": 1, "fields": { "Coverage Pick Reason": 1, "Statement": 2 } }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `failed_steps[].step` | string | `PDF Catalog`, `Presentation`, `Use Case Excel`, `CSV Catalog`, `Markdown Catalog`, `JSON Catalog`, `Language Pack`, `Tracking Table`, `Tracking Table Setup`, `Tracking Table Migration`, `Generate Lock` (Generate mode ran without the per-business lock: another session held it, or the lock table could not be read or written), `Implement Use Cases` (the Implement Use Cases operation failed for some of its use cases but not all; `error` names the failed ones, `__inspire_implement` holds each one's status and message, and the run fails when every one failed) or, from v1.3.0, `Strategy Alignment` (the alignment pass failed, or use cases kept placeholder KPIs and benefits after the retries; the use cases keep their data-only scores), `Route 1 scan` (Generate mode could not read the flagged rows of the tracking table) or `Route 2 scan` (Generate mode could not list or export a notebook, or look up a marked notebook's tracking row) |
| `failed_steps[].language` | string | The document language, or `""` for a language-independent step |
| `failed_steps[].error` | string | The error, at most 300 characters |
| `translation_gaps.<language>.use_cases` | int | Use cases with at least one field still in English in that language's documents |
| `translation_gaps.<language>.untranslated_use_cases` | int | Use cases whose translation failed entirely (shown in English) |
| `translation_gaps.<language>.fields` | object | Field → number of use cases where it stayed in English |

Each step is recorded once per language. The same keys are written in JSON (docs-only) runs. The non-English PDF and presentation flag every use case with English text ("Shown in English (translation unavailable)", translated). Scores, BoB fields and `elite_assessment` are never translated: its decision, owner, KPI, value driver, evidence columns, join path, build path and red-team note stay in English in the Excel and CSV catalogs and in each Genie notebook's `0. Use-case card` cell, and the PDF and presentation do not show them. Of the elite fields only `coverage_pick_reason` is translated.

## 12) Polling Queries

**Get session:**

```sql
SELECT *
FROM <inspire_db>.__inspire_session
WHERE session_id = :session_id
LIMIT 1;
```

**Get step delta (new steps since last poll):**

```sql
SELECT *
FROM <inspire_db>.__inspire_step
WHERE session_id = :session_id
  AND last_updated > :last_seen_last_updated
ORDER BY last_updated, step_id;
```

**ACK after render:**

```sql
UPDATE <inspire_db>.__inspire_session
SET processing_status = 'done'
WHERE session_id = :session_id
  AND processing_status = 'ready';
```

**Check if pipeline is complete:**

```sql
SELECT completed_on, completed_percent, results_json
FROM <inspire_db>.__inspire_session
WHERE session_id = :session_id
  AND completed_on IS NOT NULL
LIMIT 1;
```

**Get final catalog output:**

```sql
SELECT results_json
FROM <inspire_db>.__inspire_session
WHERE session_id = :session_id
  AND completed_on IS NOT NULL
LIMIT 1;
```

**Get all steps for a session (audit trail):**

```sql
SELECT
    step_id,
    stage_name,
    step_name,
    sub_step_name,
    progress_increment,
    message,
    status,
    result_json,
    last_updated
FROM <inspire_db>.__inspire_step
WHERE session_id = :session_id
ORDER BY last_updated, step_id;
```

**Get error steps only:**

```sql
SELECT *
FROM <inspire_db>.__inspire_step
WHERE session_id = :session_id
  AND status = 'ended_error'
ORDER BY last_updated;
```

**Get use case counts from step events:**

```sql
SELECT
    result_json:prompt_name::STRING AS prompt,
    SUM(result_json:use_cases_count::INT) AS total_use_cases
FROM <inspire_db>.__inspire_step
WHERE session_id = :session_id
  AND status = 'ended_success'
  AND result_json:use_cases_count IS NOT NULL
GROUP BY result_json:prompt_name::STRING;
```

## 13) UI Implementation Rules

1. **Upsert step rows** by `step_id`: a `started` event and its matching `ended_*` event share the same `step_id`.
2. **Sort order**: by `last_updated` ASC, then `step_id` ASC.
3. **Display hierarchy**: show timeline from `stage_name` → `step_name` → `sub_step_name` → `message`. Never expose raw prompt names to users.
4. **Keep warning/error rows** visible in history: do not auto-dismiss them.
5. **Stop active polling** when `completed_on IS NOT NULL`.
6. **Progress bar**: bind to `__inspire_session.completed_percent`. Do not accumulate `progress_increment` client-side (the server is authoritative).
7. **Flush gating**: the 2-second flush interval means step events arrive in batches, not real-time. Design your UI to handle batch updates gracefully.
8. **Tolerant JSON parsing**: always check for key existence in `result_json` before accessing. Fields vary by phase and may be absent on errors.

## 14) Pipeline Phase Sequence

This is the expected order of phases. Some phases run in parallel (marked with `||`).

```
Phase 1: Initialization & Context
  ├── Pipeline Start
  ├── Database Setup
  ├── Business Context Extraction
  ├── Generation Instructions Interpretation (if provided)
  └── Table Filtering & Classification

Phase 2: Use Case Generation
  ├── Comprehensive Discovery Pass (structured + AI/ML + statistical), one pass for every quality mode
  └── Goal Alignment Filter (if instructions contain a goal)

Phase 3: Domain Clustering (sequential)
  ├── Domain Finder
  ├── Subdomain Detector
  ├── Domain Merger
  ├── Subdomain Merger
  └── Domain Splitter

Phase 4: Scoring, Deduplication & Selection (v1.2.0)
  ├── LLM Deduplication (REVIEW_USE_CASES_PROMPT: 5-layer semantic, no regex)
  ├── Combined Value + Quality Scoring (single LLM pass; enforces all 19 gates D1-D19;
  │     a UC without a valid score is never selected)
  ├── Quality Bar of the selected mode
  │     ├── Good        → keep Medium / High / Very High / Ultra High
  │     ├── High        → keep High / Very High / Ultra High
  │     └── Ultra High  → High-or-better candidates (+ high-value second look) to the elite stage
  │
  ├── Good / High
  │     ├── Best Of Best Ranking (BEST_OF_BEST_SCORING_PROMPT)        [v0.7.2]
  │     │     ├── Score each UC across D1-D19 (tier1 D1-D11,
  │     │     │                                 tier2 D12-D14,
  │     │     │                                 tier3 D15-D19)
  │     │     ├── Name idea themes of all scored UCs in one call (THEME_ASSIGNMENT_PROMPT) [v1.3.0]
  │     │     └── Hard-vetoed and BoB-unscored UCs dropped
  │     ├── count > aggressive_prune_threshold (default 75)
  │     │     └── LLM Aggressive Consolidation / Stratified Trim       [v0.7.2]
  │     │           ├── Group UCs by idea_theme
  │     │           ├── Enforce bob_theme_max_share (default 0.15) per theme
  │     │           └── Cap = target_max_use_cases + jitter (default 91-110)
  │     └── Canonical-title dedup
  │
  ├── Ultra High: Elite Selection (ULTRA_HIGH_ELITE_JUDGE_PROMPT)        [v1.2.0]
  │     ├── BoB prescreen (hard veto out)
  │     ├── Elite judge + deterministic metadata verification
  │     ├── One uncached evidence repair re-judge when verification rejects only the judge's citations
  │     ├── Absolute bar (no quota, no cap); near misses get one second opinion,
  │     │     promoted only when the averaged scores reach the bar
  │     └── Overlap dedup keeps the stronger elite; same-decision twins collapse
  │
  ├── Domain coverage picks (every mode): one pick per empty user-specified domain,
  │     labelled "Domain coverage pick, below bar"
  ├── No recovery, no top-up. 0 met bar → Quality Bar event + selection_outcome
  │     + below-bar fallback set (closest candidates, labelled "below the <mode> bar")
  └── Selection Funnel event (funnel_ledger); final ordered set hands off to Phase 5

Phase 5: Notebooks and Genie Code Instructions (v1.2.0)
  ├── Skeleton notebook for every use case (Discover), with its Genie prompt fields captured
  └── Auto-Genie: Genie Code for the top-N by final rank (widget 13), or every elite use case in Ultra High;
        strict reference and numeric-claim validation with one uncached repair; a Genie notebook replaces
        the skeleton only when the instruction is emitted (Section 17.H)

Phase 6: Summary & Artifacts
  ├── Executive Summary
  ├── Notebook Generation (per domain)
  ├── PDF / Excel Generation
  ├── Genie Code Regeneration: Route 1 / Route 2 (PARALLEL, v0.7.3)  [concurrency = genie_regen_parallelism, default 10]
  └── JSON Catalog (→ populates results_json)

Phase 7: Translation (if multi-language)
  ├── Keywords Translation
  └── Use Case Translation (per language × per domain)

Pipeline Complete
  └── Finalize (completed_percent = 100, completed_on set)
```

> **v0.7.3 Note On Phase 6 Parallelism:** Genie Code Regeneration (Route 1 DB-flag and Route 2 notebook-flag) now runs concurrently with `genie_regen_parallelism` workers (default 10). Step events for regenerated UCs arrive as they complete, so the `(idx/total)` counters in `sub_step_name` / `message` may appear out of order (e.g., `7/30` may land after `8/30`). Apps rendering a progress timeline for regeneration should sort by `last_updated` and treat `(idx/total)` as identity/metadata, not a monotonic sequence. Overall `completed_percent` remains monotonic: it is server-authoritative and aggregated across workers.

## 15) Error Handling & Edge Cases

| Scenario | What Happens | What Your App Sees |
|---|---|---|
| AI prompt fails after all retries | `ended_error` step emitted | `status = "ended_error"`, `result_json.error` contains truncated message |
| AI prompt returns empty | `ended_warning` step emitted | `status = "ended_warning"`, step continues |
| AI prompt requires rebatching | `ended_warning` + retry with smaller batch | Brief warning step, then new started/ended pair |
| Genie Code instruction generation fails | Retry via fallback model | Additional step pair for retry |
| Pipeline crashes | `ended_error` on pipeline, `completed_on` set | `completed_percent` may be < 100, `results_json` may still contain partial output |
| No inspire_database provided | Console-only mode, no Delta writes | No tracking tables created; cannot integrate |

## 16) Quick-Start Integration Checklist

- [ ] Create a polling loop that checks `__inspire_session` every 5 seconds
- [ ] Implement the READY/DONE handshake (read steps → render → ACK)
- [ ] Bind progress bar to `completed_percent`
- [ ] Parse `stage_name`, `step_name`, `sub_step_name`, `message` for display
- [ ] Color-code steps by `status` (blue/green/amber/red)
- [ ] Handle `result_json` as tolerant JSON (check keys before access)
- [ ] On `completed_on IS NOT NULL`, read `results_json` for final catalog
- [ ] Parse `results_json` using Section 11 schema to hydrate your UI
- [ ] Use `column_registry` and `table_registry` to resolve IDs in use case fields
- [ ] Keep error/warning steps visible in the timeline for auditability
- [ ] *(v0.7.2)* Handle NULL for `idea_theme` and all four `bob_*_score` columns gracefully
- [ ] *(v0.7.2)* Render `bob_score == 2.0` with a hard-veto warning badge: apply only to legacy v0.7.2 session replay (see Section 17.D)
- [ ] *(v0.7.2)* Treat `idea_theme` as free-form text, not an enum
- [ ] *(v0.7.2)* Recognize the `Best Of Best Ranking` and `LLM Aggressive Consolidation` step events and render friendly labels
- [ ] *(v0.7.3)* Accept non-round portfolio sizes: final count lands in the `90-110` range by default; do not assert exactly 100
- [ ] *(v0.7.3)* Handle both single- and multi-language artifact filenames (`readme*.md`, `<business>-dbx_inspire*.xlsx`); see Section 19.7
- [ ] *(v0.7.3)* Tolerate out-of-order `(idx/total)` step events during parallel Genie regeneration: sort by `last_updated`, do not rely on counter monotonicity
- [ ] *(v0.7.3)* Read `target_max_jitter` and `genie_regen_parallelism` from `inspire_json` in admin/debug UIs (see Section 17.C)
- [ ] *(v1.2.0)* Offer the quality modes `Good`, `High` and `Ultra High`; read `use_cases_quality` as one of those three (Section 9.2)
- [ ] *(v1.2.0)* Render `results_json.selection_outcome` / the `Quality Bar` event as a valid below-bar result, not an error: the closest candidates ship labelled "below the `<mode>` bar" with the missed-check reasons, under a plain "0 use cases met the bar" notice (Sections 8.14, 11.7)
- [ ] *(v1.2.0)* Accept any portfolio size, including very small ones: no mode pads to a minimum and `Ultra High` has no maximum
- [ ] *(v1.2.0)* Handle NULL in `quality`, `quality_mode`, `elite_status`, `elite_score`, `elite_assessment` and `selection_flags`; render `elite_status = 'DOMAIN_COVERAGE_PICK'` as "Domain coverage pick, below bar"

## 17) BoB Scoring And Idea Themes (v0.7.2+)

Best Of Best (BoB) scoring is a deterministic, tier-weighted refinement pass that fires only when Inspire has produced an abundance of use cases and must aggressively consolidate them before handing off to Phase 5 (Genie Code Instruction generation). This section is the authoritative integrator reference.

### 17.A Schema Overview

Five columns were added to `__inspire_usecases` in v0.7.2. All are nullable: rows predating v0.7.2, or sessions in which BoB did not run, will have `NULL` in every column.

| Column | Type | When Populated | Semantics |
|---|---|---|---|
| `idea_theme` | STRING | When aggressive vetting fires (UC count > `aggressive_prune_threshold`, default 75) | LLM-assigned 2-4 word analytical archetype (e.g. "Anomaly Detection", "Demand Forecasting"). May be NULL/empty for sessions where aggressive vetting did NOT fire. |
| `bob_score` | DOUBLE | Same As Above | Composite 0-10 score. A value of exactly `2.0` is a hard-veto floor sentinel (at least one gate scored below 3). **v0.7.3+: hard-veto UCs are dropped BEFORE the stratified trim, so `bob_score = 2.0` should be rare-to-impossible in the final portfolio for new sessions. Legacy v0.7.2 sessions may still contain them.** |
| `bob_tier1_score` | DOUBLE | Same As Above | Mean of D1-D11 individual gate scores (technical grounding) |
| `bob_tier2_score` | DOUBLE | Same As Above | Mean of D12-D14 individual gate scores (business value) |
| `bob_tier3_score` | DOUBLE | Same As Above | Mean of D15-D19 individual gate scores (PBA sign-off) |

Migration is idempotent (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), so apps reading these columns MUST handle NULL for older session rows without error.

### 17.B Gate Taxonomy (D1-D19)

The BoB scoring prompt evaluates each use case along 19 independent gates, grouped into three tiers. Apps do not receive per-gate scores in the final table (only tier means), but the step-event payload may surface them under `result_json.gates` if debug telemetry is enabled.

| Tier | Gates | Dimension | Column |
|---|---|---|---|
| Tier 1 | D1-D11 | Technical Grounding (data availability, column fit, join feasibility, technique applicability, feature engineering, training data existence, production readiness, latency, evaluation, monitoring, cost) | `bob_tier1_score` |
| Tier 2 | D12-D14 | Business Value (economic impact, strategic fit, beneficiary clarity) | `bob_tier2_score` |
| Tier 3 | D15-D19 | PBA Sign-Off (problem articulation, solution articulation, sponsorship, change-management posture, risk transparency) | `bob_tier3_score` |

The composite `bob_score` is a weighted mean (Tier 1: 0.5, Tier 2: 0.3, Tier 3: 0.2), clamped to the hard-veto floor of 2.0 if any individual gate score drops below 3.

### 17.C Runtime Parameters

These parameters are inspectable via `__inspire_session.widget_values` (the verbatim user input layer) and `__inspire_session.inspire_json` (the resolved pipeline parameters). Apps building admin/debug UIs can surface them to explain BoB behavior and portfolio-size outcomes to stakeholders.

| Parameter | Default | Range | Controls |
|---|---|---|---|
| `aggressive_prune_threshold` | 75 | int, 50-500 | Trigger threshold for BoB; when running UC count > this, BoB fires |
| `target_max_use_cases` | **90** *(v0.7.3: base; was 100 in v0.7.2)* | int, 10-500 | Post-trim target base; the effective ceiling is `target_max_use_cases + random(0..target_max_jitter)` |
| `target_max_jitter` *(v0.7.3)* | **20** | int, 0-100 | Random additive jitter applied to `target_max_use_cases` each run; default yields portfolios in the `90-110` range |
| `bob_theme_max_share` | 0.15 | float, 0.05-0.50 | Max fraction of surviving UCs that can share one `idea_theme` |
| `bob_scoring_batch_size` | 25 | int, 5-100 | Batch size for the BoB scoring LLM calls |
| `genie_regen_parallelism` *(v0.7.3)* | **10** | int, 1-50 | Concurrency for every Genie Code wave: Discover auto-Genie and Route 1/2 regeneration. Not exposed as a widget; set via runtime config |

`discover_auto_genie_top_n` (v0.7.7 to v1.1.x) is removed in v1.2.0: the number of use cases that get Genie Code during Discover comes from the widget `13_generate_genie_code_for` (`widget_values.generate_genie_code_for`: a non-negative integer or `all`, default `5`, `0` disables), and `Ultra High` ignores it (Section 17.H).

**Reading Runtime Params:**

```sql
SELECT
    inspire_json:aggressive_prune_threshold::INT AS threshold,
    inspire_json:target_max_use_cases::INT       AS target_max_base,
    inspire_json:target_max_jitter::INT          AS target_max_jitter,
    inspire_json:bob_theme_max_share::DOUBLE     AS theme_share,
    inspire_json:bob_scoring_batch_size::INT     AS batch_size,
    inspire_json:genie_regen_parallelism::INT    AS genie_regen_parallelism,
    widget_values:generate_genie_code_for::STRING AS genie_code_for
FROM <inspire_db>.__inspire_session
WHERE session_id = :sid;
```

### 17.D Known Integration Considerations

1. **Free-Form Theme Labels.** `idea_theme` is LLM-generated free-form text. Apps MUST NOT assume a fixed enum. From v1.3.0 one call names the themes of a whole run, so within a session one idea carries one name; two sessions can still name the same idea differently, and sessions written before v1.3.0 can hold near-duplicates (v0.7.2 produced ~75 distinct themes across 100 UCs). Apps that build theme filters should use `COUNT DISTINCT idea_theme` dynamically, not a hardcoded list.

2. **Hard-Veto Sentinel (Legacy v0.7.2 Sessions Only).** A `bob_score` of exactly `2.0` is a flag value meaning the hard-veto floor was hit: at least one of D1-D19 scored below 3. **v0.7.3+: the stratified trim drops hard-veto UCs before trimming, so `bob_score = 2.0` survivors should be rare-to-impossible in new sessions.** Apps SHOULD still handle the sentinel defensively for older (v0.7.2) session data. See Section 17.F for the legacy warning-badge UI pattern.

3. **BoB Did Not Run.** A session in which the post-filter UC count stayed at or below `aggressive_prune_threshold` will have `NULL` in all 5 new columns. This is expected and not an error. Apps SHOULD render a neutral "not scored" state rather than `0.0` or a missing row.

4. **Read-After-Write Latency.** The BoB columns are written in a single `MERGE INTO` after the `Best Of Best Ranking` `ended_success` event. Delta may exhibit brief read-after-write latency; apps should debounce ~2s before re-querying `__inspire_usecases` after observing that event.

5. **Non-Round Portfolio Sizes (v0.7.3+).** Portfolios are no longer exactly `target_max_use_cases`. The v0.7.3 default lands in the `91-110` range thanks to `target_max_jitter`. Apps that previously hardcoded "exactly 100" must accept varying counts. See Section 17.C and Section 19.6. **v1.2.0:** that range applies only when the stratified trim fires in `Good` or `High`; smaller portfolios are delivered as they are (nothing is recovered or topped up), and `Ultra High` has no cap.

### 17.E Recommended Integration Queries

**Top 10 UCs By BoB Score Per Session:**

```sql
SELECT id, business_domain, idea_theme, bob_score,
       bob_tier1_score, bob_tier2_score, bob_tier3_score, use_case
FROM <inspire_db>.__inspire_usecases
WHERE session_id = :sid
ORDER BY bob_score DESC NULLS LAST
LIMIT 10;
```

**Theme Distribution:**

```sql
SELECT idea_theme,
       COUNT(*)                AS ucs,
       ROUND(AVG(bob_score),2) AS avg_bob
FROM <inspire_db>.__inspire_usecases
WHERE session_id = :sid AND idea_theme IS NOT NULL
GROUP BY idea_theme
ORDER BY ucs DESC;
```

**Hard-Veto Survivors (If Any):**

```sql
SELECT id, idea_theme, use_case
FROM <inspire_db>.__inspire_usecases
WHERE session_id = :sid AND bob_score <= 2.01;
```

**Check If BoB Ran For A Session:**

```sql
SELECT
  CASE WHEN COUNT(bob_score) > 0 THEN 'yes' ELSE 'no' END AS bob_ran,
  COUNT(*)          AS total_ucs,
  COUNT(bob_score)  AS with_bob
FROM <inspire_db>.__inspire_usecases
WHERE session_id = :sid;
```

**Tier Decomposition For Leaderboards:**

```sql
SELECT id, use_case, idea_theme,
       bob_score         AS composite,
       bob_tier1_score   AS tech,
       bob_tier2_score   AS value,
       bob_tier3_score   AS pba
FROM <inspire_db>.__inspire_usecases
WHERE session_id = :sid AND bob_score IS NOT NULL
ORDER BY bob_score DESC, bob_tier1_score DESC
LIMIT 25;
```

**Join Step Events With BoB Table To Reconstruct The Trim:**

```sql
SELECT
    s.result_json:before::INT  AS ucs_before_trim,
    s.result_json:after::INT   AS ucs_after_trim,
    u.idea_theme,
    COUNT(u.id)                AS survivors
FROM <inspire_db>.__inspire_step s
CROSS JOIN <inspire_db>.__inspire_usecases u
WHERE s.session_id = :sid
  AND u.session_id = :sid
  AND s.step_name = 'Stratified_Trim'
  AND u.idea_theme IS NOT NULL
GROUP BY s.result_json:before::INT, s.result_json:after::INT, u.idea_theme
ORDER BY survivors DESC;
```

### 17.F Recommended UI Patterns

**1. `bob_score` Badge (0-10 Scale).** Render as a pill with tiered coloring:

| Score Range | Color | Label Guidance |
|---|---|---|
| `NULL` | Neutral gray | "Not Scored": BoB did not run |
| `== 2.0` *(legacy v0.7.2 only)* | Red with warning icon | "Hard Veto": surface the audit-log link |
| `2.01 to 4.99` | Amber | "Marginal" |
| `5.00 to 7.99` | Yellow-Green | "Strong" |
| `8.00 to 10.0` | Green | "Flagship" |

> **v0.7.3 Note:** The `== 2.0` row applies only to OLDER session data persisted under v0.7.2. New v0.7.3+ sessions drop hard-veto UCs before the stratified trim, so the red "Hard Veto" badge should not fire for new portfolios. Keep the code path for backward compatibility with archived sessions.

**2. `idea_theme` Chip.** Render as a rounded text chip next to the UC title. Because the vocabulary is currently unbounded, assign colors by hashing the theme string (stable across refreshes). Once the planned canonicalization pass ships, apps may switch to a curated palette.

**3. Hard-Veto Flag (Legacy v0.7.2 Sessions).** When `bob_score == 2.0`, stack a small triangular warning badge on the UC card AND insert an info tooltip: "This use case hit a hard-veto floor during Best Of Best scoring. At least one quality gate scored below the acceptable threshold. Review the Phase 4 step events for which gate fired." This pattern is only expected to fire for legacy v0.7.2 sessions: v0.7.3+ removes hard-veto survivors at trim time.

**4. Tier Progress Bars.** For detail views, render three horizontal bars (Tier 1 / Tier 2 / Tier 3) each at `score / 10`. This communicates where a UC is strong vs weak at a glance.

**5. Phase 4 Timeline Entry.** When rendering step events, group `Best Of Best Ranking` and `LLM Aggressive Consolidation` under a collapsible "Fine-Grained Prioritization (v0.7.2)" sub-section of the Use Case Prioritization stage.

**6. Empty State For Non-BoB Sessions.** If `COUNT(bob_score) = 0` for the session, DO NOT render empty score badges. Instead render a one-line explanation: "BoB scoring was not required; this session produced ≤ 75 use cases."

### 17.G BEST_OF_BEST_SCORING_PROMPT And Its Place In The Flow

When integrators observe step events with `prompt_name = "BEST_OF_BEST_SCORING_PROMPT"`, render the user-facing text:

> "Inspire is ranking use cases by every quality gate for fine-grained prioritization."

This text is intentionally business-friendly. Do NOT expose the raw prompt name, tier numbers, or gate identifiers (D1-D19) in primary UI surfaces. They are acceptable in advanced/debug views.

### 17.H Discover Auto-Genie: Top-N By Final Rank, Every Elite In Ultra High (v1.2.0)

At the end of Discover, Inspire writes a skeleton notebook for every use case and then generates Genie Code instructions for a selected set, without waiting for a Route 1 or Route 2 regeneration.

**Which use cases get Genie Code:**

| Quality mode | Genie Code targets | Notes |
|---|---|---|
| `Good`, `High` | The top-N by final rank (the same order as the ids: domain coverage picks after every other use case, then elite score or Inspire Score, `bob_score` and Priority, highest first) | N comes from the widget `13_generate_genie_code_for`: a non-negative integer or `all` (default `0`, which disables it; anything else is logged and treated as `0`) |
| `Ultra High` | Every use case with `elite_status = 'ELITE'` | Only when the widget is not `0`; the count itself is not applied. Domain coverage picks and any other use case keep their skeleton notebook |

With the default `0`, Discover writes no Genie Code in any mode: every use case gets a skeleton notebook, and `Start Use Case MVP with Genie` in the Inspire App writes a use case's Genie Code notebook on demand (Route 1 with that use case flagged).

The Genie Code pass of a docs-only (JSON) run with `Operation = Generate Use Cases` does not read the widget: in `Ultra High` only elite use cases get Genie Code and the others get skeleton notebooks, and a fallback selection gets Genie Code for every below-bar pick. Route 1 and Route 2 regeneration always regenerate exactly the use cases the user flagged.

**Joins:** an instruction lists the foreign keys of the tables it cites, declared or inferred from column names, and a table that holds its time only as a key to a date table gets that date table under TABLES (`[GENIE-DATE-TABLES FIRED]`). A Route 1 or Route 2 regeneration infers the joins again over the tables of its run's scope, once per schema (`[SCOPE-JOINS FIRED]`), so it lists the same joins as Discover; before, a regenerated instruction on tables without declared foreign keys listed none.

**Validation:** every instruction is checked against live Unity Catalog metadata (tables and columns it cites) and for invented figures. In `Ultra High` the check is strict: a failing instruction gets one uncached repair attempt and is not emitted if it still fails (`genie_instruction_status = 'failed_validation'`). In `Good` and `High` an instruction with unresolved references is emitted with `genie_instruction_status = 'validation_errors'` and a warning cell in the notebook. A Genie notebook replaces the skeleton only when an instruction is emitted.

**Integrator-visible effects:**

- After a fresh Discover, rows of the session with `has_genie_code = 'Y'` are the use cases whose Genie notebook was written; the others are `'N'`. Both are written by the session replace at the end of the run (Section 2.3.1), not by per-row updates.
- One step event closes the auto-Genie pass:
  - `stage_name = "Discover Skeletons"`
  - `step_name = "Auto-Genie (Top-N)"` in `Good` and `High`, `"Auto-Genie (Elite Use Cases)"` in `Ultra High`
  - `sub_step_name = "Complete"`
  - `status = "ended_success"` when every target was validated against live metadata and written, otherwise `"ended_warning"`
  - `result_json` includes `selection` (the rule above, in words), `top_n` (the number of targets), `success`, `failed`, `ids` (Genie notebooks written), `statuses` (count per `genie_instruction_status`), `validated_ids`, `notebooks_written_ids`, `failed_validation`, `validation_errors` and `notebook_write_failed`.

**Example: Genie coverage of a session:**

```sql
SELECT session_id,
       COUNT(*) AS total_ucs,
       SUM(CASE WHEN has_genie_code IN ('Y','Yes') THEN 1 ELSE 0 END) AS with_genie,
       SUM(CASE WHEN has_genie_code IN ('N','No') OR has_genie_code IS NULL THEN 1 ELSE 0 END) AS skeleton_only,
       SUM(CASE WHEN elite_status = 'ELITE' THEN 1 ELSE 0 END) AS elite
FROM <inspire_db>.__inspire_usecases
WHERE session_id = :sid
GROUP BY session_id;
```

In `Good` or `High` with the default widget, expect `with_genie <= 5`; in `Ultra High`, expect `with_genie <= elite`. A target whose instruction failed validation or whose notebook could not be written keeps its skeleton, so `with_genie` can be lower than the number of targets; the step event above names each one.

### 17.I Genie Code Notebooks (v1.2.0, three Inspire cells from v1.3.0)

**Location:** one notebook per use case at `<generation_path>/<business>/notebooks/<Business Domain>/<Subdomain>/<id> - <Use Case Name>.ipynb` (names sanitized). The notebooks root also holds `AGENTS.md`, the instructions Genie Code reads for every notebook in the folder. Inspire never overwrites a notebook that was edited after it wrote it: the new notebook is written beside it as `<name> (regenerated <timestamp>)` and a warning is logged. An edited `AGENTS.md` is kept unchanged.

**Skeleton notebook** (a use case without a Genie Code instruction): a stub with the use-case details and a marker cell holding `INSPIRE_USE_CASE_ID`, `INSPIRE_SESSION_ID` and `generate_genie_code_instruction = False`. Setting the flag to `True`, or setting `generate_genie_code_instruction = 'Yes'` on the tracking row, and running Inspire with `Operation = Generate Use Cases` regenerates it (Route 2 and Route 1).

**Genie notebook** (an instruction was emitted): four cells written by Inspire.

| Cell | Type | Content |
|---|---|---|
| 1 | markdown | `# <id>: <name>`, the `★ Best of Best #N` line for a starred use case, and a short card: What it does, Decision (decision, owner and cadence) and KPI (with its direction), each only when the elite assessment found it, Data (the tables read) and Output (the business output table); then a one-line disclaimer and the line "Copy the cell below into Genie Code without the surrounding quotes (the `r"""` and `"""` lines), and let Genie Code implement it."; the notebook fingerprint is an HTML comment, so it does not show |
| 2 | code | The Genie Code instruction as a Python raw string, so the cell runs as a no-op. Names Inspire could not verify are listed first; the KPIs, expected key results and read-only KPI queries are appended when the run defined them |
| 3 | code | Number helpers, directly above Run controls: the tested `is_missing`, `fmt_num`, `fmt_count`, `fmt_rank` and `keep_reasons` that write every number in the notebook's text. Genie Code calls them inside the steps `run_use_case()` runs and never defines its own. The cell sits below Genie Code's `%pip` cell, which restarts Python, so a job run still has them |
| 4 | code | Run controls, always the last cell: the `JobLauncher`, an `Execution` widget (`As job` by default, or `Here`) and `inspire_main()` as the cell's last line. `inspire_main()` runs `run_use_case()`, which Genie Code builds; before Genie Code has built it, `inspire_main()` prints that nothing ran. With `As job` the cell creates or updates the notebook's persistent job `dbx_inspire_ai_<slug>_<hash8>` (one concurrent run, queued, a paused schedule at the decision cadence), runs it with the notebook's widget values and `dbx_inspire_ai_child_run = 1`, waits up to 30 minutes and stops the interactive run. The job carries the tags `dbx_inspire_ai_business`, `dbx_inspire_ai_usecase`, `dbx_inspire_ai_session_id`, `dbx_inspire_ai_launcher_source`, `dbx_inspire_ai_run_type` (`training` for families A to D, `analysis` otherwise) and `dbx_inspire_ai_notebook`. In the job run (marker 1) and with `Here`, `inspire_main()` runs `run_use_case()` in place; a launch that fails runs it in place with a printed note that the run is not tagged. `run_use_case()` returns the run's outcome; `inspire_main()` prints it as `Use case outcome: ...` and ends the run with `dbutils.notebook.exit`, whose value is the outcome (`wrote N row(s) for as_of_date D with run_id R` or `stopped without writing: <reason>`) followed by a blank line, `Printed log of this run:` and everything `run_use_case()` printed, capped at 100,000 characters (the first fifth and the last four fifths kept), because a cell that calls `dbutils.notebook.exit` loses its printed output in a job run. The launching run prints `The tagged job run finished: <outcome>` and exits with `Job run finished: <outcome>. Results table: <table>. Run: <link>` followed by the job run's log, or says that the job run returned no outcome; a job run still running after the wait exits with the wait and its link |

The user copies cell 2 into Genie Code. Genie Code reads only the instruction, adds its cells between the instruction and the Number helpers, puts each build step in a function and defines `run_use_case()`, which runs the steps in order, writes every step the instruction lists in full before the first run, never a stub or a branch that prints its work as done, runs the notebook on serverless compute and fixes its own code, running it again after a failed run, until the notebook runs from top to bottom. Only imports, function definitions, the `%pip` cell (the first cell below the instruction) and the Parameters widgets run at top level, so a run of the whole notebook runs the use case once, through `inspire_main()`. The instruction has 8 sections (goal, data, parameters, readiness check, build steps, method and acceptance, business output, definition of done) and ends with Platform Rules written by Inspire: every business output column's type and meaning and each tier's action text, in the words the instruction writer reads, which win where the instruction's business output section says otherwise, the serverless limits, one Spark action per expensive step with its small result collected to pandas once (serverless has no cache), vectorized work instead of a pandas loop per entity, fact tables aggregated to the entity and period before a join, more than 50 independent series or units fitted, scored or tested with `groupBy(...).applyInPandas(...)`, never in a driver loop over event rows moved to pandas, the Spark Connect type casts (`Decimal` cast before `toPandas()`, `first()` or `collect()`; keys, ranks and counts stay integers), ratios that survive serverless's ANSI mode (`try_divide`, `try_cast`, and inf replaced with NaN in the numeric columns only, after the last step that derives a feature), `*_pdf` and `*_sdf` frame names, `itertuples()` rows read by field (`row.name`), ARRAY values from `toPandas()` counted with `len()` and never tested as a condition, rows whose group key is missing labeled in a new column before they are grouped (on serverless environment 4, pandas 2.2.3 cannot count, list or select the groups of a one-key groupby with `dropna=False` when a key is missing), a fact about the whole run, such as a test flagging every series, tested with `if` and never used as a `.loc` row key or joined to a row mask with `and` or `or`, the index reset after a step that adds rows, per-group result frames built from an explicit column list, per-group samples taken as a seeded shuffle followed by `groupby(key).head(n)` (never `groupby(key).sample(n=...)`, which raises on a group smaller than n), each step keeping every column a later step reads, no window or aggregate nested in an aggregate, joins that leave each column name once (a list of key names only when every key has that name on both sides, shared non-key columns renamed or dropped first, the key of a frame joined to a frame built from it, such as a cross join of its distinct keys, renamed first, columns read after a SQL join qualified with their table alias, a key that can be NULL matched with `eqNullSafe`, and the rows that matched read from a flag the other side adds before the join, never from its dropped key, and frames stacked with `unionByName` over one column list selected from each), Spark conditions parenthesized before `&` and `|`, combined with `functools.reduce` and given to `F.when` as Columns, never as a column name, the rows that meet a condition counted with `F.count_if`, which gives 0 where a sum of the condition gives NULL, a window function computed as a column before a filter, a join condition or a HAVING clause reads it, an expression a fix supersedes deleted, since Spark Connect analyzes a frame only at its first action and a later `drop()` never removes it, lookups that read a side with one row per key and assert that the frame kept its row count, windows over earlier or later dates as range frames on the date as a day number (`rangeBetween(Window.unboundedPreceding, -1)` for the earlier dates; a rows frame also counts the other rows of the same date), a leakage check on the dates each step read (every feature date before the row's anchor date, every outcome date after it, every training window and its outcome horizon before the holdout, never a window left out of training, a statistic computed over the fit window, such as a peer median or an alert threshold, tested on the holdout and scored rows that read it, never on the fit rows it came from, and a window's first and last day taken from the dates its rows hold, never the holdout against the scored rows, so the scoring population is never cut to pass it), never a second computation of the values, every date read from a DATE or TIMESTAMP column, through the date table a key joins when a table holds its time as a key (Inspire lists that date table under TABLES), periods judged complete on each table's own dates before any filter, for the supervised-scoring and analytical-refresh patterns (scoring, survival, cohort, funnel, trend and the other group comparisons) the definition of a closed outcome window (its last day plus the horizon before `as_of_date`, a window labeled by its first day, such as a month, tested on its last day, never its label, with open horizons censored, never labeled negative, a closed window with no event labeled 0, never the NULL that `F.sum`, `F.max`, `F.min` and `F.avg` return over an empty frame, a survival quantile the curve never reaches longer than the follow-up, never NULL, and a date built from it stated as the earliest, and training on the anchors of every earlier window whose horizon ends before the holdout, the most recent closed window, never only each entity's latest), for the recommendation, network and optimization methods one `scipy.sparse` matrix scaled by a product with `scipy.sparse.diags`, never by assigning its rows, which stores every element of a row assigned from a dense array, numbers in text written by Inspire's number helpers, which Genie Code calls and never defines: `fmt_num` rounds to 3 significant figures before it picks K, M or B (`< 0.001` for small p- and q-values), and the notebook writes a ratio with its unit (% for a share of at most 1, x for a larger ratio, never a percent such as '2.35K%'), with a count's noun agreeing with it ('1 prior order', '2 prior orders', '1 day since the last order', also where the instruction words it 'N days') through `fmt_count`, which rejects a negative count, ranks written by `fmt_rank` ('21,302nd', never '21.3Kth', 'unknown' for a missing rank and an error for an average rank, so ties are ranked with `method='min'` or `method='first'`), every helper accepting a missing number, pandas' NA and NaT among them, which `is_missing` finds without ever calling a text missing, a difference that can fall on either side of zero worded by its sign ('freight 216 below the lane peer median', never 'excess freight of -216'), with a fact whose number is missing left out of the text and a check before the write that no reason or action holds the word 'unknown', 'inf', 'None', 'nan' or 'NaT', the text '<NA>' or a negative number and no key, label or segment holds 'None', 'nan', 'NaT', '<NA>' or an empty part (each word of a check matched case-sensitively, so a name such as 'Nan Gil' or a category such as 'Unknown' passes) and no reason, never the action, holds a second number after a comma or semicolon, shares and concentrations of a measure that can be negative analyzed by sign (a group with a negative total on its losses, with the side named in the share's own reason), for the patterns that register a model the baseline's own score as `value` when no candidate passes acceptance (its estimate of the use case's own quantity when it makes one, such as an uplift from its prediction with the treatment set to 1 minus its prediction with it set to 0, never a constant such as 0 or the class rate) and every row Monitor when the baseline itself misses the acceptance thresholds, every model fitted, evaluated and scored on one list of feature columns with no repeated name and at least one feature that every row it scores has and that takes many values, such as the days since the last event, read as its number also when a step bins it (another arm, such as the untreated arm of an uplift model or of its baseline, scored on a copy with that arm's columns set before the selection, and a column cast to pandas' category dtype only in the frame the model reads) and the MLflow 2 registration call (keyword arguments only, a pyfunc wrapper subclassing `PythonModel`, the new version read from the returned model info and asserted before the write on the accepted model's rows), each library called as the version its `%pip` line pins defines it, the cast of every business output column to the contract types (an existing table whose column type differs is converted and rewritten once), with `w.astype(object).where(pd.notna(w), None)` as the last change before the write, since a column assigned after it turns None back into NaN, the rule that no fit, score, forecast, simulation or `ai_query` step is called on an empty input, for the scoring patterns the rule that a classifier trains only on rows with at least `min_positives` examples of each class, the rule that significance tests run on observed or deseasonalized values and never on a smoothed series, the rule that a test, rate or mean computed once per unit takes its minimum sample from the test (the smallest sample at which either extreme outcome reaches significance after the multiple-test correction, never a round number, at least 5) unless a readiness threshold sets it, is gated by that minimum only (never also by the size of a cohort or segment the unit belongs to, with readiness counting units and groups by the same rows, filters and minimum as the step that tests them, and the count compared with a minimum being the sample the test computes on, for both samples of a comparison, and the minimum computed once, by one function, for readiness, the test and the reasons), leaves the units below it untested, flagged and Monitor, with reasons that give their count and the minimum, never a test result, never stops the run when no unit reaches it, and shrinks each unit's rate or mean toward its baseline before it shapes the rank (the model writing the instruction reads this rule too), the rule that the explanation's `ai_query` prompt passes the row's computed facts and only asks the model to word them and that the summary's prompt holds formatted facts, each over the rows it names, with a missing group named ('no carrier', never 'nan') and a missing fact left out or named for why it is missing, never 'unknown', and the rule to keep the Run controls cell unchanged as the last cell, in a cell of its own when the notebook is written as a source file, build `run_use_case()` from the step functions, print each step's elapsed seconds and return the run's outcome from it, never call `dbutils.notebook.exit` in its own cells, check each test run by that outcome, pass the Execution widget's name, `execution`, to each test run it submits, run one test at a time from one command that lists the active runs with `--expand-tasks` and cancels every run of the notebook's path, with retries off (`max_retries` 0 and `disable_auto_optimization` true), check that the final rows carry the run_id the outcome returned and delete the rows of earlier test runs by their run_id, use `Here` while building and testing, and set `As job` again at the end. The parameters section lists the widgets the notebook creates first, each with its default; the notebook reads every threshold and limit from them, so it also runs as a job with parameters. The `as_of_date` default `latest` is the earliest of the newest dates of the event tables the features and the outcome read, so no feature is empty because one table ends earlier; the first step of `run_use_case()` resolves it, never the Parameters cell, because every top-level statement runs in the session and again in the job run. Its readiness check covers the family's thresholds and the use case's runtime assumptions (the data shapes the elite judge found the use case depends on and metadata cannot prove, each one of `KEY_HAS_REPEATED_ROWS`, `KEY_HAS_SINGLE_ROWS`, `COLUMN_HAS_TWO_VALUES` or `COLUMN_HAS_VALUES`). When a readiness check fails, the notebook prints the measured and required values and writes nothing, except data freshness, which writes the forecast from the newest data with every row flagged `data ends <newest date>`. What happens when acceptance fails depends on the execution pattern: the patterns that register a model print "No approved model yet", register no model and write the baseline's rows (every row Monitor when the baseline also misses the thresholds); a forecast publishes the seasonal naive forecast instead; a group comparison never stops at acceptance and makes the tested findings that are not significant Monitor, with 'not significant' in their top reasons and `data_quality_flag` 'ok', while an entity below its per-unit minimum is untested and its reasons give its count and the minimum; AI text processing stops and writes nothing when its error rate is above `max_ai_error_rate`; an optimization prints "No better plan found" and writes the current plan, every row Monitor. The acceptance rule is the one Inspire states for the pattern; the instruction never adds a criterion to it. A statistical result never goes into `data_quality_flag`, which holds a row's own input problems and the flag of a failed run-wide check, never a property every row of the population has by its definition (an outcome window still open on every scored row is stated once in the summary), is never NULL (it is set on the final frame after its last merge, before the rank step), and flagged rows rank after the unflagged ones: `rank` comes from one asserted `rank_rows` helper that puts the rows that pass the decision test first and the 'ok' rows before the flagged ones, each group by impact compared at 6 significant figures and then the entity key, sorting on `data_quality_flag == 'ok'` as a boolean, never the flag text, and returning its ranks on its inputs' index, and the notebook checks that order before the write. `value` is the result of the row's own entity, never a value of its group, and NULL on a row the method computes no result for, never 0 or the baseline in its place, and each row is one entity at the grain of the use case's entity key column (or one entity with one of its items or periods, that item or period then leading `segment_or_item`, so no two rows share `entity_id` with `segment_or_item`, which is checked before the write, a repeat fixed by leading `segment_or_item` with that item or period and never by aggregating the rows to the entity, and breaks the rank's ties), never a segment's finding, which the summary step reports; every entity of the population the decision acts on keeps its row, flagged and in the Monitor tier when the method cannot score it, while a row missing any part of its row key, such as a sale without a store for a store-item row, is dropped before every step. `top_reasons` holds at most 3 distinct facts the row has, built by Inspire's `keep_reasons` helper, one fact per reason (a comparison's reference after ', against', and a test's result as its own reason), never a repeated reason, a count another reason already gives, filler text, a reason about a value the row lacks or a reason that is the same on every row, and gives a score whose scale a reader cannot judge, such as a PageRank or an anomaly score, as its rank by that score alone among every row that has the score, flagged rows among them, that count being the total it states ('12th of 4,000 senders by influence'), never the row's own rank, and a row without a score states no such rank (pandas' default `na_option='keep'`, never 'bottom' or 'top'); a unit below the test's minimum states its count and the minimum, never a test result, and no other reason of its row, such as its rate, states that count again, and a row the test skipped for a missing input never states them, so the step adds that reason only to the rows below the minimum, first among their facts, and asserts it; a row's own value is never a reason by itself, only with the reference it is compared against, and a reference for a missing group key names the rows it covers. A share of a two-signed measure names its side, and a row of the other sign states its own amount, never a 0% share, which the step that writes the shares asserts on each share's number, never on the reason's text; a count that can be missing is held as pandas' nullable `Int64`, a comparison of such a column is filled before it picks rows, a missing-value test treats inf as missing only on a number and never calls `float()` on text, a ratio of Python numbers is computed only on a positive denominator, and every `json.dumps` passes a `default` that converts numpy values. The instruction names the AI endpoint for `ai_query` (the first selectable worker endpoint) and tells Genie Code to call it with `failOnError => false` and without a temperature.

**Execution families:** every Analytics Technique maps to exactly one family in the technique registry (`TECHNIQUE_EXECUTION_FAMILY`); an unknown technique runs as family F and logs `[TECHNIQUE_UNKNOWN]`.

| Family | Pattern | Techniques |
|---|---|---|
| A | Supervised scoring: trains on closed outcome windows, registers the accepted model as `champion`, scores the open cases | Classification, Predictive Modeling, Survival Analysis |
| B | Anomaly scoring: fits on a reference window, registers the accepted detector, scores the current window | Anomaly Detection |
| C | Segmentation: an assignable model, registered when accepted | Clustering, Segmentation |
| D | Recommendation: checked against popularity on a time-based holdout, registered when accepted | Recommendation |
| E | Forecasting: single run, backtested against the seasonal naive forecast, nothing registered | Forecasting, Lifetime Value |
| F | Analytical refresh: effect sizes with corrected significance | Trend Analysis, Correlation Analysis, Pareto Analysis, Cohort Analysis, Funnel Analysis, Regression Analysis, Geospatial Analysis, Network Analysis, AI Analysis, Decomposition, Peer Benchmarking |
| G | AI text processing: the newest rows up to the as-of date, rewritten on every run, Databricks AI functions | Sentiment Analysis, Document Processing, Extraction |
| H | Optimization and simulation | Optimization, Simulation, Threshold Optimization |
| I | Impact measurement: effects with confidence intervals and corrected significance against a control or pre-period, nothing registered | Causal Impact, Uplift Modeling, Marketing Mix Modeling |
| J | Process and sequence analysis: paths, transitions and waits from event rows, nothing registered | Process Mining, Sequence Analysis, Queueing |
| K | Rules and controls testing: every tested row is scored against its rule or control limit, nothing registered | Controls Testing, Statistical Process Control, Entity Matching |
| L | Data agent: a Genie room and ai_query over the business tables, checked with sample questions, nothing registered | Data Agent |

A use case labelled with a model technique (families A-D) whose elite build path, or Solution, runs a Databricks AI text function (`ai_classify`, `ai_extract`, `ai_analyze_sentiment`, `ai_summarize`, `ai_parse_document`, `ai_translate`, `ai_mask`, `ai_fix_grammar`, or `ai_query` on a free-text signal column) and names no model training runs as family G with the AI-text implementation guidance.

**Business output objects:** both names are derived from the use case's quoted three-level `result_table` (Section 11.6), so catalogs and schemas that need quoting work: the output table `<result_table>` (each run replaces the rows of its own as-of date and keeps older dates) and, for families A-D, the Unity Catalog model `<catalog>.<schema>.<table>_model` with the alias `champion`. Notebooks written before v1.3.0 also created `<result_table>_latest`, `<result_table>_runs` and the `_smoke` variants; the three-cell notebook creates none of them, and the ones that exist are left as they are. Its only job is its own tagged persistent job (`dbx_inspire_ai_<slug>_<hash8>`), created by the Run controls.

**Launch gate and cap:** `JobLauncher.launch` is the single entry point for starting a run, used by the agent's own child-launch gate. It sets `max_concurrent_runs=1` and `queue=True` on the job so a job never runs two runs at once (a second request queues instead of starting concurrently), passes the `dbx_inspire_ai_child_run` run-parameter marker so a launched run recognises itself as a child and runs in place instead of launching again (the recursion breaker is the marker, not job-context detection), and enforces a `launch_cap` argument (default 20) that refuses to start a run once the job already started that many runs in the last 60 minutes, logging `[LAUNCH-CAP FIRED]` and returning without starting a run. On serverless the job's task sets `disable_auto_optimization`, so the platform does not rerun a failed run; the task class adds the field to the request body itself, because the SDK of serverless environment 1 does not have it. A task on a cluster keeps the cluster's retry setting. The App's Inspire and demo-data jobs set the same field on their serverless tasks.

## 18) v0.7.2 Known Issues (Resolved in v0.7.3)

This section is preserved for integrators still querying legacy v0.7.2 session data. Each item below is marked with its resolution status in v0.7.3.

### 18.1 Hard-Veto Survival In Stratified Trim: Resolved in v0.7.3

**Status:** Resolved in v0.7.3.

**Symptom (v0.7.2):** A use case with `bob_score = 2.0` (hard-veto floor) appeared in the surviving set after `LLM Aggressive Consolidation`, despite being semantically below the acceptable threshold.

**Root Cause (v0.7.2):** The stratified trim grouped by `idea_theme` and retained the highest-scoring UC per theme. When a hard-veto UC was the single occupant of its theme bucket, it survived by default because removing it would eliminate the theme entirely.

**Resolution in v0.7.3:** The stratified trim now applies a hard-veto pre-filter that drops `bob_score = 2.0` UCs BEFORE the per-theme trim, regardless of theme uniqueness. As long as the global count stays above 50, hard-veto UCs are always removed. Validated on three sample DBs (see Section 20.1).

**Integrator Guidance (v0.7.3+):** Apps no longer need to render hard-veto warning badges for NEW sessions. Retain the UI path for backward compatibility with archived v0.7.2 sessions.

### 18.2 Free-Form Theme Vocabulary Explosion: Not Resolved

**Status:** Fixed in v1.3.0 for new sessions: one call names the themes of the whole run (see 17.D). Sessions written before v1.3.0 keep their themes.

**Symptom:** Theme filter dropdowns populated from `SELECT DISTINCT idea_theme` may contain 50-80 entries, many of which are near-duplicates ("Anomaly Detection" vs "Outlier Detection" vs "Anomaly Identification").

**Root Cause:** Before v1.3.0 every BoB scoring batch named its own themes, without seeing the other batches.

**Integrator Guidance:**

- Do NOT hardcode a theme enum.
- For filter UIs, consider client-side normalization (lowercase + simple fuzzy grouping) as a temporary mitigation.
- Communicate to end users that theme labels are preliminary.

**Planned Fix:** A canonicalization pass (target: post-v0.7.3) will reduce the vocabulary to 15-25 curated themes (e.g. "Anomaly Detection", "Demand Forecasting", "Churn Prediction", "Recommendation", "Optimization", "Classification", "Segmentation"...).

### 18.3 Delta Read-After-Write On BoB Columns: Unchanged

**Status:** Unchanged in v0.7.3 (inherent to Delta read-after-write semantics, not a pipeline bug).

**Symptom:** Immediately after the `Best Of Best Ranking` `ended_success` event, a follow-up SELECT on `__inspire_usecases` may still return `NULL` in the five BoB columns.

**Root Cause:** Small window of Delta read-after-write latency; the MERGE commits a few hundred milliseconds after the step-event emission.

**Integrator Guidance:** Apply a ~2 second debounce between observing the `ended_success` and querying the BoB columns. Alternatively, gate on the presence of the `LLM Aggressive Consolidation` `ended_success` event, which is emitted after the MERGE completes.

### 18.4 Counts May Briefly Exceed `target_max_use_cases`: Semantics Changed in v0.7.3

**Status:** Semantics changed in v0.7.3; counts are now deliberately non-round by design (see Section 17.C `target_max_jitter`).

**Symptom (v0.7.2):** The `after` field of the `LLM Aggressive Consolidation` step payload occasionally exceeded the configured `target_max_use_cases` because hard-veto survivors occupied unique-theme buckets.

**v0.7.3 Behavior:** The hard-veto pre-filter (Item 18.1) removes the overshoot cause. However, portfolios are now intentionally non-round: the effective ceiling is `target_max_use_cases + random(0..target_max_jitter)`. With the v0.7.3 defaults (`target_max_use_cases=90`, `target_max_jitter=20`), portfolios land in the `90-110` range. Apps MUST accept variable counts and MUST NOT assume exactly 100.

## 19) Migration Notes (Upgrading From v0.7.1 or Earlier)

v0.7.2 is a **forward-compatible** upgrade: no breaking table renames, drops, or semantic changes to existing columns. However, integrators should verify several behaviors before rolling out to production consumers.

### 19.1 Schema Changes

| Table | Change | Action Required |
|---|---|---|
| `__inspire_usecases` | Added `idea_theme`, `bob_score`, `bob_tier1_score`, `bob_tier2_score`, `bob_tier3_score` | Handle NULL gracefully on older rows; update SELECTs and DTOs |
| `__inspire_step` | Added two new (`stage_name`, `step_name`) tuples | Update any hardcoded step-name allowlists to include `"Best of Best Ranking"` and `"LLM Aggressive Consolidation"` |
| `__inspire_session` | `widget_values` / `inspire_json` may carry new runtime-parameter keys | Apps ignoring unknown keys will continue to work; apps that explicitly validate schema must be updated |

### 19.2 Application Code Changes

1. **DTO Update:** Add the five v0.7.2 columns as nullable fields in your internal UC DTO / struct. Examples:
   - TypeScript: `ideaTheme: string | null; bobScore: number | null; bobTier1Score: number | null; bobTier2Score: number | null; bobTier3Score: number | null;`
   - Python: `idea_theme: Optional[str] = None`, etc.

2. **ORDER BY Adjustments:** When sorting UCs for display, use `ORDER BY bob_score DESC NULLS LAST` to gracefully interleave BoB-scored and non-scored sessions.

3. **Step-Event Handlers:** Add branches for the two new `step_name` values in your step renderer. See Section 5.2 for the full user-facing label mapping.

4. **UI Surface Additions:** Add the bob_score badge, idea_theme chip, and tier bars per Section 17.F.

### 19.3 Older Session Handling

Sessions created before v0.7.2 retain their original row shape after migration; the five new columns are simply `NULL` for those rows. Apps MUST:

- Use `IS NULL` guards in any templating that assumes BoB data.
- Never crash on `undefined`/`null` for BoB-adjacent access patterns.
- Treat the absence of the `Best Of Best Ranking` step event as a valid, complete session state.

### 19.4 Recommended Deprecation Warnings

If your app used older-schema approaches that BoB now subsumes, emit developer warnings (not user-facing) during the transition:

| Old Pattern | New Pattern | Warning Message |
|---|---|---|
| Ranking UCs purely by `Priority` / `Quality` label | Prefer `bob_score` when present | `"Deprecation: rank_by_quality_label is superseded by bob_score (v0.7.2+); fall back to label only when bob_score IS NULL"` |
| Hardcoded UC-count ceiling of 100 | Read `target_max_use_cases` from `inspire_json` | `"Deprecation: hardcoded UC ceiling; read target_max_use_cases runtime param"` |
| Treating all UCs as fungible | Group by `idea_theme` in summaries | `"Enhancement: v0.7.2 exposes idea_theme; consider theme-grouped summaries"` |

### 19.5 Rollback Safety

Because v0.7.2 only **adds** columns and step-event tuples (no drops, no semantic redefinitions):

- Downgrading the Inspire pipeline back to v0.7.1 is safe: the new columns remain in the Delta schema but simply stop being populated.
- Integrator apps pinned to the v0.7.1 schema continue to read existing columns without error.
- No data migration or backfill is required.

### 19.6 Migrating From v0.7.2 To v0.7.3 (Behavioral Changes Only)

**Good News: No Schema Migration.** v0.7.3 does NOT add, drop, or rename any columns on `__inspire_session`, `__inspire_step`, or `__inspire_usecases`. No data migration or backfill is needed. Existing DTOs and SQL continue to work.

The v0.7.3 changes are entirely **behavioral** and **runtime-parameter-driven**:

| Change | Impact On Integrators | Action Required |
|---|---|---|
| Hard-veto pre-filter (Issue 18.1 resolved) | `bob_score = 2.0` survivors effectively disappear from new portfolios | None: the red "Hard Veto" badge path simply stops triggering for new sessions. Keep the UI code for legacy v0.7.2 session replay |
| `target_max_use_cases` default changed: 100 → **90** | Admin/debug UIs displaying the parameter will show 90 by default | Update any hardcoded display copy that says "default 100" |
| New parameter `target_max_jitter` (default 20) | Final portfolio counts now land in the `90-110` range | Remove any assertions / tests that expect exactly 100 UCs. Render counts dynamically |
| New parameter `genie_regen_parallelism` (default 10) | Route 1/2 Genie regeneration (Phase 6) runs in parallel | Accept out-of-order `(idx/total)` step events during regeneration. Sort by `last_updated` and do not rely on monotonic counter ordering |
| Multi-language filenames: `readme_<lang>.md`, `_<lang>.xlsx` | Apps walking the `docs/` folder must handle both single- and multi-language patterns | See Section 19.7 |

**Rollback Safety (v0.7.3 → v0.7.2):**

- Downgrading the Inspire pipeline to v0.7.2 is safe: no schema changes to revert.
- Apps tested against v0.7.3 portfolios will see exactly-100-UC portfolios again if the runtime rolls back.
- Apps relying on the v0.7.3 hard-veto pre-filter should re-enable their hard-veto warning badge path if a rollback occurs.

### 19.7 Multi-Language Filename Pattern (v0.7.3)

When the run produces a single output language, artifact filenames are unchanged:

- `readme.md`
- `<business>-dbx_inspire.xlsx`

When the run produces multiple output languages, Inspire now writes one artifact per language using a language-abbreviation suffix:

- `readme_en.md`, `readme_de.md`, `readme_ar.md`, ...
- `<business>-dbx_inspire_en.xlsx`, `<business>-dbx_inspire_de.xlsx`, ...

**Integrator Guidance:** Apps walking the `docs/` / `generation_path` folder must handle BOTH patterns. A simple glob such as `readme*.md` and `<business>-dbx_inspire*.xlsx` will match both. The language abbreviation is the standard ISO-639-1 two-letter code (e.g. `en`, `de`, `fr`, `es`, `ar`). The PDF (`<business>-dbx_inspire_<code>.pdf`) and the presentation (`<business>-dbx_inspire_<code>.pptx`) always carry the code.

**Language Codes (v1.2.0):** every documents language maps to its ISO 639-1 code: English `en`, French `fr`, German `de`, Spanish `es`, Hindi `hi`, Chinese (Mandarin) `zh`, Japanese `ja`, Arabic `ar`, Portuguese `pt`, Russian `ru`, Swedish `sv`, Danish `da`, Norwegian `no`, Finnish `fi`, Italian `it`, Polish `pl`, Romanian `ro`, Ukrainian `uk`, Dutch `nl`, Korean `ko`, Indonesian `id`, Malay `ms`, Tamil `ta`. Before v1.2.0 six languages got the first two letters of their name instead: Swedish `sw`, Polish `po`, Dutch `du`, Indonesian `in`, Malay `ma` and Chinese (Mandarin) `ch`. Apps that build these file names must use the new codes for sessions from v1.2.0.


**How To Know Which Pattern To Expect:** parse `widget_values:output_language`: if it contains a comma, expect the multi-language pattern.

```sql
SELECT
    widget_values:output_language::STRING AS languages,
    CASE
      WHEN INSTR(widget_values:output_language::STRING, ',') > 0
        THEN 'multi-language (use readme_<lang>.md)'
      ELSE 'single-language (use readme.md)'
    END AS filename_pattern
FROM <inspire_db>.__inspire_session
WHERE session_id = :sid;
```

### 19.8 Migrating To v1.2.0 (Quality Modes)

**Schema Changes:**

| Table | Change | Action Required |
|---|---|---|
| `__inspire_usecases` | Added `quality`, `quality_mode`, `elite_status`, `elite_score`, `elite_assessment` (JSON), `selection_flags` (JSON) via idempotent `ALTER TABLE ... ADD COLUMN` | Add nullable fields to your DTOs; older rows read NULL |
| `__inspire_step` | New steps under `Use Case Prioritization`: `Quality Bar`, `Selection Funnel`, `Elite Selection` | Add them to any step allowlist (Section 8.14) |
| `__inspire_session` | `results_json` gains `funnel_ledger`, on a zero outcome `selection_outcome`, and in `Ultra High` `elite_outcome`; `use_cases_quality` holds the canonical mode | Read the new keys tolerantly (Section 11.7) |
| `__inspire_session` | `results_json` gains `failed_steps` and `translation_gaps` when an artifact step failed or a translation kept English text | Surface them as warnings, not errors (Section 11.8) |
| `__inspire_session` | `results_json` always carries `metadata_unavailable` and `llm_endpoint_health` | Show lost tables as a warning (Section 11.8) |
| `__inspire_step` | Steps for `USE_CASE_VALUE_SCORE_PROMPT` and `USE_CASE_QUALITY_SCORE_PROMPT` no longer appear; a `Metadata Load` warning step can appear under `Data Preparation` | Remove them from step allowlists; add `Metadata Load` |
| `__inspire_usecases` | `code_structure_mandate` is filled for every row; a session's rows are replaced in one transaction instead of a delete followed by inserts | No action; a reader never sees a partly written session (Section 2.3.1) |

**Behavioral Changes:**

| Change | Impact On Integrators | Action Required |
|---|---|---|
| Quality modes `Good`, `High`, `Ultra High` | Legacy labels still run, mapped as in Section 9.2 | Offer the new options; keep sending legacy labels only if you cannot update yet |
| Retired keep-all `Coverage Mode (All)` | That label now runs as `Good`, so Low, Very Low and Ultra Low use cases are no longer delivered | Explain the change to users who relied on keep-all |
| One generation pass for every mode | `Strict Quality` / `Very High Quality` users now get the same broad generation as `Good`, followed by the High-or-better selection | Expect more candidates in the funnel ledger; the delivered set still meets the High bar |
| No recovery, top-up or target-zone floor | Small portfolios are delivered as they are; when 0 clear the bar the run ships the closest candidates labelled "below the `<mode>` bar", never empty | Render `selection_outcome` as a valid below-bar outcome |
| Domain coverage picks in every mode | A user-specified Business Domain is never empty when any scored use case exists for it; such a pick is marked `elite_status = 'DOMAIN_COVERAGE_PICK'` | Label it "Domain coverage pick, below bar" |
| `Ultra High` elite stage | Short lists are expected, and every elite use case has Genie Code | Do not assert a minimum count |
| Final `Inspire pipeline completed` event can be `ended_warning` | A session whose artifacts partly failed, or whose metadata could not be loaded for some tables, completes with `ended_warning` and `Completed with warnings: ...` | Treat `ended_warning` on the final event as completed with warnings (Section 8.1) |
| Final-rank ids in every mode | `Good` and `High` ids (`N##-U##`) now follow the final rank, as `Ultra High` already did; a rerun of the same inputs can number use cases differently than v1.1.x | Do not persist ids across sessions as stable keys; join on `session_id` + `id` |
| Quoted `result_table` | `result_table` and `result_database` read `` `catalog`.`schema`.`_inspire_...` `` | Strip backticks before splitting on `.` |
| Business context is never invented from the business name | `strategic_initiative` and `revenue_model` are `UNKNOWN_FROM_METADATA`; inferred text is prefixed `[ASSUMPTION ...]` | Show these fields as unknown or assumed, not as facts |
| ISO 639-1 file codes | Swedish, Polish, Dutch, Indonesian, Malay and Chinese (Mandarin) artifacts are named `_sv`, `_pl`, `_nl`, `_id`, `_ms`, `_zh` (previously `_sw`, `_po`, `_du`, `_in`, `_ma`, `_ch`) | Update any hard-coded file name (Section 19.7) |
| `Not scored` cells | Excel, CSV and Markdown catalogs show `Not scored` for a score that was never computed instead of 0, 5.0 or Medium | Treat `Not scored` as missing, not as text to parse |

**Rollback Safety:** the new columns are only added, never renamed or dropped. Rolling back leaves them NULL for new rows.

### 19.9 Migrating To v1.2.1 (Timeout Retries, Dedup Re-Ask, Log Levels)

**Schema Changes:** no table, column, widget or `results_json` key is added, renamed or removed. The `elite_assessment` JSON gains one optional key, `verdict_capped_from`, which is null unless a verdict was capped.

**Behavioral Changes:**

| Change | Impact On Integrators | Action Required |
|---|---|---|
| A worker step the pipeline itself cancels ends `ended_warning` | When a scoring batch runs past its straggler budget the pipeline cancels it and re-sends its use cases; that worker step used to end `ended_error` (39 such rows across the 29 v1.2.0 release runs) | Treat `ended_error` rows as real failures; no allowlist change is needed |
| Timed-out scoring batches are retried in halves with the full per-task timeout | `Ultra High` no longer loses candidates to slow judge calls (v1.2.0 lost 2 to 50 per run); `funnel_ledger` drops `unjudged` and `bob_unscored` should be rare | Expect slower scoring stages on a slow endpoint; the stage deadline still bounds them |
| A use case lost after every scoring retry is logged at ERROR | The elite judge now also logs `UC(s) unscored after retries and excluded from selection` | Alert on this line if you monitor logs |
| An unusable dedup keep-list is asked for once more | A step named `Deduplicate_Global_Reask` or `Deduplicate_Domain_<domain>_Reask` can follow the original dedup step | Add the `_Reask` suffix to any step allowlist |
| A failed global dedup over a single group keeps all use cases | When every use case is in one group (as in `Ultra High`), a second identical per-domain request is no longer sent; the run keeps all use cases and logs one ERROR | None |
| The keep-list can no longer be wiped by a trailing note | A closing note with a comma used to delete the kept ids and drop the use cases the model kept; prose now goes to the row guard | None; expect dedup counts to match the model's keep-list |
| A discarded elite-judge record is asked for again with its reason | Fewer `unjudged` drops in `funnel_ledger`; the log names the rejected value (`invalid verdict '<value>'`) | None |
| A verdict still above its own scores after the corrective re-judge is capped | `elite_assessment.verdict_capped_from` holds the original verdict; the use case is judged at the capped verdict instead of being dropped as `unjudged` | Parse the key as optional |
| Recovered failures log WARNING, degraded outcomes log ERROR | Retried LLM attempts, retried translation, interpreter, business-context, domain and subdomain attempts, the global-to-per-domain dedup fallback and retried score parses are warnings; a use-case batch left in English is an error | Re-baseline log alerts keyed on ERROR counts |

**Rollback Safety:** the only stored difference is the optional `verdict_capped_from` key inside `elite_assessment`; v1.2.0 reads that JSON by key and ignores it, so rolling back needs no data change.

### 19.10 Migrating To v1.3.0 (Discovery Type, Strategy Alignment, Feedback, AI Call Log)

Every change is additive; an App built for v1.2.1 keeps working on v1.3.0 sessions and on the same database.

1. **Widgets.** Pass `03_discovery_type` (`Deep` or `Standard`; empty means `Deep`), `10_strategic_context` (inline JSON, a `/` path, or empty) and `16_best_of_best_count` (empty unless the user chose a number, so the generation instructions and the default 20 still apply) when launching a run. When regenerating Genie Code (Route 1) on a session row written before v1.3.0, both columns are NULL: pass empty values so the run behaves as before.
2. **Columns.** Read `__inspire_session.discovery_type` and `strategic_context`, the 14 new `__inspire_usecases` columns (Section 2.3.1) and `__inspire_step.event_id` NULL-safe. Parse the JSON columns tolerantly.
3. **New tables.** Write user decisions to `__inspire_feedback` (Section 2.4) with bound parameters, copying `use_case_key` from the use case row. Read `_ailogs` (Section 2.5) for AI call diagnostics; never write to it.
4. **`results_json`.** Read the new top-level keys (Section 11.1) and per-use-case keys (Section 11.6) only when present; sessions written before v1.3.0 have none of them.
5. **Stage and failed step.** Show the `Strategy Alignment` stage (Section 8.15) and handle a `Strategy Alignment` entry in `failed_steps`; show the `Best of Best` step (Section 8.16), star use cases where `best_of_best = 'Y'`, and handle a `Best of Best` entry in `failed_steps`.
6. **Data access.** Show `results_json.data_access`: in Standard, nothing was read; in Deep, the tables read and the statement counts, with `rows_sent_to_ai` always 0.

Rollback: v1.2.1 ignores the new columns and tables; leave them in place.

## 20) Release Notes For Integrators

### 20.A v0.7.6 to v0.7.9 Release Notes (Current Line)

These incremental releases refine the v0.7.3 production baseline without breaking the schema or pipeline contract.

| Tag | Change | Integrator Impact |
|---|---|---|
| **v0.7.6** | `has_genie_code` values shortened: `'Yes'`/`'No'` → `'Y'`/`'N'` | Apps querying by exact value string must now accept both formats. Pre-existing Delta rows keep their original `'Yes'`/`'No'` values; newly-written rows use `'Y'`/`'N'`. Recommended query pattern: `has_genie_code IN ('Y','Yes')`. |
| **v0.7.7** | Auto-Genie top-N during Discover (see 17.H) | Apps see up to `discover_auto_genie_top_n` (default 5) UCs with `has_genie_code='Y'` immediately after Discover finishes. New step event `Auto-Genie (Top-N)`. New runtime param `discover_auto_genie_top_n`. |
| **v0.7.8** | Back-filled demo CSVs with 6 new columns (`Has Genie Code`, `Idea Theme`, `BoB Score`, `BoB Technical`, `BoB Business`, `BoB PBA`) | Apps reading the legacy per-business CSV artifacts (`demos/<biz>/docs/Samples <biz>-dbx_inspire.csv`) now see the extended column set matching post-v0.7.2 Excel catalogs. All `Has Genie Code` values in back-filled CSVs use the `Y`/`N` format. |
| **v0.7.9** | Added `demos/bakehouse` as a fresh v0.7.7 validation demo | No pipeline behavior change. Reference for integrators: demonstrates Auto-Genie top-5 artifact layout + Y/N format. |

### 20.B v0.7.3 Release Notes

v0.7.3 is a **behavior-only** upgrade: no schema changes, no new columns, no new step events. Portfolio quality and multi-language artifact layout improve; integrators need only address varying portfolio sizes, the multi-language filename pattern, and parallel Genie regeneration event ordering.

#### 20.A.1 What's New

- **Hard-Veto Pre-Filter (Issue 18.1 Resolved):** The stratified trim now drops `bob_score = 2.0` UCs BEFORE the per-theme trim. `bob_score = 2.0` survivors should be rare-to-impossible in new portfolios.
- **Target-Max Jitter (Non-Round Portfolios):** `target_max_use_cases` default changed from 100 to **90** (now the base). New parameter `target_max_jitter` (default **20**) adds random jitter on top, so default portfolios land in the `90-110` range.
- **Multi-Language Filename Pattern:** Multi-language runs now produce per-language `readme_<lang_abbr>.md` and `<business>-dbx_inspire_<lang_abbr>.xlsx`. Single-language runs retain the legacy filenames. See Section 19.7.
- **Parallel Genie Regeneration:** Phase 6 Route 1/2 Genie Code regeneration runs concurrently. New runtime parameter `genie_regen_parallelism` (default **10**) controls concurrency. Step events may arrive out-of-order per-UC: apps sorting by `(idx/total)` counters must accept non-monotonic ordering.
- **Validation Run:** Three sample DBs validated on v0.7.3:
  - **NYC Taxi** (session `7301073301073001`): 30 UCs, BoB not triggered.
  - **HealthVerity** (session `7302073002073002`): 39 UCs, BoB not triggered.
  - **tpcds_sf1** (session `1234567890000001`): 105 UCs, BoB triggered, dropped 13 hard-vetos via pre-filter, trimmed to the `91-110` range.

#### 20.A.2 What Might Break

- **Hardcoded UC-Count Assertions:** Apps asserting `count(*) == 100` will fail. Use `BETWEEN 90 AND 110` or read `target_max_use_cases + target_max_jitter` from `inspire_json` for precise bounds.
- **Folder Walks Assuming Fixed Filenames:** Apps expecting `readme.md` and `<business>-dbx_inspire.xlsx` exclusively will miss multi-language outputs. Use a `readme*.md` glob.
- **Step-Event `(idx/total)` Monotonicity:** Apps that assume step events for the Genie regeneration arrive in strict counter order may render progress out of sequence. Sort by `last_updated` for display; do not rely on `(idx/total)` as a monotonic timeline.
- **Rendering Hard-Veto Badges:** Apps that hide `bob_score = 2.0` UCs will see no change (they continue to be absent). Apps that expected to display them will no longer have any to display for new sessions: legacy v0.7.2 session data still includes them.

#### 20.A.3 Backward Compatibility Matrix

| App Pinned To | Inspire v0.7.3 Runtime | Outcome |
|---|---|---|
| v0.7.0 or v0.7.1 schema | v0.7.3 | App keeps working; BoB / multi-lang columns & filenames simply ignored |
| v0.7.2 schema | v0.7.3 | App keeps working with two caveats: (a) hard-veto badge path never fires for new sessions, (b) UC counts no longer round to 100 |
| v0.7.3 schema | v0.7.3 | Full feature parity |
| v0.7.3 schema | v0.7.2 runtime (rollback) | App works unchanged; hard-veto badges re-appear and counts snap back to 100 |

#### 20.A.4 Version Stamp

This document describes the v0.7.3 production release. For planned future work (theme canonicalization, Issue 18.2), monitor the `CHANGELOG.md` in the Inspire repository.

### 20.C v0.7.2 Release Notes

#### 20.B.1 What's New

- **New Columns on `__inspire_usecases`:** `idea_theme`, `bob_score`, `bob_tier1_score`, `bob_tier2_score`, `bob_tier3_score`. See Section 17.A.
- **New Step Events:** `("Use Case Prioritization", "Best of Best Ranking")` started + ended_success pair; `("Use Case Prioritization", "LLM Aggressive Consolidation")` ended_success. See Section 8.13.
- **New Prompt Title:** `BEST_OF_BEST_SCORING_PROMPT` with user-facing step title "Best Of Best Ranking" and message "Inspire is ranking use cases by every quality gate for fine-grained prioritization." See Sections 5.2 and 7.
- **New Runtime Parameters:** `aggressive_prune_threshold` (default 75), `target_max_use_cases` (default 100 in v0.7.2; changed to 90 in v0.7.3), `bob_theme_max_share` (default 0.15), `bob_scoring_batch_size` (default 25). See Section 17.C.
- **Expanded Phase 4 Decision Tree:** Target-zone vetting now includes a BoB + Stratified Trim branch when the UC count exceeds the aggressive prune threshold. See Section 14.
- **Documented Hard-Veto Sentinel:** `bob_score = 2.0` is an explicit flag value meaning at least one gate scored below 3. Apps rendering v0.7.2 session data MUST render a warning badge. See Section 17.D. (Resolved in v0.7.3; see Section 20.A.)

#### 20.B.2 What Might Break

- **Unchecked NULL Access:** Apps that destructure or JSON-serialize the UC row without accounting for NULL in the five new columns may throw runtime errors. Adopt defensive accessors.
- **Hardcoded Step-Name Allowlists:** Apps that maintain a static list of recognized `step_name` values must add `"Best of Best Ranking"` and `"LLM Aggressive Consolidation"`. Unknown step names will typically render as raw strings.
- **Fixed Theme Enums:** If any downstream analytics hardcoded a list of expected "categories" to expect, they will see themes they don't know. Treat `idea_theme` as open-set.
- **UC-Count Assumptions:** Apps assuming a strict ceiling of 100 UCs must accept slight overshoot (see Section 18.4).

#### 20.B.3 Recommended Deprecation Warnings

See Section 19.4 for the concrete list. In short: deprecate label-only ranking in favor of `bob_score` when present, and expose `target_max_use_cases` dynamically rather than hardcoding 100.

#### 20.B.4 Backward Compatibility Matrix

| App Pinned To | Inspire v0.7.2 Runtime | Outcome |
|---|---|---|
| v0.7.0 schema | v0.7.2 | App keeps working; new columns ignored |
| v0.7.1 schema | v0.7.2 | App keeps working; new columns ignored |
| v0.7.2 schema | v0.7.2 | Full feature parity |
| v0.7.2 schema | v0.7.1 runtime (rollback) | App reads all new columns as NULL; renders "not scored" state |

## 21) End-To-End Integration Example: Reading BoB Results

Below is a minimal end-to-end read flow an integrator can adapt. Replace `<inspire_db>` and `:sid` appropriately.

**Step 1: Confirm BoB Ran.**

```sql
WITH s AS (
  SELECT
    CASE WHEN COUNT(bob_score) > 0 THEN true ELSE false END AS bob_ran,
    COUNT(*) AS total_ucs
  FROM <inspire_db>.__inspire_usecases
  WHERE session_id = :sid
)
SELECT * FROM s;
```

**Step 2: Fetch Ranked UCs With Defensive NULL Handling.**

```sql
SELECT
  id,
  short_name,
  COALESCE(idea_theme, 'Unclassified')       AS theme,
  bob_score,
  CASE
    WHEN bob_score IS NULL       THEN 'Not Scored'
    WHEN bob_score = 2.0         THEN 'Hard Veto'
    WHEN bob_score < 5.0         THEN 'Marginal'
    WHEN bob_score < 8.0         THEN 'Strong'
    ELSE                              'Flagship'
  END AS tier_label,
  bob_tier1_score, bob_tier2_score, bob_tier3_score,
  use_case
FROM <inspire_db>.__inspire_usecases
WHERE session_id = :sid
ORDER BY bob_score DESC NULLS LAST, id ASC;
```

**Step 3: Render.** Apply UI patterns from Section 17.F.

**Step 4: (Optional) Show Theme Distribution.**

```sql
SELECT theme,
       COUNT(*)                    AS ucs_in_theme,
       ROUND(AVG(bob_score),2)     AS avg_bob,
       MIN(bob_score)              AS min_bob,
       MAX(bob_score)              AS max_bob
FROM (
  SELECT COALESCE(idea_theme, 'Unclassified') AS theme, bob_score
  FROM <inspire_db>.__inspire_usecases
  WHERE session_id = :sid
)
GROUP BY theme
ORDER BY ucs_in_theme DESC;
```

**Step 5: (Optional) Correlate With Phase 4 Step Events.**

```sql
SELECT stage_name, step_name, status,
       result_json:before::INT     AS before_count,
       result_json:after::INT      AS after_count,
       result_json:scored::INT     AS scored_count,
       result_json:total::INT      AS total_count,
       last_updated
FROM <inspire_db>.__inspire_step
WHERE session_id = :sid
  AND step_name IN ('BoB_Ranking', 'Stratified_Trim')
ORDER BY last_updated;
```

**Step 6: (v0.7.3+) Detect Pipeline Version From Session Behavior.**

Because v0.7.3 introduces no schema changes, a reliable version-detection query must rely on behavioral signals. The `target_max_jitter` runtime parameter is the cleanest indicator: it only exists from v0.7.3 onward.

```sql
SELECT
    session_id,
    create_at,
    inspire_json:target_max_jitter::INT      AS target_max_jitter,
    inspire_json:target_max_use_cases::INT   AS target_max_base,
    inspire_json:genie_regen_parallelism::INT AS genie_regen_parallelism,
    CASE
      WHEN inspire_json:target_max_jitter IS NOT NULL THEN 'v0.7.3+'
      WHEN widget_values:output_language LIKE '%,%'
           AND inspire_json:target_max_jitter IS NULL THEN 'v0.7.2 (multi-lang, pre-jitter)'
      WHEN inspire_json:aggressive_prune_threshold IS NOT NULL THEN 'v0.7.2'
      ELSE 'v0.7.1 or earlier'
    END AS inferred_version,
    CASE
      WHEN inspire_json:target_max_jitter IS NOT NULL THEN false
      ELSE true
    END AS expect_hard_veto_survivors
FROM <inspire_db>.__inspire_session
WHERE session_id = :sid;
```

Apps MAY use the `expect_hard_veto_survivors` flag to gate their hard-veto warning-badge rendering: hide the badge path entirely for v0.7.3+ sessions, keep it for legacy v0.7.2 replay.

This flow gives the integrator a complete BoB-aware view: whether BoB ran, what the final ranking looks like, how themes distribute, which step events produced the counts, and which pipeline version generated the session; all read from the three canonical Delta tables described at the top of this guide.
