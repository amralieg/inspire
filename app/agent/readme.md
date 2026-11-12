<div align="center">

# Inspire AI

### Discover production-ready business use cases from your data -- automatically

**Release v1.5.3**

[![Databricks](https://img.shields.io/badge/Platform-Databricks-FF3621?style=for-the-badge&logo=databricks&logoColor=white)](#)
[![Unity Catalog](https://img.shields.io/badge/Data-Unity%20Catalog-4B0082?style=for-the-badge)](#)
[![Multi-Language](https://img.shields.io/badge/Languages-23%20Supported-10A37F?style=for-the-badge)](#)
[![LLM Powered](https://img.shields.io/badge/AI-Multi--Model%20Cascade-FF6B00?style=for-the-badge)](#)
[![Version](https://img.shields.io/badge/Version-1.5.3-brightgreen?style=for-the-badge)](#whats-new-in-v130)

*Point Inspire at your Unity Catalog metadata. Get scored, ranked, idea-themed, and documented business use cases.*

</div>

---

## Table of Contents

1. [Quality Modes: Good, High, Ultra High (v1.2.0)](#quality-modes-good-high-ultra-high-v120)
2. [What's New in v1.3.0](#whats-new-in-v130)
3. [What's New in v1.2.1](#whats-new-in-v121)
4. [What's New in v1.2.0](#whats-new-in-v120)
5. [What's New in v0.7.3](#whats-new-in-v073)
6. [What's New in v0.7.2](#whats-new-in-v072)
7. [What Is Inspire AI?](#what-is-inspire-ai)
8. [Documentation (Getting the Notebook Running)](#documentation)
9. [Key Features & Widget Reference](#key-features)
10. [The 19 Quality Gates](#the-19-quality-gates)
11. [Best-of-Best Ranking (v0.7.2+, v0.7.3 Refinements)](#best-of-best-ranking-v072-v073-refinements)
12. [Idea Themes](#idea-themes)
13. [Portfolio Size Math](#portfolio-size-math)
14. [Pipeline Phases](#pipeline-phases)
15. [Output Artifacts](#output-artifacts)
16. [LLM Architecture](#llm-architecture)
17. [Use Case Scoring Explained](#use-case-scoring-explained)
18. [Docs-Only Mode](#docs-only-mode)
19. [Troubleshooting](#troubleshooting)
20. [Quick Operator Checklist](#quick-operator-checklist)
21. [5-Step Fast Start](#5-step-fast-start)
22. [Release Notes: v0.7.3](#release-notes-v073)
23. [Release Notes: v0.7.2](#release-notes-v072)
24. [v0.7.2 Known Issues (Resolved In v0.7.3)](#v072-known-issues-resolved-in-v073)

Inspire reads the structure of your data tables in Databricks Unity Catalog: catalog, schema, table and column names, column types, comments, key constraints, tags, table properties, metric view definitions and usage counts.
Both values of the `04. Discovery Type` widget compute aggregates over your tables, such as row counts, date coverage and join match rates, to decide whether each use case can work. In **Standard Discovery** (the default and the recommended choice) none of those numbers ever reaches the AI. In **AI Enhanced Discovery** the AI also sees them. No data row is ever sent to the AI, and Inspire never reads the values of personal columns. See [Discovery Type](#a-discovery-type-standard-and-deep).

From that evidence, Inspire:

1. Understands your business context automatically
2. Interprets any generation instructions you provide
3. Generates prioritized AI use cases relevant to your data
4. Scores each use case on business value and data quality across 19 quality gates
5. Ranks survivors on a 0-10 Best-of-Best composite (new in v0.7.2)
6. Groups use cases into business domains and tags each with an idea theme (new in v0.7.2)
7. Writes Genie Code instruction notebooks for each use case
8. Produces output artifacts you can share with stakeholders

The Genie Code instructions it writes are designed to be executed by Databricks Genie Code.
Each instruction describes WHAT to achieve and WHY, letting Genie Code determine the optimal implementation (SQL, joins, algorithms).

End result: a prioritized, theme-balanced catalog of use cases with Genie Code instruction notebooks, executive summaries, and multi-language documentation.

---

## Quality Modes: Good, High, Ultra High (v1.2.0)

The **06. Use Cases Quality** widget offers three modes. All three run the same broad generation pass; they differ only in which scored use cases are selected.

| Mode | Selection |
|------|-----------|
| `Good` (default) | Keeps use cases scored Medium, High, Very High or Ultra High. Best-of-Best ranking drops hard-vetoed use cases; a very large set is capped by the stratified theme trim. |
| `High` | Keeps only use cases scored High, Very High or Ultra High, with the same Best-of-Best ranking and trim. |
| `Ultra High` | Elite selection: High-or-better candidates are judged against an absolute bar for business value, metadata evidence, implementability and actionability. No quota, no cap, no padding. |

**Legacy labels** keep their previous behavior: `Coverage Mode (All)`, `Balanced`, `Good Quality` and `High Quality` run as `Good`; `Strict Quality` and `Very High Quality` run as `High`. Matching ignores case and surrounding spaces. `Ultra High` runs only when you choose it. Any other value stops the run with a validation error that lists the valid options and the accepted legacy labels. The session records the canonical mode.

**No padding in any mode.** The recovery from the rejection pool, the minimum top-up and the target-zone floor described in the v0.7.x sections below are removed. The portfolio holds what clears the bar, with no padding whenever at least one use case clears it. If a mode's bar would select zero use cases, the run does not ship an empty catalog: it returns the closest real candidates instead, each labelled "below the `<mode>` bar" with its real scores and the check it missed, under a plain notice that no use case met the bar (`Good` falls back to the candidates that passed the hard gates, `High` to Medium then Low, `Ultra High` to the near misses rejected without a fatal flaw and then High-tier candidates). Each user-specified Business Domain still keeps at least one use case: when none of its use cases cleared the bar, its best scored use case is added and labelled "Domain coverage pick, below bar".

**One Priority source, final-rank ids.** Combined value and quality scoring is the only scoring pass: the separate per-domain value pass (and its relative rescaling that made the best use case 9.5) is removed, so `Priority` is the absolute combined priority. Ids assigned before selection are provisional; every mode renumbers the final list in final-rank order, so `N01` is the domain of the best use case and `U01` its best use case.

### Ultra High: Elite Selection

1. **Candidates**: use cases scored High or better, plus a second look at Medium use cases with a high value score so a high-value idea with a noisy quality label is not lost. When Business Domains are set, candidates are assigned to those domains first.
2. **Best-of-Best prescreen**: hard-vetoed candidates and candidates below the prescreen minimum are dropped.
3. **Elite judge** (`ULTRA_HIGH_ELITE_JUDGE_PROMPT`): records, per candidate, the decision the use case changes and who owns it, the KPI, a value driver tied to named columns (no invented figures), the signal, outcome, time and entity-key columns, the join path, the Databricks build path and its blockers, the data shapes the use case depends on that metadata cannot prove (`runtime_assumptions`), every reason that defeats it as a `fatal_flaws` entry from a fixed list (`OUTCOME_DERIVED_FROM_INPUTS`, `NO_DECISION_CHANGED`, `DUPLICATE_OF_ANOTHER_USE_CASE`, `DATA_SHAPE_ASSUMPTION_UNVERIFIABLE`, `INFEASIBLE_WITH_AVAILABLE_COLUMNS`, `VALUE_OVERCLAIMED`), a red-team "why this fails" note with its category, and absolute 1-10 scores for value, evidence, implementability and actionability. The red-team verdict is derived from `fatal_flaws`: any fatal flaw is fatal. An assessment that contradicts itself (a red-team note naming a fatal category that is not listed as a fatal flaw, an `ELITE` or `NEAR_MISS` verdict with a fatal flaw, or a verdict better than its own scores and value tier allow) is discarded and the use case is judged again.
4. **Metadata verification**: every cited table and column must exist, each technique's required columns must be present with compatible types (a date or timestamp for temporal techniques, which may be a date key that joins a dated table and is recorded as time via join; a numeric measure for the KPI; an entity key, which is a declared key, an identifier-like name such as `*_id`, `*_key`, `*_sk`, `*_code`, `*_no`, `*_num` or `*_number`, or a text column named as the entity the decision acts on; and an outcome column for supervised techniques), and a multi-table use case needs a foreign-key path. A supervised use case whose outcome is computed from its own signal columns in the same period is rejected: its label is a rule over its inputs, so it is a ranking or a rule, not a model; an outcome observed in a later window than the signals (`label_timing` `future_window`) with a dated time column is a real prediction. A use case built on Databricks AI text functions (for example `ai_classify` or `ai_extract`) without model training is verified as text processing, not as a supervised model. A co-occurrence use case grouped by its table's own row key, or a central runtime assumption that the table's own keys contradict, is rejected; the other runtime assumptions are checked by the Genie notebook's readiness gate before it builds anything. Evidence comes from metadata only. When verification rejects only the judge's own citations (for example a mistyped column or a text column cited as the time column), the use case gets one re-judge with the cache bypassed, the exact failures and the real column lists of its tables, and is verified again; data that lacks the needed column, and a design failure such as a label rule over its own inputs, stays rejected.
5. **Absolute bar**: a use case is elite only when it has no fatal flaw, the judge rates it elite, all four scores reach the minimum (8 of 10 by default), its value tier is Transformational or Material, and verification passes. A use case just below the bar gets one independent second opinion from the next model and becomes elite only when the two opinions' averaged scores reach the minimum on every dimension; every other miss is recorded in the near-miss ledger with the gate it failed (`second_opinion_average_below_bar` or `second_opinion_reject` when the second opinion does not confirm it).
6. **Overlap, coverage and ranking**: of two overlapping elites the stronger is kept, and elites that change the same decision (the same canonical title, or the same decision object and technique on another channel's table) collapse to the one with the higher elite score. The domain coverage picks are added, the final set is clustered into business domains without merging small domains (the near misses of the ledger are clustered with it, so every near miss carries a domain), and use cases are ranked by elite score (0.40 value, 0.25 evidence, 0.20 implementability, 0.15 actionability), with domain coverage picks after every elite use case.
7. **Genie Code for every elite use case** when widget `13_generate_genie_code_for` is not `0` (the default `0` keeps every use case on its skeleton notebook).

If no candidate clears the bar the run does not ship empty: it returns the near misses rejected without a fatal flaw, ranked by elite score and each labelled "below the Ultra High bar" with the check it failed (never fatal-flaw rejects), then High-tier candidates, under a plain notice that no use case met the Ultra High bar. The scores shown are the real elite scores; nothing is invented. The count of elite use cases is reported, never targeted.

### Use Case Names

The headline (`usecase`) keeps its benefit-led form, for example "Increase Basket Size to Grow Revenue". The `Name` line says what the owner does, in sentence case and about 6 to 10 words: a plain verb, the items acted on and the rule that picks them, for example "Call the repeat buyers most likely to lapse this month". It names no technique, has no "with ..." tail and no value phrase; Q5 R20 flags a `Name` that breaks these rules (`Q5_R20_NAME_STYLE`) and never drops the use case. The PDF, the slides and the Markdown catalog show the line as "<Name> using <technique>". A naming rule written in **09. Generation Instructions** replaces these rules and turns the check off.

### Generation Instructions and the Quality Bar

A goal in **09. Generation Instructions** sets the scope and the alignment of the portfolio: use cases that serve it are kept in scope, scored high on strategic alignment, and never penalized for domain or technique balance. A goal never exempts a use case from the quality bar of the selected mode.

### Selection Outcome and Tracking

| Surface | What You See |
|---------|--------------|
| `__inspire_step`, stage `Use Case Prioritization` | `Quality Bar` (a warning step carrying the near-miss list when 0 use cases met the bar), `Selection Funnel` (the stage ledger) and `Elite Selection` (`Ultra High` only) |
| `__inspire_session.results_json` | `funnel_ledger` (one entry per stage: `stage`, `in`, `out`, `drops` by reason; `Ultra High` logs the `elite_*` stages, including `elite_evidence_repair`), `selection_outcome` (present when 0 use cases met the bar) and `elite_outcome` (`Ultra High` only: elite count, coverage picks and the near-miss ledger) |
| `__inspire_session.results_json` (run outcome) | `failed_steps`: one entry per failed artifact step (`step`: `PDF Catalog`, `Presentation`, `Use Case Excel`, `CSV Catalog`, `Markdown Catalog`, `JSON Catalog`, `Language Pack`, `Tracking Table`, `Tracking Table Setup`, `Tracking Table Migration`, `Generate Lock` when Generate mode ran without the per-business lock, `Implement Use Cases` when the Implement Use Cases operation failed for some of its use cases but not all (the run fails when every one failed), or `Route 1 scan` and `Route 2 scan` when Generate mode could not read the flagged tracking rows or a notebook it scanned; `language`; `error`). `translation_gaps`: per language, `use_cases` with text shown in English, `untranslated_use_cases` and a count per field, and `artifacts_in_english` (`Genie Code notebooks`) when the run wrote use-case notebooks, which are written in English only. Both are absent when nothing failed. Always present: `metadata_unavailable` (`count`, and `tables`: each table whose metadata could not be loaded, with the reason) and `llm_endpoint_health` (`unusable` endpoints with the reason, `temperature_unsupported`, `probed`) |
| `__inspire_step`, stage `Data Preparation` | `Metadata Load`: an `ended_warning` step whose `result_json` names every table whose metadata could not be loaded (`count`, `tables` with `table` and `reason`); those tables are not analysed. When no table of the UC metadata can be analyzed, the run fails with an error that names the metadata it read and each table not loaded |
| Run completion | With `failed_steps`, `translation_gaps` or lost tables present the run still completes, but the closing banner reads "COMPLETED WITH WARNINGS" (normal and JSON mode) and lists them, and the final `Inspire pipeline completed` step is `ended_warning` with the message `Completed with warnings: ...` instead of `ended_success` / `Completed` |
| `__inspire_usecases` | New columns `quality`, `quality_mode`, `elite_status`, `elite_score`, `elite_assessment` (JSON) and `selection_flags` (JSON); `code_structure_mandate` is now filled for every row. A session's rows are replaced in one Delta transaction (staged, then one `replaceWhere` overwrite): readers never see a partly written session, and a failed replace keeps the previous rows and is recorded in `failed_steps`. Table names are quoted, so catalog or schema names that need quoting (for example with a hyphen) work |
| Artifacts | A score that was never computed reads `Not scored` in the Excel, CSV and Markdown catalogs, never a default. Per-language file names use ISO 639-1 codes: Swedish `sv`, Polish `pl`, Dutch `nl`, Indonesian `id`, Malay `ms`, Chinese (Mandarin) `zh` (previously `sw`, `po`, `du`, `in`, `ma`, `ch`) |
| LLM CSV answers | Every CSV answer (use case generation, table filter, deduplication, domain and subdomain assignment, user domains, goal filter, translation, summaries) passes one row guard. A row that is short of its columns, carries unexplained extra values, or holds a copied id, table name, technique, quality label or enum value in another column is rejected, logged as `[CSV-ROW misaligned]` with a count per reason, and treated as missing, so the stage retries it instead of reading shifted values. Honesty columns are removed only where the row shape proves where they are. A translation answer counts as cut off only when it ends inside an open quoted field, its last row stops mid-row, or its closing rows never started; a complete answer that lacks a row is retried once and split into smaller batches only if the retry is incomplete too. A deduplication keep-list that was cut off, or that names a use case outside its id column, is refused instead of dropping use cases and, from v1.2.1, asked for once more with the cache bypassed |

---

## What's New in v1.3.0

v1.3.0 separates finding use cases from judging them against a strategy. Discovery and grading never see your goals, priorities or strategy, so a goal can never talk the model into a use case your data does not support. After selection, every final use case is aligned to your strategy with evidence from its own columns, and gets KPIs, expected key results, measures of success and financial and non-financial benefits. A new Discovery Type decides whether Inspire may read your data at all. Genie Code notebooks are written to deliver their use case, not only to run: every acting row says what to do next, tiers follow the evidence, statistical tests can say no, explanations word facts the code computed, and a model that misses acceptance still publishes its baseline (section J).

### A. Discovery Type: Standard And Deep

`04. Discovery Type` (`03_discovery_type`) is `Standard Discovery` by default from v1.4.0. v1.4.0 renamed `Deep` to `AI Enhanced Discovery` and made `Standard Discovery` read the same aggregates while showing none of them to the AI; see [Discovery Type](#discovery-type). The table below describes v1.3.0.

| | Standard | Deep (default) |
|---|---|---|
| Metadata | `information_schema`, `SHOW` and `DESCRIBE`, Unity Catalog metric view definitions, usage counts from `system.access.table_lineage` (reads, number of distinct readers and tables read together over 90 days; no user identity and no query text is kept) and Inspire's own tables | Everything Standard reads |
| Your data | Never read | Aggregates only: row counts, null share and approximate distinct count per column, first and last date of each non-personal date column, up to 20 most frequent values of non-personal text columns with at most 50 distinct values, join match rates on known keys, KPI baselines |
| Query history | Not read | Join edges mined from `system.query.history` (last 30 days, up to 5,000 statements that mention the scanned catalogs); statement text never reaches the AI |
| Data rows sent to the AI | 0 | 0 |

Deep never reads the values of a personal column. A column named like personal data (email, phone, names, address, postcode, national or tax ID, passport, license number, IBAN, account or card number, birth date, IP address, coordinates) or tagged `pii`, `personal`, `sensitive`, `confidential`, `gdpr`, `hipaa`, `phi`, `pci` or `restricted` gets counts only: no value list, no first or last date and no `MIN` or `MAX` KPI. Deep reads stop at 900 seconds in total and 120 seconds per statement, and cover at most 80 tables, 80 columns and 8 value columns per table, 40 joins and 60 KPI baselines. Tables over 1,000,000 rows are profiled on a 1,000,000-row slice. A table Inspire may not read stays Standard and the run goes on.

In Deep, the profiles and observed joins go into the generation context, and extra checks run before scoring: a use case is dropped when its primary table is empty, its label column has a single class, the join it needs matches under 5% of rows, or its key signal has fewer than 30 non-null rows. Thin date coverage and mostly-null signals are flagged, not dropped. Every document states what was read, for example "Deep discovery: Inspire read aggregates from the tables in scope, 12 in total".

After scoring and selection, Deep also checks that each use case's own data holds the signal its technique needs, with the same readiness rules the build applies plus one test per technique family. A prediction needs a signal column whose average differs by at least 0.1 standard deviations between the outcome's classes (or a correlation of at least 0.05 with a numeric outcome). A pricing or other lever optimization needs the outcome volume to move with the lever, with a correlation of at least 0.05 overall or within its groups. A recommendation needs two items that appear together in 20 or more baskets at 1.2 times the rate chance gives. A forecast needs 2 seasonal cycles and an autocorrelation of at least 0.2 at a lag of one period or one season. A clustering needs 3 numeric features, an anomaly detection 3 distinct values, a comparison 2 groups of 30 rows, and a text use case text in half its rows. The AI names the columns of each use case's table; Inspire checks they exist with the right type, writes every query itself, reads only counts, averages and correlations, and samples a table over 1,000,000 rows by a hash of its key, so a basket or an entity is kept whole. A personal column is read only where its values are counted (a basket, item, entity, group or series key). A key or a code stored as a number, such as an id, a surrogate key or a ZIP code, is never read as a signal, an outcome, a lever or a measure, because its numbers name things rather than measure them; it can still be a basket, item, entity, group or series key. A use case that fails is dropped with the reason, for example "the data shows no signal: quantity does not move with sales_price: the strongest correlation, across all rows or within each item_sk, is 0.0010". A use case the instructions ask for, and the strongest use case of a business domain you named whose use cases all fail, stays and says "The data shows no signal". A use case whose columns sit in several tables, or that the check could not read, stays unchecked and says why. The check spends at most 600 seconds (runtime key `deep_signal_budget_seconds`), separate from the profiling budget, and its counts are in the funnel and the step "Data Signal Check". Standard never runs it.

### B. Strategy-Blind Discovery And Grading

Generation, the quality checks, the 19 gates, Best-of-Best and the Ultra High elite judge never receive your goals, priorities, strategy entries, KPIs, key results or sponsors. Inspire computes Value and Priority itself from the model's sub-scores: before selection, `Value = ROI x 0.80 + Time to Value x 0.10 + Reusability x 0.10` and `Priority = Value x 1.5 + Feasibility x 0.5`. Your own scope written in `09. Generation Instructions` still steers discovery as before. Generation keeps a use case only when its decision moves revenue, cost or loss directly, moves a line of the Revenue Model, a Value Chain step or the Strategic Initiative of the business context, or automates manual work.

Every business table can reach a use case. Foreign keys named after the referenced table's own key are inferred (`ss_cdemo_sk` -> `customer_demographics.cd_demo_sk`, `ss_addr_sk` -> `customer_address.ca_address_sk`, `ss_promo_sk` -> `promotion.p_promo_sk`), and the coverage catch-all keeps a master or reference table that a declared or inferred foreign key path joins to a transactional table (up to 4 hops, sending the bridge tables along), not only one that shares a column name. In five recorded TPC-DS runs the catch-all excluded `customer_demographics`, `household_demographics` and `income_band` every time, and no use case used them or `customer_address`, so demographic segments, customer geography and income bands were never proposed. A reference table is also part of the run's known tables now, so a use case that cites one the generation batch sent is no longer rejected as a hallucinated table: the first catch-all run (U13) rejected 13 such use cases, all on `income_band` and `household_demographics`.

### C. Strategic Context And Post-Selection Alignment

`11. Strategic Context` (`10_strategic_context`) takes inline JSON or a Workspace or Volumes path starting with `/`. It holds one strategy tree in your own words: 1 to 4 level names (for example `Strategic Pillar` and `Business Objective`), entries with optional KPIs and key results on any entry, business priorities, a sponsor roster, and labels for your own terms (`priority`, `kpi`, `key_result`, `sponsor`). Tree priorities replace `08. Business Priorities`. Without a strategic context, Inspire aligns to the goals it inferred, as a one-level tree.

After selection, `STRATEGY_ALIGNMENT_PROMPT` aligns each final use case to at most 2 entries. Every alignment must cite the use case's own columns or KPI, or it is dropped and the use case is `Not aligned`. An entry with KPIs must be measurable: when no aligned use case computes one of its KPIs, its use cases are aligned again without it and the entry is reported as a gap. A strategy KPI about a physical quantity (emissions, energy, weight, volume, distance or temperature) links only to a column that names that quantity, so a cost is never reported as an emission. A rate, share or ratio KPI is built as numerator / denominator on one table (times 100 for %). A KPI is named only for what it computes: a total is never called a rate, and a value only a model produces later (flagged, predicted, at risk) is never a baseline; a strategy KPI computed another way is kept and marked as a proxy. Alignment never adds, keeps or removes a use case. Inspire then recomputes Value with Strategic Alignment at 25% (`ROI x 0.60 + Strategic Alignment x 0.25 + Time to Value x 0.075 + Reusability x 0.075`), then Priority and the Inspire Score, and the final order follows the Inspire Score. Each final use case lists the business priorities it serves in `Business Priority Alignment`, and each matched priority raises its Strategic Alignment by 0.25 (at most 2 priorities, capped at 5). Strategic Alignment carries a quarter of Value, so this reorders use cases with close scores and never adds, keeps or removes one. Strategy entries that no data-backed use case supports are reported as gaps.

### D. KPIs, Key Results, Measures And Benefits

Every final use case gets up to 3 KPIs, expected key results (from your strategy, plus up to 2 proposed ones), up to 3 measures of success, and up to 3 financial and up to 3 non-financial benefits. A KPI is a structured spec: an allowlisted aggregate over a named column of the use case's own tables, or a measure of a Unity Catalog metric view, with an optional filter and a time window. A filter is refused only when the data evidence lists every value of its column and the value is not one of them; the KPI is then not computable rather than counted without the filter. A SUM, AVG, MIN or MAX over a column that is not a number is not computable either, and every SUM, AVG, MIN, MAX, ratio and metric view measure returns a DOUBLE, so a DECIMAL column gives a number the notebook's summary step can format. A rate, share or ratio is a numerator divided by a denominator on the same table. A numerator equal to its denominator is refused because the ratio never changes, and a % unit is kept only for a share (COUNT over COUNT, COUNT_DISTINCT over COUNT or COUNT_DISTINCT, SUM over SUM). A KPI named for something its computation does not produce is renamed, and a strategy KPI computed another way is kept as a marked proxy. Inspire builds every KPI query itself; the model never writes SQL that Inspire runs. In Deep, Inspire measures the baseline and records it with its window and date. In Standard, it writes the query only. Figures in benefits come only from you or from a measured baseline; any other number is replaced with a labeled placeholder such as `[ASSUMPTION: uplift to be agreed with the sponsor]`.

### E. Shared Data Foundations

Tables and joins that two or more final use cases need are grouped into foundations, ranked by how many use cases they unlock and then by those use cases' summed Inspire Score. Each fact table anchors its own foundation with the dimensions it joins, so a shared dimension such as a date or product table appears in several foundations instead of merging them into one. The delivery order lists use cases foundation first. Inspire writes no durations or dates.

### F. Feedback And Value Tracking

The Inspire App writes accepted, rejected, planned and implemented use cases to `<inspire_database>.__inspire_feedback`. The next run for the same business excludes the rejected ones, carries the history of the others, and reports the KPI of each implemented use case now against its stored baseline. A rejected use case is matched on `use_case_key` (title plus primary table) and also when the next run proposes it again in other words: the deduplication review is told which use cases were rejected, and afterwards a candidate on the same primary table is excluded when its subject (the words before "with") shares at least 60% and its whole title at least 50% of their words with a rejected title. Each such exclusion is logged with both scores and listed under "Hidden by feedback" with the new wording. Deep measures it; Standard writes the query only.

### G. AI Call Log

Every LLM call attempt is written once to `<inspire_database>._ailogs` with the full request and response, in the same table design as Semunity (`agent = inspire`). Statuses are `success`, `failed`, `timedout`, `exhausted` (no attempt succeeded) and `hedged`. Cache hits are not logged, and a log write never fails a call. Without an inspire database, the rows go to `ailogs.jsonl`, which the live log streamer copies next to the live log. Each run ends with an `[AILOGS CHECK]` line. Its non-success check counts model calls only; failed startup probes (an endpoint the workspace cannot serve, or one that rejects temperature) are counted apart. When the run's identity may not write `_ailogs`, for example a table the Inspire App's service principal created and you run the notebook as yourself, the first refused write logs one `[SPOOL-DENIED FIRED]` warning naming the table, and no row is sent to it again in that run. The rows stay in a local spool that the live log streamer copies next to the live log as `ailogs.jsonl`, and the run-end check fails `rows_reach_the_table`. A refused `__inspire_step` write is handled the same way. Before, each chunk of rows was retried 5 times and then quarantined with an ERROR line, while the check still reported every check passed.

### H. New Outputs

| Output | What is new |
|---|---|
| Excel and CSV | One column per strategy level (customer tree only), KPIs with baselines, expected key results, measures of success, financial and non-financial benefits and data foundations. Your labels rename the priority, KPI, key result and sponsor headers |
| PDF | A value block under each use case card and a shared data foundations section |
| PowerPoint | A value slide after each use case card and a foundations slide |
| Markdown | The value lists and a foundations table |
| Genie Code notebooks | Three cells: the title with the use-case card and the copy line, the instruction, and Run controls that run the notebook as its tagged job. KPIs with baselines, expected key results and the read-only KPI queries are appended to the instruction |
| All documents | A data-access statement that matches the discovery type |
| Translated documents | KPI names and proposed key results are translated; your own KPI names and key results keep your wording |

### I. Best of Best

When the catalog holds more than 20 use cases, the run stars up to 20 of them as Best of Best, so a reader can start with a short list instead of the whole catalog. A catalog of 20 or fewer is already the short list, and nothing is starred. Nothing is removed: the catalog keeps every selected use case, in the same order. A star means the use case passed every test of the Ultra High elite judge: a value tier of Transformational or Material, at least 8 out of 10 on business value, evidence strength, implementability and actionability, the columns and joins it cites verified against the table metadata, no fatal flaw found by the red team, and, for a near miss, the confirmation of a second model. Use cases with a Best-of-Best score under 5 are not judged.

- **How many.** `16. Best of Best Count` (`16_best_of_best_count`) sets the number, from 0 (no stars) to 100, and stars are only marked when the catalog holds more use cases than that. Empty means 20, unless your generation instructions say otherwise, for example "star the top 10 use cases". The widget wins over the instructions.
- **Which ones.** The highest elite scores win. The best passing use case of each business domain you listed in `06_business_domains` is starred first, and no domain takes more than a quarter of the stars (at least 2) while other domains still have passing use cases.
- **Fewer than the number.** When fewer use cases pass every test, only those are starred. The others are listed as near misses with the test each one failed, and nothing is padded.
- **Where.** The PDF card, the slide and the Markdown entry of a starred use case carry a line such as `★ Best of Best #3 · Elite Score 8.6 / 10`. Excel and CSV have a `Best of Best` column with the star rank and a `Best of Best Reason` column for every use case. The Inspire App marks starred use cases and filters on them.
- **Ultra High.** The elite judge already ran during selection, so the stars reuse its verdicts and no use case is judged twice. In Good and High the judge runs once more on the final catalog, on copies, so the catalog's scores and order never change; a use case that passes every elite test keeps its verified assessment (it is not marked Elite), so its notebook card shows the decision, owner, cadence and KPI, its Genie Code instruction uses the verified columns and joins, and its job gets a paused schedule at that cadence. A key column (for example `return_reason_sk`, `reason_code` or `review_id`) is never counted as a free-text column, so an `ai_query` that only annotates a numeric result does not make a use case AI text processing.
- **One judge per run.** Every elite judge call of a run, in Ultra High selection and for the Best of Best stars, starts on one model: the first healthy endpoint of `elite_judge_preferred_endpoints` (default `databricks-claude-opus-4-8`, the model the bars were calibrated on), else the first healthy judge endpoint. Another model judges only after that one is demoted or unusable (`[ELITE-JUDGE-PINNED FIRED]`), and the second opinion comes from the first healthy model other than the judge. Before this, each batch took the head of the cascade at the moment it ran: on the TPC-DS runs U11 and U12 the same catalog got 12 and 5 stars because U12's batches were judged mostly by a stricter, newer model.

### J. Three-Cell Genie Code Notebooks

A Genie Code notebook now has three cells that Inspire writes. The first is a short use-case card: the title, the Best of Best star when the use case has one, and up to five rows (what it does, the decision with its owner and cadence, the KPI, the tables it reads and the business output table; the decision and the KPI appear only when the elite assessment found them), then a one-line disclaimer and the line "Copy the cell below into Genie Code without the surrounding quotes (the `r"""` and `"""` lines), and let Genie Code implement it." The second holds the Genie Code instruction as a code cell. The third, Run controls, is the last cell and ends with `inspire_main()`. You copy the instruction into Genie Code, and Genie Code adds its cells between the instruction and the Run controls: each build step is a function, and `run_use_case()` runs them in order. Running the notebook only defines the steps until `inspire_main()` runs the use case once, as the notebook's tagged Databricks job (Execution = As job, the default) or in the session (Here), so Run all never runs the work twice. No cell needs filling in: the Parameters cell Genie Code builds creates the use case's widgets with their defaults.

- **The instruction stands on its own.** It names every table, column, join, outcome rule and threshold, the method and its baseline, the business output table with its columns, and when to stop. It never refers to cells, functions or files Genie Code would not have, because Genie Code reads only the instruction.
- **Widgets.** The first build step is a Parameters cell that creates one text widget per setting, with its default and a label that says what it is for, and reads each widget into a typed variable that every later step uses. Every notebook gets `result_table`, `ai_endpoint`, `as_of_date` (`latest` means the last period that is complete in every event table the features and the outcome read, resolved by the first step of `run_use_case()`), `act_now_share` (0.05), `review_share` (0.2) and `explanation_top_k` (200), plus `model_name` for scoring, anomaly, segmentation and recommendation use cases, `horizon` and `season_length` for forecasts, and one widget for each readiness and acceptance threshold of the use case's execution pattern. Inspire restores any of these that the model leaves out or changes. Up to 6 more widgets come from the use case itself, and each is kept only with a default. Change a widget and rerun the notebook to change the run without editing code.
- **The stop rules hold, and a failed acceptance still delivers.** The notebook first checks data readiness against the thresholds of the use case's execution pattern, including the data shapes the elite judge flagged and a date that is reached through a join. When a check fails, it prints the measured and required values and writes nothing, but keeps every cell, so a rerun after a widget change runs the whole notebook. Data freshness is the exception: a forecast on data older than `max_staleness_cadences` is still written from the newest data, with every row flagged `data ends <newest date>`, so no row is acted on. Acceptance follows the pattern. A scoring, anomaly, segmentation or recommendation model that does not beat its baseline registers no model and writes the baseline's rows (method = the baseline), scored by the baseline model for every entity of the scoring population; a constant such as the class rate is only what the baseline is compared with and is never written. When the baseline also misses the thresholds, every row is Monitor. A sample of at most 5,000 entities is used for evaluation only; the scoring and the business output keep every entity. A forecast that does not beat the seasonal naive forecast publishes the seasonal naive forecast. A group comparison writes every finding with its effect size and q-value, and one that is not significant is Monitor. A simulation that finds no plan better than the current one writes the current plan, every row Monitor. An AI text step whose error rate is too high writes nothing.
- **Every row says what to do.** The `recommended_action` of an 'Act now' or 'Review' row is its tier's text followed by its own next step, from a fixed template in the instruction filled with the row's computed facts, for example "Act in this cycle: review pricing for Books, store 10; main driver deeper price cuts". The step serves the elite assessment's decision, else the deliverable the use case name promises after its last "with". Only rows that pass the use case's decision test (significant, past the cutoff, a planned change, enough evidence) can be 'Act now' or 'Review'; a row whose expected impact is a loss never passes, and a row with a data quality flag is Monitor. A weight computed from the data, such as a margin, is printed before it shapes the value, and one that is zero, negative or the same for most rows never multiplies the value: on TPC-DS every item's unit margin is negative, and a margin-weighted score clipped at zero once wrote a value of 0 on all 454,360 recommendation rows. A share or a concentration, such as a Pareto curve or a Gini, on a measure that can be negative analyzes a group with a negative total on its losses and a group with a positive total on its positive values, so no group is dropped for its sign: on TPC-DS, 2 of 700 store and class groups made a profit in the last quarter of 2002, and a profit Pareto that kept only those gave one q-value to all 4,979 rows it tested. Rank follows the stake: the value times the row's exposure, such as its sales or loss, when the method gives both. Rows that pass the decision test rank first, then the unflagged rows, then the flagged rows, so a row without enough evidence never outranks one with it. A row the method computes no result for, such as a sender with no recipient left to test, holds a NULL value, never 0 or the baseline. `data_quality_flag` holds only the row's own input problems and the flag a failed run-wide check sets on every row; notes about the whole run go to the summary step. A statistical result is never a flag: a finding that is not significant keeps 'ok' and says so in its top reasons. The flag is never NULL: it is set on the final frame after its last merge, so a row a merge left without a test gets the reason its inputs are missing, and `top_reasons` holds at most 3 distinct facts the row has, one fact per reason, never a repeated reason or filler text, with a score whose scale a reader cannot judge, such as a PageRank, given as its rank by that score alone among every row that has the score. Every number in a row's text comes from one formatter that rounds to 3 significant figures before it picks the K, M or B suffix, and the notebook asserts 8 of its cases (109.96 gives 110, 999.6 gives 1K, 1060 gives 1.06K) before it builds any text; a ratio carries its unit, x for a multiple and % for a share. Significance tests run on observed values with library statistics (statsmodels or scipy, never a hand-written statistic) and handle seasonality inside the test, with season indicators in an OLS over the full history or by comparing each period with the same period a cycle earlier; they never follow a smoother such as STL, whose trend absorbs a short series' noise, use HAC standard errors only from 30 points, leave out the incomplete latest periods of an event that lags another (a return after its sale), and compare seasonal data with the same season of earlier cycles: a cohort is compared with earlier cohorts that started in the same quarter or month, and the cohort of the data's first period, whose members may predate the data, is left out. A window whose outcome takes time to observe, such as a lapse window, a cohort's period offset or a funnel's conversion window, is closed only when its last day plus that time is before the as-of date: training, holdout and baseline windows are chosen by that test, never by which cases already have an outcome, and a case whose window is still open is scored or left out, never counted as a negative. Numbers in the reasons, the actions and the `ai_query` prompts are formatted by one Python function (3 significant figures, a unit for large amounts, `< 0.001` for tiny p-values) and never turned into text in SQL, where a cast writes the raw double. Explanations are written only for 'Act now' and 'Review' rows, and each row's explanation prompt is built in pandas from its computed facts and asks the model only to word them, never to pick the driver. They run on a fast chat endpoint: a worker model of the roster, else the workspace's newest Claude Sonnet, Haiku or GPT OSS endpoint, which the startup probe checks. Each expensive step (a model fit per group, an `ai_query` call) runs in one Spark action and is collected to pandas once, because serverless has no cache. A frame from `toPandas()` has its `attrs` cleared at once, because Spark Connect stores the query's metrics there and pandas copies them into every row `iterrows()` yields, and row text is built with vectorized operations or `itertuples()`. Keys, ranks and counts stay integers, and `run_id` is one uuid made at the start of each run, never the MLflow run id, which exists only when a model is logged. `ai_query` takes `failOnError => false` as a named argument: written as `named_struct('failOnError', false)` it returns plain text and fails on the first error.
- **What it writes.** Only the business output table (`<result_table>`, the same 16 columns as before, one row per entity and as-of date) and, for scoring, anomaly, segmentation and recommendation use cases, the Unity Catalog model `<catalog>.<schema>.<table>_model` with the alias `champion`. It never writes to your source tables, and the only job it creates is its own tagged job (below).
- **KPIs come along.** When the strategy alignment defined KPIs, key results and read-only KPI queries, they are appended to the instruction, and the notebook's summary step, the last step `run_use_case()` runs, reports each KPI's current value against its baseline.
- **Names Inspire could not verify** are listed at the top of the instruction, with a request to check each one with `DESCRIBE TABLE` before using it.
- **Tested with Genie Code.** With the Genie Code CLI (v0.2.0, GPT 5.6 through Unity Gateway) on TPC-DS, Genie Code built and ran the notebooks of 13 use cases from 7 execution patterns (scoring, anomaly, recommendation, cohort analysis, trend analysis, forecast and simulation) from their instructions alone, in rounds 0 to 37: 8 use cases in rounds 0 to 17, then the 5 Genie use cases of the release run U20. After each round, every step Genie Code had to repair on its own and every defect in the rows it wrote became a general rule, the instructions were regenerated through Route 1, and the next round ran on them. Rounds 0 to 6 were graded on 13 structural checks (cells built, environment pinned, widgets created with defaults and labels and read, readiness checks, only the instructed tables, the business output table and columns, the `ai_query` contract, a clean finish, no self-repair); round 2 passed 78 of 78. Those checks never read the output. Reading it after round 6 showed notebooks that ran without delivering their use case: one action text per tier on every row, 'Act now' on findings that were not significant, an anomaly queue led by a $21 loss, a margin-erosion test on the smoothed STL trend that gave all 60 series the same q-value, explanations that named another driver than the computed one (5 of 28), keys printed as floats, and 3 of 8 notebooks that wrote nothing. From round 7 each notebook is also graded on the rows it wrote: rows written, values that vary, tests that do not flag every series, a row-specific action on every acting row, tiers that follow the evidence, per-row flags, explanations stored as text and only on acting rows, explanations that match the computed driver, and formatted numbers. Notebooks that passed every value check at the end of their round: 2 of 8 in round 7 (4 ran past the 45-minute limit; each sent 200 explanations to the slowest model), 4 of 8 in round 8, 3 of 8 in round 9 (a raw join and a 300-series backtest fitted one by one ran past the limit), and 7 of 8 in round 10, in 4.8 to 18.9 minutes. One of those 7, the trend analysis, was still wrong in a way the checks could not see: its test, following the guidance of the time, called 48 of 60 flat series significant; reproducing it offline showed that robust STL had put the noise into its trend and that HAC errors from 12 points gave p = 1e-53. In round 11 the trend analysis fits OLS with month-of-year indicators and flags 2 of 60 series, and all 3 notebooks of the round passed; in round 12 one notebook wrote an unformatted score into its explanations, because our rule said "formatted in code" and it built the prompt in SQL with a cast, and the two notebooks ran 41.4 and 25.0 minutes: a frame from `toPandas()` carries the query's metrics in `attrs` (505,014 characters), and pandas copied them into every row `iterrows()` yielded. From round 12 the grader also reads the run log, so a resubmission after a change counts as a repair and a final run longer than 20 minutes fails. In round 13 those two notebooks passed every check in 4.0 minutes each, but the recommender wrote 454,360 rows with value 0.0: its use case weighted the score by unit margin clipped at zero, and every TPC-DS item's margin is negative. In round 14 its values varied, and it wrote a NULL `run_id`, taken from MLflow, on every row. In round 15 the scoring, anomaly and routing notebooks passed every value check, with final runs of 1.5 to 2.2 minutes, and the recommender filtered out every item without a positive margin and stopped. In round 16 the recommender passed all 25 checks, and the scoring notebook wrote 306 rows that all carried the class rate: the instruction said "write baseline-rate rows", and an evaluation sample of 5,000 rows taken before the split left 306 of about 28,000 customers to score. In round 17 the scoring notebook wrote its logistic baseline for all 28,311 customers, three of the four notebooks passed all 25 checks, and every final run took 1.5 to 2.5 minutes. In round 18, on the 5 Genie use cases of U20, 3 notebooks stopped with data they needed: a readiness assumption about order lines was counted on the 20-row `ship_mode` table, and a Pareto and a gifting network treated every item or sender as a group. In round 19 all 5 wrote rows, but an uplift notebook trained on a window without a positive outcome and wrote one value on 9,819 rows. Round 20 ran the new layout (a short card, Run controls last, every step a function that `run_use_case()` runs, called once from Run controls): all 5 notebooks defined `run_use_case()`, wrote rows and passed every value check, 4 of 5 kept Run controls as their own last cell, and 2 resolved `latest` in the Parameters cell, so the job run resolved it again. In round 21, on the instructions with those rules, all 5 notebooks passed every value check and all 20 layout checks (Run controls last and unchanged, `run_use_case()` built, no work at top level), wrote 2,927 to 49,964 rows in final runs of 1.1 to 1.8 minutes, and every Genie Code session took 4.5 to 8.8 minutes (5.0 to 45 in round 20). Its 6 remaining repairs were Genie Code's own slips: a Spark `&` without parentheses and a per-group sample that dropped its key, both now rules, a categorical dtype lost in a permutation, and a write it switched to `replaceWhere` itself. Each of these became a rule. In round 22 the Pareto notebook stopped with its 53,999 items unwritten, because its halo test asked each item for 30 tickets, a round number no tail item reached, and Genie Code reported success from the rows round 21 had left in the table; the gifting network ranked first the senders whose 1 of 1 recipients converted, and its 17,171 binomial tests all had q = 1.0. A per-unit test now takes its minimum sample from the test itself, ranks rates shrunk toward their baseline and never stops the run, and `run_use_case()` returns the run's outcome, which the job run hands back. In round 23 all 5 notebooks wrote rows (3,257 to 53,825) and returned their outcome, in final runs of 1.1 to 2.7 minutes and Genie Code sessions of 4.0 to 8.3 minutes, and the round passed 147 of 151 checks. Its repairs became rules: a ratio over a zero column, which raises `DIVIDE_BY_ZERO` in serverless ANSI mode, a per-group result frame built without its columns, a readiness CTE that dropped a date key a later join read, and, from round 22, an index that a landmark expansion duplicated. Its one value failure came from the use case's design, the profit Pareto above, and Inspire's guidance for the nine group-comparison patterns, which said that groups below the minimum stop the run, now says what readiness does: they are left out and counted. In round 24 the profit Pareto passed all 31 checks, analyzing each losing group on its losses, and 4 of 5 notebooks wrote rows (2,939 to 53,296) in final runs of 1.4 to 2.1 minutes. The lapse-timing notebook stopped: it took the newest quarter with any closed spell as its holdout, and in that quarter the only closed spells were those with an early reorder, so the holdout held one class. Inspire's guidance said "the most recent closed window" in 9 places without saying what closed means; it now defines it once, for every scoring, survival, cohort and funnel notebook. The round's other slips also traced back to Inspire's rules: a pyfunc model passed by position to `log_model`, the way Inspire's MLflow rule showed it, collided with `artifact_path`; a network notebook written as a source file lost the separator above Run controls, so its code and the Run controls became one 572-line cell; and a feature step dropped a key the output's quality flag read, a reader the column rule did not name. In round 25, on the instructions with those rules, all 5 notebooks wrote rows (2,939 to 53,999) and passed every value check, the lapse-timing notebook among them with 27,298 rows, in final runs of 1.4 to 3.4 minutes and Genie Code sessions of 3.8 to 6.8 minutes, and the round passed 148 of 150 checks. Its 2 repairs became rules. The uplift notebook built its prior-order features with a rows frame, so a second order on a day read the first one as its history and the leakage guard stopped the first run, as it had in rounds 19 and 20; a window over earlier or later dates is now a range frame on the date as a day number, which a check on serverless confirmed (10 for that order, against 30 from the rows frame). A network notebook joined on a key that one side had renamed, a slip of the same kind as the shared columns that made three joins ambiguous in rounds 7 and 8; a join now leaves each column name once. In round 26, on those rules, all 5 notebooks again wrote rows (2,939 to 53,999) and passed every value check, in final runs of 1.5 to 2.8 minutes, and the round passed 148 of 150 checks; the uplift notebook built its windows as range frames and the network notebook its joins, both with no repair. Its 4 repairs became rules. A freight notebook read its `itertuples()` rows by name in brackets, which a named tuple does not allow. A Pareto notebook, whose instruction returned each item's tickets as an array, failed twice on those arrays, first on an array tested as a condition (`x or []`), then on inf replaced over the whole frame, which compares every array; the rules now say how pandas holds an ARRAY value and replace inf in the numeric columns only. Its third run failed because a step read a value another step computed without receiving it as an argument, and each step now receives those values as arguments. That Genie Code session took 26.3 minutes for its 4 runs, against 4.3 to 6.8 minutes for the other 4 notebooks. In round 27, on those rules, all 5 notebooks wrote rows (323 to 53,268) with no repair, in Genie Code sessions of 4.6 to 8.3 minutes (5.0 for the Pareto notebook), and the round passed 150 of 151 checks; the miss was the grader's, since the lapse notebook checked its outcome under another name. Reading the rows found 3 defects that came from Inspire, not Genie Code. A check that runs each notebook's own number formatter showed that all 40 notebooks of rounds 20 to 27 wrote some numbers wrong, 110 as 11 or 999.6 as 1000, because the rule described the format but not how to round; it now gives the algorithm, and the notebook asserts 8 cases that both formatters Genie Code wrote fail. Inspire's acceptance text for group comparisons told the instruction to flag a finding that was not significant, so no row of the Pareto or the network notebook kept 'ok', and the network notebook ranked 153 senders without enough evidence above the 55 it could test, while the uplift and lapse notebooks ranked flagged rows among unflagged ones; a result now stays out of the flag, and flagged rows rank last. In round 28, on those rules, all 5 notebooks wrote rows (2,939 to 53,095) in Genie Code sessions of 6.1 to 10.3 minutes; every notebook's formatter passed its 8 cases, and every notebook ranked its flagged rows last. Both repairs of the round fixed code that Inspire's own rules prescribed: the freight notebook's `groupby(key).sample(n=...)` raised on a ship mode with fewer rows than n, and the uplift notebook's leakage check compared the NULL history of a customer's first order with the 0 its feature step wrote; both rules now name a method that works on every row. Reading the rows found 4 more defects from Inspire. The network notebook tested none of its 46,353 senders and flagged every one, because readiness counted cohorts of senders with any closed gift, while the test needed each sender's own minimum of closed recipients and a cohort of 30 such senders on top of it; a unit's own minimum is now its only gate, and readiness counts with the same rows, filters and minimum as the step it guards. The Pareto notebook wrote 18 rows with a NULL flag and a NaN value, from a merge that left them without a flag and a column assigned from a list after the None conversion, and the lapse notebook wrote more than 3 reasons on all 27,261 rows and repeated one on 11,066; the flag is now set on the final frame, the None conversion is the last change before the write, and each reason is a distinct fact. No notebook's printed numbers, its readiness counts and metrics among them, reached its job run's output, because a cell that calls `dbutils.notebook.exit` loses what it printed; `inspire_main()` now returns everything `run_use_case()` printed under the outcome. The Pareto found no significant halo on TPC-DS, so all 53,095 of its rows are Monitor. The grader now also checks NULL flags, NaN values, repeated reasons, the printed log and that readiness left units to test, and round 28 passed 188 of its 200 checks. In round 29, on those rules, all 5 notebooks wrote rows (12,608 to 107,681) in Genie Code sessions of 4.3 to 40.4 minutes, and every job run returned its printed log under the outcome. Seven of its 8 repairs fixed code that followed from 4 gaps in Inspire's rules. Three leakage checks computed the features a second way and stopped runs that had no leakage (on an approximate median, a sample with NULL keys and same-day orders); the check now tests the dates each step read. The Pareto read the integer date key 2452642 as a date, because its tables listed no date table, which Inspire now adds. The uplift notebook trained only on each customer's latest anchor and found no positive before the holdout, and the freight notebook looked columns up on repeated order numbers, which failed and then grew 38,079 rows to 362,652. Reading the rows found 4 more defects: the Pareto gave every item its group's value, so the items of its 594 groups were ranked on nothing, and its reasons said 'unknownx class ticket'; the lapse notebook sorted on the flag text, so 7,242 flagged rows ranked from 1; and the uplift notebook's fallback wrote uplift 0.0 for all 12,608 customers instead of its baseline's scores. The Pareto also moved 2,677,771 rows to pandas and tested 107,132 items in a loop on the driver, so its run took 16.0 minutes. Each of these now has a rule; round 29 passed 197 of its 205 checks, and the grader now also checks that a row's value is its own and that no reason states a missing value. In round 30, on those rules, all 5 notebooks wrote rows (2,939 to 53,296) in Genie Code sessions of 5.8 to 10.1 minutes and final runs of 1.7 to 2.7 minutes, and the round passed 206 of 210 checks, every value check among them. Reading the rows still found 8 defects, each traced to Inspire. Route 1 had regenerated the instructions without joins, because only Discover inferred them, so no date table reached TABLES; a Generate run now infers them too. The uplift notebook trained on every closed quarter, as the rule then said, so the quarter before the holdout labeled its reorders on the holdout's days. The network notebook first required both extreme outcomes of its test to reach significance, which raises the minimum wherever the base rate is skewed. The acceptance texts called every finding 'not significant', so 38,280 untested Pareto items said it in their reasons. The freight notebook wrote ship costs above the sales price as '2.35K%' of sales (47 of 2,939 rows), the uplift and lapse notebooks wrote '1 prior catalog orders' (4,172 of 12,494 and 9,302 of 27,261 rows), and the network notebook packed 5 facts into 2 reasons on 51,643 of its 51,644 rows and named influence only as a bare PageRank such as 0.00000646. The grader had passed all of these, so it now also checks untested results, ratios written as percents, plural nouns after 1, packed reasons and bare scores. In round 31, on those rules, all 5 notebooks wrote rows (323 to 53,825) in Genie Code sessions of 5.5 to 12.6 minutes and final runs of 1.4 to 2.5 minutes. The freight notebook now wrote one row per order, its entity key, instead of one per order line (323 orders, against 2,939 lines in round 30), and its reasons read '7.32x the peer median'. The round passed 223 of 236 checks, and reading the rows found 10 more defects. One came from a round 30 rule: the per-unit minimum took either extreme outcome at the uncorrected level, so the Pareto tested 49,803 items from 6 tickets, with a median of 10, and every q-value was 1, since one item needed 21 tickets to pass a correction over 49,803 tests on its own; the minimum is now the smallest sample whose extreme outcome passes that correction. One came from the platform: serverless retried a failed test run of the lapse notebook after its final run, and the retry's 27,314 rows replaced the final run's; test runs now run one at a time with retries off, and the last run checks that the rows carry its run_id. The lapse notebook also sorted on the flag text again, so 7,220 flagged rows ranked from 1, and the rank is now checked before the write. Counts and ranks still went wrong: 20,891 network rows read '1 new recipients', 60 lapse rows '1 days' and 38 Pareto rows '1 tickets', and senders were ranked '1.01Kth of 51.6K'; both now go through `fmt_count` and `fmt_rank`, whose cases the notebook asserts. 6,496 lapse rows flagged 'no prior order history' still gave the reason 'unknown prior orders', and the text is now checked for missing-number words before the write. The Pareto packed the side of its share into the share ('in its class, head, ranked on losses'), a date parameter compared with a datetime64 column stopped a run, an uplift leakage check tested months that training had left out, and a freight order flagged 'missing gmt offset' gave the reason '294 peer lines, the median needs 5'. The grader now also checks ordinals, a count at or above the minimum its reason says the test needs, and that the final rows carry the reported run_id, and no longer counts the count-and-minimum reason as two facts; under it round 31 passes 237 of 251. In round 32, on those rules, all 5 notebooks wrote rows (2,789 to 53,999) in Genie Code sessions of 5.0 to 12.2 minutes and final runs of 1.8 to 2.7 minutes; every row carried the run_id its final run reported, and the freight actions named the order line, the carrier and its contract ('dispute order 159904 line 39 with TBS (REGULAR, contract 5EpqT)'). The round passed 246 of 251 checks, and reading the rows found 6 more defects, each traced to Inspire's rules. The freight notebook gave each row's queue rank as its anomaly score's rank, which was wrong on 28 of its 2,789 rows, even taking a tied score as any rank its ties span (the line it ranked 1st holds the 21st highest score), because the rule said "the row's rank among the scored rows"; the rank now comes from the score alone. Every one of the Pareto's 53,999 rows gave the reason 'solo rate 0%', and 3,454 read '0% of its class's losses', the zero its loss share gave the items of a loss-making class that did not lose money; a reason that is the same on every row is now dropped and printed once, and a row of the other sign states its own amount. The lapse notebook joined the typical reorder gap to the days since the last order with a comma on all 20,818 rows, the Pareto joined a share to its test result on 1,255, and the network notebook wrote 'baseline 11.4%' after a rate on 55; a comparison now names its reference after ', against', a test's result is its own reason, and the text is checked before the write. The Pareto's 2 repairs also came from the rules: its halo test cast counts that NULL class medians left missing with `astype(int)`, and its pre-write check stopped a run on a zero-total group's share, which its formatter wrote as 'unknown'. A count that can be missing is now a nullable `Int64`, `int()` and `round()` run only in a function that returns first on a missing value (round 31's coupon-lift notebook had guarded `round()` with `np.where`, which still ran it), and every row's reasons are built by `keep_reasons`, whose case the notebook asserts. The grader had failed the Pareto's tests, whose q-values were all 1, but its stated minimum of 17 tickets let one of its 1,255 tested items pass the correction from 16, so that was a true null result; the grader now accepts it, reads 'q-value' figures, and also checks reasons that are the same on every row, 0% shares and score ranks against the score. In round 33, on those rules, all 5 notebooks wrote rows (2,927 to 53,825) in Genie Code sessions of 4.6 to 11.9 minutes and final runs of 1.7 to 3.1 minutes. The round passed 257 of 262 checks, and reading the rows found 6 more defects, each traced to Inspire's rules. The rank rule still left each notebook to write its own sort: the coupon-uplift notebook sorted its 'ok' boolean ascending, so its 129 flagged rows ranked 1 to 129, and the gift-sender notebook sorted the flag text descending, so 51,589 senders below the test minimum ranked before the 55 it tested; `rank` now comes from one `rank_rows` helper whose case the notebook asserts, and the whole order is checked before the write. The freight notebook ranked the lines without a score with `na_option='bottom'`, so all 138 of them read '2,790th of 2,789 scored lines by anomaly score'; a row without a score now states no score rank. Genie Code repaired 3 more defects on its own: the coupon-uplift notebook labeled reorders with a window sum, which is NULL over a closed window with no order, the freight notebook's first leakage guard tested its fit lines against the peer medians computed from them and compared a bound its window excludes, and its first acceptance check found an agreement of 1.82 between two fits' top alerts, because acceptance never defined that agreement. A closed window with no event is now 0, a fit statistic is tested on the rows that read it, and the agreement is the share of the first fit's top k alerts among the second fit's top k. The grader had wrongly failed the freight notebook's formatter, whose helpers were defined inside a function, never read the gift-sender notebook's tested rows, which ranked after its first 5,000, and missed the 138 impossible ranks, so it now loads nested helpers, reads every tested row and checks that no rank exceeds the total it ranks among; under it round 33 passes 260 of 265. In round 34, on those rules, all 5 notebooks wrote rows (721 to 53,999) in Genie Code sessions of 5.8 to 14.9 minutes and final runs of 1.6 to 3.4 minutes. The round passed 258 of 265 checks, and 3 of the 5 notebooks passed every value check. Genie Code repaired 4 defects that Inspire's rules left open: the coupon-uplift instruction checked the holdout's horizon against the first scoring date, so Genie Code cut the scored customers from 12,608 to 721 to pass it; the lapse notebook combined its Spark conditions with NumPy, which raised CANNOT_CONVERT_COLUMN_INTO_BOOL; the Pareto notebook joined on an item class that can be NULL with an equality, so its items without a class lost their group figures; and the gift-sender notebook let a quarter into its prior-year comparison by its senders, then divided by a quarter with 0 closed recipients. The lapse notebook also repaired 2 slips against rules it already had. Reading the rows found 2 more defects: 1,418 of the lapse notebook's 27,298 rows said 'lapse window opens in -13 days' or another negative count, and 141 Pareto rows said '17 tickets, the test needs 17', because the sign test dropped the tied tickets that the reason still counted. The holdout is now never checked against the scored rows, a list of conditions combines with `functools.reduce`, a key that can be NULL joins with `eqNullSafe`, the count compared with a minimum is the sample the test computes on, `fmt_count` rejects a negative count, and `rank_rows` returns its ranks on its inputs' index, which 2 of the notebooks did not. The grader had wrongly failed the lapse notebook's readiness, whose key the instruction wrote in bold, and caught only the 13 rows at -1 days, so it now reads bold keys and checks every negative count; under it round 34 passes 258 of 270, and 263 without the negative-count case that round 34's rules add to `fmt_count`. In round 35, on those rules, all 5 notebooks wrote rows (2,939 to 53,273) in Genie Code sessions of 5.8 to 18.9 minutes and final runs of 2.0 to 5.5 minutes, and the coupon-uplift notebook scored 12,591 customers again instead of 721. The round passed 267 of 271 checks, and all 5 notebooks passed every value check. The 4 failures were Genie Code's own repairs, one in each of 4 notebooks: the freight notebook's `fmt_rank` raised on a missing rank while its reasons were built, the gift-sender notebook gave `F.when` a column name, the Pareto notebook read a column its instruction named `tail` as `out.tail`, which returns the method, and the coupon-uplift notebook's readiness counts read a join key it had dropped. Reading the rows found 3 more defects: 1,427 of the freight notebook's 2,939 rows said 'excess freight of -766 over the lane peer median' or another negative excess; 9 of its labels read '(None)' for a line without a carrier, and 11 of its segments and 173 of the Pareto notebook's kept an empty part; and the coupon-uplift notebook's 12,591 baseline rows ranked customers on a reorder probability in a use case that ranks them on lift. A missing rank now gives 'unknown' and every function a reason's text calls accepts a missing number, an amount takes its words from its sign, a label or segment leaves out a missing part and is checked before the write, the condition of `F.when` is a Column, a join's matches are read from a flag the other side adds, a baseline that estimates the use case's quantity writes that estimate, and the instruction never names a column after a DataFrame method. The grader now runs `fmt_rank` on a missing rank and checks for negative numbers and empty label parts; under it round 35 passes 269 of 281 checks, and 3 of the 5 notebooks pass every value check without the missing-rank case that round 35's rules add to `fmt_rank`. In round 36, on those rules, all 5 notebooks wrote rows (2,939 to 60,897) in Genie Code sessions of 5.3 to 14.8 minutes and final runs of 2.2 to 3.3 minutes, and the coupon-uplift notebook needed no repair. The round passed 275 of 279 checks, and all 5 notebooks passed every value check. The 4 failures were 6 repairs in 4 notebooks: the freight notebook's second-number check stopped on its own action and its summary named a missing carrier 'nan', the Pareto notebook summed a condition that was NULL on every row of a store-item and called `int()` on the result, the gift-sender notebook assigned rows of its sparse PageRank matrix and ran out of memory on 72,759 edges, then joined with an ambiguous column, and the lapse notebook checked its training rows for columns only its scoring rows have. Reading the rows and summaries found 4 more defects: the freight summary paired each carrier's alert count with its excess freight over all of its lines, so the Transportation Manager read that the queue's 19 alerts came with total excess freight of 1,136K; the Pareto notebook dropped the lines without an item but kept those without a store, so 6,898 of its 60,897 rows carried a key such as '<NA>-1'; the gift-sender target list put 3 segment rows at ranks 1, 2 and 4 among its senders; and the lapse instruction defined its population as repeat buyers, so the 6,490 single-order customers that round 35 wrote as flagged rows had no row. The second-number check now reads only the reasons, the summary prompt holds formatted facts over the rows each names, a condition is counted with `F.count_if`, a sparse matrix is scaled by a diagonal product, every row is one entity of the decision's population at the grain of its entity key, and a row missing any part of its row key is dropped before every step, with every key, label, reason and summary checked for the texts a missing value leaves, '<NA>' and 'NaT' among them. In round 37, on the rules of round 36 without its last fix, all 5 notebooks wrote rows (2,939 to 79,843) in Genie Code sessions of 6.0 to 13.4 minutes; the gift-sender notebook wrote one row per sender (51,644, with no segment rows), and the lapse notebook kept every customer with a catalog order (79,843 rows). The round passed 294 of 298 checks, 295 once the grader loaded a helper the freight formatter called. Its failures were 5 repairs in 2 notebooks and 51 coupon-uplift rows that read '1 days since the last catalog order', from a reason its instruction worded with a count before a plural noun. Three of the coupon-uplift notebook's 4 repairs came from frames a model read with other columns than its fit (columns in another order, a current and a prior copy of each demographic column under one name, and a counterfactual frame that selected its treatment before setting it), and the fourth, a training month whose horizon reached the holdout, was caught by its leakage guard; the freight notebook's formatter raised a TypeError on pandas' NA, as `fmt_num` in each of the other 4 notebooks did when called on it. Reading the rows found one more defect: the freight instruction moved entity_id to the order number and kept the item only in the label, so its 2,939 order-line rows held 2,380 distinct pairs of entity_id and segment_or_item. Every model now reads one list of feature columns, every formatter tests a missing value with `pd.isna`, a count of days agrees with its noun whatever the instruction's wording, and when an entity has several rows, the item or period that tells them apart leads segment_or_item, the rank breaks ties on that row key, and a check before the write stops on two rows that share it. In round 38, on those rules, all 5 notebooks wrote rows (374 to 107,681) in Genie Code sessions of 4.3 to 8.3 minutes and passed 293 of 300 checks, but reading the rows showed that the column meanings had reached Genie Code only through the instruction writer's paraphrase. The delisting instruction gave `value` as the effect size of the item's group concentration change, so its 107,681 item rows held 898 distinct values, and all were Monitor: 58,897 had too few tickets and the group test flagged every group for the rest. The coupon-uplift baseline missed its minimum AUC (0.487 against 0.6), yet 495 rows were Act now and 1,979 Review, because the writer left the Monitor clause out. The freight notebook met the new row-key check by writing one row per order (374 rows where round 37 wrote 2,939 order lines), the lapse notebook flagged 20,090 of its 27,298 rows 'censored, open window', the condition that puts a customer in its scoring population, and two notebooks wrote a score rank above its stated total or a count twice in a row's reasons, while 354 of the freight notebook's 357 score ranks disagreed with the rank by that score. The Platform Rules now carry every column's meaning in the writer's own words and say it wins over the instruction's business output section, the Monitor clause is part of the baseline rule both readers get verbatim, a repeated row key is fixed by leading `segment_or_item` with the item, never by aggregating, a Pareto's value and test are each contributor's own, and the `%pip` cell sits directly below the instruction cell. In round 39, on those rules, all 5 notebooks wrote rows (2,939 to 53,296) in Genie Code sessions of 6.0 to 12.6 minutes and passed 312 of 318 checks, with 3 of 5 passing every value check. The freight notebook went back to one row per order line (2,939 rows) and passed all 65 of its checks, and the coupon-uplift and lapse candidates missed acceptance, so both notebooks wrote their baselines' scores with every row Monitor. Its failures were 7 repairs in 4 notebooks and two defects in the rows: the gift-sender notebook wrote a value of 0.0, the shrunken rate of a sender with no recipient left to test less the baseline, for 27,108 of its 51,644 senders, and 2 delisting rows still read '0% of its class's losses'. Five of the repairs came from a missing-value check that matched 'nan' whatever its case and stopped on a real sender's name (3 senders, such as Nan Gil, have the first name Nan), a column cast to pandas' category dtype in the frame later steps filled, a stack of frames whose columns differed, and a counterfactual arm selected before it was set; the other 2, a date compared with a pandas datetime and a step that dropped columns a later step read, broke rules Genie Code already had. The coupon-uplift notebook's top values also agreed to 12 significant digits, so float rounding chose its first row. Missing-value texts, 'unknown' among them, are now matched case-sensitively, a row with no result holds a NULL value, a category cast stays in the frame the model reads, another arm is set before its selection, frames stack by name over one column list, the rank compares impact at 6 significant figures, and the step that writes a signed share asserts that none is 0%. In round 40, on those rules, all 5 notebooks wrote rows (2,939 to 53,296) in Genie Code sessions of 5.5 to 23.1 minutes and final runs of 1.8 to 4.8 minutes, and passed 325 of 331 checks, with 3 of 5 passing every value check. Its failures were 5 repairs in 4 notebooks and one defect in the rows. Three repairs came from pandas 2.2.3, which serverless environment 4 runs: `list()` or `.groups` of a groupby on one key with `dropna=False` raises 'Categorical categories cannot be null' when a key is missing (2 test runs of the lapse notebook, 1 of the freight notebook). One came from a fact about the whole run used as the row key of `.loc`, as the significance rule's wording had invited, and the last broke a rule Genie Code already had (an aggregation dropped a column a later step read). In the rows, 24,025 of the gift-sender notebook's 51,682 rows stated their count twice, '3 closed recipients, the test needs 5' and then a rate 'over 3 closed recipients'. The grader also counted the coupon-uplift notebook's 2,692 customers with no prior catalog orders, who share one value, as a placeholder, but that value is the model's estimate for their identical features, flagged and Monitor. Rows whose group key is missing are now labeled in a new column before they are grouped, a fact about the whole run is tested with `if`, and a count below the test's minimum is stated once. In round 41, on those rules, every notebook wrote rows in both of the round's two runs. The first passed 342 of 347 checks, with 3 of 5 notebooks passing every value check, in Genie Code sessions of 5.0 to 15.6 minutes and final runs of 1.8 to 2.9 minutes; the second wrote 2,939 to 79,843 rows per notebook and passed 340 of 347. The lapse-timing notebook's instruction said its Kaplan-Meier quantile is NULL when the curve never reaches it, and the curve reached it in none of its 7 segments, so no customer got a lapse-window date. Test runs collided again in the delisting notebook: a test run passed the widget's label `Execution` instead of its name and so launched the tagged job, its cancel step listed the active runs without `--expand-tasks` and so canceled nothing, two test runs started 3 seconds apart, and a test run that resolved a later as_of_date left 53,989 rows that read as the newest. In the rows, 25 shipping lines with a missing or zero price or quantity read '1.13K peer lines, the median needs 5', lines with no known lane were compared with a lane median of every such line, and lapse rows gave their own risk as a reason. Genie Code also repaired a numpy boolean that `json.dumps` rejected and a 0% share check that matched '10%'. The grader's two failures on the lapse notebook were its own: it missed widgets read in a dict comprehension and took segment labels such as '5001-10000' for raw numbers. The instruction writer and the closed-window rule now share one sentence that makes an unreached quantile longer than the follow-up, a test run passes the widget's name and is submitted from one command that lists the active runs with `--expand-tasks` and cancels the notebook's own, the rows of earlier test runs are deleted by their run_id, the count-and-minimum reason goes only to rows below the minimum, every `json.dumps` converts numpy values, and the 0% check reads the share's number. In round 42, on those rules, every notebook wrote rows and the round passed 353 of 359 checks, the coupon-uplift notebook every one, in Genie Code sessions of 5.3 to 8.3 minutes and final runs of 2.0 to 2.4 minutes. The lapse notebook's baseline read only features of the gaps between orders, which a customer with one order lacks, so its median imputer gave all 31,998 single-order customers of its 79,850 one risk, 0.503; unlike round 40's customers with no prior orders, these differ in the days since their last order, which every row has. Its curve stayed above one half to 365 days in every group, and its reasons gave the window built from that bound as a fact, such as 'the lapse window opened 36 days ago' for a customer 401 days after the last order. Genie Code repaired 3 steps: a missing-value helper that called `float()` on text and so marked every lane and carrier name missing, an `np.where` on a comparison of two `Int64` counts, which is `<NA>` where a count is missing, and a summary prompt that held 'unknown' for a missing correlation. The grader's 2 other failures were its own: it read the reference after ', against' as a restated count and the summary's 'None of those senders' as a missing value. Every model now reads a feature that every row it scores has, a comparison of a nullable column is filled before it picks rows, the missing-value test never calls `float()` on text, a missing summary fact is left out or says why, and a date built from an unreached quantile is stated as the earliest. In round 43, on those rules, 4 of 5 notebooks wrote rows and the round passed 311 of 319 checks, the coupon-uplift and shipping-charge notebooks every one, in Genie Code sessions of 4.5 to 8.8 minutes and final runs of 1.7 to 2.4 minutes. The lapse notebook's first edit did not apply; Genie Code then wrote 7 of its steps, from the survival fit to the summary, as functions that only raise 'requires continuation', ran it and reported the failed run as its result, and its instruction had no word on stubs. Genie Code repaired 2 steps itself: a share of tickets divided by an item's untied-ticket count, a Python number that raises on 0, and a readiness that computed the per-sender minimum before the outcomes (7) while the test used 6. The grader compared the coupon notebook's 12,511 rows with a median over populations that other instructions defined; it now compares a count with the nearest prior population at or above it and flags a step whose body only raises, passes or returns None. Every step is now written in full before the first run and a failed run is fixed and run again, in a sentence the Platform Rules and AGENTS.md share; a ratio of Python numbers is computed only on a positive denominator; and the per-unit minimum is computed once from the tested sample. In round 44, on those rules, every notebook wrote rows and passed every value check, the lapse notebook for its 79,850 customers, and the round passed 360 of 362 checks, in Genie Code sessions of 5.0 to 8.8 minutes and final runs of 1.3 to 2.3 minutes. Genie Code repaired 3 steps: the coupon notebook filtered on a rank window inside its filter, which Spark rejects, and chose its training months by each month's first day plus the horizon, which its leakage check stopped, and the gift-sender notebook kept a first holiday flag that read a column its frame lacks, which serverless reported only at a later count. A window is now a column before a filter reads it, a window labeled by its first day is tested on its last day, and the Platform Rules say that Spark Connect analyzes a frame at its first action, so the code a fix supersedes is deleted. In round 45, on those rules, every notebook wrote rows (2,939 to 53,273) and the round passed 363 of 365 checks, in Genie Code sessions of 5.3 to 8.1 minutes and final runs of 2.0 to 3.2 minutes, and no round 44 class came back. Genie Code repaired 1 step: the freight notebook's register step printed that the accepted model's registration was tracked, registered nothing and wrote an empty model version, which Genie Code found in the log and fixed in a second run. The lapse notebook's candidate missed acceptance, and its baseline, a logistic regression on a log of the prior order count and two categories, gave its 27,298 customers 123 distinct risk scores. A step now never prints its work as done in place of doing it, an accepted model asserts its registered version before the write, and every model reads a feature that takes many values, such as the days since the last order. In round 46, on those rules, every notebook wrote rows and the round passed 365 of 366 checks, the lapse notebook with a score of its own for each customer; only the freight notebook needed repairs: its registration, now written in full, passed MLflow a plain class where MLflow 2 requires a `PythonModel` subclass, and it called `.date()` on a date and `.groups` on a groupby with `dropna=False`, two classes its rules already name. A pyfunc wrapper now subclasses `PythonModel`. In round 47, on those rules, every notebook wrote rows (2,939 to 79,843) and the round passed 359 of 364 checks, in Genie Code sessions of 5.8 to 31.3 minutes and final runs of 2.1 to 4.9 minutes. The lapse notebook's instruction put the days since the last order and the prior order count into quantile bins, so its model gave 27,298 customers 3 scores, and Genie Code called `KBinsDiscretizer` with `quantile_method`, which scikit-learn added in 1.7, against the pinned 1.6.1; the freight notebook put structs with unnamed fields into one array, which Spark stops with `DATA_DIFF_TYPES`. A model now reads its many-valued feature as its number also when a step bins it, and the instruction writer reads the same sentence; a notebook calls each library as its pinned version defines it; and every field of a struct in an array is named. In round 48 every notebook wrote rows (2,939 to 79,843) and the round passed 362 of 365 checks, in Genie Code sessions of 5.0 to 18.8 minutes. Inspire's own KPI query returned a SUM over a DECIMAL column as a DECIMAL, which the freight notebook's summary step could not format; the lapse notebook joined a cross join of its distinct customers back to the orders it was built from, which Spark stops with `AMBIGUOUS_COLUMN_REFERENCE`; and a freight notebook replaced inf before it took the log of a ratio. A KPI query now returns a DOUBLE and is computable only over a numeric column, a frame joined to a frame built from it renames its key first, and inf is replaced after the last step that derives a feature. Apart from the false stops of rounds 18, 22 and 24 and round 43's stubbed lapse notebook, every notebook since round 8 writes rows: a model that misses acceptance writes its baseline (38,038 scoring rows, 454,490 popularity recommendations), and a forecast on stale data writes its forecast with every row Monitor (SARIMAX with MASE 0.69 against 1.0 for the seasonal naive forecast). The CLI is a stand-in for Genie Code in the workspace, which adds cells to the open notebook.

### K. Upgrade Notes

- A `Generate Use Cases` run on an existing session (the App's Genie buttons start one) keeps the session's row as the Discover run wrote it and only updates `last_updated`; it used to replace `results_json` with its own payload, so the session lost its results after one regeneration. Its logs are written beside the Discover run's logs as `log_generate_<UTC stamp>.log`, `ailogs_generate_<stamp>.jsonl` and `docs/generation_log_generate_<stamp>.txt`, so a log monitor of a regeneration reads that file instead of `log.log`.
- A failed run fails once. Every serverless job task Inspire creates (the agent's own Inspire run, the persistent job of each Genie Code notebook, and the App's Inspire and demo-data jobs) sets `disable_auto_optimization`, so the platform no longer reruns it. Serverless used to rerun a failed task up to twice under the same session: in the v1.3.0 live runs it retried 5 failed Inspire runs, among them a Generate that failed 3 times and a Discover whose retry ran 48.7 minutes until it was canceled, and none of them succeeded. Start a failed run again from the App. A job on a cluster keeps the cluster's retry setting.
- Genie Code notebooks written by v1.3.0 have three cells written by Inspire: a short use-case card, the instruction and Run controls, which is the last cell and ends with `inspire_main()`. Genie Code adds its cells between the instruction and Run controls, with each step in a function that `run_use_case()` runs, so running the notebook runs the use case once, through `inspire_main()`. Notebooks written by earlier versions keep working as they are; regenerate a use case to get the new layout. `notebooks/AGENTS.md` is rewritten for the new layout unless you edited it.
- `__inspire_usecases.code_structure_mandate` now holds the run pattern and the business output layout the instruction is written from, instead of the GENIE SLOT contracts. The column and its type are unchanged.
- The Run controls cell keeps the v1.2.1 job launcher: its Execution widget defaults to As job, so running the notebook creates or updates its persistent job (`dbx_inspire_ai_<slug>_<hash8>`, with a paused schedule at the decision cadence) and runs it as that job, tagged `dbx_inspire_ai_business`, `dbx_inspire_ai_usecase`, `dbx_inspire_ai_session_id`, `dbx_inspire_ai_launcher_source`, `dbx_inspire_ai_run_type` (`training` for scoring, anomaly, segmentation and recommendation, `analysis` for the rest) and `dbx_inspire_ai_notebook`, so the Inspire dashboard registers the run. The job run itself carries the `dbx_inspire_ai_child_run` marker, so its `inspire_main()` runs `run_use_case()` in the job, and Execution = Here runs it in the session, untagged; Genie Code is told to use Here while it builds and tests and to set As job again when it finishes. When it writes the notebook as a source file, it keeps the `# COMMAND ----------` line above Run controls, so its code never shares that cell, and checks after each import that the last cell is still Run controls. `run_use_case()` returns the run's outcome (written, with the row count, as_of_date and run_id, or stopped, with the reason), `inspire_main()` prints it, and the job run returns it, so the notebook that launched the job prints "The tagged job run finished: wrote N row(s) ..." or "... stopped without writing: <reason>" instead of a blanket success. A cell that calls `dbutils.notebook.exit` loses its printed output in a job run, so `inspire_main()` exits with the outcome followed by everything `run_use_case()` printed (up to 100,000 characters), and the launching notebook exits with "Job run finished: <outcome>. Results table: <table>. Run: <link>" followed by that log: a job run's readiness values, metrics and summary can be read from its output. Genie Code never calls `dbutils.notebook.exit` in its own cells. The old `_latest` view, `_runs` table and `_smoke` tables are not created; those made by earlier notebooks are left as they are.
- Idea themes are named once for the whole scored portfolio. Each Best-of-Best scoring batch of 25 use cases used to name its own themes, so one idea got a new name in every batch: on the TPC-DS run behind this release, 124 scored use cases carried 70 themes, 52 of them with a single use case, and the trim's one-per-theme floor protected 70 of the 103 slots whatever their score. The scoring prompt no longer names themes. After scoring, one `THEME_ASSIGNMENT_PROMPT` call sees every scored use case (id, name, technique and main table) and puts each in one theme of one shared list. Use cases the answer leaves out go to a second call that sees the themes already used, and an answer with fewer than min(8, n/6) themes is retried once without the cache. When more than a quarter of the themes hold one use case, those use cases go to one more call that lists the themes two or more use cases share, and the new placement is kept only when it leaves fewer use cases alone (`[THEME-REGROUP FIRED]`). The model's grouping varies from run to run: on 5 release runs it left 3 to 4 themes with one use case three times, and 25 of 75 (U15) and 53 of 95 (U19) twice; on U19 the trim's one-per-theme floor therefore kept 95 of 110 slots whatever their score. Without a usable answer each use case takes its subdomain as its theme, so a failed call never puts the portfolio in one theme that the per-theme cap would cut to 15 use cases. The step logs `[THEME-ASSIGN FIRED]` with the theme count, the themes holding one use case and the largest theme, `[THEME-ASSIGN FALLBACK]` when it falls back, and a warning when more than half the themes hold one use case.
- In Deep, KPI baselines are measured for the first KPI of every use case, in rank order, before any use case's second KPI, up to 300 distinct KPI queries (runtime key `deep_max_kpi_baselines`, which was 60) within the Deep evidence time budget. Baselines left out by the cap are logged. A proposed key result shows the baseline of the KPI it names; one that names no KPI, in a use case with several, keeps `[BASELINE: measured by the KPI query]` instead of another KPI's value.

- Three new widgets: `03_discovery_type` (label `04. Discovery Type`, default `Deep`), `10_strategic_context` (label `11. Strategic Context`, default empty) and `16_best_of_best_count` (label `16. Best of Best Count`, default empty, which means 20). To keep the v1.2.1 behavior of never reading data, set Discovery Type to `Standard`.
- `__inspire_session` gains `discovery_type` and `strategic_context`; `__inspire_step` gains `event_id`; `__inspire_usecases` gains 14 columns, among them `best_of_best` (`Y` or `N`), `best_of_best_rank`, `best_of_best_score` and `best_of_best_reason` (see [the schema](#__inspire_usecases-schema-v072-v120-v130-columns)); `__inspire_feedback` and `_ailogs` are new. Every change is additive, and older rows read the new columns as NULL.
- `results_json` gains the top-level keys `discovery_type`, `data_access`, `usage_signals`, `strategic_context`, `strategy_coverage`, `foundations`, `delivery_order`, `portfolio_history`, `excluded_by_feedback`, `value_tracking`, `ailogs_check` and `best_of_best`, and per use case `Strategy Alignment`, `Strategy Path`, `KPIs`, `Expected Key Results`, `Measures of Success`, `Financial Benefits`, `Non-Financial Benefits`, `Data Evidence`, `Foundations`, `Feedback Status`, `use_case_key`, `best_of_best`, `best_of_best_rank`, `best_of_best_score` and `best_of_best_reason`.
- New steps under `Use Case Prioritization`: `Best of Best` (the star outcome) and, when the star judge fails, a failed step of the same name; the run continues without stars. A new failed step, `Strategy Alignment`, is recorded when the alignment pass fails or leaves placeholder KPIs and benefits; the use cases keep their data-only scores.
- In Good and High, the stratified trim gives the slots left after one use case per theme to the strongest remaining use cases by Best-of-Best score. It used to split them by theme size, which let the largest theme keep its weakest use cases while strong use cases of small themes were cut.
- An endpoint whose startup check did not finish (for example a timeout) stays in the model list but comes after the endpoints that passed it, in every cascade.
- The catalog is still trimmed to 91 to 110 use cases (`target_max_use_cases` plus 1 to `target_max_jitter`), but the draw now comes from the session id, so re-running a session ships the same size.
- Grading prompts run at temperature 0, and strict JSON output is used only on endpoints that pass a startup check. The strict format wraps the returned array in an object (`{"results": [...]}`), because endpoints accept only an object at the root of a response schema. The check waits at most 20 seconds, and the run log says for each endpoint whether strict JSON is on and, when it is off, why; for example, the serving gateway refuses structured output for some newer models.
- A generation path given without the `/Workspace` prefix is used in its `/Workspace` form. The Inspire App's default `./../demos/` resolves next to the agent notebook, for example to `/Workspace/Shared/demos`. When the run's identity cannot write the `vol_root` volume of the inspire database, the live log streams to `<generation path>/<business>/.inspire_logs/session_<id>/log.log`.
- During a parallel wait longer than a minute, for example the generation batches, which can take 15 minutes on a slow endpoint, the run log gets one `[WAIT-HEARTBEAT]` line a minute with the step, the tasks done and in progress, and the time elapsed against the step's limit. These progress lines used to go only to the notebook output, so a live tail of the log showed nothing for the whole wait. The scoring stages (combined scoring, Best-of-Best, the elite judge and strategy alignment) write the same line under their stage label, and a single model call longer than a minute writes its "Still waiting" line to the run log at DEBUG once a minute; on the release candidate run, the log had gaps of up to 298 seconds during combined scoring and 295 seconds during domain detection.
- Genie Code instructions have 8 sections: a Parameters section (the widgets of section J) now comes between data and readiness check, and Inspire appends Platform Rules. In a Genie Code test of 6 use cases from 6 execution patterns, Genie Code had to repair three things on its own before these rules existed: a `.cache()` call rejected by serverless, an MLflow 3 `log_model(name=...)` call on MLflow 2, and Python `Decimal` values rejected by Spark Connect. The data section now also says how nulls in signal, rating and outcome columns are handled, and a recommender fits on all past interactions, with eligibility rules such as margin or stock applied only when ranking (the test's recommender had filtered items before fitting and was left with 21). A forecast's period grid runs from the first period with data to the as-of date, never past the data; in the test, a grid that ran to today on data that ends in 2003 counted 80% of the periods as missing. When the newest data is too old, the stop message names the `max_staleness_cadences` widget, the way to forecast from older data. The as-of date `latest` is the earliest of the newest dates of the event tables the features read; in the test, returns ran to July 2003 and sales to January 2003, so a quarter picked from the returns alone had no sales, every return ratio was null and the anomaly detector was called on 0 rows. A platform rule now counts the input of every fit, score, forecast, simulation and `ai_query` step, and an empty one stops the run with the rows each filter and each feature removed. Spark ML ALS fails on serverless compute (`UC_COMMAND_NOT_SUPPORTED`: Unity Catalog does not support the higher-order functions it runs), so recommenders now use item-item similarity or truncated SVD with scikit-learn and scipy. In the test, ALS was the recommender's first candidate and failed, which left one candidate against the popularity baseline. When a use case's design names a method a serverless notebook cannot run (Spark ML ALS, GraphFrames or another JAR library, or `ai_forecast`, which runs only in Databricks SQL), the instruction uses the method of the implementation guidance and says why. The work also stays sparse: each item keeps only its top neighbors and users are scored in batches that keep each user's top items. In the next round, a dense all-pairs similarity of about 18,000 items ran too long and Genie Code had to replace it, and its rerun was still in the step that fits, scores and evaluates the candidates for 90,872 customers when the 45-minute test limit ended. Simulations draw from aggregates computed once before the draw loop. Readiness counts are taken on the joined source rows before any feature engineering, so an over-strict feature filter can no longer look like missing data (in the test, a row count defined on complete features came out 0), and a failed check prints how many rows each filter removed. The notebook keeps every step, including the output write, when a run stops at readiness or acceptance; in the test, a recommender that stopped at acceptance had left its output cells out. Every step is also written in full, never stubbed: in a later round, a forecast that stopped at staleness had replaced each step after readiness with a placeholder that raised an error, so the notebook would have failed on fresher data.
- A group comparison (cohort or driver analysis) stops only when fewer than 2 groups (`min_reportable_groups`) hold at least 30 rows (`min_group_rows`); smaller groups are left out of the findings and counted. It used to stop when any single group had fewer than 30 rows, which in the Genie Code test stopped a cohort analysis because one cohort had 1 member. The implementation guidance of the nine group-comparison patterns (driver, cohort, trend, correlation, Pareto, funnel, AI, geospatial and network analysis) now says the same, and scores every item of a Pareto and every node of a network; it said that groups below the minimum stop the run. A test of one unit, such as an item or a sender, needs only its own minimum sample, never a minimum size of the cohort or segment it belongs to, and readiness counts units and groups with the same rows, filters and minimum as the step that tests them. The forecast guidance no longer says that stale data stops the run: stale data flags every row.
- A star candidate that passed every elite test but was removed as a duplicate or a decision twin now says so and names the kept use case by title. Its reason was an empty `did not pass:` (4 of 106 use cases on the release candidate run). Drop reasons name use cases by title, never by an id that the final renumbering changes.
- Foreign keys inferred from column names also strip role words ending in -ed or -ing, so `wr_returned_date_sk` resolves to `date_dim` and `cr_returning_customer_sk` to `customer`. Other leading words longer than 4 characters still block a match, so `order_item_id` is never read as a key of `item`. Before, the returns tables' date keys had no join edge, and star verification rejected returns use cases whose time column is a date key.
- A Generate run (Route 1 or Route 2) infers the same foreign keys from column names before it writes a Genie Code instruction, over the tables of the run's scope in the schemas the use cases cite, once per schema (`[SCOPE-JOINS FIRED]`). Only Discover used to infer them, so on tables without declared foreign keys every regenerated instruction listed no joins and no date table: in Genie round 30, Route 1 regenerated 5 instructions whose joins section said `None`. A schema that the Discover scan already inferred keeps the scan's joins, and a run scoped to named tables never joins a table outside them.
- Phase L's production-readiness check (L19) grounds a backticked name with the rule of the column-grounding check: a column in scope, a known table name, bare or qualified, or a SQL keyword is grounded. Its per-use-case check J3 compared backticked names with column names only, so a use case that named its tables in backticks (`date_dim`, `item`, `store_sales`) counted as citing invented columns. On U12 of section L, 21 of 98 use cases failed J3 that way, 76 of 98 counted as production-ready against the check's 80% bar, and Phase L passed 18 of 19; the same catalog now counts 96 of 98.
- Business output rows of v1.3.0 Genie Code notebooks carry a row-specific `recommended_action` ("<tier text>: <next step>") instead of one fixed text per tier, and the tiers no longer fill 5% and 20% of all rows whatever the evidence (section J). A reader that matched the old fixed texts should read `priority_tier` instead. The 'Act now' text for a use case without an elite assessment used to be "Act in this cycle: the decision this use case supports" on every row.
- When a notebook finds its business output table with a column type other than the contract type (for example an `explanation` struct written by an early test), it converts that column and rewrites the table once with the contract types. It used to cast its own rows to the existing types, which kept a wrong type for good. A column the contract does not list, for example one you added, is kept: new rows write NULL in it and the notebook prints its name.
- The 20,000-character Genie instruction target counts only the text the model drafts; the Platform Rules Inspire appends come on top. On U14 one instruction was sent back for a repair only because the appended rules took it over the target, and the repair log listed no reason; it now names the length.
- The business context and the generation-instruction calls at the start of a run are awaited for up to 30 minutes (`CONTEXT_INIT_TIMEOUT_S`), longer than the model cascade they run, so a slow first endpoint falls back instead of being cancelled. On U18 of section L the 300-second wait cancelled the cascade while `databricks-claude-opus-5-5` had not answered, and the run failed 5 minutes in. A business context that still does not arrive becomes an empty context (`[CONTEXT-INIT-TIMEOUT FIRED]`) and the run continues; a generation-instruction timeout stays an error, because your instructions are never dropped.

### L. Validation

Releases are gated on the TPC-DS gold set (`tests/regression/tpcds_sf1_gold.json`, 25 must-find use cases) in two checks:

- **Live run.** On a Discover run without a customer strategy, `tests/scripts/recall_benchmark.py --gate` exits non-zero when the run finds fewer gold use cases than the previous release (v1.2.1: 18, judged by `databricks-claude-sonnet-4-6`). The top 25 of a single run is reported but not gated: two generations of the same inputs held 10 and 5 must-find use cases in their top 25, so one run cannot tell two releases apart.
- **Frozen pool.** `tests/scripts/frozen_pool_gate.py --endpoint <grader>` grades one recorded pool of 185 candidate use cases (`tests/regression/tpcds_sf1_frozen_pool.json`) twice in one session on the same endpoint: with the release's grading prompt and score formulas, and with those of the reference release, loaded from its git tag. It exits non-zero when the release's top 25 holds more than one fewer must-find use case than the reference's, or when more than a tenth of either grading comes back unscored after the agent's own split retry.

Measured for v1.3.0 with `databricks-claude-opus-4-8`: the frozen pool put 7 must-find use cases in the release's top 25 and 8 in v1.2.1's (pass).

The unit and contract suite covers the read guarantees (Standard never reads a row; personal columns never have values read), strategy-blind prompts, membership that alignment cannot change, KPI query building and every writer: 2,379 tests pass on the release build.

Live validation ran on a Databricks workspace against `samples.tpcds_sf1` with Deep discovery, every run launched from the Inspire App installed with the workspace installer. Of the 20 Discover runs launched from the App (U1 to U20), 18 ended in SUCCESS: U16 was cancelled when later fixes superseded it, and U18 failed 5 minutes in when its business context call timed out, which section K fixes. Up to U9, the runs without a customer strategy found 18 to 20 of the 25 must-find use cases (the gate asks for at least 18); U10 to U12 found 15 to 17 and failed it. Replaying the recorded candidate pools of U8 to U12 showed why: each pool held 18 to 20 must-find use cases, and the trim to the catalog size removed 0 to 3 of them. No run from U1 to U12 found the demographic customer segments (G07) or the store site selection from customer geography (G21), because their tables never reached a use case (section B). A per-theme floor in the trim did worse on the same pools (U11: 15 to 12) and was reverted. U13, the first run with the foreign key and catch-all changes of section B, found 19, G07 and G21 among them, and used 22 of the 24 business tables. U14, U15, U17, U19 and U20 found 21, 20, 18, 17 and 21. U19 held 20 must-find use cases before its trim and 17 after it. 53 of its 95 idea themes held one use case (section K), but replaying the trim with those themes regrouped kept 16: the trim drops the must-find use cases the Best-of-Best scorer ranks lowest (4 ranked 149th to 167th of 177), whatever the themes. U20, the release run, found 21 with 8 in its top 25. The release runs U8, U9, U14 and U20 had 0 ERROR lines, Phase L 19 of 19, 0 hallucinated tables, 0 hard-veto survivors, every KPI computable with a measured baseline, and a passing AI call log check. The Genie Code loop of section J ran 13 use cases from 7 execution patterns over 27 rounds (0 to 26), graded from round 7 on the rows each notebook wrote; in rounds 21 to 23 Genie Code built its cells above an unchanged Run controls cell, tested them with Execution = Here and created no job, and in round 24 it created no job either, while one notebook fused its code with the Run controls cell, which a rule now prevents; in rounds 25 and 26 all 5 notebooks kept the Run controls cell last and unchanged and created no job.

---

## What's New in v1.2.1

v1.2.1 is a patch on v1.2.0. It stops `Ultra High` from losing candidates to slow judge calls, stops one malformed dedup row from cancelling the dedup of a whole domain, and makes the logs and the step table report by cause. There is no widget, column, `results_json` or artifact-format change; the `elite_assessment` JSON gains one optional key, `verdict_capped_from`.

### A. Timed-Out Scoring Batches Are Retried, Not Dropped

On v1.2.0 a scoring batch that ran past the straggler budget (three times the median batch time; 158 to 255 seconds on the release runs) was retried once at the same size under the same budget, and because a timeout returns nothing the retry rule then gave up. The funnel ledger of the v1.2.0 release runs shows what was lost:

| Run | Candidates lost to timeouts |
|-----|-----------------------------|
| `tpcds_sf1` Ultra High repeat | 50 of 102 (Best-of-Best prescreen) |
| `tpcds_sf1` Ultra High | 20 of 134 (elite judge) |
| `tpcds_sf1` Ultra High rerun | 12 of 116 (elite judge and evidence repair) |
| `tpcds_sf1` Ultra High, final build | 5 of 94 (elite judge) |
| `accuweather` Ultra High | 2 of 116 (elite judge) |
| 15 `Good` and `High` runs | 0 |

v1.2.1 cuts only the first attempt with the straggler budget. A timed-out batch is retried in halves, every retry gets the full per-task timeout, and it keeps being retried for up to `scoring_split_retry_rounds` rounds (2 by default); only an unusable answer stops retrying early. The same engine serves the goal filter, user-domain assignment, combined scoring, Best-of-Best and the elite judge. A use case still unscored after every retry is logged at ERROR with its reason (`UC(s) unscored after retries and excluded from selection`, now also for elite candidates) and is counted in the funnel ledger as before.

An elite-judge record that is discarded (an invalid verdict, a missing key or a self-contradiction) is asked for again with the exact reason and the allowed verdicts `ELITE`, `NEAR_MISS` and `REJECT`, and the log names the value the judge returned. The judge prompt now names every key it must return, including `verdict` and `scores`, which it described but never named; the logged values showed the discarded records carried an empty verdict (`invalid verdict ''`). An unusable answer also gets its one corrective retry when it first arrives on the retry of a timed-out batch. Before these fixes, live v1.2.1 runs lost 5 of 104, 2 of 124 and 4 of 135 elite candidates to discarded records. When the corrective re-judge still states a verdict better than its own scores and value tier support, the record is kept with its verdict capped at what they support (`verdict_capped_from` keeps the original, log `[VERDICT-CAP FIRED]`), so the absolute bar decides instead of the candidate being dropped as unjudged; the build before this cap dropped 2 of 104 such candidates.

This is separate from the run-to-run variation in section F of v1.2.0: the measured `tpcds_sf1` pair lost 12 and 0 candidates and still shared only 18% of its ideas, so `Ultra High` still varies between runs and the advice to run it twice stands.

### B. Dedup Reads the Keep-List Safely and Asks Again Before Giving Up

- **Ask again.** A dedup keep-list that is cut off, names a use case outside its id column, or names no reviewed use case is asked for once more with the LLM cache bypassed (log `[DEDUP-REASK FIRED]`, step `<step>_Reask`). An LLM call that already failed through the model cascade is not asked again.
- **No identical resend.** When global dedup fails and the use cases form a single group (as in `Ultra High`, which dedups before clustering), per-domain dedup would resend the same request and replay the cached answer, so the run keeps all use cases with one ERROR instead. With several groups, global dedup still falls back to per-domain dedup.
- **A trailing note can no longer wipe the keep-list.** The keep-list has one data column, so after its honesty columns are removed its rows have no comma. The shared CSV cleaner treated every line before the first line with a comma as preamble, so a closing note such as `U4, U6 merged into U5` deleted the whole keep-list and dropped every use case the model had kept. The keep-list is now read without that preamble rule; prose and notes go to the row guard instead. No v1.2.0 release run shows the wipe pattern (the largest removal was 9 of 30 use cases, consistent with real duplicates), but one note line was enough to trigger it.
- **The id column follows the majority.** The id column of an answer without a header is the column most rows put a reviewed id in, so one commentary line can no longer move it and reject every real row.
- **No narration.** The prompt now forbids the layer analysis, notes and explanations of merged pairs the judge wrote into its answers.

On v1.2.0 one misaligned row skipped the dedup of a whole domain (for example 1 bad row out of 188 use cases); 3 of 24 completed release runs hit it, and global dedup fell back to per-domain dedup in 4.

### C. Logs and Steps Report by Cause

On the v1.2.0 release runs 47 of the 70 ERROR lines (67%) came from failures the run recovered from. v1.2.1 logs those as warnings and keeps ERROR for outcomes that degraded:

| Event | v1.2.0 | v1.2.1 |
|-------|--------|--------|
| Worker cancelled by its own straggler retry | ERROR, step `ended_error` | WARNING, step `ended_warning` |
| LLM attempt timed out and another attempt or model follows | ERROR | WARNING (the exhausted cascade stays ERROR) |
| Retried attempt of UI translation, use-case translation, the instruction interpreter, business context, domain or subdomain detection | ERROR | WARNING (the final fallback stays ERROR) |
| Global dedup falls back to per-domain dedup | ERROR | WARNING |
| Combined-score batch that could not be parsed and is retried | ERROR | WARNING |
| Use case lost after every scoring retry (combined score, Best-of-Best, elite judge, goal filter) | WARNING | ERROR |
| Use-case batch left in English after every attempt | WARNING | ERROR |

### D. Upgrade Notes

- No widget, column, `results_json` or artifact change. The `elite_assessment` JSON gains one optional key, `verdict_capped_from` (null unless a verdict was capped); read it as optional.
- `__inspire_step`: a worker step that the pipeline itself cancels now ends `ended_warning`, so `ended_error` rows are real failures. A dedup re-ask adds a step named `Deduplicate_Global_Reask` or `Deduplicate_Domain_<domain>_Reask`.
- Log monitors keyed on ERROR lines see far fewer of them. A scoring stage on a slow endpoint can take longer than on v1.2.0, because a slow batch gets its full timeout instead of being dropped; the stage deadline still bounds it.
- Rules R56 (timeout retries), R57 (log by cause) and R58 (dedup re-ask) are added to `rules/inspire-ai-rules.csv`.

### E. Validation

The final build (`c1b48c4`) was deployed byte-identical to both test workspaces and all 2,147 unit tests pass. Live runs, each on a fresh Inspire database:

| Run | Result | Lost to timeouts | Lost at the elite judge | ERROR lines | Output | Phase L |
|-----|--------|------------------|-------------------------|-------------|--------|---------|
| `tpcds_sf1` Ultra High | SUCCESS, 41.2 min | 0 (5 retries) | 0 of 99 | 0 | 18 elites, 18 Genie notebooks | 19 of 19 |
| `accuweather` Ultra High | SUCCESS, 42.7 min | 0 (7 retries) | 0 of 122 | 0 | 3 elites, 3 Genie notebooks | 18 of 19 (`L18_multi_table_ratio` caution) |
| `tpcds_sf1` Good | SUCCESS, 28.4 min | 0 | not applicable | 0 | 106 use cases | 18 of 19 (`L3_subdomain_diversity` caution) |

The same corpora on v1.2.0 logged 9 (`tpcds_sf1` Ultra High), 8 (`accuweather` Ultra High) and 0 (`tpcds_sf1` Good) ERROR lines, and its `Ultra High` runs lost 2 to 50 candidates each. Every table the final use cases cite exists, no hard-vetoed use case survived, and run times stayed within the v1.2.0 range (36.6 to 47.9 min for `tpcds_sf1` Ultra High). Both Phase L cautions also appear on v1.2.0 runs of the same corpora.

---

## What's New in v1.2.0

v1.2.0 replaces the old quality enum with three modes (`Good`, `High`, `Ultra High`), adds an `Ultra High` elite-selection stage that keeps only use cases which clear an absolute bar, rebuilds every per-use-case Genie notebook into a tested skeleton with a readiness gate and a persistent tagged job, and rebuilds the PDF and PowerPoint around one shared use-case view in 23 languages. The runtime is hardened against flaky model endpoints, malformed LLM CSV answers and PDF-render failures. On the release matrix all 13 runs finished SUCCESS; the measured numbers below come from clean-timed runs on the `bakehouse`, `tpcds_sf1` and `accuweather` corpora against the deployed v1.2.0 build.

Everything from v0.7.2 and v0.7.3 (Best-of-Best ranking, stratified trim, idea themes, the persisted BoB columns) still runs in `Good` and `High`; the v0.7.x sections below are kept as history.

### A. Three Quality Modes

The **Use Cases Quality** widget now takes `Good` (default), `High` or `Ultra High`. All three run the same broad generation pass and differ only in which scored use cases are selected.

| Mode | Selection |
|------|-----------|
| `Good` (default) | Keeps use cases scored Medium or better. Best-of-Best ranking drops hard-vetoed use cases; a very large set is capped by the stratified theme trim. |
| `High` | Keeps only use cases scored High or better, with the same ranking and trim. |
| `Ultra High` | Elite selection against an absolute bar for business value, metadata evidence, implementability and actionability. No quota, no cap, no padding. |

**Legacy labels still work.** `Coverage Mode (All)`, `Balanced`, `Good Quality` and `High Quality` run as `Good`; `Strict Quality` and `Very High Quality` run as `High`. Matching ignores case and surrounding spaces, and the session records the canonical mode. Any other value stops the run with a validation error listing the valid options and accepted legacy labels.

**One scoring pass, no padding, final-rank ids.** The separate per-domain value pass is removed: combined value-and-quality scoring is the only pass, so `Priority` is the absolute combined priority. The recovery-from-rejection pool, the minimum top-up and the target-zone floor are gone. The portfolio holds what clears the bar, with no padding whenever at least one use case clears it. If a mode's bar would select zero use cases, the run does not ship an empty catalog: it returns the closest real candidates instead, each labelled "below the `<mode>` bar" with its real scores and the check it missed, under a plain notice that no use case met the bar. `Good` falls back to the remaining candidates that passed the hard gates; `High` falls back to Medium, then Low; `Ultra High` falls back to the near misses rejected without a fatal flaw (ranked by elite score, each showing its failed check, never fatal-flaw rejects), then to High-tier candidates. Nothing is invented. Ids assigned before selection are provisional; every mode renumbers the final list in final-rank order, so `N01`/`U01` is the domain and use case of the best idea.

### B. Ultra High Elite Selection

`Ultra High` judges High-or-better candidates (plus a second look at high-value Medium candidates) against a fixed bar and keeps only those that clear it:

- **Metadata-only evidence.** Every cited table and column must exist with compatible types; multi-table use cases need a foreign-key path. Evidence is names, types, comments, constraints, tags and table properties only. Inspire never reads data rows.
- **Fatal-flaw red team.** The elite judge (`ULTRA_HIGH_ELITE_JUDGE_PROMPT`) records the decision each use case changes and its owner, the KPI and value driver tied to named columns, and every reason that defeats it from a fixed `fatal_flaws` list. Any fatal flaw is fatal. A self-contradictory assessment (a red-team category not listed as a fatal flaw, an `ELITE`/`NEAR_MISS` verdict with a fatal flaw, or a verdict better than its own scores allow) is discarded and re-judged.
- **Leakage and data-shape rules.** A supervised use case whose outcome is a rule over its own signal columns in the same period is rejected as a rule, not a model; a real prediction observes the outcome in a later window (`label_timing = future_window`) using a dated time column. Runtime assumptions that metadata cannot prove are deferred to the notebook's readiness gate; a co-occurrence use case grouped by its table's own row key, or an assumption the table's own keys contradict, is rejected outright.
- **Absolute bar + second opinion.** A use case is elite only with no fatal flaw, an elite verdict, all four scores at the minimum (8 of 10 by default), a Transformational or Material value tier, and passing verification. A use case just below the bar gets one independent second opinion from the next model and is promoted only when the two opinions' averaged scores clear every dimension; every other miss is kept in the near-miss ledger with the gate it failed.
- **Decision twins and coverage.** Of two overlapping elites the stronger is kept, and elites that change the same decision (same canonical title, or same decision object and technique on another channel's table) collapse to the higher-scored one. Each user-specified Business Domain with no elite receives one "Domain coverage pick, below bar"; the near-miss ledger is clustered into the same domains.
- **Below-bar fallback.** When at least one use case is elite the catalog holds only elites, with no padding. When nothing clears the bar the run does not ship empty: it returns the near misses that were rejected without a fatal flaw, ranked by elite score and each labelled "below the Ultra High bar" with the check it failed (never fatal-flaw rejects), then High-tier candidates, under a plain notice that no use case met the Ultra High bar. The scores shown are the real elite scores; nothing is invented.

The elite count is reported, never targeted, and it varies run to run because the judging model samples the candidates it accepts (the elite judge accepted 15% of candidates on one run and 38% on another). The measured counts on the release matrix were:

| Run | Corpus | Build | Elite use cases |
|-----|--------|-------|-----------------|
| `bakehouse_ultra` | bakehouse (6 tables) | 33f73ed | 7 |
| `bakehouse_ultra_s2` (repeat) | bakehouse | 33f73ed | 7 |
| `bakehouse_ultra_edge_domains` (4 pinned domains) | bakehouse | 33f73ed | 7 |
| `accuweather_ultra` | accuweather | 33f73ed | 6 |
| `tpcds_sf1_ultra` | tpcds_sf1 | 33f73ed | 13 |
| `tpcds_sf1_ultra_s2` (repeat) | tpcds_sf1 | 33f73ed | 11 |
| `tpcds_sf1_ultra_r3` (rerun) | tpcds_sf1 | ef38882 | 35 |
| `tpcds_sf1_ultra_s2_r3` (rerun) | tpcds_sf1 | ef38882 | 30 |
| `tpcds_sf1_fiultra` (final build) | tpcds_sf1 | a5ae0a9 | 8 |

The count tracks corpus size and the judge's run-to-run acceptance rate, not a target: the same `tpcds_sf1` corpus returned 13 and 11 elites on one build, 35 and 30 on another, and 8 on the final build. Treat the elite set as "every candidate that cleared the bar on this run", not a fixed-size shortlist; **Section F** covers how to get a stable shortlist.

### C. Redesigned Genie Code Notebooks

v1.3.0 replaces this layout with a three-cell notebook (use-case card, instruction, Run controls); see [What's New in v1.3.0](#whats-new-in-v130).

Every use case still gets its own Databricks notebook, now built as a tested skeleton in sections 0-12 (use-case card, run controls, readiness gate, evaluation against a baseline, model registration, business output, explanations, owner summary, operationalization, contract check). The only open cells are marked `GENIE SLOT`; Genie Code fills them until the final cell prints `Contract check PASSED`.

- **Per-family skeleton.** The skeleton and its harness are chosen per technique family (supervised training A-D, inference, AI-text, analysis), so each family gets the right build and evaluation scaffold.
- **Readiness gate.** Before building anything the notebook checks the use case's runtime assumptions on the real tables (row count, derivable outcome with both label classes, positives and class rate, and for churn-style cases ≥2 prior purchases per entity) and stops with a plain message when the data shape does not hold.
- **Temporal leakage guard.** Features are built only from rows strictly before `as_of_date`; the label is a future outcome window; open cases are dropped.
- **`@champion` alias.** A trained model is promoted to the `@champion` alias in Unity Catalog only when it beats a baseline on an out-of-time split (AUC ≥ 0.6, PR-AUC ≥ 1.5× the class rate, AUC ≥ 0.02 over baseline).
- **Persistent tagged job.** Each notebook runs as its own job `dbx_inspire_ai_<slug>_<hash8>` that Inspire creates once, reuses on re-run, and never deletes. The tag `dbx_inspire_ai_run_type` is `training`, `inference` or `analysis`. `notebooks/AGENTS.md` carries the rules Genie Code follows for every notebook.

In `Ultra High` only elite use cases get Genie Code; in `Good`/`High` the top-N by final rank do (widget **Generate Genie Code Instruction For**).

### D. Redesigned PDF and PowerPoint

The PDF catalog and PowerPoint are rebuilt around **one shared use-case view and index** so both artifacts describe each use case the same way, with Databricks brand styling, a metadata-only disclaimer, and a consistent index. They render in **23 languages**, including right-to-left scripts (Arabic) and CJK (Japanese, Chinese, Korean); release review confirmed correct RTL bidi isolation (LTR identifiers and scores stay left-to-right inside RTL prose), clean CJK glyphs, and no clipping or overflow.

### E. Runtime and Resilience

- **Endpoint probe and circuit breaker.** Model endpoints are probed at startup and recorded in `results_json.llm_endpoint_health` (`unusable` with reason, `temperature_unsupported`, `probed`). Endpoints that are not batch-capable are excluded, and a failing endpoint trips a circuit breaker so the cascade moves to the next model instead of stalling.
- **Temperature adaptation.** Endpoints that reject a `temperature` parameter (for example the default thinker) have it stripped and the call retried, so explanations and owner summaries come back non-null instead of failing.
- **Shared CSV row guard.** Every LLM CSV answer (generation, table filter, dedup, domain/subdomain, goal filter, translation, summaries) passes one row guard. A row short of its columns, carrying unexplained extra values, or holding a copied id/table/technique/label in the wrong column is rejected, logged as `[CSV-ROW misaligned]`, and treated as missing so the stage retries it rather than reading shifted values.
- **Re-request of missing rows.** When a complete answer simply omits a row, the stage re-requests only the missing rows once and splits into smaller batches only if that retry is still incomplete; a truncated dedup keep-list is refused rather than silently dropping use cases.
- **Hardened PDF rendering.** WeasyPrint is pinned to `>= 70.0` and PDF renders are serialized to avoid the native-library contention that produced intermittent render failures.
- **Launch safety.** The agent and every generated notebook now run one job run at a time per job (`max_concurrent_runs=1`, queue enabled), break self-launch recursion with the `dbx_inspire_ai_child_run` marker instead of job-context detection, and refuse to start more than 20 runs per job in any 60-minute window.
- **Grounding schema superset.** Grounding judges now see every column of the tables they judge; a v1.2.0 pre-release cut wide tables to 30 columns.

### F. Ultra High Run-to-Run Stability

`Ultra High` keeps only picks that clear an absolute bar, so the highest-scored ideas are the most stable between runs, but both the size of the elite set and its borderline members vary run to run. Two things drive the variation: the broad generation pass is an LLM, so the candidate pool differs between runs, and the elite judge itself samples the candidates it accepts. That sampling cannot be pinned down, because the judge endpoint rejects the `temperature` parameter and so cannot be forced to be deterministic; its acceptance rate ranged from 15% to 38% of candidates across the release pairs.

Measured on repeat runs, idea-level overlap (same decision and outcome, ignoring the wording of the title) was about **17-18%**: the two `bakehouse` runs shared **2 ideas** out of 7 and 7, and the two `tpcds_sf1` reruns shared **10 ideas** out of 35 and 30. The highest-scored picks recur; the borderline picks turn over. If you need a stable shortlist, **run `Ultra High` twice and compare**: the ideas that appear in both runs are the durable core, and the top-ranked picks are the most reliable to carry forward.

### G. Measured Speed and Volume vs v1.1.3

Clean-timed runs on the deployed v1.2.0 build, compared with the v1.1.3 baseline for the same corpus and the closest mode:

| Run | v1.2.0 time | v1.1.3 time | v1.2.0 final UCs | v1.1.3 final UCs |
|-----|-------------|-------------|------------------|------------------|
| `tpcds_sf1` Good | 30.7 min | 51.7 min | 105 | 92 |
| `tpcds_sf1` High | 28.0 min | 43.6 min | 90 | 83 |
| `bakehouse` High | 22.6 min | 27.4 min | 20 | 44 |
| `bakehouse` Good | 29.6 min | 28.7 min | 27 | 49 |

`tpcds_sf1` is faster and ships **more** final use cases from **less** generation (v1.1.3 generated 345 candidates and shipped 92; v1.2.0 generated 160 and shipped 105), because v1.2.0 removes near-duplicates and consolidates domains instead of carrying redundant variants. `bakehouse` Good ships 27 rather than 49 for the same reason: the v1.1.3 count was duplicate-heavy and also contained staffing, labor, operating-cost and menu ideas that the 6-table `bakehouse` corpus has no tables to support. The v1.2.0 27 cover every grounded `bakehouse` theme; the drop is fewer duplicates and tighter metadata grounding, not lost business value.

On the final build (`a5ae0a9`), which adds the grounding schema superset and keys the scoring cache on the full per-batch schema, a clean re-run recovered `accuweather` Good to **101** use cases, matching the v1.1.3 count: a v1.2.0 pre-release that cut wide tables to 30 columns had dropped it to 21 because grounding judges rejected use cases for columns the truncation hid. The same re-run returned `accuweather` High **75** real High use cases (the pre-release returned none and fell back to below-bar candidates), `tpcds_sf1` Good **95** and `healthverity` Good **21** with its payer-mix, reimbursement-leakage, site-of-care, referral-network and provider-taxonomy ideas intact, and no rejection cited a column that exists.

### H. Upgrade Notes

- **Widget values.** Launchers and apps that set the quality widget should switch to `Good` / `High` / `Ultra High` and add the `Ultra High` option. Old enum strings keep working through the legacy mapping, but new runs record the canonical mode.
- **New tracking columns.** `__inspire_usecases` gains `quality`, `quality_mode`, `elite_status`, `elite_score`, `elite_assessment` (JSON) and `selection_flags` (JSON), and `code_structure_mandate` is now filled for every row. Columns are added with idempotent `ADD COLUMN IF NOT EXISTS`, so older-session rows read `NULL`; consumers must handle NULL for every versioned column. A session's rows are now replaced in one Delta transaction (staged, then one `replaceWhere`), so readers never see a partly written session.
- **Dashboard change.** Any dashboard that reads `__inspire_usecases` should account for the new quality and elite columns and for final-rank ids: `N01`/`U01` is now the best use case rather than a provisional id, so filters or sorts that assumed stable pre-selection ids must move to the new columns. Each Genie notebook's operationalize section (section 11) also emits a run-health dashboard and Genie space step for the use case it builds.

---

## What's New in v0.7.3

v0.7.3 is an incremental release on top of v0.7.2. It closes the single documented v0.7.2 "Known Issue" (hard-veto survivors), removes an artificial-looking portfolio-size artifact, respects the user's language selection across all file outputs, and parallelizes the Route 1/2 Genie Code regeneration pass for a ~10x speedup.

Everything introduced by v0.7.2 (Best-of-Best ranking, Stratified Trim by idea theme, tier-weighted composite, the 5 persisted columns) remains in place. v0.7.3 does not re-architect any of that; it fixes, refines, and speeds it up.

### A. Hard-Veto Pre-Filter (Resolves The v0.7.2 Known Issue)

In v0.7.2, `_stratified_trim_by_theme` ran the FLOOR rule (≥1 UC per theme) before any score filtering. A UC with `bob_score = 2.0` could survive if it was the sole representative of its theme, because FLOOR outranked the hard-veto quality floor. The v0.7.2 tpcds_sf1 validation run ended with 3% hard-veto survivors (3 of 100 UCs).

v0.7.3 flips the order: `_stratified_trim_by_theme` now **drops every UC with `bob_hard_veto_gate != None` BEFORE theme grouping begins**. A theme whose only representative was hard-vetoed is legitimately eliminated, which is the correct semantic, since a theme that cannot produce even one fundable UC should not appear in the portfolio.

**Validation (tpcds_sf1, session `1234567890000001`)**: 13 hard-veto UCs dropped before stratified trim. **Zero hard-veto survivors** in the final 105-UC portfolio.

### B. Target-Max Jitter (Non-Round Portfolio Sizes)

v0.7.2 always trimmed to exactly `target_max_use_cases` (default 100). An exact round number on every run looked artificial and drew skepticism from reviewers.

v0.7.3 introduces `target_max_jitter`. The effective trim ceiling is now:

```
effective_cap = target_max_use_cases + randint(1, target_max_jitter)
```

Default changes:

| Key | v0.7.2 Default | v0.7.3 Default |
|-----|---------------|----------------|
| `target_max_use_cases` | 100 | **90** (now the base, not the ceiling) |
| `target_max_jitter` | not set (new) | **20** |
| Effective cap range | fixed 100 | **[91, 110]** |

The `target_min_use_cases` floor (50) and `aggressive_prune_threshold` (75) are unchanged. (The floor and its recovery were removed in v1.2.0; see [Quality Modes](#quality-modes-good-high-ultra-high-v120).)

**Validation**: tpcds_sf1 session `1234567890000001` ended at **105 UCs** (not 100). A separate NYC run finished at 30 UCs: BoB did not trigger because the count was below the 75-UC threshold, which is the expected no-op behavior.

### C. Multi-Language Filename Convention Fix

Customer feedback on v0.7.2: "the second selected language (German) was not respected." Root cause: when multiple languages were selected, both the Excel catalog and the Markdown readme wrote to a single filename; the second language's content overwrote the first.

v0.7.3 distinguishes single- and multi-language runs:

| Run Type | Excel Filename | Markdown Filename |
|----------|----------------|-------------------|
| Single language (unchanged) | `<business>-dbx_inspire.xlsx` | `readme.md` |
| Multi-language (new) | `<business>-dbx_inspire_en.xlsx`, `<business>-dbx_inspire_de.xlsx`, ... | `readme_en.md`, `readme_de.md`, ... |

PDF and PowerPoint outputs already used a per-language suffix and were not affected.

### D. Parallel Route 1/2 Genie Code Regeneration

v0.7.2 regenerated Genie Code instructions sequentially. Each UC took roughly 3 minutes of LLM time; a 100-UC portfolio therefore needed **~5 hours** of wall-clock for the regeneration pass alone, the worst bottleneck in the entire pipeline.

v0.7.3 parallelizes regeneration across a `ThreadPoolExecutor`. Default pool size: **10 workers**. A 100-UC portfolio now finishes regeneration in **~30 minutes**: a ~10x speedup.

New runtime key: `TECHNICAL_CONTEXT["runtime"]["genie_regen_parallelism"] = 10`.

### E. Operational Note: Workspace Sync On Git Renames

During v0.7.3 validation we observed that `databricks repos update` silently fails with `Conflict pulling from remote` when a file has been renamed in git and the old path still exists in the workspace. The CLI does not surface this as a hard error: it returns success with the old content still in place.

**Operator remediation**: if a rename-heavy branch fails to sync, **delete the old paths from the workspace first**, then re-run `repos update`. This note is also included in the [Quick Operator Checklist](#quick-operator-checklist).

### F. v0.7.3 Validation Evidence

| Dataset | Session ID | Final UC Count | Hard-Veto Survivors | Notes |
|---------|-----------|----------------|---------------------|-------|
| NYC | `7301073301073001` | 30 | 0 | Below 75; BoB correctly skipped |
| HV | `7302073002073002` | 39 | 0 | Below 75; BoB correctly skipped |
| tpcds_sf1 | `1234567890000001` | **105** | **0** | Above 75; BoB + stratified trim with 13 hard-vetoes pre-dropped |

Every v0.7.3 validation run finished with zero hard-veto survivors, the defining proof that the v0.7.2 Known Issue is closed.

### G. New Runtime Config Keys (v0.7.3)

| Key | Default | What It Controls |
|-----|---------|------------------|
| `target_max_jitter` | `20` | Upper bound for `randint(1, target_max_jitter)` added to `target_max_use_cases` to produce the effective trim cap |
| `genie_regen_parallelism` | `10` | ThreadPoolExecutor worker count for Route 1 / Route 2 Genie Code regeneration |

Plus the v0.7.3 default change for an existing key:

| Key | v0.7.2 | v0.7.3 |
|-----|--------|--------|
| `target_max_use_cases` | 100 | 90 |

---

## What's New in v0.7.2

v0.7.2 is the first Inspire release that ranks AND diversifies the surviving portfolio. Before v0.7.2, when the portfolio exceeded the target ceiling, the pipeline resorted to an aggressive "dedupe harder" pass that silently favored whichever topic had the largest cluster. Starting with v0.7.2 this is replaced with **Best-of-Best (BoB) ranking** followed by a **Stratified Trim by Idea Theme**: a deterministic algorithm that keeps the *strongest* UCs while *guaranteeing* that no idea category gets wiped out.

This section gives a high-level overview of the four things that changed. Each is covered in depth later in the README.

### A. Best-of-Best (BoB) Ranking + Stratified Trim

When the surviving portfolio exceeds the `aggressive_prune_threshold` (default **75**), the pipeline now executes a two-part flow:

1. **BoB Scoring (LLM)**: A new prompt, `BEST_OF_BEST_SCORING_PROMPT`, scores EACH surviving use case on all 19 quality gates individually on a **0-10 scale** (not the legacy YES/NO). The same prompt tags each use case with a concise 2-to-4-word `idea_theme` (e.g. "Anomaly Detection", "Pricing Optimization", "Churn Prevention"). Scoring is batched at **25 UCs per batch** and executed in parallel across the LLM cascade.

2. **Tier-weighted Composite (Python)**: The 19 BoB dimension scores are composed into a single 0-10 composite:

   | Tier | Gates | Weight | Meaning |
   |------|-------|--------|---------|
   | Tier 1 | D1-D11 (technical) | 0.30 | Data grounding, analytical soundness |
   | Tier 2 | D12-D14 (business value) | 0.35 | Funding, engineering, sponsor-readiness |
   | Tier 3 | D15-D19 (principal-business-analyst) | 0.35 | Cadence, Monday Test, explainability, longevity, attribution |

   Composite formula:

   ```
   bob_score = 0.30 * mean(D1..D11)
             + 0.35 * mean(D12..D14)
             + 0.35 * mean(D15..D19)
   ```

   **Hard-veto floor**: if ANY individual gate scores **< 3** on the 0-10 scale, the composite is capped at **2.0**. This keeps catastrophic failures at the bottom of every ranking regardless of how strong the UC is elsewhere.

3. **Stratified Trim by Idea Theme (Python, deterministic)**: Replaces the pre-v0.7.2 "keep top-N by score" global sort. The algorithm:

   - Group UCs by `idea_theme`
   - **FLOOR**: every theme keeps its best UC by `bob_score` (coverage guarantee; the WHOLE POINT is that no idea category is wiped out)
   - **CAP**: no theme may exceed `target_max * bob_theme_max_share` (default: 15 UCs in a 100-UC target)
   - **FILL**: the slots left after the floor go to the strongest remaining UCs by `bob_score`, across all themes. Before v1.3.0 they were split in proportion to theme size and the rounding shortfall went to the largest theme, so with many small themes the largest theme kept its weakest UCs while strong UCs of small themes were cut

4. **Five new columns** are written to `__inspire_usecases` so you can audit the ranking. The Excel, CSV and JSON exports carry `bob_score` as the `Best-of-Best Score` column, next to `Best of Best` (the star rank) and `Best of Best Reason`; the theme and the three tier scores stay in the table:

   | Column | Type | Description |
   |--------|------|-------------|
   | `idea_theme` | STRING | 2-to-4-word LLM-assigned theme (e.g. "Customer Segmentation") |
   | `bob_score` | DOUBLE | 0-10 tier-weighted composite |
   | `bob_tier1_score` | DOUBLE | Mean of D1-D11 (technical grounding) |
   | `bob_tier2_score` | DOUBLE | Mean of D12-D14 (business value) |
   | `bob_tier3_score` | DOUBLE | Mean of D15-D19 (principal-business-analyst) |

### B. Validation Evidence (tpcds_sf1 Session 1234567890000002)

v0.7.2 was validated end-to-end on the TPC-DS scale-factor-1 dataset. The numbers below come from a single real production run (Session ID `1234567890000002`):

| Stage | UC Count | Notes |
|-------|----------|-------|
| Phase 2: Generation (pass 1 + pass 2) | **378** | Raw use cases from metadata |
| Phase 4: Combined Value + Quality Scorer | 308 | Scored + deduplicated |
| Phase 4: Balanced Quality Filter (now `Good`) | 244 | Dropped `Low`, `Very Low`, `Ultra Low` |
| Phase 4: BoB + Stratified Trim | **100** | Bullseye target_max = 100 |

Portfolio statistics at final 100:

| Statistic | Value |
|-----------|-------|
| Distinct idea themes | **75** |
| Top theme (most UCs) | Anomaly Detection (**11** UCs, under the 15 cap) |
| BoB composite: mean | **6.7** |
| BoB composite: range | 2.0 to 8.23 |
| Tier 1 (technical) mean | 7.23 |
| Tier 2 (business value) mean | 6.92 |
| Tier 3 (PBA) mean | 6.23 |
| Total run duration | 68 min |

The 75-theme spread across 100 final UCs is the coverage-preservation win: the old global-sort approach would have collapsed these into ~20-25 themes dominated by whichever topic had the largest cluster.

### C. New Runtime Config Keys

Five new keys in `TECHNICAL_CONTEXT["runtime"]` control v0.7.2 behavior:

| Key | Default | What It Controls |
|-----|---------|------------------|
| `aggressive_prune_threshold` | `75` | Trigger BoB + Stratified Trim when the surviving count exceeds this number |
| `target_max_use_cases` | `100` | Trim ceiling: the algorithm will not keep more than this many UCs |
| `target_min_use_cases` | `50` | Recovery floor: if the count falls below this, the rejection pool is raided (removed in v1.2.0: nothing is recovered or topped up) |
| `bob_scoring_batch_size` | `25` | LLM batch size for `BEST_OF_BEST_SCORING_PROMPT` |
| `bob_theme_max_share` | `0.15` | Maximum fraction of `target_max_use_cases` any single theme may hold |

All five are tunable without code change. The defaults are the validated production settings.

### D. Known Issue (Resolved In v0.7.3)

**Hard-veto UCs can survive the Stratified Trim if they are the only representative of their theme.** The stratified trim's 1-per-theme FLOOR rule (coverage guarantee) takes precedence over the hard-veto rule (quality floor). On the v0.7.2 validation run, **3 out of 100 UCs (3%)** arrived at the final list with `bob_score = 2.0`: they were kept because removing them would have erased their idea theme entirely.

**Status:** Resolved in v0.7.3 (commit `69c9f12`). `_stratified_trim_by_theme` now pre-filters hard-veto UCs BEFORE theme grouping, so coverage is reconstructed only from UCs that cleared the hard-veto floor. See [What's New in v0.7.3 §A](#whats-new-in-v073) and [v0.7.2 Known Issues (Resolved In v0.7.3)](#v072-known-issues-resolved-in-v073).

---

## What Is Inspire AI?

Inspire AI is a 7-phase multi-model AI agent that reads Unity Catalog metadata -- catalog, schema, table and column names, column types, comments, key constraints, tags and table properties only -- and automatically discovers, scores, ranks, and generates production-ready business use cases.

It never touches your actual data at any point of the pipeline.

From metadata alone, Inspire produces:

- Scored, ranked, and idea-themed business use cases grouped by domain
- Genie Code instruction notebooks for each use case
- PDF catalogs, PowerPoint presentations, and Excel spreadsheets
- JSON catalogs for programmatic consumption

Inspire supports 23 languages for all generated artifacts. It is privacy-first by design: both discovery types read aggregates over your tables to judge each use case, and in Standard Discovery (the default) the AI never sees them. No data row is ever sent to the AI, and the values of personal columns are never read.

---

## Documentation

1. Download or copy the file `dbx_inspire_ai_agent.ipynb`
2. In your Databricks workspace, go to Workspace > Import > select the file
3. Attach it to a serverless or shared cluster
4. The first cell creates all widgets at the top of the notebook
5. Fill in widget values (see [Key Features](#key-features))
6. Click **Run All** (or run cells sequentially)

After widgets are created, you will see them at the top of the notebook as input fields and dropdowns.

---

## Key Features

### Mandatory Widgets

These two must be filled correctly or the run will fail immediately.

**01. Business Name**
- What it is: the name of the organization, business unit, or initiative being analyzed
- Example: `Acme Retail`, `Global Payments Division`, `HealthCo Claims`
- Why it matters: this name is embedded into every AI prompt, so the AI understands whose business it is analyzing
- If empty: validation fails, run stops

**02. UC Metadata**
- What it is: comma-separated Unity Catalog paths that define the data scope
- Accepts three levels:
  - Catalog level: `my_catalog` (all schemas and tables in that catalog)
  - Schema level: `my_catalog.my_schema` (all tables in that schema)
  - Table level: `my_catalog.my_schema.my_table` (specific table)
- You can mix levels: `catalog1, catalog2.schema1, catalog3.schema2.orders`
- Why it matters: this is the entire universe of data Inspire will consider
- If empty in Discover mode: validation fails, run stops
- Special behavior: if you provide a file path starting with `/`, Inspire enters docs-only mode (regenerates artifacts from a previous run's JSON output)

### Optional Tracking

**03. Inspire Database**
- What it is: a `catalog.schema` location where Inspire writes tracking tables
- Example: `my_catalog.inspire_tracking`
- Must be exactly two levels separated by a dot
- Creates three tracking tables automatically: `__inspire_session`, `__inspire_step`, `__inspire_usecases`
- The `__inspire_usecases` table in v0.7.2+ includes 5 new BoB columns; see [Output Artifacts](#output-artifacts)
- Why it matters: without this, you lose all run monitoring, progress tracking, BoB audit trail, and session reproducibility
- If left empty: defaults to `main._inspire` as a placeholder
- Result table names are quoted three-level names: `` `catalog`.`schema`.`_inspire_<id>_<name>` ``
- From v1.3.0 the same schema also holds `__inspire_feedback` (use case feedback written by the Inspire App) and `_ailogs` (every LLM call attempt)

### Discovery Type

**04. Discovery Type** (dropdown, default `Standard Discovery`; widget key `03_discovery_type`)

| Value | Behavior |
|-------|----------|
| `Standard Discovery` (default, recommended) | Reads metadata, metric view definitions and usage counts, plus aggregates over your tables (row counts, distinct counts, first and last dates, null share, group sizes, outcome and interaction counts). Inspire uses those numbers only to decide each use case; one gate (`InspireAIGate`) withholds every measured number from every AI prompt, so the AI sees metadata only |
| `AI Enhanced Discovery` | The same aggregate checks, and the AI also sees the aggregates (row counts, null share, distinct counts, date coverage, short value lists of non-personal low-cardinality columns, join match rates, KPI baselines) when it writes and grades use cases |

In both, no data row is sent to the AI and the values of personal columns are never read. A use case short of a hard data minimum (for example a prediction with 11 outcome rows) is dropped with its reason; a use case you asked for, and the strongest use case of a domain you named, are kept and carry the reason. The values `Deep`, `Deep Discovery` and `AI Enhanced` still work and mean `AI Enhanced Discovery`; `Standard` means `Standard Discovery`. A use case of a decision kind must name a decision or action and a measurable outcome; an informational kind (such as a driver breakdown or a journey path) is labelled Informational.

When a use case is built, Inspire counts its data before Genie starts. When the data is short of the method's minimum, Genie gets the measured numbers and must pick a method valid at that size, and the build summary says what changed.

See [Discovery Type: Standard And Deep](#a-discovery-type-standard-and-deep) for the exact reads and limits.

### Table Selection

**05. Table Election** (dropdown)

| Value | Behavior |
|-------|----------|
| `Let Inspire Decides` | Automatically selects tables based on data category (prefers transactional tables when there are many tables; includes all when count is small) |
| `All Tables` | Uses every business table discovered (excludes technical/metadata tables automatically) |
| `Transactional Only` | Uses only transactional tables; falls back to all if none found |

Inspire always filters out technical/metadata tables (audit logs, system tables, ETL tracking) regardless of this setting.

### Quality Control

**06. Use Cases Quality** (dropdown, default `Good`)

| Value | Effect |
|-------|--------|
| `Good` | Keeps Medium, High, Very High, and Ultra High quality use cases |
| `High` | Keeps only High, Very High, and Ultra High quality use cases |
| `Ultra High` | Keeps only the elite use cases that clear an absolute bar for value, metadata evidence, implementability and actionability; see [Quality Modes](#quality-modes-good-high-ultra-high-v120) |

Every mode runs the same broad generation pass; the mode only decides which scored use cases are selected. Legacy labels are accepted: `Coverage Mode (All)`, `Balanced`, `Good Quality` and `High Quality` run as `Good`; `Strict Quality` and `Very High Quality` run as `High`.

### Business Steering Widgets

These are optional but significantly improve relevance.

**07. Business Domains** (text, comma-separated)
- Seed domains you want use cases aligned to
- Example: `Risk Management, Revenue Optimization, Customer Retention`
- If empty: domains are auto-detected from data

**08. Business Priorities** (multi-select)
- Available options: `Increase Revenue`, `Reduce Cost`, `Optimize Operations`, `Mitigate Risk`, `Empower Talent`, `Enhance Experience`, `Drive Innovation`, `Achieve ESG`, `Protect Revenue`, `Execute Strategy`
- From v1.3.0 priorities act only after selection: each final use case lists the priorities it serves in `Business Priority Alignment`. They no longer steer generation or scoring; each matched priority raises Strategic Alignment by 0.25 (at most 2), which moves the final order
- The `priorities` of a strategic context replace this list

**09. Generation Instructions** (text, free-form)
- The highest-priority steering signal
- Example: `join table X with Y on column Z, focus on fraud detection, use XGBoost, ignore tables starting with __log`
- When provided, these are interpreted by AI and applied as non-negotiable instructions across all generation phases (table joins, goals, forced algorithms, table ignores)

**11. Strategic Context** (text, optional; widget key `10_strategic_context`)
- Inline JSON, or a Workspace or Volumes file path starting with `/`
- One strategy tree in your own words: 1 to 4 level names, entries (with optional KPIs and key results on any entry), business priorities, a sponsor roster and labels for your terms
- Applied only after selection: it aligns, enriches and orders the final use cases and never finds, keeps or removes one
- Invalid JSON, an unreadable path, a tree deeper than 4 levels, more than 200 entries or a name over 300 characters stop the run with a clear error

```json
{
  "schema_version": 1,
  "levels": ["Strategic Pillar", "Business Objective"],
  "strategy": [
    {"name": "Customer", "children": [
      {"name": "Grow repeat purchases",
       "kpis": [{"name": "Repeat purchase rate", "unit": "%", "direction": "increase"}],
       "key_results": [{"statement": "Raise repeat purchase rate from 18% to 24%", "kpi": "Repeat purchase rate"}]}]},
    {"name": "Operations", "children": ["Cut stockouts", "Lower delivery cost"]}
  ],
  "priorities": ["Grow revenue", "Protect margin"],
  "sponsors": [{"role": "Chief Customer Officer", "owns": ["Customer"]}],
  "labels": {"kpi": "Measure", "key_result": "Target"}
}
```

### Output Control Widgets

**10. Generation Options** (multi-select)

| Option | What It Produces |
|--------|-----------------|
| `Genie Code Instructions` | Per-use-case Genie Code instruction notebooks designed for Databricks Genie Code to execute autonomously |
| `PDF Catalog` | Professional PDF document per language |
| `Presentation` | Executive PowerPoint slides per language |

**12. Generation Path** (text, default: `./../demos/inspire_gen/`)
- Folder where all output files are written
- Path is relative to your workspace notebook location

**13. Documents Languages** (multi-select)
- Required only when generating PDF or Presentation
- Available: English, French, German, Spanish, Hindi, Chinese (Mandarin), Japanese, Arabic, Portuguese, Russian, Swedish, Danish, Norwegian, Finnish, Italian, Polish, Romanian, Ukrainian, Dutch, Korean, Indonesian, Malay, Tamil
- If not generating PDF/Presentation, defaults to English automatically

**14. Inspire Session ID** (text, optional)
- If empty: auto-generated unique ID
- If provided: allows reproducible tracking and log queries; same session ID across runs updates existing entries rather than creating new ones

**16. Best of Best Count** (text, optional; widget key `16_best_of_best_count`)
- How many use cases are starred as Best of Best: a whole number from 0 (no stars) to 100
- Empty means 20, unless the generation instructions give a number ("star the top 10 use cases"); this widget wins over the instructions
- Only stars use cases; it never adds, removes or reorders one. Any other value stops the run with a clear error

---

## The 19 Quality Gates

Every use case Inspire generates must survive 19 quality gates. These gates are baked into the generation prompt, enforced at scoring time, re-applied during selection, and (new in v0.7.2) scored individually on a **0-10 scale** during Best-of-Best ranking.

**Every gate is enforced by LLM reasoning: zero regex, zero pattern matching.**

If a use case fails any critical gate at the classic scoring stage, it is capped at quality score 2.0 ("Low") and dropped by the quality bar of every mode. If it fails a BoB gate (individual score < 3 out of 10) at the BoB stage, its composite is capped at 2.0 and it is dropped before the stratified trim.

### Scoring Style at Each Stage

| Pipeline Stage | Gate Scoring Style | Scale | Effect of Failure |
|----------------|-------------------|-------|-------------------|
| Generation (Pass 1 + Pass 2) | Gates are prompt instructions | none | LLM avoids producing UCs that violate gates |
| Combined Value + Quality Scorer | Rubric-driven 1.0-5.0 per dimension | 1.0-5.0 | Hard veto caps `quality_score` at 2.0 |
| Aggressive Vetting (v0.7.2+ BoB) | Individual numeric score per gate | **0-10** per gate | Any gate < 3 caps `bob_score` at 2.0 |

The 0-10 BoB scale is new in v0.7.2: it replaces the legacy YES/NO vote used in earlier aggressive vetting. The finer granularity is what lets the stratified trim distinguish a 6.4 from a 7.9 within the same theme.

**v0.7.3 refinement: hard-veto UCs are dropped before the stratified trim.** In v0.7.2 the trim's 1-per-theme FLOOR rule could preserve a hard-vetoed UC if it was the sole representative of its theme. v0.7.3 pre-filters every UC with `bob_hard_veto_gate != None` out of the trim input, so a theme whose only representative was hard-vetoed is legitimately eliminated. This is the correct semantic: a theme that cannot produce even one fundable UC should not appear in the portfolio.

### Tier 1: Technical Grounding (D1-D11)

Proving the use case is grounded in the data and analytically sound.

| # | Gate | Question | Veto |
|---|------|----------|------|
| D1 | Causal Signal | Do the data columns directly cause or indicate the outcome being predicted? | ≤ 2.5 → Hard veto |
| D2 | Cause-Effect Validity | Is the cause-effect relationship logical, proven, and industry-recognized? | ≤ 2.5 → Hard veto |
| D3 | Data Granularity | Is the data at the right level of detail for the analysis? | ≤ 2.5 → Soft veto |
| D4 | Critical Dimensions | Are all required columns actually present in the schema? | Hallucination → Hard veto |
| D5 | Logical Possibility | Can the operation be performed on the given types? | none |
| D6 | Metric Validity | Can the claimed metric actually be calculated from available fields? | none |
| D7 | Design-Schema Match | Does the technical design cite columns that exist? | ≤ 2.5 → Soft veto |
| D8 | Semantic Uniqueness | After verb / noun / entity / metric normalization: is this a duplicate? | ≤ 2.5 → Hard veto |
| D9 | Analytical Depth (Strip Test) | Remove ML-technique mentions: is there real analytical substance left? | ≤ 2.5 → Hard veto |
| D10 | Activation Quality (Action Test) | Does the `Name` start with the owner's action and name the items it picks, with no technique, no "with ..." tail and no value phrase? | ≤ 2.0 → Hard veto |
| D11 | Domain & Technique Balance | Does the portfolio cluster too heavily on one domain+technique? | Score reduction only |

### Tier 2: Business Value (D12-D14)

The "would you actually fund this?" gates: applied after technical grounding passes.

| # | Gate | Persona | Question | Veto |
|---|------|---------|----------|------|
| D12 | Business Relevance & Opportunity | Business Stakeholder | Is it relevant to day-to-day operations? Does it deliver tangible value (revenue / cost / risk / opportunity)? Can you name the team or role that consumes the output? Does it represent a current pain or a future opportunity to expand into? | Any "no" → Hard veto |
| D13 | Sponsor Test | Sponsor / CFO | Would you fund this use case with a real budget line? Could you pitch it to the CEO and get approval without caveats? | Any "no" → Hard veto |
| D14 | Engineering Test | Production Engineer | Can you put this to production on existing Databricks capabilities (`ai_query`, Delta, MLflow, Spark): no fabricated external services? Can you support and maintain it long-term (drift, refresh, retrain) with existing team skills? Can you fix issues without external dependencies or bespoke infrastructure? | Any "no" → Hard veto |

### Tier 3: Principal-Business-Analyst (D15-D19)

The questions a 20-year Principal Business Analyst would ask before signing off.

| # | Gate | Question | Veto |
|---|------|----------|------|
| D15 | Decision Cadence Match | Does the data refresh cadence match the business decision cadence? Weekly decisions need at least weekly data. If decision speed outruns data speed, the output is unactionable. | "No" → Hard veto |
| D16 | The Monday Test | If a stakeholder reads this on Monday morning, does their Monday look different from last Monday? Must name a concrete action the output triggers. Interesting-to-know without a workflow change is decorative. | "No" → Hard veto |
| D17 | Explainability & Audit Defensibility | If a regulator, auditor, CFO, or unhappy customer asks "how did you reach this conclusion?", can the output be explained in 5 minutes without proprietary magic? Black-box models for high-stakes decisions fail. | "No" → Hard veto (high-stakes) |
| D18 | 18-Month Longevity | In 18 months, will this still be running or abandoned? Short-term tactical patterns ("this quarter's promo mix") are one-offs, not use cases. Only persistent operational advantages pass. | "No" → Hard veto |
| D19 | Attributable Impact | Six months after deployment, can the business prove this use case changed a measurable dollar amount in revenue, cost, or risk? Diffuse impact ("awareness", "visibility") without a traceable decision chain fails. | "No" → Hard veto |

### How the Gates Fire

```
┌──────────────────────────────────────────────────────────────┐
│  Generation Pass 1 + Pass 2                                  │
│    ↓  Gates D1-D19 are instructions, so the LLM generates    │
│       use cases already trying to satisfy all 19 gates       │
├──────────────────────────────────────────────────────────────┤
│  Combined Value + Quality Scorer                             │
│    ↓  Gates D1-D19 scored as 1.0-5.0 dimensions;             │
│       any hard veto caps quality_score at 2.0                │
├──────────────────────────────────────────────────────────────┤
│  Quality Bar of the selected mode                            │
│    ↓  Good: keeps Medium or better                           │
│       High / Ultra High candidates: keep High or better      │
├──────────────────────────────────────────────────────────────┤
│  Good / High: BEST-OF-BEST (v0.7.2+): each gate 0-10,        │
│    ↓  hard-vetoed UCs dropped; count >                       │
│       aggressive_prune_threshold (default 75) →              │
│       stratified trim by theme                               │
│  Ultra High: ELITE SELECTION, absolute bar,                  │
│       no quota, no cap                                       │
├──────────────────────────────────────────────────────────────┤
│  Every mode: one domain coverage pick per empty user domain; │
│       no recovery, no top-up; 0 survivors is reported        │
└──────────────────────────────────────────────────────────────┘
```

### Why This Is Ruthless But Fair

| Gate Group | What It Kills |
|---|---|
| Technical (D1-D11) | Hallucinated columns, trivial SQL, duplicates, analytics dressed up as ML |
| Sponsor (D13) | Use cases no CFO would fund and no CEO would approve |
| Engineering (D14) | Shelfware: use cases that cannot be operated by the production team |
| Monday Test (D16) & Longevity (D18) | Decorative "insight" use cases that never change behavior and die in 3 months |
| Cadence (D15) | Use cases whose data cannot refresh fast enough to support the decision |
| Explainability (D17) | Black-box models for high-stakes decisions where someone might defend the output in court |
| Attributable Impact (D19) | Diffuse "awareness" and "visibility" use cases that no one can later prove moved a dollar |

**Portfolio size after all 19 gates**: there is no target count, quota or floor. The portfolio holds every fundable, operable, explainable, durable, measurable use case that clears the selected mode's bar. In `Good` and `High` a survivor set larger than `aggressive_prune_threshold` is capped by the stratified trim; `Ultra High` has no cap.

---

## Best-of-Best Ranking (v0.7.2+, v0.7.3 Refinements)

Best-of-Best (BoB) is the v0.7.2 replacement for the legacy "aggressive dedupe" pass. It runs automatically inside Phase 4 whenever the surviving count exceeds `aggressive_prune_threshold` (default 75). It has two halves: an LLM pass that scores every UC on every gate, and a deterministic Python pass that selects the final portfolio. The stratified trim described below applies to the `Good` and `High` modes; in `Ultra High` BoB is the prescreen in front of the elite stage, and nothing is trimmed to a target size.

**v0.7.3 refinements** to this subsystem: (1) hard-veto UCs are pre-filtered before the stratified trim, closing the 3% survivor rate observed in v0.7.2; (2) the trim ceiling is randomized within `[target_max_use_cases + 1, target_max_use_cases + target_max_jitter]` so final portfolio sizes are no longer artificially round.

### Why BoB Exists

Before v0.7.2, when the portfolio exceeded the target ceiling the pipeline ran a "dedupe harder" LLM pass. That worked fine on small overshoots (e.g. 90 → 75) but collapsed on large ones (e.g. 244 → 100) for two reasons:

1. **Topic collapse**: the LLM preferentially dropped UCs from small theme clusters because they looked like "outliers", leaving the final 100 dominated by 2-3 popular themes.
2. **No audit trail**: the decision to drop a UC was an opaque LLM judgement, with no per-gate score you could later inspect in the database.

BoB solves both: it forces the LLM to score every gate numerically (audit trail) and it lets deterministic Python handle the selection (no topic collapse).

### The Composite Score

Every UC that enters aggressive vetting is scored by `BEST_OF_BEST_SCORING_PROMPT` on all 19 gates on a 0-10 scale. Python then composes the 19 numbers:

```
tier1 = mean(D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11)   # technical
tier2 = mean(D12, D13, D14)                                   # business value
tier3 = mean(D15, D16, D17, D18, D19)                         # PBA

bob_score = 0.30 * tier1 + 0.35 * tier2 + 0.35 * tier3

if min(D1..D19) < 3:
    bob_score = min(bob_score, 2.0)    # hard-veto floor
```

Why 0.30 / 0.35 / 0.35? Tiers 2 and 3 are the "would a CFO / Principal BA sign off?" gates: they are what actually prevents shelfware. Tier 1 is a necessary-but-not-sufficient floor; a technically-perfect UC that fails the Monday Test is worthless, so Tier 1 gets slightly less weight. The split is a deliberate *business-value-first* posture.

### Batching

BoB scoring is batched at `bob_scoring_batch_size` (default 25) UCs per LLM call. Each batch runs in parallel across the LLM cascade. On the 244-UC validation run this meant 10 parallel batches, completed in roughly 4 minutes wall-clock.

### The Stratified Trim Algorithm

Once every UC has a `bob_score` and an `idea_theme`, Python picks the final portfolio. Pseudocode (v0.7.3):

```python
def stratified_trim(ucs, target_max, target_max_jitter, max_share):
    # Step 0 (v0.7.3): HARD-VETO PRE-FILTER:
    #   drop every UC with bob_hard_veto_gate != None before
    #   theme grouping. A theme whose only representative was
    #   hard-vetoed is legitimately eliminated here.
    ucs = [u for u in ucs if u.bob_hard_veto_gate is None]

    # Step 0.5 (v0.7.3): JITTERED CAP:
    #   effective trim ceiling is randomized so portfolio sizes
    #   are not always a round number.
    effective_cap = target_max + randint(1, target_max_jitter)  # e.g. 90 + [1..20] -> [91..110]

    theme_cap = int(effective_cap * max_share)    # e.g. 110 * 0.15 = 16
    themes = group_by(ucs, key="idea_theme")

    # Step 1, FLOOR: every (surviving) theme keeps at least 1 UC.
    kept = []
    for theme, members in themes.items():
        best = max(members, key=lambda u: u.bob_score)
        kept.append(best)
        members.remove(best)

    # Step 2, BUDGET: allocate remaining slots proportionally
    #          to theme size, capped by theme_cap.
    remaining_budget = effective_cap - len(kept)
    total_remaining = sum(len(m) for m in themes.values())

    for theme, members in themes.items():
        share = len(members) / total_remaining
        slots = min(
            int(share * remaining_budget),
            theme_cap - 1,                        # -1 because FLOOR already took 1
        )
        top_k = sorted(members, key=lambda u: -u.bob_score)[:slots]
        kept.extend(top_k)

    # Step 3, BACKFILL: if rounding left us short, take the next-best
    #          UCs from any under-capped theme by global bob_score DESC.
    leftover = effective_cap - len(kept)
    if leftover > 0:
        pool = [u for u in ucs if u not in kept]
        pool.sort(key=lambda u: -u.bob_score)
        for uc in pool:
            theme_count = sum(1 for k in kept if k.idea_theme == uc.idea_theme)
            if theme_count < theme_cap:
                kept.append(uc)
                leftover -= 1
                if leftover == 0: break

    return kept
```

Four invariants hold regardless of input (v0.7.3):

1. `|kept| <= effective_cap` (with `effective_cap ∈ [target_max + 1, target_max + target_max_jitter]`)
2. For every theme: `count(kept by theme) <= theme_cap`
3. For every theme whose BEST UC cleared the hard-veto: `count(kept by theme) >= 1`
4. **No UC with `bob_hard_veto_gate != None` appears in `kept`** (new in v0.7.3)

Invariant 3 is the coverage guarantee. Invariant 2 is the anti-collapse guarantee. Invariant 4 is the quality-floor guarantee. Together they mean a 244-UC portfolio with 75 distinct themes cannot emerge as "100 UCs all about Fraud Detection" AND cannot contain a UC that failed any gate below 3/10.

### Worked Example: The v0.7.2 Validation Run

Input: 244 UCs, 75 distinct themes, `target_max = 100`, `bob_theme_max_share = 0.15` ⇒ `theme_cap = 15`.

1. **FLOOR**: 75 UCs kept (one per theme, the highest `bob_score` in each theme). Budget remaining = 25.
2. **BUDGET**: 25 slots distributed proportionally. The largest theme, Anomaly Detection, had ~27 UCs; proportional share ≈ 27/169 × 25 ≈ 4 extra slots → ends up with 1 (floor) + 4 (budget) = 5. With the backfill pass described below, Anomaly Detection climbed to the observed 11 UCs.
3. **BACKFILL**: rounding leaves a few slots unfilled; the highest-scoring UCs in under-capped themes are added until `|kept| = 100`.

Final observed distribution from the validation run:

| Theme | UCs | Cap Reached? |
|-------|-----|--------------|
| Anomaly Detection | 11 | No (cap = 15) |
| Customer Segmentation | 6 | No |
| Pricing Optimization | 5 | No |
| Churn Prevention | 5 | No |
| Supply Chain Forecasting | 4 | No |
| ... 70 other themes | 1-4 each | No |

No theme hit the cap. Every one of the 75 input themes is represented in the final 100. The BoB composite range in the final 100 was **2.0-8.23**, mean **6.7**.

---

## Idea Themes

### What Is an Idea Theme?

An idea theme is a 2-to-4-word LLM-assigned label that describes the *analytical idea* a use case embodies. It is a complementary label to the existing `business_domain` / `subdomain`:

- `business_domain` = *"who in the business cares"* (e.g. Risk Management, Revenue Operations)
- `subdomain` = *"which sub-function within that business"* (e.g. Credit Risk, Fraud Detection)
- `idea_theme` = *"what analytical idea are we using"* (e.g. Anomaly Detection, Time Series Forecasting)

Two use cases can share an `idea_theme` while living in completely different `business_domains`: e.g. both "Fraud Transaction Scoring" (Risk Management) and "Manufacturing Defect Detection" (Operations) share the theme `Anomaly Detection` even though their domains are different.

### How Are Themes Discovered?

Themes are **LLM-named once per run, after BoB scoring** (v1.3.0). There is no pre-defined theme list. One `THEME_ASSIGNMENT_PROMPT` call sees every scored use case (id, name, technique and main table) and:

- Chooses 2-to-4-word labels that describe the *analytical idea* (not the business domain)
- Gives use cases built with the same kind of method for the same kind of question one theme, across domains
- Keeps apart ideas that answer different questions (`Demand Forecasting` and `Cash Flow Forecasting` stay separate) and never makes a catch-all theme

The prompt seeds only examples, not a list, so the vocabulary still comes from the data. Before v1.3.0 every scoring batch named its own themes and the vocabulary grew to ~60-120 distinct themes per portfolio, most of them holding one use case.

### Why Themes Matter

Themes are the unit of *coverage* in v0.7.2. The legacy aggressive-dedupe approach was effectively a global sort by quality score: it guaranteed "the top N strongest UCs survive" but gave zero guarantee that the top N covered more than 2-3 topics. Themes flip this:

- **Coverage is first-class**: no theme can be wiped out (FLOOR rule)
- **Concentration is bounded**: no theme can dominate (CAP rule)
- **Within-theme quality is preserved**: BoB ranking picks the best-per-theme

The business impact: stakeholders reviewing the final portfolio see a wide analytical palette (75 themes across 100 UCs in the validation run), not 100 variations on whichever idea the LLM happened to generate most. That is exactly what a Principal Business Analyst would have produced by hand: and exactly what the old pipeline could not.

### Example Themes Observed in Real Runs

| Theme | Typical UC Count (validation) | Analytical Idea |
|-------|-------------------------------|-----------------|
| Anomaly Detection | 11 | Unsupervised or supervised outlier identification |
| Customer Segmentation | 6 | Clustering on behavioral or demographic attributes |
| Pricing Optimization | 5 | Elasticity modeling, demand-based pricing |
| Churn Prevention | 5 | Survival analysis, retention scoring |
| Supply Chain Forecasting | 4 | Time series + causal drivers |
| Fraud Scoring | 3 | Supervised classification on known fraud labels |
| Inventory Right-Sizing | 3 | Safety-stock + demand-forecast join |
| Basket Analysis | 3 | Frequent itemset / association rules |
| Campaign Attribution | 2 | Multi-touch attribution modeling |
| Return-to-Source Analysis | 2 | Root-cause classification |
| ... 65 other themes | 1-2 each | Various |

---

## Portfolio Size Math

This section applies to the `Good` and `High` modes. There is no lower bound in any mode: Inspire never recovers rejected use cases, never tops a small portfolio up, and never pads it toward a target zone. `Ultra High` has no upper bound either; its count is whatever clears the elite bar.

### The Decision Table

After the quality bar of the selected mode, Inspire knows the count `N` of surviving use cases. It compares `N` to these threshold constants:

- `bob_min_threshold` (default 20)
- `aggressive_prune_threshold` (default 75)
- `target_max_use_cases` (default 90 in v0.7.3, was 100 in v0.7.2)
- `target_max_jitter` (default 20 in v0.7.3, new key)

| Condition | Action | Why |
|-----------|--------|-----|
| `N = 0` (none met the bar) | **Below-bar fallback**: the closest candidates are returned, labelled "below the `<mode>` bar" with their real scores and the check each missed, under a plain notice that no use case met the bar | The run is never shipped empty when candidates exist, and never padded when the bar is met |
| `0 < N < bob_min_threshold` | **No trim**: BoB is not run | Too few to rank |
| `bob_min_threshold ≤ N ≤ aggressive_prune_threshold` | **BoB scoring**: hard-vetoed and BoB-unscored use cases are dropped; nothing is trimmed | Every UC gets a `bob_score` |
| `aggressive_prune_threshold < N` | **BoB + Stratified Trim** to `effective_cap = target_max_use_cases + randint(1, target_max_jitter)` | Too many; need ranked, theme-balanced selection |

In every row the canonical-title dedup then removes duplicate decisions, and each user-specified Business Domain left empty receives one domain coverage pick, labelled "Domain coverage pick, below bar".

Note: `aggressive_prune_threshold` (75) is lower than `target_max_use_cases` (90) by design. When `75 < N ≤ 90 + jitter`, the old code would have done nothing; v0.7.2+ chooses to BoB-rank those portfolios anyway, so that the final list is always ranked and themed, even when no trimming is needed. The trim step simply happens to be a no-op in that range (all UCs kept, but now tagged with `bob_score` and `idea_theme`).

**v0.7.3 effective-cap formula**: `effective_cap = target_max_use_cases + randint(1, target_max_jitter)` = `90 + randint(1, 20)` ∈ **[91, 110]**. The cap is resampled per run, so two runs of the same dataset will generally end at different (but nearby) portfolio sizes, intentionally.

### Worked Example: 244 → 105 (v0.7.3 tpcds_sf1 Validation)

- `N = 244`, `aggressive_prune_threshold = 75` → trigger BoB.
- BoB scoring: 244 UCs × 19 gates = 4,636 individual scores, in 10 batches of 25 → ~4 minutes wall-clock.
- Tier composition yields 244 `bob_score` values.
- **Hard-veto pre-filter (v0.7.3)**: 13 UCs with `bob_hard_veto_gate != None` are dropped before the trim runs. Input to the trim: **231 UCs**.
- Themes emerge on the filtered set: ~70 distinct labels.
- Effective cap this run: `90 + randint(1, 20)` → **105** (a specific sample; other runs of the same data would land elsewhere in [91, 110]).
- `theme_cap = int(105 * 0.15) = 15`.
- Stratified trim on 231 UCs with `effective_cap = 105`:
  - FLOOR takes ~70 UCs (one per surviving theme)
  - BUDGET allocates the remaining ~35 proportionally
  - BACKFILL fills any last gaps
- Final output: **105 UCs, zero hard-veto survivors**. Session `1234567890000001`.

For reference, the legacy v0.7.2 worked example (244 → exactly 100, 3% hard-veto survivors) is preserved in [Release Notes: v0.7.2](#release-notes-v072).

### Observable Outputs

After BoB runs, the operator can query:

```sql
-- Theme distribution
SELECT
  idea_theme,
  COUNT(*) AS uc_count,
  ROUND(AVG(bob_score), 2) AS avg_score,
  ROUND(MIN(bob_score), 2) AS min_score,
  ROUND(MAX(bob_score), 2) AS max_score
FROM <inspire_db>.__inspire_usecases
WHERE session_id = <session_id>
GROUP BY idea_theme
ORDER BY uc_count DESC, avg_score DESC;
```

```sql
-- Identify hard-veto survivors (see Known Issues)
SELECT
  id, use_case, idea_theme,
  bob_score, bob_tier1_score, bob_tier2_score, bob_tier3_score
FROM <inspire_db>.__inspire_usecases
WHERE session_id = <session_id>
  AND bob_score <= 2.0
ORDER BY idea_theme;
```

---

## Pipeline Phases

Inspire executes 7 phases sequentially when running in Discover mode.

**Phase 1: Initialization and Context Extraction**
- Inspire sends your business name and metadata to an LLM
- LLM returns: business context, strategic goals, priorities and value chain; text inferred from the business name alone is labelled `[ASSUMPTION ...]` (business context, value chain, and the business priorities when the user selected none; user-selected priorities are never labelled) and the industry is taken from that labelled context, never from the business name itself
- Strategic initiative and revenue model stay `UNKNOWN_FROM_METADATA` because no input carries them; every generation, scoring, elite-judge and Genie Code instruction prompt treats `[ASSUMPTION ...]` text as a hypothesis, never as evidence
- Tables whose metadata cannot be loaded are named in an `ended_warning` `Metadata Load` step, the honesty report and `results_json.metadata_unavailable`
- If you provided Generation Instructions, they are interpreted by AI into structured directives (table joins, goals, forced algorithms, table ignores) that apply as non-negotiable rules across all phases
- Tables are classified as business vs. technical; technical tables are filtered out
- Table Election widget controls which business tables are kept

**Phase 2: Use Case Generation**
- Inspire generates use cases covering structured data analytics, AI/ML, and statistical techniques in a comprehensive discovery pass (Pass 1 + Pass 2)
- Each use case includes: name, statement, solution, business value, beneficiary, sponsor, technical design, tables involved
- **19 quality gates (D1-D19)** are enforced at generation time; see [The 19 Quality Gates](#the-19-quality-gates)
- Every gate is evaluated by LLM reasoning: **zero regex, zero pattern matching, pure LLM judgment**

**Phase 3: Domain Clustering**
- Use cases are grouped into business domains (e.g., Risk Management, Revenue Operations)
- Subdomains are detected within each domain
- Overlapping domains are merged
- Duplicate subdomains across domains are consolidated
- Oversized mega-domains are split into balanced groups

**Phase 4: Scoring, Deduplication, and Best-of-Best Ranking**
- Each use case receives two independent scores from a single combined LLM call (the only scoring pass; each batch sees only the schema of its own tables and their foreign-key partners):
  - **Value Score** (1.0-5.0): strategic alignment, ROI potential, business impact
  - **Quality Score** (1.0-5.0): all 19 gates (D1 technical grounding through D19 attributable impact)
- Any HARD VETO gate caps `quality_score` at 2.0 and the UC is dropped by the quality bar of every mode; a UC without a valid score is never selected
- Duplicate detection is **LLM-based only** (no regex clustering): 5-layer semantic judgment via `REVIEW_USE_CASES_PROMPT` (verb normalization, noun synonyms, entity-metric pairs, technique swaps, table overlap); the global pass starts on the thinker model and cascades to the next model when that one is slow or fails
- Goal alignment filtering removes use cases that do not align with user-specified goals (when Generation Instructions contain a goal); goal-aligned use cases still face the quality bar
- **Quality bar of the selected mode**: `Good` keeps Medium or better; `High` keeps High or better; `Ultra High` sends High-or-better candidates (plus a high-value second look) to the elite stage
- **`Good` and `High`: BoB + Stratified Trim (v0.7.2+)**:
    1. `BEST_OF_BEST_SCORING_PROMPT` scores every UC on all 19 gates on a 0-10 scale; one `THEME_ASSIGNMENT_PROMPT` call then names the `idea_theme` of every scored UC (v1.3.0)
    2. Python composes the tier-weighted `bob_score` (0.30 / 0.35 / 0.35) with a hard-veto floor at 2.0; hard-vetoed UCs are dropped
    3. Only when `count > aggressive_prune_threshold` (default 75): stratified trim by `idea_theme` enforces FLOOR (≥1 per theme), CAP (≤ `target_max * bob_theme_max_share`), and BUDGET (proportional allocation)
    4. 5 columns are persisted: `idea_theme`, `bob_score`, `bob_tier1_score`, `bob_tier2_score`, `bob_tier3_score`
- **`Ultra High` Elite Selection**: BoB prescreen, `ULTRA_HIGH_ELITE_JUDGE_PROMPT`, deterministic metadata verification and the absolute bar; no quota, no cap, no padding (see [Quality Modes](#quality-modes-good-high-ultra-high-v120))
- **Every mode**: one domain coverage pick per empty user-specified Business Domain; no recovery, no top-up; when zero use cases met the bar the run returns the closest candidates labelled "below the `<mode>` bar" with real scores, under a plain notice that no use case met the bar (never shipped empty when candidates exist)
- See [Best-of-Best Ranking](#best-of-best-ranking-v072-v073-refinements) and [Portfolio Size Math](#portfolio-size-math) for full detail.

**Phase 5: Genie Code Instructions**
- For each qualifying use case, Inspire generates a goal-oriented Genie Code instruction
- In `Ultra High` mode every elite use case receives its Genie Code instruction
- Each instruction describes WHAT to achieve and WHY, letting Genie Code determine the optimal implementation
- Instructions include business context, analytical goals, table references, and `ai_query` compliance rules

**Phase 6: Summary and Artifacts**
- Executive summary is generated by AI
- Per-use-case Genie Code instruction notebooks are written (organized by domain/subdomain folders)
- Excel catalog is generated; in v0.7.2 this includes the 5 new BoB columns
- PDF and Presentation are generated per language (if selected)

**Phase 7: Translation**
- Keywords are translated first for accuracy
- Then full use case content is translated into selected languages
- One PDF and one PPTX per selected language

### Session Monitoring

The session ID is printed in the notebook output when the run starts:
`Inspire Session ID: 1234567890000000003`

Copy this number. You will use it in all monitoring queries.

### Session Health Query

```sql
SELECT
  session_id,
  processing_status,
  completed_percent,
  create_at,
  last_updated,
  completed_on
FROM <inspire_db>.__inspire_session
WHERE session_id = <session_id>;
```

How to read the result:

| completed_on | completed_percent | Meaning |
|-------------|-------------------|---------|
| NULL | < 100 | Pipeline still running |
| NULL | 99 | Almost done (capped at 99 until finalization) |
| timestamp | 100.0 | Pipeline complete |

### Stage Progress Query

```sql
SELECT
  last_updated,
  stage_name,
  step_name,
  sub_step_name,
  status,
  message
FROM <inspire_db>.__inspire_step
WHERE session_id = <session_id>
ORDER BY step_id;
```

Status values:

| Status | Meaning | What to Do |
|--------|---------|------------|
| `started` | Step is in progress | Wait |
| `ended_success` | Step completed successfully | Nothing |
| `ended_warning` | Step completed with caveats | Check message for details |
| `ended_error` | Step failed | Read message; may need widget adjustment |

The final `Inspire pipeline completed` step is `ended_warning` with the message `Completed with warnings: ...` when an artifact step failed, a translated document kept text in English or a table's metadata could not be loaded; `results_json.failed_steps`, `results_json.translation_gaps` and `results_json.metadata_unavailable` carry the details.

Business-friendly stage names you will see:

| Stage Name | What Is Happening |
|-----------|-------------------|
| Inspire Journey | Pipeline start/end markers |
| Setup | Database and tracking initialization |
| Business Understanding | Business context extraction and generation instructions interpretation |
| Data Preparation | Table filtering and classification |
| Use Case Design | Generating use cases from metadata |
| Domain Mapping | Clustering use cases into domains, subdomain detection, domain merging/splitting |
| Use Case Prioritization | Scoring, deduplication, and review; v1.2.0 adds the steps `Quality Bar` (warning carrying the below-bar fallback list when 0 use cases met the bar), `Selection Funnel` (the per-stage ledger) and `Elite Selection` (`Ultra High` only) |
| Best-of-Best Ranking | BoB LLM scoring (v0.7.2+): only appears when aggressive vetting triggers |
| Stratified Trim | Theme-balanced trimming to `target_max_use_cases` (v0.7.2+, `Good` and `High` only) |
| Goal Filtering | Filtering use cases by goal alignment |
| Implementation Planning | Genie Code instruction generation |
| Executive Readout | Summary, PDF, slides, Excel |
| Localization | Translating to non-English languages |

### Use Case Index Query

```sql
SELECT
  id,
  business_domain,
  subdomain,
  idea_theme,
  use_case,
  bob_score,
  bob_tier1_score,
  bob_tier2_score,
  bob_tier3_score,
  updated_at
FROM <inspire_db>.__inspire_usecases
WHERE session_id = <session_id>
ORDER BY bob_score DESC, id;
```

Use this to verify:
- Expected domains are present
- Use case names are business-relevant
- No unexpected gaps in ID numbering
- `idea_theme` is populated on every row (v0.7.2+)
- `bob_score` range is reasonable (typical: 2.0-9.0)

Always order by `result_json:event_at` NOT `last_updated` when querying `__inspire_step`; the writer flushes every 2s and `last_updated` can lag.

---

## Output Artifacts

After a successful run, your `Generation Path` contains:

```text
<generation_path>/
└── <BusinessName>/
    ├── notebooks/
    │   ├── AGENTS.md
    │   ├── risk_management/
    │   │   ├── credit_risk/
    │   │   │   ├── N01-U01 - predict_credit_default.ipynb
    │   │   │   └── N01-U02 - score_portfolio_risk.ipynb
    │   │   └── fraud_detection/
    │   │       └── N01-U03 - detect_anomalous_transactions.ipynb
    │   └── revenue_operations/
    │       └── ...
    └── docs/
        ├── <business>-dbx_inspire.xlsx
        ├── <business>-dbx_inspire.csv
        ├── readme.md
        ├── <business>-dbx_inspire.json
        ├── <business>-dbx_inspire_<lang>.json for each other output language
        ├── PDF catalog and PPTX presentation per language
        └── generation_log.txt
```

### What Each File Contains

**`<id> - <Use Case Name>.ipynb` (Use-Case Notebooks, v1.2.0)**
- One notebook per use case under `notebooks/<Domain>/<Subdomain>/`; the id follows the final rank
- **Skeleton notebook** (no Genie Code instruction yet): the use-case details and a marker cell (`INSPIRE_USE_CASE_ID`, `INSPIRE_SESSION_ID`, `generate_genie_code_instruction = False`). Flip the flag to `True`, or set `generate_genie_code_instruction = 'Yes'` on the tracking row, and run Inspire with `Operation = Generate Use Cases` to regenerate it. A regeneration that writes none of the flagged notebooks (for example when the run's identity cannot write to the session's generation path) fails the run and records a failed step; when only some are written, the run completes with warnings that count the ones not written. A Generate run that finds nothing to regenerate fails and says why: no tracking row of its session is flagged and no notebook is marked, the scan of the tracking table or of a notebook failed (with the error), or the marked notebooks match no tracking row
- **Genie notebook** (an instruction was emitted): four cells. The first holds the title, a short use-case card, a one-line disclaimer and "Copy the cell below into Genie Code without the surrounding quotes (the `r"""` and `"""` lines), and let Genie Code implement it."; the second holds the Genie Code instruction as a code cell; the third holds Inspire's Number helpers, directly above Run controls: the tested `is_missing`, `fmt_num`, `fmt_count`, `fmt_rank` and `keep_reasons`, which Genie Code calls inside the steps `run_use_case()` runs and never defines itself; the fourth, Run controls, is the last cell, and its `inspire_main()` runs the use case as the notebook's tagged Databricks job or in the session. The instruction cell holds the instruction with the KPIs, key results and KPI queries appended when the run defined them. Copy the instruction into Genie Code and let it run: Genie Code adds its cells between the instruction and the Number helpers, with each step in a function that `run_use_case()` runs, runs the notebook on serverless compute and fixes its own code until the notebook runs from top to bottom
- **Business output:** `<result_table>` (each run replaces the rows of its own as-of date and keeps older dates) and, for families A-D, the Unity Catalog model `<catalog>.<schema>.<table>_model` with the alias `champion`; both names are built from the quoted three-level `result_table`
- `notebooks/AGENTS.md` holds the rules Genie Code follows for every notebook. A notebook or `AGENTS.md` edited after Inspire wrote it is never overwritten; a regenerated notebook is written beside the edited one as `<name> (regenerated <timestamp>)`
- This is your primary working artifact

**`<business>-dbx_inspire[_<lang>].xlsx` (Excel Catalog)**
- Full catalog of all generated use cases
- **Filename (v0.7.3)**:
  - Single-language run: `<business>-dbx_inspire.xlsx` (unchanged)
  - Multi-language run: per-language suffix, for example `<business>-dbx_inspire_en.xlsx`, `<business>-dbx_inspire_de.xlsx`, ...
- Columns, in order (the `Use Cases` sheet; the CSV export has the same columns):
  - ID, Rank, Business Domain, Subdomain, Use Case, Description, Quality, Meets your quality bar (Y when the use case meets the run's quality bar, N when it is kept below the bar with its reason), Inspire Score, Quality Score, Best-of-Best Score, Priority, Value, Feasibility, Statement, Solution, Business Value, Use Case Kind, Kind Family, What we serve, How it works, Where the value comes from, Sponsor, Beneficiary, Business Priority Alignment, Strategic Goals Alignment, Analytics Technique, Type, Tables Involved, Data Foundations, Value estimate (a money range from a measured baseline with its currency and assumption, or value not measured yet with what to measure)
  - KPIs, Expected Key Results, Measures of Success, Financial Benefits, Non-Financial Benefits, when any use case of the run carries them
  - Primary Table, then Suggested Grouping and Record Level when Deep discovery suggested a grouping for any use case of the run, the twelve sub-scores (Strategic Alignment, ROI, Reusability, Time to Value, Data Availability, Data Accessibility, Architecture Fitness, Team Skills, Domain Knowledge, People Allocation, Budget Allocation, Time to Production), Priority Reasons, Quality Reasons, Result Database, Has Genie Code, Best of Best, Best of Best Reason
  - the elite columns (Elite Status and the elite decision fields) when the run judged elite use cases
- In a language other than English every header, the sheet names (`Use Cases`, `Foundations`), the Foundations headers, the Has Genie Code values (Yes / No) and the Elite Status values are in that language, and Priority Reasons, Quality Reasons, Best of Best Reason and the Ultra High assessment text (Verdict, Decision, Decision Owner, KPI, Value Driver, Build Path, Red-Team Note) are translated with the rest of the use case, and Decision Cadence reads its label, or is translated too when it is not a standard cadence; a field left in English is named in that row's untranslated column and counted in `translation_gaps`
- The idea theme and the three BoB tier scores are not exported; read them from `__inspire_usecases`
- v1.2.0: a score that was never computed reads `Not scored` (never 0); rows follow the shared final rank: domain coverage picks after every other use case, then elite score (or Inspire Score), `bob_score` and Priority, highest first, with unscored values last
- Use this for browsing, filtering, and sharing with stakeholders

**`readme[_<lang>].md` (Markdown Readme)**
- Business-facing summary rendered as Markdown
- **Filename (v0.7.3)**:
  - Single-language run: `readme.md` (unchanged)
  - Multi-language run: per-language suffix, for example `readme_en.md`, `readme_de.md`, ...
- Rationale: prior to v0.7.3, both Excel and Markdown outputs overwrote a single filename across all selected languages, effectively dropping every language except the last. The per-language suffix in multi-language runs guarantees every selected language is preserved in the filesystem.

**`<business>-dbx_inspire.json` and `<business>-dbx_inspire_<lang>.json` (JSON Catalog)**
- `<business>-dbx_inspire.json` is the English catalog, the one the App and docs-only mode read; its name and shape do not change with the output languages
- Every other output language gets `<business>-dbx_inspire_<lang>.json` (for example `Acme-dbx_inspire_ar.json`) with the same keys, the translated use cases, titles and summaries, plus `language` and `translation_gaps` (the use cases of that language with text shown in English and a count per field); each use case keeps `_translation_status` and `_untranslated_fields`
- It is rewritten after the English catalog, so it carries the same notebook paths and Genie Code fields; a language whose translation did not complete records a failed `JSON Catalog` step for that language
- Docs-only mode reads the English catalog only and stops with a clear error when given a translated one

**`inspire_catalog_<lang>.pdf` (PDF Catalog)**
- Professional business document version of the use case catalog
- Includes scores, descriptions, idea themes, and domain groupings
- One file per selected language (always used `_<lang>` suffix: unchanged)

**`inspire_presentation_<lang>.pptx` (Executive Slides)**
- Executive-ready PowerPoint presentation
- Summarizes domains, top use cases, theme distribution, and strategic alignment
- One file per selected language (always used `_<lang>` suffix: unchanged)

### `__inspire_usecases` Schema (v0.7.2, v1.2.0, v1.3.0 Columns)

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | STRING | Joins to `__inspire_session` |
| `id` | STRING | Per-session identifier (`N##-U##`, numbered in final-rank order) |
| `business_domain` | STRING | "Who cares" business grouping |
| `subdomain` | STRING | Sub-function within the domain |
| **`idea_theme`** | **STRING** | **NEW in v0.7.2**: 2-to-4-word analytical-idea label |
| `use_case` | STRING | Full use case name |
| `statement` | STRING | Business problem |
| `solution` | STRING | Databricks-based approach |
| `business_value` | STRING | Expected impact |
| `beneficiary` | STRING | Consuming role |
| `sponsor` | STRING | Executive sponsor |
| `value_score` | DOUBLE | 1.0-5.0 |
| `quality_score` | DOUBLE | 1.0-5.0 |
| **`bob_score`** | **DOUBLE** | **NEW in v0.7.2**: 0-10 tier-weighted composite |
| **`bob_tier1_score`** | **DOUBLE** | **NEW in v0.7.2**: mean of D1-D11 |
| **`bob_tier2_score`** | **DOUBLE** | **NEW in v0.7.2**: mean of D12-D14 |
| **`bob_tier3_score`** | **DOUBLE** | **NEW in v0.7.2**: mean of D15-D19 |
| **`quality`** | **STRING** | **NEW in v1.2.0**: quality label from combined scoring (`Ultra High` … `Ultra Low`) |
| **`quality_mode`** | **STRING** | **NEW in v1.2.0**: the run's quality mode: `Good`, `High` or `Ultra High` |
| **`elite_status`** | **STRING** | **NEW in v1.2.0**: the elite decision in `Ultra High`; `DOMAIN_COVERAGE_PICK` (any mode) for a use case kept only to cover a user-specified Business Domain |
| **`elite_score`** | **DOUBLE** | **NEW in v1.2.0**: `Ultra High` elite score, 0.40 value + 0.25 evidence + 0.20 implementability + 0.15 actionability (each 1-10); NULL in `Good` and `High` |
| **`elite_assessment`** | **STRING (JSON)** | **NEW in v1.2.0**: the elite judge's assessment and the metadata verification result |
| **`selection_flags`** | **STRING (JSON)** | **NEW in v1.2.0**: selection flags for the use case, for example a domain coverage pick and its reason |
| `code_structure_mandate` | STRING | Genie Code structure mandate cached per use case; filled for every row from v1.2.0 |
| **`strategy_alignment`** | **STRING (JSON)** | **NEW in v1.3.0**: up to 2 alignments, each `{id, path, evidence}` |
| **`strategy_path`** | **STRING** | **NEW in v1.3.0**: the aligned entries' paths, `; `-separated, or `Not aligned` with a customer strategy |
| **`kpis`** | **STRING (JSON)** | **NEW in v1.3.0**: structured KPI specs with the read-only query and, in Deep, the measured baseline and its window |
| **`expected_key_results`** | **STRING (JSON)** | **NEW in v1.3.0**: key results from the strategy (`source` `strategy`) and proposed ones (`source` `proposed`) |
| **`measures_of_success`** | **STRING** | **NEW in v1.3.0**: one measure per line |
| **`financial_benefits`** | **STRING** | **NEW in v1.3.0**: one benefit per line |
| **`non_financial_benefits`** | **STRING** | **NEW in v1.3.0**: one benefit per line |
| **`data_evidence`** | **STRING (JSON)** | **NEW in v1.3.0**: Deep only; row counts, date ranges and join match rates of the use case's tables, and under `signal` the result of the data signal check (status, check, table, columns, measures, reason) |
| **`foundation_ids`** | **STRING** | **NEW in v1.3.0**: comma-separated shared data foundation IDs (`F1`, `F2`, ...) |
| **`use_case_key`** | **STRING** | **NEW in v1.3.0**: title plus primary table; the key `__inspire_feedback` uses |
| **`best_of_best`** | **STRING** | **NEW in v1.3.0**: `Y` when the use case is starred as Best of Best, `N` otherwise |
| **`best_of_best_rank`** | **STRING** | **NEW in v1.3.0**: star rank from 1, empty when not starred (cast to INT to sort) |
| **`best_of_best_score`** | **STRING** | **NEW in v1.3.0**: elite score out of 10 for every use case the elite judge scored |
| **`best_of_best_reason`** | **STRING** | **NEW in v1.3.0**: why the use case is starred, or the test it failed |
| **`use_case_kind`** | **STRING** | **NEW in v1.4.0**: the kind id from the kind registry (`forecast`, `risk_propensity`, ...); a row written before v1.4.0 reads its kind from `analytics_technique` |
| **`kind_family`** | **STRING** | **NEW in v1.4.0**: the kind's family id (`predict`, `detect_protect`, ...) |
| **`app_layout`** | **STRING** | **NEW in v1.4.0**: the App layout the kind builds |
| **`serving_summary`** | **STRING** | **NEW in v1.4.0**: what we serve, one plain line from the kind's template |
| **`method_summary`** | **STRING** | **NEW in v1.4.0**: how it works, one plain line from the kind's method text for the technique |
| **`value_source`** | **STRING** | **NEW in v1.4.0**: where the value comes from, one plain line from the kind's value formula |
| **`selection_basis`** | **STRING** | **NEW in v1.4.0**: why the use case was kept: `earned`, `kind_floor` or `user_request` |
| **`selection_replaced`** | **STRING** | **NEW in v1.4.0**: the use case whose place it took, blank when it replaced none |
| **`selection_score_gap`** | **STRING** | **NEW in v1.4.0**: Best-of-Best score of the replaced use case minus its own, blank when it replaced none |
| **`name_with_technique`** | **STRING** | **NEW in v1.4.0**: the name the catalog shows, `<Name> using <technique in lower case>`, or the Name alone when the use case has no technique |
| **`suggested_group_by`** | **STRING** | **NEW in v1.4.0**: Deep discovery only, grouping techniques only: the columns to compare like with like, coarse to fine and comma separated, chosen from the aggregates Deep already read (2 to 500 groups, at least 30 records per group on average, never a personal column); a column one join away is written `<table>.<column>`. Blank in Standard mode or when no column qualifies |
| **`record_level`** | **STRING** | **NEW in v1.4.0**: Deep discovery only: what one record of the main table is, the near-unique column Deep measured, or the table name when none is near-unique |
| `tables_involved` | STRING | Comma-separated list |
| `result_json` | STRING | Raw JSON of the full UC record |
| `last_updated` | TIMESTAMP | Writer-side stamp; use `result_json:event_at` for event ordering |

---

## LLM Architecture

Inspire uses a 6-model cascade with automatic fallback on failure or timeout.

**Models (in cascade order):**

1. Claude Opus 4.6
2. Claude Sonnet 4.6
3. Claude Opus 4.5
4. Claude Sonnet 4.5
5. GPT-OSS 120B
6. GPT-OSS 20B

**Model classification:**

| Role | Description |
|------|-------------|
| Thinker | Complex reasoning tasks (context extraction, scoring, deduplication, **BoB scoring**) |
| Worker | High-volume generation tasks (use cases, SQL, translations) |

BoB scoring (`BEST_OF_BEST_SCORING_PROMPT`) runs as a Thinker task because each call evaluates 19 gates × 25 UCs and requires careful per-gate reasoning. The `Ultra High` elite judge (`ULTRA_HIGH_ELITE_JUDGE_PROMPT`, step title "Elite Selection", started message "Inspire has started the Ultra High elite selection") is also a Thinker task; a near-miss second opinion goes to the next model in the cascade.

### Use Case Fields

- **ID**: unique identifier like `N01-AI03` (Domain 01, Use Case 03)
- **Name**: descriptive business name (e.g., "Detect Anomalous Transaction Patterns with Fraud Investigation Queue")
- **Domain / Subdomain**: business grouping
- **Idea Theme** (v0.7.2+): analytical-idea label (e.g., "Anomaly Detection")
- **Type**: Risk, Improvement, Forecasting, Classification, etc.
- **Technique**: Anomaly Detection, Time Series, Classification, etc.
- **Statement**: the business problem being solved
- **Solution**: how Databricks AI capabilities solve it
- **Business Value**: expected impact
- **Beneficiary**: the role who uses the output (e.g., Fraud Analyst)
- **Sponsor**: the executive who cares (e.g., Chief Risk Officer)
- **Value Score / Quality Score**: 1.0-5.0 ratings (classic scorer)
- **BoB Score** (v0.7.2+): 0-10 composite when aggressive vetting triggered
- **Quality Mode / Elite Status / Elite Score** (v1.2.0): the run's mode, the elite decision (or `DOMAIN_COVERAGE_PICK`) and the `Ultra High` elite score
- **Tables Involved**: which tables are referenced

### Genie Code Instruction Block

A Genie notebook's instruction cell is the brief you paste into Genie Code; Genie Code reads only that brief and builds and runs the whole notebook from it. It has exactly 8 sections: goal, data (tables, join path, entity key, time column, as-of rule, outcome rule, how nulls are handled), parameters (the widgets the notebook creates first, each with its default), readiness check (one line per threshold and per data-shape assumption), build steps (step 1 creates the widgets), method and acceptance, business output, and definition of done. Inspire then adds a Platform Rules section itself: every business output column's type and meaning and each tier's action text, in the words the instruction writer reads, which win where the business output section says otherwise, no `.cache()` or `.persist()` on serverless, DECIMAL columns cast to DOUBLE before pandas, a ratio of Python numbers computed only on a positive denominator, joins that leave each column name once, rename the key of a frame joined to a frame built from it first, and match a key that can be NULL with `eqNullSafe`, frames stacked with `unionByName` over one column list, every field of a struct that goes into an array named, windows over earlier or later dates as range frames on the date as a day number (a rows frame also counts the other rows of the same date), a window function computed as a column before a filter reads it, an expression a fix supersedes deleted, since Spark Connect analyzes a frame only at its first action, a window labeled by its first day, such as a month, tested on its last day, a closed outcome window with no event labeled 0, never the NULL that a sum over an empty frame returns, a survival quantile the curve never reaches given as more than the follow-up, never NULL, and a date built from it stated as the earliest, leakage checks on the dates each step read, never a second computation of the values (a training window and its outcome horizon end before the holdout starts; a window left out of training is not checked; the holdout is never checked against the scored rows, so a leakage check never cuts the scoring population; a statistic computed over the fit window, such as a peer median, is checked on the rows that read it, never on the rows it came from), every date read from a DATE or TIMESTAMP column (through the date table a key joins, which Inspire lists under TABLES) and a date parameter such as `as_of_date` converted before it is compared with a datetime64 column, lookups on one row per key that assert the frame kept its row count, more than 50 independent units fitted or tested with `groupBy(...).applyInPandas(...)`, `itertuples()` rows read by field (`row.name`), ARRAY values from `toPandas()` never tested as a condition, inf replaced with NaN in the numeric columns only after the last step that derives a feature, numbers in text written by Inspire's number helpers, which Genie Code calls and never defines (`fmt_num` for a number, with a share of at most 1 as a percent, a larger ratio as a multiple, `fmt_count` for a count and its noun agreeing with it, a number of days among them, which rejects a negative count, and `fmt_rank` for an ordinal such as '21,302nd', which rejects an average rank), each giving 'unknown' for a missing value, pandas' NA and NaT among them, found by `is_missing`, which treats inf as missing only on a number and never calls a text missing, a check before the write that no reason or action says 'unknown', 'inf', 'None', 'nan', 'NaT' or '<NA>' (matched case-sensitively, so a name such as 'Nan' or a category such as 'Unknown' passes), the side of a share of a two-signed measure named in that share's own reason ('56.9% of its class's losses') and a row of the other sign stating its own amount, never a 0% share, which the step that writes the shares asserts on each share's number, never on the reason's text, every row's reasons built by Inspire's `keep_reasons` helper, which leaves out a fact whose number is missing, a reason that is the same on every row dropped and printed once, a comparison's reference written after ', against' and a test's result as its own reason, a score whose scale a reader cannot judge given as its rank by that score alone and a row without a score stating no such rank, a count that can be missing held as pandas' nullable `Int64`, with `int()` and `round()` only in a function that returns first on a missing value and a comparison of such a column filled before it picks rows (`(n < m).fillna(False)`), every `json.dumps` given a `default` that converts numpy values, a unit's minimum sample taken as the smallest sample at which either extreme outcome reaches significance after the multiple-test correction, with the count compared with it being the sample the test computes on and the minimum computed once, by one function, for readiness, the test and the reasons, and the reasons of a unit below it giving that sample and the minimum, never a test result, and no other reason of its row, such as its rate, giving that sample again, and a row skipped for a missing input never giving them, that reason added only to the rows below the minimum, first among their facts, and asserted before the write, a row's own value never a reason by itself, only with the reference it is compared against, a reference for a missing group key naming the rows it covers, no fit, score, forecast, simulation or `ai_query` step on an empty input, every business output column cast before the write to the contract type (an existing table whose column type differs is converted and rewritten once), `rank` built by an asserted `rank_rows` helper, which sorts on the decision test and on `data_quality_flag == 'ok'` as booleans, never on the flag text, then on impact compared at 6 significant figures, and returns its ranks on its inputs' index, then checked before the write, `value` as the result of the row's own entity, NULL on a row the method computes no result for, no two rows sharing `entity_id` with `segment_or_item`, which leads with the item or period that tells apart an entity's rows, a repeat fixed by leading with that item and never by aggregating the rows to the entity, every model fitted and scored on one list of feature columns, with at least one feature that every row it scores has and that takes many values, read as its number also when a step bins it, a category cast only in the frame the model reads and another arm's columns set before the selection, rows whose group key is missing labeled in a new column before they are grouped (on serverless environment 4, pandas 2.2.3 cannot count, list or select the groups of a one-key groupby with `dropna=False` when a key is missing), a fact about the whole run tested with `if`, never used as a `.loc` row key, each step's elapsed seconds printed, every step the instruction lists written in full before the first run, never a stub or a branch that prints its work as done, and a failed run fixed and run again until it returns its outcome, test runs submitted with the Execution widget's name `execution`, one at a time from one command that lists the active runs with `--expand-tasks` and cancels every run of the notebook's path, with retries off (so a late retry of an earlier run cannot replace the final run's rows), the final rows checked against the run_id the outcome returned and the rows of earlier test runs deleted by their run_id, and, for the patterns that register a model, the baseline's own score as `value` when no candidate passes acceptance, with every row Monitor when the baseline also misses the thresholds, and the MLflow 2 logging call of serverless environment 4 (`artifact_path`, never `name`, a pyfunc wrapper subclassing `PythonModel`), with the accepted model's registered version asserted before the write, and each library called as the version its `%pip` line pins defines it.

The parameters table always holds the core widgets Inspire sets from the use case, with Inspire's values as defaults: `result_table`, `model_name` (supervised scoring, anomaly scoring, segmentation and recommendation), `ai_endpoint`, `as_of_date` (`latest` means the last complete period in the data; every window, holdout, period grid and scoring population ends at it), `horizon` and `season_length` (forecasts), `act_now_share`, `review_share`, `explanation_top_k`, and one widget per readiness and acceptance threshold. The instruction may add up to 6 widgets for the use case, such as the as-of date or a lookback window, each with a default; a widget without a default is dropped, and a core default the model changed is restored. Each widget is created with its used-for text as the label, and every later step reads its values from the widgets, so the notebook also runs as a job with parameters. It is written from the use case's decision block (the `Ultra High` elite assessment, `not assessed` otherwise, with a date reached through a join named in the time column and the join path), the tables and columns read from live Unity Catalog metadata, the foreign-key paths, the run pattern of the execution family (pinned packages, the AI endpoint for `ai_query`, the business output table and its columns, the action text per priority tier), and the readiness and acceptance thresholds. Context marked `[ASSUMPTION ...]` is treated as a hypothesis, never as evidence.

Which use cases get one: in Discover, none by default (widget `13_generate_genie_code_for`, default `0`, so a run writes use case definitions and skeleton notebooks only, and the Inspire App's Start Use Case MVP with Genie writes a use case's notebook on demand); when the widget is a number or `all`, the top-N by final rank in `Good` and `High`, and every elite use case (only those) in `Ultra High`; in Generate mode, exactly the flagged use cases. Every instruction is checked against live metadata for the tables and columns it cites and for invented figures, and a failing one gets one uncached repair. In `Ultra High` an instruction that still fails is not emitted and the use case keeps its skeleton; in `Good` and `High` it is emitted with a note at the top of the instruction that lists the unresolved references and asks Genie Code to check each one with `DESCRIBE TABLE`.

| Family | Pattern | Techniques |
|---|---|---|
| A | Supervised scoring (trains on closed outcome windows, registers the accepted model as `champion`, scores the open cases) | Classification, Predictive Modeling, Survival Analysis |
| B | Anomaly scoring (fits on a reference window, registers the accepted detector, scores the current window) | Anomaly Detection |
| C | Segmentation (an assignable model, registered when accepted) | Clustering, Segmentation |
| D | Recommendation (checked against popularity on a time-based holdout, registered when accepted) | Recommendation |
| E | Forecasting (backtested against seasonal naive, nothing registered) | Forecasting |
| F | Analytical refresh (effect sizes, corrected significance) | Trend, Correlation, Pareto, Cohort, Funnel, Regression, Geospatial and Network Analysis, AI Analysis |
| G | AI text processing (Databricks AI functions on new text) | Sentiment Analysis, Document Processing, Extraction |
| H | Optimization and simulation | Optimization, Simulation |

A use case labelled with a model technique (families A to D) whose build path, or Solution outside `Ultra High`, runs a Databricks AI text function such as `ai_classify`, `ai_extract` or `ai_analyze_sentiment` (or `ai_query` on a free-text signal column) and names no model training runs as family G, with the AI-text implementation guidance. The readiness check of every instruction includes the use case's runtime assumptions (for example "values of `<key>` occur on more than one row"), and the notebook stops with the assumption's plain statement when one does not hold. The instruction tells Genie Code to call `ai_query` with `failOnError => false` and without a temperature.

---

## Use Case Scoring Explained

Inspire has two independent scoring layers. The first (Value + Quality) runs on every use case. The second (BoB) runs only when the surviving count exceeds `aggressive_prune_threshold`. In `Ultra High` mode a third layer, the elite assessment, decides which candidates are elite.

### Layer 1: Value + Quality (Classic, Always Runs)

Each use case receives two independent scores (1.0-5.0 scale):

#### Value Score

Measures business worth:
- Strategic alignment with your stated goals
- ROI potential
- Business impact and urgency
- Stakeholder relevance

| Score | Label | Meaning |
|-------|-------|---------|
| 4.0+ | High Value | Strong ROI, closely aligned with priorities |
| 3.0-3.9 | Medium Value | Useful but not top priority |
| < 3.0 | Lower Value | Limited strategic alignment |

#### Quality Score

Measures data and analytical soundness:
- Data sufficiency (are all required columns present?)
- Cause-effect validity (does the logic make sense?)
- Analytical depth (is the analysis non-trivial?)
- Semantic uniqueness (is this genuinely different from other use cases?)

| Score | Label | Meaning |
|-------|-------|---------|
| 4.0+ | High Quality | Data strongly supports the analysis |
| 3.0-3.9 | Medium Quality | Data is adequate with some gaps |
| < 3.0 | Lower Quality | Significant data or logic gaps |

Best use cases have both high value AND high quality.

### Layer 2: Best-of-Best (v0.7.2+, Conditional)

When surviving count exceeds `aggressive_prune_threshold` (default 75), each UC is additionally scored on a 0-10 scale per gate. The 19 per-gate scores compose into a tier-weighted composite `bob_score` (0.30 T1 + 0.35 T2 + 0.35 T3) with a hard-veto floor of 2.0 for any gate scoring below 3.

Interpret BoB scores as follows:

| `bob_score` | Meaning |
|-------------|---------|
| 8.0-10.0 | Top-tier UC: flagship-quality across all three tiers |
| 6.0-7.9 | Solid UC: strong portfolio member |
| 4.0-5.9 | Borderline: usually survives only because of its theme's FLOOR |
| 2.0 (hard-veto floor) | Failed at least one gate below 3/10; kept only if sole theme rep (see Known Issues) |

Best use cases have both high classic Quality AND a high BoB composite. A UC with `quality_score = 4.5, bob_score = 7.8` is a reliable flagship; a UC with `quality_score = 3.2, bob_score = 2.0` is a hard-veto survivor that should be manually reviewed before delivery.

### Layer 3: Elite Assessment (v1.2.0, `Ultra High` Only)

The elite judge scores each candidate from 1 to 10 on value, evidence, implementability and actionability against fixed anchors (no curve, no quota). A use case is elite only when all four scores reach the minimum (8 by default), its value tier is Transformational or Material, it has no fatal flaw, and the deterministic metadata verification passes. Elite use cases are ranked by `elite_score = 0.40 × value + 0.25 × evidence + 0.20 × implementability + 0.15 × actionability`, with `bob_score` as the tie-break. The full assessment is stored in `elite_assessment`.

---

## Docs-Only Mode

If you put an absolute file path (starting with `/`) in UC Metadata instead of catalog paths:
- Inspire skips all generation phases
- Loads use cases from the JSON file (the English `<business>-dbx_inspire.json`; a translated `<business>-dbx_inspire_<lang>.json` is refused)
- Regenerates notebooks, PDF, slides, Excel from existing data
- Useful for recreating artifacts after manual edits to the JSON catalog
- v0.7.2 note: if the source JSON lacks `idea_theme` / `bob_score` fields (e.g. from an older run), the regenerated Excel/PDF will have empty BoB columns. This is expected and not an error.

---

## Troubleshooting

### Problem: Run fails immediately with validation errors
- Root cause: widget values are missing or malformed
- Fix: read the error messages carefully; they list exactly which widget failed and why
- Common: empty Business Name, missing UC Metadata, wrong format for Inspire Database

### Problem: No use cases generated
- Root cause: metadata scope too narrow, or all tables classified as technical
- Fix: add more catalogs/schemas to UC Metadata; check that tables have meaningful business column names and descriptions

### Problem: Use cases generated but no Genie Code instructions
- Root causes: the widget `13_generate_genie_code_for` is `0`; in `Ultra High` no use case cleared the elite bar (domain coverage picks keep skeleton notebooks); or every target's instruction failed validation (the `Auto-Genie` step names each one with its unresolved references)
- Fix: set the widget to a number or `all`, or flag the use cases (`generate_genie_code_instruction = 'Yes'` on the tracking row, or the marker flag in the notebook) and run `Operation = Generate Use Cases`

### Problem: Too few use cases after quality filter
- Root cause: quality threshold too strict for the data available. Inspire never pads a short portfolio, so the count is exactly what cleared the bar.
- Fix: lower `Use Cases Quality` to `High` or `Good`

### Problem: "0 use cases met the bar"
- Root cause: no scored use case cleared the bar of the selected mode. This is a reported outcome, not a failure: the run ends successfully, the `Quality Bar` step and `results_json.selection_outcome` carry the plain notice plus the below-bar fallback list (the closest candidates, each with its real scores and the check it missed), and those candidates are shipped labelled "below the `<mode>` bar" so the run is never wasted.
- Fix: read the missed-check reasons first. If they show weak metadata (missing comments, no declared keys), add table and column comments or constraints and re-run; otherwise choose a lower mode. In `Ultra High` a short elite list, or a below-bar fallback list, can be the honest answer for the data in scope.

### Problem: Pipeline appears stuck at one stage
- Root cause: large metadata scope causing long LLM processing times
- Fix: wait longer (scoring, BoB, and instruction generation can take 10-30+ minutes for many use cases); check `__inspire_step` for recent updates

### Problem: Goal alignment filter removes too many use cases
- Root cause: Generation Instructions contain a narrow goal that only a few use cases match
- Fix: broaden the goal in Generation Instructions, or remove it to let Inspire generate a wider set

### Problem: BoB scores missing in Excel / DB after the run
- Root cause: surviving count was at or below `aggressive_prune_threshold` (default 75), so BoB never ran
- Fix: not a bug; BoB is not needed on small portfolios. If you want BoB to run for audit purposes on smaller portfolios, lower `aggressive_prune_threshold` via the `TECHNICAL_CONTEXT["runtime"]` override

### Problem: A single theme dominates the final 100
- Root cause: `bob_theme_max_share` was raised above 0.15, OR the input portfolio had fewer distinct themes than expected
- Fix: verify the input had adequate theme diversity; reset `bob_theme_max_share` to the default 0.15

### Problem: A UC at `bob_score = 2.0` appears in the final list (v0.7.2 behavior)
- Root cause: it was the only representative of its idea theme and was kept by the FLOOR rule
- Fix: **resolved in v0.7.3**: hard-veto UCs are pre-filtered before the stratified trim. If you still see `bob_score <= 2.0` in a v0.7.3 run's final portfolio, something is wrong; capture the session ID and the BoB audit columns and file a bug.
- For v0.7.2 runs: see [v0.7.2 Known Issues (Resolved In v0.7.3)](#v072-known-issues-resolved-in-v073) for the manual workaround.

---

## Quick Operator Checklist

**Before run:**
- [ ] Business Name filled with actual organization name
- [ ] UC Metadata points to the right catalogs/schemas/tables
- [ ] Inspire Database set to a valid `catalog.schema` (optional but recommended, and required to audit BoB scores after the run)
- [ ] Generation Options include at least Genie Code Instructions
- [ ] Generation Path is valid and writable

**During run:**
- [ ] Session ID noted from output
- [ ] `__inspire_session` shows progress increasing
- [ ] `__inspire_step` shows stages advancing (ordered by `result_json:event_at`)
- [ ] If surviving count > 75, a `Best-of-Best Ranking` stage appears
- [ ] No stuck `ended_error` statuses

**After run:**
- [ ] Generated notebooks exist in generation path
- [ ] Excel catalog has use cases with scores AND BoB columns (where applicable)
- [ ] **Multi-language runs**: verify per-language files exist (`readme_en.md`, `readme_de.md`, `<business>-dbx_inspire_en.xlsx`, `<business>-dbx_inspire_de.xlsx`, ...)
- [ ] Opened one domain notebook
- [ ] Reviewed use case cards for relevance
- [ ] Genie Code instructions describe the right analytical approach
- [ ] **Verified `bob_score` values in `__inspire_usecases`**: run the theme-distribution query from [Portfolio Size Math](#portfolio-size-math)
- [ ] **Final portfolio size**: in `Good` / `High`, when the stratified trim fired the count is at most `target_max_use_cases + target_max_jitter` (default 110) plus any domain coverage picks, while any smaller count is expected because nothing is padded; in `Ultra High` there is no cap. Check the `Selection Funnel` ledger for where use cases were dropped
- [ ] **Quality mode** in `__inspire_session` is one of `Good`, `High`, `Ultra High` (legacy labels are stored as their canonical mode)
- [ ] **No UC with `bob_score <= 2.0`** (v0.7.3: hard-veto pre-filter should guarantee zero). If any appear, file a bug with the session ID.
- [ ] Theme distribution looks reasonable (no single theme at the ~15-UC cap unless expected)

**Workspace sync gotcha (v0.7.3 operational note):**
- If `databricks repos update` returns `Conflict pulling from remote` after a rename-heavy branch, **delete the old paths from the workspace first** and re-run `repos update`. The CLI does not surface this as a hard error and may silently keep serving the old content.

---

## 5-Step Fast Start

1. Import `dbx_inspire_ai_agent.ipynb` into Databricks. Attach a cluster. Run the first cell to create widgets.
2. Fill: `Business Name`, `UC Metadata` (catalog/schema paths). Optionally set `Inspire Database` (`catalog.schema`).
3. Set `Generation Options = Genie Code Instructions`.
4. Click Run All. Copy the Session ID from output. Monitor with the log queries in [Pipeline Phases](#pipeline-phases).
5. When complete, open one `N##_*.py` notebook from your generation path. Review use case cards, idea themes, BoB scores, and Genie Code instructions.

You are now operating Inspire end-to-end.

---

## Release Notes: v0.7.3

v0.7.3 closes the single documented v0.7.2 Known Issue, removes a cosmetic artifact in final portfolio size, fixes a multi-language filename collision, and parallelizes the largest remaining bottleneck.

### Commits (Newest First)

| Commit | Subject | What It Fixes |
|--------|---------|---------------|
| `69c9f12` | Hard-veto pre-filter in `_stratified_trim_by_theme` | Closes v0.7.2 Known Issue: hard-veto UCs can no longer survive the FLOOR rule |
| `97ef04d` | Multi-language filename convention for Excel and Markdown | Customer-reported: "second selected language (German) was not respected" |
| `309adcf` | Introduce `target_max_jitter` config key | Portfolio sizes are no longer always a round `target_max_use_cases`; randomized within [base+1, base+jitter] |
| `0fbff91` | Default-value change: `target_max_use_cases` 100 → 90 | Companion to `309adcf` so effective cap range is [91, 110], not [101, 120] |
| `c728515` | ThreadPoolExecutor for Route 1 / Route 2 Genie Code regeneration | 100-UC regeneration pass: ~5 hours → ~30 min |

### v0.7.3 Headline Changes (Expanded)

1. **Hard-veto pre-filter (`69c9f12`)**: `_stratified_trim_by_theme` now drops every UC with `bob_hard_veto_gate != None` BEFORE theme grouping. A theme whose only representative was hard-vetoed is legitimately eliminated. **Zero hard-veto survivors on tpcds_sf1 validation** (session `1234567890000001`, 13 UCs dropped, 105 UCs in final portfolio).
2. **Target-max jitter (`309adcf` + `0fbff91`)**: new `target_max_jitter` config key. Effective trim cap = `target_max_use_cases + randint(1, target_max_jitter)`. Defaults changed so the effective cap range is **[91, 110]**, centered near the old fixed 100 but non-round on any given run.
3. **Multi-language filename convention (`97ef04d`)**: single-language runs unchanged; multi-language runs add `_<lang>` suffix to Excel and Markdown outputs so each language's content is preserved in its own file.
4. **Parallel Genie Code regeneration (`c728515`)**: Route 1 and Route 2 regeneration now uses a `ThreadPoolExecutor` of 10 workers (tunable via `genie_regen_parallelism`). Measured 100-UC regeneration time: ~5 hours sequential → ~30 min parallel, ~10x speedup.

### New Runtime Config Keys

| Key | Default | What It Controls |
|-----|---------|------------------|
| `target_max_jitter` | `20` | Upper bound for `randint(1, target_max_jitter)` added to `target_max_use_cases` |
| `genie_regen_parallelism` | `10` | `ThreadPoolExecutor` worker count for Route 1 / Route 2 Genie Code regeneration |

### Changed Defaults

The `target_max_use_cases` default moved from 100 to 90, as listed under "G. New Runtime Config Keys (v0.7.3)" above.

### v0.7.3 Validation Evidence

| Dataset | Session ID | Final UC Count | Hard-Veto Survivors | BoB Triggered? | Notes |
|---------|-----------|----------------|---------------------|----------------|-------|
| NYC | `7301073301073001` | 30 | 0 | No (`count < 75`) | No-op trim, expected |
| HV | `7302073002073002` | 39 | 0 | No (`count < 75`) | No-op trim, expected |
| tpcds_sf1 | `1234567890000001` | **105** | **0** | Yes (13 pre-dropped) | Effective cap = 90 + 15 = 105 |

Every validation run ended with zero hard-veto survivors, the defining proof that the v0.7.2 Known Issue is closed.

### Compatibility Notes (v0.7.3)

- All v0.7.2 persisted columns (`idea_theme`, `bob_score`, `bob_tier1_score`, `bob_tier2_score`, `bob_tier3_score`) remain unchanged. No schema migration required.
- Sessions created on v0.7.2 keep working on v0.7.3 without modification. The new `target_max_jitter` and `genie_regen_parallelism` keys have defaults so no config change is required to upgrade.
- Docs-only mode is unaffected by the hard-veto fix (docs-only replays the JSON catalog verbatim).
- Multi-language runs created on v0.7.2 and below may have silently overwritten outputs; regenerate via docs-only on v0.7.3 to get per-language files.

---

## Release Notes: v0.7.2

Full commit list since v0.7.0, newest first:

| Commit | Subject | Tag |
|--------|---------|-----|
| `7f9f2be` | Reload schema at BoB call site so `__inspire_usecases` writes don't fail when the table was created earlier in the same session | v0.7.2 |
| `c013b06` | **Best-of-Best ranking + Stratified Trim by idea theme** (the headline change) | v0.7.2 |
| `5c0f7f8` | Fix `_target_max_llm` NameError in aggressive vetting path | v0.7.2 |
| `f8c8a5a` | Unify 19-gates doc style: tables + title case; folded the standalone gates doc into `readme.md` | v0.7.1 |
| `a4abaac` | v0.7.1 docs refresh: 19 quality gates + LLM-only pipeline | v0.7.1 |
| `9291ffb` | Add D12-D14 business / sponsor / engineering gates + 75-UC sweet spot | v0.7.1 |
| `d643603` | Remove regex / pattern dedup: everything LLM-based | v0.7.0 |
| `7a06f02` | Target-zone vetting (bidirectional) + metadata-grounded quality filter | v0.7.0 |

### v0.7.2 Headline Changes (Expanded)

1. **Best-of-Best (BoB) ranking**: new LLM prompt `BEST_OF_BEST_SCORING_PROMPT` replaces the legacy aggressive-dedupe pass. Scores every UC on all 19 gates on a 0-10 scale, batched 25 UCs per call, parallel across the LLM cascade. Tags each UC with a 2-to-4-word `idea_theme`.
2. **Tier-weighted composite**: deterministic Python composes the 19 dimension scores into a 0-10 `bob_score` (0.30 T1 + 0.35 T2 + 0.35 T3) with a hard-veto floor at 2.0 for any single gate scoring below 3.
3. **Stratified Trim by idea theme**: replaces the legacy global-sort trim. FLOOR (≥1 per theme), CAP (≤ `target_max * 0.15` per theme), proportional BUDGET for remaining slots, backfill pass to hit exactly `target_max`.
4. **5 new persisted columns** in `__inspire_usecases` and Excel/CSV export: `idea_theme`, `bob_score`, `bob_tier1_score`, `bob_tier2_score`, `bob_tier3_score`.
5. **5 new runtime config keys**: `aggressive_prune_threshold` (75), `target_max_use_cases` (100), `target_min_use_cases` (50), `bob_scoring_batch_size` (25), `bob_theme_max_share` (0.15).
6. **Schema reload fix** (`7f9f2be`): when BoB runs in the same session as the original `__inspire_usecases` table creation, the cached Delta schema did not yet include the new BoB columns; the fix reloads the schema at the BoB write site so MERGE/UPDATE statements target the correct column set.
7. **NameError fix** (`5c0f7f8`): removed stale reference to `_target_max_llm` that prevented aggressive vetting from running in certain edge cases.

### Validation: tpcds_sf1 Session `1234567890000002`

End-to-end on TPC-DS scale-factor-1:

| Metric | Value |
|--------|-------|
| Session ID | 1234567890000002 |
| Phase 2 UCs | 378 |
| After Scorer | 308 |
| After Balanced Filter (now `Good`) | 244 |
| After BoB + Stratified Trim | **100** |
| Distinct idea themes (final 100) | 75 |
| Top theme | Anomaly Detection (11 UCs) |
| BoB mean / range | 6.7 / 2.0-8.23 |
| Tier 1 / 2 / 3 mean | 7.23 / 6.92 / 6.23 |
| Hard-veto survivors | 3 / 100 (3%) |
| Total run duration | 68 min |

### Compatibility Notes (v0.7.2)

- Runs initiated on v0.7.2 write all 5 new columns. Older sessions in the same `__inspire_usecases` table will have NULL in those columns; this is expected and requires no migration.
- The 5 new runtime keys have sensible defaults, so **no config change is required** to upgrade from v0.7.0 or v0.7.1 to v0.7.2. Existing runs keep working.
- Docs-only mode replays whatever is in the source JSON: if the JSON lacks BoB fields, the regenerated Excel/PDF omits the BoB columns. Regenerate from a v0.7.2 run to get BoB in docs.

---

## v0.7.2 Known Issues (Resolved In v0.7.3)

This section preserves the v0.7.2 Known Issues record for historical and audit purposes. All blocking issues are marked with resolution status.

### Issue 1: Hard-Veto UCs Can Survive the Stratified Trim (RESOLVED in v0.7.3)

**Status:** RESOLVED in v0.7.3 (commit `69c9f12`).

**Symptom (v0.7.2):** A UC with `bob_score = 2.0` (meaning it scored below 3/10 on at least one gate, triggering the hard-veto floor) appears in the final portfolio.

**Root cause (v0.7.2):** The stratified trim enforced two rules in this order:
1. **FLOOR**: every idea theme keeps at least 1 UC.
2. **CAP**: no theme exceeds `target_max * bob_theme_max_share`.

The FLOOR rule ran BEFORE any score filtering. If a UC was the only representative of its idea theme AND its `bob_score` was 2.0, FLOOR kept it anyway to preserve coverage. There was no short-circuit that said "if this UC is hard-vetoed, let the theme die."

**v0.7.2 validation run impact:** 3 out of 100 final UCs (3%) were in this state on the tpcds_sf1 validation run. All 3 had `bob_score = 2.0` and were the sole representative of their idea theme.

**Resolution in v0.7.3 (`69c9f12`):** `_stratified_trim_by_theme` now **pre-filters every UC with `bob_hard_veto_gate != None` BEFORE theme grouping begins**. Coverage (FLOOR) is reconstructed only from UCs that cleared the hard-veto floor. Themes whose sole representative was hard-vetoed are dropped entirely, which is the correct semantic: a theme that cannot produce even one fundable UC should not appear in the portfolio.

**v0.7.3 validation evidence:** tpcds_sf1 session `1234567890000001`: 13 hard-veto UCs dropped before the trim; **0 hard-veto survivors** in the final 105-UC portfolio.

**Historical reproducer query** (runs against any v0.7.2 session; should return zero rows against any v0.7.3 session):

```sql
SELECT
  id, idea_theme, use_case,
  bob_score, bob_tier1_score, bob_tier2_score, bob_tier3_score
FROM <inspire_db>.__inspire_usecases
WHERE session_id = <session_id>
  AND bob_score <= 2.0
ORDER BY idea_theme;
```

**Historical workaround (v0.7.2 only):** Manually inspect each hard-veto survivor. Either:
- Delete it from the JSON catalog and regenerate artifacts via docs-only mode, OR
- Manually rework the use case statement to address the failing gate, then re-run BoB on just that UC.

### Issue 2: Idea Theme Vocabulary Drift (UNCHANGED)

**Status:** By design; monitoring only. Unchanged in v0.7.3.

**Symptom:** Two UCs that are clearly the same analytical idea occasionally receive slightly different theme labels (e.g. "Anomaly Detection" vs "Outlier Detection"), which inflates the theme count and can slightly dilute the per-theme FLOOR benefit.

**Root cause:** Themes are LLM-tagged freeform at BoB time; there is no canonical vocabulary.

**Impact:** Low. On the v0.7.2 validation run, 75 distinct themes emerged from 244 UCs; empirically the LLM converges well. Occasional near-duplicate labels are absorbed by the BUDGET pass because both labels' UCs get FLOOR coverage.

**Still no fix planned.** A future version may consider a post-processing canonicalization step if telemetry shows the problem growing.

### Issue 3: BoB Scoring Cost on Very Large Portfolios (UNCHANGED)

**Status:** Known performance characteristic. Unchanged in v0.7.3.

**Symptom:** On portfolios with > 400 surviving UCs entering aggressive vetting, BoB adds ~8-10 minutes of wall-clock time beyond what the legacy aggressive-dedupe pass would have taken.

**Root cause:** BoB scores every UC × every gate (19 scores per UC). At `bob_scoring_batch_size = 25`, a 400-UC portfolio needs 16 parallel LLM calls; the critical path is gated by the slowest cascade member.

**Workaround:** Increase `bob_scoring_batch_size` to 40 or 50 on very large portfolios. The tradeoff is longer per-call latency but fewer parallel calls.

**No fix planned.** The cost is inherent to the audit-trail requirement: you cannot get per-gate BoB scores without scoring per gate. (Separately, v0.7.3's `c728515` parallelizes the later Genie Code regeneration pass, which is the much bigger wall-clock win.)

---

*End of readme. For the north-star goal and design rationale, see project notes. For commit-level detail, see `git log`.*
