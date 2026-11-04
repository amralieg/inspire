# Inspire-AI Testing Guide

This document is a runbook for validating the Inspire-AI agent (`agent/dbx_inspire_ai_agent.ipynb`) end-to-end on any Databricks workspace. It captures the test → verify → fix → retest loop used during the bring-up work in this repo.

Another LLM (or a human operator) should be able to follow this guide exactly, substitute the environment placeholders, and reproduce the validation.

---

## 0. Working principles (do not skip)

These are hard constraints for every fix you apply. Violating them regresses the product.

1. **Prompt-first.** The agent is a prompt-driven pipeline. Fix defects by editing the prompts. Write Python / SQL / new code ONLY when the defect is 100% outside what a prompt can control (filesystem writes, table writes, widget validation, concurrency, etc.).
2. **No overfitting.** Every prompt rule you add must be STRUCTURAL and industry-agnostic. If a rule contains an industry-specific example (retail products, finance loans, healthcare diagnoses, HR headcount, bakery SKUs, payment fees, etc.), it is overfit. Replace the example with a structural description (e.g., "a timestamp column + a numeric measure column" instead of "`dateTime` + `totalPrice`").
3. **Grounding trumps cleverness.** Every claim a UC makes in Statement / Solution / Business Value must trace back to a column in `Tables Involved`. If it can't, reject the UC or rewrite it.
4. **No invented capabilities.** The agent must not propose UCs that require concepts, programs, tiers, or externalities the schema does not evidence.
5. **Session = experiment.** A `session_id` pins one Discover run and every Generate that references it. Don't mix sessions in comparisons.

---

## 1. Prerequisites

### 1.1 Tools

- Databricks CLI `>= 0.289` installed locally (`databricks --version`).
- A Databricks workspace profile configured (`databricks auth login --profile $PROFILE` or an entry in `~/.databrickscfg`).
- A running SQL warehouse (serverless is fine). You will need its `warehouse_id`.
- A Unity Catalog catalog and schema where Inspire will create its tracking tables. You will provide this as `$INSPIRE_DB = <catalog>.<schema>`.
- `python3` locally for running validator scripts.
- `jq` is optional but helpful.

### 1.2 Environment placeholders used below

Substitute these in every command. Never commit concrete values.

| Placeholder | Meaning | Example |
|---|---|---|
| `$PROFILE` | Databricks CLI profile name | `<your-profile>` |
| `$WAREHOUSE_ID` | SQL warehouse id | `2ad1b26d…` |
| `$USER_WORKSPACE` | Absolute workspace path for the current user | `/Workspace/Users/<user>/inspire-ai` |
| `$NOTEBOOK_PATH` | Workspace path to the agent notebook | `$USER_WORKSPACE/agent/dbx_inspire_ai_agent` |
| `$LOCAL_NOTEBOOK` | Local path to the `.ipynb` | `./agent/dbx_inspire_ai_agent.ipynb` |
| `$INSPIRE_DB` | UC database for tracking tables | `<catalog>.<schema>` |
| `$BUSINESS_NAME` | The customer/business the agent simulates for | `Acme Corp` |
| `$UC_METADATA` | Scope input: single table, schema, or catalog | `samples.bakehouse.sales_transactions` or `samples.tpch` |
| `$SESSION_ID` | The `session_id` of a Discover run (captured after Discover completes) | `8102180…` |

### 1.3 One-time setup

```
databricks workspace import-dir ./ $USER_WORKSPACE \
  --overwrite --profile $PROFILE
```

Ensure the schema exists:

```
databricks api post /api/2.0/sql/statements --profile $PROFILE --json '{
  "warehouse_id": "'"$WAREHOUSE_ID"'",
  "statement": "CREATE SCHEMA IF NOT EXISTS '"$INSPIRE_DB"'",
  "wait_timeout": "30s"
}'
```

---

## 2. The test loop

```
 ┌─────────────────────┐
 │ 1. Run Discover     │  agent generates N use cases as __inspire_usecases rows + docs folder
 └─────────┬───────────┘
           │
 ┌─────────▼───────────┐
 │ 2. Validate CSV     │  deterministic checks (§4.1–4.6) on the use-cases CSV
 └─────────┬───────────┘
           │   if any check fails →
 ┌─────────▼───────────┐
 │ 3. Fix (prompt)     │  edit the relevant prompt in the notebook (§5); DO NOT write code unless §6
 └─────────┬───────────┘
           │
 ┌─────────▼───────────┐
 │ 4. Re-upload agent  │  databricks workspace import
 └─────────┬───────────┘
           │
 ┌─────────▼───────────┐
 │ 5. Rerun Discover   │  new session_id; compare head-to-head with prior iteration
 └─────────┬───────────┘
           │   when clean →
 ┌─────────▼───────────┐
 │ 6. Flag 3–5 top UCs │  UPDATE __inspire_usecases SET generate_genie_code_instruction='Yes'
 └─────────┬───────────┘
           │
 ┌─────────▼───────────┐
 │ 7. Run Generate     │  same session_id; produces genie_instruction for flagged UCs
 └─────────┬───────────┘
           │
 ┌─────────▼───────────┐
 │ 8. Validate Genie   │  deterministic checks (§4.7–4.9) + semantic alignment (§4.10)
 └─────────┬───────────┘
           │   if any check fails →
 ┌─────────▼───────────┐
 │ 9. Fix prompt, loop │  loop back to step 3, targeting the Genie prompt
 └─────────────────────┘
```

---

## 3. Running Discover and Generate

### 3.1 Submit Discover

```
cat > /tmp/inspire-discover.json <<EOF
{
  "run_name": "inspire-ai discover",
  "tasks": [{
    "task_key": "discover",
    "notebook_task": {
      "notebook_path": "$NOTEBOOK_PATH",
      "base_parameters": {
        "00_business_name": "$BUSINESS_NAME",
        "01_uc_metadata": "$UC_METADATA",
        "02_inspire_database": "$INSPIRE_DB",
        "15_operation": "Discover Use Cases"
      }
    },
    "environment_key": "env1"
  }],
  "environments": [{"environment_key":"env1","spec":{"client":"2"}}]
}
EOF

databricks jobs submit --json @/tmp/inspire-discover.json --profile $PROFILE --no-wait
```

Capture the returned `run_id`. The outer run immediately spawns a nested job; the nested job does the real work.

### 3.2 Monitor progress

Pulse every 5 minutes (270s stays inside prompt cache for an LLM driver):

```
# Run state
databricks jobs get-run $RUN_ID --profile $PROFILE | \
  jq '{state: .state.life_cycle_state, result: .state.result_state}'

# Latest session and its current step
databricks api post /api/2.0/sql/statements --profile $PROFILE --json '{
  "warehouse_id":"'"$WAREHOUSE_ID"'",
  "statement":"SELECT session_id, processing_status, completed_percent, last_updated FROM '"$INSPIRE_DB"'.__inspire_session ORDER BY last_updated DESC LIMIT 1",
  "wait_timeout":"30s"
}'

databricks api post /api/2.0/sql/statements --profile $PROFILE --json '{
  "warehouse_id":"'"$WAREHOUSE_ID"'",
  "statement":"SELECT COUNT(*) c, MAX_BY(stage_name,last_updated) stage, MAX_BY(step_name,last_updated) step, MAX_BY(status,last_updated) status FROM '"$INSPIRE_DB"'.__inspire_step WHERE session_id = '"$SESSION_ID"'",
  "wait_timeout":"30s"
}'

# UC rows landed so far
databricks api post /api/2.0/sql/statements --profile $PROFILE --json '{
  "warehouse_id":"'"$WAREHOUSE_ID"'",
  "statement":"SELECT COUNT(*) FROM '"$INSPIRE_DB"'.__inspire_usecases WHERE session_id = '"$SESSION_ID"'",
  "wait_timeout":"30s"
}'
```

The agent emits step events sparsely during long LLM calls. A "frozen" step count for 10–20 minutes is normal while a `Business Understanding` or `Use Cases Generation` call is in flight.

### 3.3 Flag top UCs for Generate

Once Discover completes and you want to generate Genie code for a subset:

```
databricks api post /api/2.0/sql/statements --profile $PROFILE --json '{
  "warehouse_id":"'"$WAREHOUSE_ID"'",
  "statement":"UPDATE '"$INSPIRE_DB"'.__inspire_usecases SET generate_genie_code_instruction = \"Yes\" WHERE session_id = '"$SESSION_ID"' AND id IN (SELECT id FROM '"$INSPIRE_DB"'.__inspire_usecases WHERE session_id = '"$SESSION_ID"' ORDER BY inspire_score DESC LIMIT 3)",
  "wait_timeout":"30s"
}'
```

Pick 3 for fast iteration, 5–10 for realistic portfolios.

### 3.4 Submit Generate

Same structure as Discover, but set `15_operation = "Generate Use Cases"` and `14_session_id = $SESSION_ID`:

```
cat > /tmp/inspire-generate.json <<EOF
{
  "run_name":"inspire-ai generate",
  "tasks":[{
    "task_key":"generate",
    "notebook_task":{
      "notebook_path":"$NOTEBOOK_PATH",
      "base_parameters":{
        "00_business_name":"$BUSINESS_NAME",
        "01_uc_metadata":"$UC_METADATA",
        "02_inspire_database":"$INSPIRE_DB",
        "14_session_id":"$SESSION_ID",
        "15_operation":"Generate Use Cases"
      }
    },
    "environment_key":"env1"
  }],
  "environments":[{"environment_key":"env1","spec":{"client":"2"}}]
}
EOF

databricks jobs submit --json @/tmp/inspire-generate.json --profile $PROFILE --no-wait
```

### 3.5 Verify Generate did not destroy Discover's artifacts

Discover's output directory is at `${11_generation_path}/<business_slug>/`. It contains:

- `docs/` — CSV + XLSX + JSON + PDF + MD + log (6 files)
- `notebooks/<domain>/<subdomain>/<UC-slug>.ipynb` — one per UC (skeletons after Discover; fully populated for flagged UCs after Generate)

Regression test: after Generate completes, assert `docs/` still has 6 files and the unflagged skeleton notebooks are still there. If they were wiped, the known "init wipes the output dir unconditionally" bug has regressed (see §6.1).

---

## 4. What to verify (checks)

### 4.1 UC-level GROUNDING (CSV)

Every row in `$INSPIRE_DB.__inspire_usecases` (or the exported CSV) must:
- cite `Tables Involved` that ALL exist in the information_schema for the input scope
- cite columns in `Statement` and `Solution` that exist on the cited tables
- carry no invented column names

Deterministic check script: see Appendix A — `validate_uc_grounding.py`.

### 4.2 DEDUPLICATION (CSV)

No two UCs may share:
- the same canonical signature `(sorted(Tables Involved), Analytics Technique, normalized-first-6-nouns-of-Statement)`; OR
- identical `Tables Involved` + a functionally-equivalent business question with only a technique change (e.g., three "predict churn" UCs with Survival / Classification / Predictive Modeling as the only difference).

The first check is deterministic; the second is semantic and best run as an LLM-judge pass OR a human-review pass. See Appendix A — `validate_dedup.py` for the exact-canonical check.

### 4.3 RELEVANCE (CSV)

Every UC must reference at least one BUSINESS table (not audit/log/system); its declared technique must have structural support in the cited tables; and it must connect to either a user priority or a detected domain. See Appendix A — `validate_relevance.py`.

### 4.4 RECALL / COVERAGE (CSV)

For every structural signal present in the schema there should be ≥ 1 UC exercising it. Minimum operational patterns to check:

- `(date/timestamp column, numeric measure column)` → ≥ 1 trend / period-over-period UC.
- `(high-cardinality dimension, fact FK)` → ≥ 1 top-N / ranking UC.
- `(status or enum-like column, date column)` → ≥ 1 anomaly / SLA UC.
- `(grouping id on fact, multiple rows per group)` → ≥ 1 basket / funnel UC.
- `(fact ↔ subject dim via FK)` → ≥ 1 subject-360 / subject-level dashboard UC.

See Appendix A — `validate_recall.py`.

### 4.5 INDUSTRY DEBIAS (CSV and Genie text)

Scan Statement / Solution / Business Value / Description fields for:
- named competitors (`Snowflake`, `Fortune 500`, specific vendor product names)
- hardcoded industry anchors (`retail`, `fintech`, `healthcare`, `telecom` when the business isn't explicitly those)
- dollar or percent figures not backed by a column in `Tables Involved`

All three counts must be ≤ the budget you declare (zero-tolerance for fabricated money; small tolerance for statistical CIs and ML metric estimates).

### 4.6 ORGANIZATIONAL CONSTRUCT INVENTION (CSV and Genie text)

Scan for UCs framed around programs/systems/tiers/initiatives that the schema doesn't evidence. Heuristics:
- regex for `loyalty (program|tier)`, `rewards? (program|points)`, `subscription (plan|tier)`, `promotion (code|campaign)`, `compliance (audit|committee)`, `referral (program|bonus)`.
- for each hit, cross-check that the UC's cited tables contain a column semantically matching the construct. If no, flag it.

See Appendix A — `validate_constructs.py`.

### 4.7 GENIE HALLUCINATION SCAN (post-Generate)

For each `genie_instruction` (a long text field on `__inspire_usecases` for flagged UCs), count:
- **Fabricated dollars** — `$\d+[.,]?\d*\s?[MBK]` occurrences. Budget: 0.
- **Percentage figures** — `\d+\s?%`. Budget: small (statistical CI and ML metric estimates only).
- **Real-column citations** — backticked identifiers that match the actual column names of `Tables Involved`.
- **Fake-column citations** — backticked identifiers that are NOT real columns AND NOT legitimate output columns / MLflow tags / Python variables. (Distinguishing these requires careful heuristics — see Appendix A `validate_genie.py`.)
- **Phantom enrichment tables** — mentions of `product dimension`, `calendar reference`, `holiday calendar`, etc. when such tables are not in the input scope.
- **Entity-scale fabrications** — "50,000+ daily transactions", "100+ SKUs", "Fortune 500".

### 4.8 GENIE ↔ UC SEMANTIC ALIGNMENT (post-Generate)

Per flagged UC, verify:
- `Tables Involved` on the UC row == tables cited in the Genie's Input section.
- `Analytics Technique` on the UC row appears (literally or as a clear synonym — e.g., "Predictive Modeling" ≈ "XGBoost classifier") in the Genie's Implementation Strategy section.
- Columns cited in UC's Statement/Solution all reappear in the Genie instruction.
- The Mission in Genie §2.A reflects the UC's Statement (same problem, same decision).

See Appendix A — `audit.py`.

### 4.9 GENIE GROUNDING DEEP-CHECK (post-Generate)

Scan Genie instructions for any column reference inside a `SELECT ... FROM <table>` context. Every such reference must resolve to a real column of that table. Column references inside output-column specifications (e.g., "the result table will contain `forecast_quantity`, `data_completeness_score`") are LEGITIMATE output columns, not hallucinations — do not flag them.

### 4.10 SEMANTIC ALIGNMENT SAMPLING (manual review)

After deterministic checks pass, read 3–5 UCs end-to-end and ask:
- Is the technique chosen appropriate for the data? (Funnel needs stage columns; Cohort needs an onboarding timestamp; Survival needs start + end-or-status.)
- Is the Business Value coherent with the Statement? Do they argue for the same decision?
- Could a real developer implement the Solution from the column references alone?

This catches things the deterministic checks can't — e.g., a "Funnel Analysis" on a schema without stage columns may pass grounding checks but be analytically broken.

### 4.11 FULL QUALITATIVE UC REVIEW (domain-expert pass)

§4.1–4.10 catch mechanical defects. §4.11 catches the harder ones: *would this UC actually earn its place in a customer deliverable?* Run this on the entire portfolio (not a sample) once deterministic checks pass.

Answer each question per UC and record answers in a checklist — a UC can pass §4.1–4.10 and still fail here.

**A. Relevance — does this UC address a real business problem?**
- Who inside the business would actually fund this UC if asked to pay out of budget?
- What concrete decision does this UC change? (If the answer is "it gives a nice report" rather than "decide X over Y" — the UC is decorative, not operational.)
- Is the implied business action reachable within this company's org? (E.g., a pricing UC is only relevant if pricing authority exists.)
- If the answer to "who gets called at 2 AM when this breaks" is nobody — the UC is not operational.

**B. Coherence — does the UC make internal sense?**
- Does the `Statement` problem actually require the `Analytics Technique` that was chosen, or could a simpler analysis answer the same question?
- Does the `Solution` describe steps that produce the output the `Business Value` claims?
- Does the `Business Value` narrative follow from the `Statement` without switching topics midway?
- If `Tables Involved` has multiple tables, is the join necessary for the analysis, or is one table cited for flavor?

**C. Self-test — "would I build it this way?"**
- If a skilled analyst were handed ONLY the `Solution` text, would they write the same code the UC implies?
- Is there a cheaper / simpler / more robust method for the same question that the UC missed?
- Is the technique's precision proportional to the decision's stakes? (Don't build Monte Carlo for a $5 decision.)
- Would a senior reviewer change the `Analytics Technique` if they saw this portfolio?

**D. Blindspots — what's missing?**
- Are there structural signals in the schema that DID NOT produce a UC? (Date+measure → no trend UC? Fact+dim FK → no subject-level dashboard? Grouping id → no basket/funnel UC?)
- Are there obvious industry-specific UCs that a domain expert would expect but don't appear? (For retail: returns analysis; for finance: anti-money-laundering; for logistics: delivery SLA. Use the inferred industry to drive this check.)
- Are there PAIRS of UCs that invite a third combining UC the model didn't write? (If UC-A finds clusters and UC-B predicts churn, is there a missing "targeted retention per cluster" UC?)
- Are there tables cited only in obvious UCs and never in creative ones? (Under-exploited data.)

**E. Coverage completeness — did the model hit every UC the data supports?**
- Enumerate every FK edge in the schema. For each edge, does at least one UC exercise the join?
- Enumerate every analytics technique on the allowed list. Are any glaringly absent where the schema supports them? (E.g., no time-series on a schema with years of date-stamped facts.)
- Is the distribution across techniques roughly consistent with the data's strengths, or is it a Forecasting/Classification bias because the LLM defaults there?
- Does every structural pattern (date+measure, dim+fact, status-column, grouping-id) have ≥ 1 UC?

**F. Business-completeness — is the business missing a UC category?**
- Are `Beneficiary` roles spread across the organization or bunched in one function? (All Beneficiaries = Procurement Manager means you've built a procurement-only portfolio.)
- Are `Sponsor` roles plausible for this business's size? (Don't put CFO on a UC worth $5K.)
- Does the portfolio have a balance of Opportunity / Risk / Improvement / Problem types? A 100% Opportunity portfolio reads salesy; 100% Risk reads paranoid.
- Are the Business Priorities from the user reflected in at least N UCs each (per §4.4 recall), and are they ALSO properly *framed* (not just tagged)?

**G. Reality — are these UCs real or aspirational?**
- Could this UC be built today with the supplied data, or does it assume data that would "be nice to have"?
- Does the UC require data sources (e.g., "customer NPS scores", "competitor price data", "inventory levels") that are not in `Tables Involved`?
- If the UC depends on external enrichment, is it FLAGGED as such or presented as ready-to-ship?
- Does the UC assume business processes that may not exist? (A "loyalty program optimization" UC on a schema without loyalty data.)

**H. Data-fit — does the data support the UC's claim?**
- If the UC claims "forecast 14-day demand per SKU", does the date column have ≥ 2 years of history to learn seasonality? (If 3 months, the claim is weak.)
- If the UC claims "customer segmentation" based on behavior, does the customer column have enough cardinality? Enough attributes per customer? Enough repeat interactions?
- If the UC cites `basket/order id` for association analysis, does the grouping id actually reveal multi-item baskets, or is each order a single item?
- If the UC implies cross-sell recommendations, is there enough product diversity AND enough co-purchase signal?
- Run a quick SQL sanity check from the CSV: for every UC, does a `SELECT COUNT(*)` on the stated join produce enough rows to support the method?

**I. Portfolio-level smell tests**
- **Scoring compression**: is the inspire_score range wider than 1.5 points? If every UC is 7.9–8.7, the score is signaling "all good" rather than stratifying. Something upstream is averaging out.
- **Technique redundancy**: if > 20% of UCs share one technique (e.g., 30/100 are Anomaly Detection), the model has a technique bias.
- **Wording repetition**: if phrases like "unlock hidden value", "drive actionable insights", "deliver measurable ROI" appear in many UCs, the model is padding with generic marketing copy rather than grounded analysis.
- **Domain starvation**: any domain with < 3 UCs is either underserved OR the domain itself is a placeholder and should be merged into a neighbor.
- **Industry self-contradiction**: if the business is "a healthcare provider" but UCs talk about "customer cross-sell recommendations", there's a framing error.

**Fix path for anything §4.11 catches:**
1. If the miss is structural (missing operational patterns, missing FK-join UCs) → tighten Rule 6 (FULL PORTFOLIO) or Rule 11 (technique–data fit) in `BASE_USE_CASE_GEN_PROMPT`.
2. If the miss is organizational invention or data-support fiction → tighten Rules 5, 9, 10.
3. If the miss is role/sponsor absurdity → add a rule to `BASE_USE_CASE_GEN_PROMPT` requiring Beneficiary and Sponsor be grounded in plausible roles FROM the business inputs (not invented titles).
4. If the miss is under-use of a specific table (e.g., `nation` / `region`-type lookup dims) → check the BUSINESS-table filter (see §6.x for the REFERENCE-class carve-out fix) and whether the schema for Pass-2 validation includes those tables.
5. If the miss is portfolio-level (technique bias, compressed scores) → consider a post-generation dedup / rebalancing code gate (plan Q2 / Q5).

Every failure found here must be logged into `tests/review_findings.jsonl` (one JSON line per UC) with `{uc_id, issue_type, severity, proposed_fix, fix_location}`. After applying fixes, rerun the full loop and re-answer the questions.

---

## 5. Prompt-fix cookbook

When a check fails, identify which prompt's rules were inadequate and patch it. These are the seven places defects tend to live.

### 5.1 `BASE_USE_CASE_GEN_PROMPT`

Generates use cases during Discover. This is the single highest-leverage prompt.

Defects that live here:
- GROUNDING failures → weak or missing column-citation rule.
- Near-duplicates → missing or weak dedup rule.
- Invented capabilities → weak no-invention rule.
- Missing operational UCs → missing or weak full-portfolio preamble.
- Invented $/% figures → missing or weak no-invented-numbers rule.
- Mislabeled techniques → missing technique–data fit rule.
- Vague technique names → missing no-catch-all rule.

Patch location: in the **ABSOLUTE RULES** block near the top of the prompt. Add rules following the numbering; use structural language only.

### 5.2 `BUSINESS_CONTEXT_WORKER_PROMPT`

Extracts the 6-field business context (context, goals, priorities, initiative, value chain, revenue model) from the business name + industry.

Defects that live here:
- Fabricated revenue / location / employee counts.
- Invented Fortune-500 / ISO-certification claims.
- Named competitor leakage.

Patch: require every field to be grounded in supplied inputs or labeled `UNKNOWN_FROM_METADATA`.

### 5.3 `USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT`

Generates the long Genie implementation instruction during Generate.

Defects that live here:
- The persona section invents scale numbers — fix in Section 1.
- The Business Value section invents dollar ranges — fix in Section 2.B.
- The Failure Scenario names competitors — fix in Section 2.D.
- Output column specs are fine; don't try to force them into the schema-grounding check.

### 5.4 Other prompts

- `FILTER_BUSINESS_TABLES_PROMPT` — classifies tables as BUSINESS vs TECHNICAL. Bugs: wrong-industry examples; default-to-BUSINESS on parse failure (should default TECHNICAL).
- `SUMMARY_GEN_PROMPT` — narrative summary. Bugs: named-entity leakage.
- `_merge_small_domains` / `_split_mega_domains` / `_merge_duplicate_subdomains` — domain taxonomy. Bugs: hardcoded industry domain names in the few-shot examples.

### 5.5 How to apply a prompt edit safely

The notebook is a single-cell ~1.5 MB Jupyter file. Editing line-by-line via a text editor is error-prone. Use this Python pattern for every prompt edit:

```python
import json
NB = "<local path to dbx_inspire_ai_agent.ipynb>"
nb = json.load(open(NB))
cell = nb["cells"][1]  # the mega code cell
src = "".join(cell["source"])

OLD = "<exact anchor string from the current prompt>"
NEW = "<replacement>"

assert OLD in src, "anchor not found — re-read current state"
assert NEW not in src, "already applied"
src = src.replace(OLD, NEW, 1)

cell["source"] = [l + "\n" for l in src.split("\n")]
if cell["source"]:
    cell["source"][-1] = cell["source"][-1].rstrip("\n")
json.dump(nb, open(NB, "w"), ensure_ascii=False, indent=1)
open(NB, "a").write("\n")
```

After every edit:
1. Re-upload: `databricks workspace import $NOTEBOOK_PATH --file $LOCAL_NOTEBOOK --format JUPYTER --overwrite --language PYTHON --profile $PROFILE`
2. Run a fresh Discover → validate → if needed, loop.

### 5.6 Anti-overfit self-check before applying any prompt edit

Before committing a new rule to a prompt, scan the rule for:
- any literal column name that came from the testing dataset (e.g., `customerID`, `totalPrice`)
- any literal industry (`retail`, `bakery`, `bank`, `clinic`, `factory`)
- any literal vendor or product (`Snowflake`, `SAP`, `Databricks SQL`)

If found → replace with a structural description. If the rule cannot be stated without an example, pick a placeholder like `<category_column>` or describe the structural property (e.g., "a column with ≤ 30 distinct values and non-null ratio ≥ 0.7").

---

## 6. When code changes are unavoidable

Some defects are not prompt-controllable. These require code edits to the agent notebook. Common ones:

### 6.1 Generate mode wipes Discover's output directory

Symptom: after running Generate, the `docs/` folder is empty and all skeleton notebooks except the flagged ones have been deleted.

Root cause: `DatabricksInspire.__init__` unconditionally calls `workspace.delete(self.base_output_dir, recursive=True)`.

Fix: guard the delete on `self.operation == "Discover Use Cases"`. Generate mode should preserve the existing artifacts. Apply via the same `json.load` / `src.replace` pattern as §5.5, targeting the `try: self.logger.info(f"Cleaning up existing output directory…")` block.

### 6.2 Silent default-APPROVE on parser failure

Symptom: malformed LLM output gets passed through as valid.

Root cause: parsers like `_parse_validation_response` default to APPROVE on JSON parse failure.

Fix: default to REJECTED with an explicit `validation_error` marker.

### 6.3 No heartbeat during long LLM calls

Symptom: step event stream is frozen for 15+ minutes while an LLM call is in flight, making it impossible to tell a live call from a hang.

Fix: wrap each long LLM call in a background heartbeat that writes a `status='heartbeat'` step event every N seconds. Plan reference: Phase N6.

### 6.4 Generate mode reads stale catalog snapshot

Symptom: Generate produces Genie instructions citing columns that have been renamed or dropped since Discover ran.

Fix: at the top of Generate, re-snapshot information_schema for the catalogs involved and compare against the snapshot hash stored on `__inspire_session` at Discover time. If drift, BLOCK or auto-accept via widget. Plan reference: Phase E0.

---

## 7. Iteration methodology

### 7.1 Baseline pass

- Run Discover against the target scope. No edits yet.
- Validate using every check in §4.
- Record:
  - UC count, domain count, subdomain count, technique count
  - Column-citation count by column
  - $/% hallucination count
  - Near-duplicate count
  - Invented-construct count
  - Recall gaps per pattern

### 7.2 Targeted fix pass

- Pick the 2–3 highest-impact failures from the baseline.
- For each: identify the prompt responsible, craft a STRUCTURAL rule (§5.6 self-check), apply via §5.5.
- Rerun Discover. Compare deltas. Accept when each fix moves the metric in the right direction AND no other metric regresses.

### 7.3 Generate validation pass

- Flag 3 top-score UCs.
- Run Generate.
- Validate Genie instructions with §4.7–4.10.
- If Genie hallucinations appear, the fix almost always lives in `USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT`'s Persona or Section 2.

### 7.4 Cross-schema generalization pass

After iterations on one dataset converge, rerun the full loop on a DIFFERENT dataset with a different schema, industry, table count, and column naming convention. This is the real test of whether the prompt rules are structural or secretly industry-specific.

A rule that passes on dataset A but fails on dataset B is overfit. Go back to §5.6 and re-generalize.

---

## 8. Outputs to inspect

### 8.1 Tables in `$INSPIRE_DB`

- `__inspire_session` — one row per session with widget snapshot, status, completion %, JSON blob of results.
- `__inspire_usecases` — one row per UC, ~35 columns, sortable by `inspire_score`.
- `__inspire_step` — one row per pipeline step; use for progress monitoring.

Queries of interest:

```sql
-- Portfolio summary for a session
SELECT business_domain, subdomain, COUNT(*) cnt, AVG(inspire_score) avg_score
FROM $INSPIRE_DB.__inspire_usecases
WHERE session_id = $SESSION_ID
GROUP BY business_domain, subdomain
ORDER BY avg_score DESC;

-- UCs without Genie
SELECT id, use_case, analytics_technique, inspire_score
FROM $INSPIRE_DB.__inspire_usecases
WHERE session_id = $SESSION_ID AND genie_instruction IS NULL
ORDER BY inspire_score DESC;

-- Step trace
SELECT last_updated, stage_name, step_name, status, message
FROM $INSPIRE_DB.__inspire_step
WHERE session_id = $SESSION_ID
ORDER BY last_updated;
```

### 8.2 Workspace files

Default generation path: `./../demos/inspire_gen/<business_slug>/` relative to the notebook location.

- `docs/<business_slug>-dbx_inspire.csv` — portfolio CSV
- `docs/<business_slug>-dbx_inspire.xlsx` — Excel
- `docs/<business_slug>-dbx_inspire.json` — JSON
- `docs/<business_slug>-dbx_inspire.md` — Markdown
- `docs/<business_slug>-dbx_inspire_en.pdf` — PDF
- `docs/generation_log.txt` — run log
- `notebooks/<domain>/<subdomain>/<UC-slug>.ipynb` — per-UC notebook

Download a single file:

```
databricks workspace export <workspace_path> --format AUTO --profile $PROFILE > local.csv
```

---

## 9. Known failure signatures and their prompt fixes

Reference list. When a defect matches a row, apply the fix listed.

| Symptom in output | Root cause | Prompt fix |
|---|---|---|
| UCs cite no column names, just prose ("historical transaction data") | `BASE_USE_CASE_GEN_PROMPT` lacks a column-level grounding rule | Add rule: "Statement AND Solution MUST EACH name ≥ 2 specific columns as backticked identifiers" |
| UCs quote $ figures, entity counts, Fortune-500-style claims | `BUSINESS_CONTEXT_WORKER_PROMPT` tells LLM to fabricate scale; Genie prompt Section 2.B demands dollar ranges | Rewrite BC worker Step 1 to allow `UNKNOWN_FROM_METADATA`; rewrite Genie Persona + §2 to forbid fabricated scale |
| Three UCs on the same table with different techniques, same business question | No dedup rule | Add rule: "Near-duplicates (same Tables Involved + functionally same question + only technique differs) are REJECTED" |
| UC references a loyalty / subscription / tier / program the schema doesn't have | No "no invented organizational constructs" rule | Add rule: "Every organizational construct referenced must map to a column in Tables Involved" |
| UC claims a cost/fee/benchmark not in the schema | No "no inferred-externality" rule | Add rule: "Every cost/rate/externality claim must be computable from a named column" |
| Funnel / Cohort / Survival technique on a schema that doesn't support it | No technique–data fit rule | Add rule listing structural prerequisites per technique |
| `Analytics Technique` = "AI Analysis" / "General Analytics" | No "no catch-all" rule | Add rule: "Use a specific named technique; catch-all umbrella labels are REJECTED" |
| Genie instruction citations match backticked MLflow tags, output columns, Python vars | Validator false positive | Ignore backticks outside `SELECT ... FROM <table>` contexts; output columns and system tags are legitimate |
| Generate wipes Discover's docs/ folder | `__init__` unconditionally deletes base_output_dir | Code fix: guard the delete on `operation == "Discover"` |
| Step events frozen 15+ minutes during LLM call | No heartbeat | Code fix: background heartbeat writer (§6.3) |
| Generate produces citations for dropped columns | No catalog-drift check at Generate entry | Code fix: re-snapshot information_schema and diff against stored hash |
| Pass-2 LLM chain-of-thought ("Let me check...", "Wait...", "I need to...") leaks into CSV body; parser rejects N rows silently | Pass-2 prompt allows narrative output | Prompt: add Rule 13 — OUTPUT DISCIPLINE — "Response MUST be pure CSV. No preamble/afterword/commentary. No lines beginning with `#`/`-`/`//`/narrative phrases. First char = CSV header's first char; last char = last row's last char." |
| Small lookup/dimension tables (e.g., `nation`, `region`, `calendar_dim`) never cited by any UC; Pass 2 flags re-mentions as "hallucinated tables" | Agent code explicitly skips REFERENCE-classified tables from the schema passed to Pass-2 validation | Code fix: remove the `if reference_tables_set and fqtn in reference_tables_set: continue` skip in `all_columns_for_sql` construction; REFERENCE tables remain flagged for classification but stay available for joins |
| Domain names come out as `Domain1..DomainN` placeholders | Primary domain-naming LLM retries exhausted; code falls through to generic names silently | Code fix: after fallback, re-attempt naming using each cluster's DETECTED SUBDOMAINS as context; strict single-word validator; collision guard; keep placeholder only as last resort (Iter5-A pattern in this repo) |
| First run on a new environment has no baseline to diff against; Phase L gate 6 fails | Baseline capture demanded before any edits | R3 — first clean run captures baseline automatically; gate 6 is advisory on first-run-per-fixture, BLOCKING on subsequent runs |
| Cross-batch LLM output contains near-duplicate UCs (different technique, same business question, same tables) because each batch is independent | Single-batch prompt rule (Rule 8) cannot enforce dedup across independent LLM calls | Code fix: post-Discover portfolio-wide canonical-signature dedup; emit `UC_DEDUP_RATE_HIGH` BLOCKING if > 5% |
| UCs cite fields that are not in the schema ("loyalty_tier", "promo_code") even when no such column exists | Model invents organizational constructs to satisfy FULL-PORTFOLIO pressure | Rule 9 — every organizational/program/tier reference must map to a column. Tightened in this repo to be structural (applies to any industry) |
| General Instructions field (hints about joins / preferred techniques / table exclusions) is ignored by the agent | Long or complex instruction strings hang the "Interpreting Generation Instructions" LLM call; agent makes many retry attempts | Keep hints SHORT (≤ 3 sentences) and STRUCTURAL (specific columns/tables/joins). Verify adherence post-run (see §10). If hint is > 3 sentences and run hangs > 20 min, cancel and trim. |

---

## 10. Multi-schema sweep with randomized General Instructions

When validating the agent on a fresh environment OR when testing generalization, run Inspire against multiple schemas with STRUCTURAL (not industry-biased) hints in `08_generation_instructions`, then verify the hints were followed.

### 10.1 Schema selection

- Pick schemas of different shapes: a single-table fact, a small normalized schema (5–10 tables), a denormalized wide schema, a large normalized benchmark (20+ tables). The `samples` catalog on Databricks provides this range.
- Skip schemas with 0 tables (e.g., empty namespaces).
- Note catalog-level stats (column counts via `information_schema.columns`) — some tables may show 0 columns due to preview-only access; the agent can still handle them.

### 10.2 Crafting hints (structural only)

Every hint must be stated as a schema-level structural direction, never as an industry assumption. Good and bad examples:

✅ Good (structural): `"Treat lineitem and orders as pre-joined on l_orderkey = o_orderkey. Prefer time-series UCs on the month grain when a date column is present."`
❌ Bad (industry-biased): `"Focus on retail customer churn patterns. Use promotional campaign analysis since this is a consumer business."`

Categories of useful hints:
- **Join hints**: "Treat A and B as pre-joined on `A.k = B.k`." Pick at most 2–3 joins per run to avoid hanging.
- **Technique preferences**: "Prefer time-series UCs on the `<grain>` grain." Or: "Prefer ranking UCs over `<dim_column>`."
- **Exclusion hints**: "Exclude tables whose names match `*_logs`, `*_audit`, `*_temp`." (Agent already has this; reinforce if needed.)
- **Equivalence hints**: "`table_imperial` and `table_metric` describe the same data at different units; do not double-generate UCs."
- **Cardinality hints**: "Dimension tables include X, Y, Z; all others are facts."

### 10.3 Length budget

Keep total length ≤ 3 sentences (~300 chars). Longer inputs have hung the Interpreting-Generation-Instructions step for 60+ min in production.

### 10.4 Verifying hint adherence post-run

After Discover completes, validate that the hints actually shaped the output:

- **Join hint:** grep the `Tables Involved` field across all UCs. Count UCs that cite BOTH tables named in the join. Target: ≥ 10% of UCs should exploit the join.
- **Technique hint:** count UCs whose `Analytics Technique` matches the hinted preference. Target: ≥ 25% match.
- **Exclusion hint:** confirm 0 UCs cite the excluded tables.
- **Equivalence hint:** check for duplicate-by-unit-system UCs (same business question, same technique, tables differ only in `_imperial`/`_metric` suffix). Target: 0.

If adherence is below target, the prompt's interpretation of user hints needs tightening — NOT the hints themselves. Investigate whether the agent is reaching `generation_instructions_section` at UC-generation time (Pass 1) or only in an ancillary LLM call.

### 10.5 Recording the sweep

Maintain `tests/sweep_log.csv` with columns:
`schema, n_tables, hint_text, session_id, runtime_sec, uc_count, domain_count, technique_count, columns_cited, multi_table_uc_rate, hint_adherence_pct, §4_checks_passed, §4_checks_failed, §4.11_issues_found, genie_route1_ok, genie_route2_ok, docs_files_6_present`.

One row per schema. Updated after each run. Feeds §10.6 and §11.

### 10.6 Cross-schema generalization scoring

Per prompt rule (1–13), mark which schemas the rule held up on. If a rule works on schemas A, B, C but not D, the rule is specific-to-structure-type X, not universal. Tighten to structural wording and retest on D.

---

## 11. One-time export of sessions for a UI importer

When a UI component wants to display the agent's history, export three CSV snapshots to `demos/sessions/`:

- `__inspire_session.csv` — one row per session.
- `__inspire_step.csv` — one row per step event.
- `__inspire_usecases.csv` — one row per UC.

### 11.1 Path discipline

- Strip ALL absolute paths (`/Workspace/Users/<user>/...`) from any string column. Replace with a path relative to the `demos/` folder (e.g., `demos/bakehouse/session_<session_id>/docs/Bakehouse-dbx_inspire.pdf`). As of v0.5.5, output is session-scoped under `session_<id>/{docs,notebooks}/` to prevent cross-session clobbering.
- Strip workspace-specific identifiers (workspace ids, user principals) from any metadata field.
- Use `os.path.relpath(abs_path, start=demos_root)` or equivalent string-replace to produce the relative form.
- The importer MUST resolve the relative path against its own `demos/` folder at display time.

### 11.2 Scope

- Include sessions whose `business_name` falls within the permitted sample businesses you ran (do not export customer-data-bearing rows from other sessions).
- If a session contains widget values in the `widget_snapshot` field that include free-text fields (e.g., `08_generation_instructions`), preserve them as-is — but verify they contain no secrets.

### 11.3 Deduplication

If the same `session_id` appears in more than one run (rare — only when resumed), keep the latest `last_updated`.

### 11.4 Export script pattern

```python
import csv, os, subprocess, json
DEMOS_ROOT_ABS = "/Workspace/Users/<redacted>/inspire-ai/demos"
# Query each table via SQL API; for each string column, run a regex replace:
#   r"/Workspace/.*?/inspire-ai/demos/" -> "demos/"
#   (repeat for any other absolute-path prefixes observed in the data)
# Then write CSV with csv.DictWriter + QUOTE_ALL.
```

The three CSVs go to `demos/sessions/`. This is a one-time export; not re-run on every agent execution.

### 11.5 Verification

- `grep -r "/Workspace/" demos/sessions/*.csv` must return zero matches.
- `grep -rE "[a-z0-9._-]+@[a-z0-9.-]+" demos/sessions/*.csv` must return zero matches (no emails).
- Every `session_id` in `__inspire_step.csv` and `__inspire_usecases.csv` must resolve to a row in `__inspire_session.csv`.
- The importer smoke test: load the three CSVs, render, and click a UC's "open notebook" link. The link must resolve correctly via the importer's own `demos/` root.

---

## Appendix A — Validator scripts

Paste these into `/tmp/` and run with `python3`.

### A.1 `validate_uc_grounding.py`

```python
#!/usr/bin/env python3
"""Check that every UC's Tables Involved resolves to a real table, and
count column-level citations in UC text."""
import csv, re, sys, subprocess, json
CSV_PATH = sys.argv[1]      # path to exported use-cases CSV
PROFILE = sys.argv[2]       # databricks CLI profile
WAREHOUSE = sys.argv[3]     # warehouse id
SCOPE = sys.argv[4]         # e.g., "samples.tpch" or "samples.bakehouse.sales_transactions"

# Resolve actual columns per table for the scope
parts = SCOPE.split(".")
if len(parts) == 2:
    catalog, schema = parts
    table_filter = ""
elif len(parts) == 3:
    catalog, schema, table = parts
    table_filter = f"AND table_name = '{table}'"
else:
    sys.exit(f"bad scope: {SCOPE}")

q = f"SELECT table_name, column_name FROM {catalog}.information_schema.columns WHERE table_schema = '{schema}' {table_filter}"
r = subprocess.run(
    ["databricks","api","post","/api/2.0/sql/statements","--profile",PROFILE,
     "--json", json.dumps({"warehouse_id":WAREHOUSE,"statement":q,"wait_timeout":"30s"})],
    capture_output=True, text=True)
cols_by_table = {}
for tn, cn in json.loads(r.stdout)["result"]["data_array"]:
    cols_by_table.setdefault(tn, set()).add(cn)

rows = list(csv.DictReader(open(CSV_PATH)))
miss_tables = 0
miss_cols = 0
col_cites = 0
for r in rows:
    for t in r["Tables Involved"].split(","):
        tn = t.strip().split(".")[-1]
        if tn and tn not in cols_by_table:
            miss_tables += 1
            print(f"MISSING TABLE  {r['ID']}  {tn}")
    blob = " ".join(r.get(f,"") for f in ("Statement","Solution","Business Value"))
    for tn, cs in cols_by_table.items():
        for c in cs:
            col_cites += len(re.findall(r"`?\b"+re.escape(c)+r"\b`?", blob))

print(f"rows={len(rows)}  missing_tables={miss_tables}  column_citations_total={col_cites}")
```

### A.2 `validate_dedup.py`

```python
#!/usr/bin/env python3
"""Exact-canonical dedup check."""
import csv, re, sys
from collections import Counter, defaultdict
rows = list(csv.DictReader(open(sys.argv[1])))
def sig(r):
    tabs = tuple(sorted(t.strip() for t in r["Tables Involved"].split(",") if t.strip()))
    tech = r["Analytics Technique"].strip().lower()
    nouns = tuple(re.findall(r"[a-z]+", r["Statement"].lower())[:6])
    return (tabs, tech, nouns)
sigs = defaultdict(list)
for r in rows:
    sigs[sig(r)].append(r["ID"])
dupes = [(s, ids) for s, ids in sigs.items() if len(ids) > 1]
print(f"rows={len(rows)} exact_duplicate_groups={len(dupes)}")
for s, ids in dupes:
    print(f"  {ids}  tables={s[0]}  technique={s[1]}")
```

### A.3 `validate_relevance.py`

```python
#!/usr/bin/env python3
"""Heuristic relevance checks: technique-data fit, at least one business-like
table cited, non-empty business value."""
import csv, re, sys
rows = list(csv.DictReader(open(sys.argv[1])))
TECH_REQUIRES = {
    "funnel analysis": ["stage", "step", "event", "phase"],
    "cohort analysis": ["date","signup","joined","first","created"],
    "survival analysis": ["date","time","start","end","status"],
    "forecasting": ["date","time","timestamp"],
    "top-n": ["numeric","count","amount","value"],
}
for r in rows:
    tech = r["Analytics Technique"].lower()
    # Business table heuristic: avoid TECHNICAL words in tables_involved
    tabs = r["Tables Involved"].lower()
    if any(k in tabs for k in ["log","audit","system","metadata","_temp"]):
        print(f"WARN  {r['ID']}  only TECHNICAL-like tables: {r['Tables Involved']}")
    # Catch-all technique
    if tech in ("ai analysis","general analytics","data science","ml analysis","advanced analytics"):
        print(f"FAIL  {r['ID']}  vague technique: {tech}")
```

### A.4 `validate_recall.py`

```python
#!/usr/bin/env python3
"""Check operational-pattern coverage."""
import csv, sys
from collections import defaultdict
rows = list(csv.DictReader(open(sys.argv[1])))
PATTERNS = {
    "TREND":        ["trend","period","month-over","year-over","forecast","seasonal"],
    "TOP_N":        ["top ","rank","highest","lowest","pareto"],
    "SUBJECT_360":  ["360","profile","customer segment","lifetime value"],
    "ANOMALY_SLA":  ["anomal","outlier","sla","breach","alert","detect"],
    "BASKET_FUNNEL":["basket","funnel","cohort","progression","bundle","association"],
}
hits = defaultdict(list)
for r in rows:
    blob = " ".join(r.get(f,"") for f in ("Use Case","Statement","Solution","Analytics Technique")).lower()
    for p, keys in PATTERNS.items():
        if any(k in blob for k in keys):
            hits[p].append(r["ID"])
for p, ids in PATTERNS.items():
    mark = "OK" if hits[p] else "MISSING"
    print(f"{p:<15}  {mark:8}  {len(hits[p])} UCs")
```

### A.5 `validate_constructs.py`

```python
#!/usr/bin/env python3
"""Flag UCs framed around organizational constructs not in the schema."""
import csv, re, sys
rows = list(csv.DictReader(open(sys.argv[1])))
CONSTRUCTS = [
    ("loyalty (program|tier)", "loyalty"),
    ("rewards? (program|points)", "rewards"),
    ("subscription (plan|tier)", "subscription"),
    ("promotion (code|campaign)", "promotion"),
    ("referral (program|bonus)", "referral"),
    ("compliance (audit|committee)", "compliance"),
    ("training program", "training"),
    ("risk committee", "risk_committee"),
]
for r in rows:
    blob = " ".join(r.get(f,"") for f in ("Statement","Solution","Business Value","Description")).lower()
    tabs = r["Tables Involved"].lower()
    for pat, key in CONSTRUCTS:
        if re.search(pat, blob):
            if key not in tabs and not any(key in c for c in tabs.split(",")):
                print(f"WARN  {r['ID']}  references '{key}' without a column named for it")
```

### A.6 `validate_bob.py` — Best-Of-Best Sanity Check (v0.7.2+)

```python
#!/usr/bin/env python3
"""Post-Discover BoB validator.

Asserts:
  - bob_score is populated on every surviving row
  - bob_tier1/2/3_score are populated
  - idea_theme is populated
  - the final UC count lands in [50, 100]
  - hard-veto survivors (bob_score <= 2.0) are enumerated, not silently ignored
  - no theme contains > 15% of the portfolio (stratified-trim cap)
  - every theme has >= 1 UC with bob_score >= 6 (strong-anchor rule)

Usage:
    python3 validate_bob.py <session_id> <profile> <warehouse_id> <catalog.schema>
"""
import json, subprocess, sys
from collections import Counter

SESSION_ID, PROFILE, WAREHOUSE, INSPIRE_DB = sys.argv[1:5]

def q(sql):
    r = subprocess.run(
        ["databricks","api","post","/api/2.0/sql/statements","--profile",PROFILE,
         "--json", json.dumps({"warehouse_id":WAREHOUSE,"statement":sql,"wait_timeout":"30s"})],
        capture_output=True, text=True, check=True)
    return json.loads(r.stdout).get("result", {}).get("data_array", [])

rows = q(f"""
    SELECT id, idea_theme, bob_score, bob_tier1_score, bob_tier2_score, bob_tier3_score
    FROM {INSPIRE_DB}.__inspire_usecases
    WHERE session_id = {SESSION_ID}
""")

total = len(rows)
print(f"Total surviving UCs: {total}")
assert 50 <= total <= 100, f"FAIL: UC count {total} outside [50, 100] target zone"

missing_bob   = sum(1 for r in rows if r[2] is None)
missing_t1    = sum(1 for r in rows if r[3] is None)
missing_t2    = sum(1 for r in rows if r[4] is None)
missing_t3    = sum(1 for r in rows if r[5] is None)
missing_theme = sum(1 for r in rows if not r[1])

print(f"Missing bob_score     : {missing_bob}")
print(f"Missing tier1_score   : {missing_t1}")
print(f"Missing tier2_score   : {missing_t2}")
print(f"Missing tier3_score   : {missing_t3}")
print(f"Missing idea_theme    : {missing_theme}")
assert missing_bob == 0 and missing_theme == 0, "FAIL: BoB columns not populated"

# Hard-veto survivors
hv = [r for r in rows if float(r[2]) <= 2.0]
print(f"\nHard-veto survivors (bob_score <= 2.0): {len(hv)}")
for r in hv:
    print(f"  {r[0]}  theme='{r[1]}'  bob={r[2]}")

# Theme distribution
themes = Counter(r[1] for r in rows)
cap = int(total * 0.15) + 1
print(f"\nTheme distribution: {len(themes)} themes, largest = {themes.most_common(1)[0][1]}, cap = {cap}")
over_cap = [(t, n) for t, n in themes.items() if n > cap]
assert not over_cap, f"FAIL: themes over 15% cap: {over_cap}"

# Strong-anchor check: every theme needs >= 1 UC with bob_score >= 6
by_theme = {}
for r in rows:
    by_theme.setdefault(r[1], []).append(float(r[2]))
weak_themes = [t for t, scores in by_theme.items() if max(scores) < 6.0]
print(f"\nThemes with NO strong UC (all bob_score < 6): {len(weak_themes)}")
for t in weak_themes:
    print(f"  '{t}'  max_bob={max(by_theme[t]):.2f}")

# Summary
print("\nPASS" if (missing_bob == 0 and missing_theme == 0 and not over_cap) else "FAIL")
```

Run it after every Discover that triggers BoB (portfolio > 75 pre-trim).

### A.7 `audit.py` — Genie Instruction Audit

```python
#!/usr/bin/env python3
"""Full Genie audit: hallucination counts + semantic alignment to UC fields."""
import json, re, sys
from collections import Counter

JSON_PATH = sys.argv[1]  # SQL-API response containing id, statement, solution, business_value, analytics_technique, tables_involved, genie_instruction
SCHEMA_COLS = set(sys.argv[2].split(","))  # comma-separated list of actual columns for the scope

rows = json.load(open(JSON_PATH))["result"]["data_array"]

def h(txt):
    dollars = len(re.findall(r"\$[\d.,]+\s?[MBK]\b|\$\d{3,}", txt))
    pcts = len(re.findall(r"\b\d{1,3}(?:\.\d+)?\s?%", txt))
    real = sum(len(re.findall(r"`?\b"+c+r"\b`?", txt)) for c in SCHEMA_COLS)
    enrich = len(re.findall(r"(product dimension|store dimension|calendar reference|holiday (?:reference|calendar)|promotional calendar)", txt, re.I))
    scale = len(re.findall(r"\d[\d,]*\+?\s?(?:daily transactions|SKUs|locations|customers daily|stores|employees)", txt))
    return dollars, pcts, real, enrich, scale

totals = Counter()
print(f"{'id':<10} {'$':>3} {'%':>3} {'real':>5} {'enrich':>7} {'scaleN':>7}")
for row in rows:
    uc_id, stmt, sol, bv, tech, tabs, genie = row
    d, p, r_, e, s = h(genie)
    print(f"{uc_id:<10} {d:>3} {p:>3} {r_:>5} {e:>7} {s:>7}")
    totals["$"] += d; totals["%"] += p; totals["real"] += r_; totals["enrich"] += e; totals["scale"] += s
    # Semantic
    if tech and tech.lower() not in genie.lower() and tech.split()[0].lower() not in genie.lower():
        print(f"  TECHNIQUE DRIFT  {uc_id}: '{tech}' not mentioned")
    for t in tabs.split(","):
        t = t.strip()
        if t and t not in genie:
            print(f"  MISSING TABLE  {uc_id}: {t}")
print(f"\nTOTALS  $={totals['$']}  %={totals['%']}  real={totals['real']}  enrich={totals['enrich']}  scale={totals['scale']}")
```

---

## Appendix B — Iteration log template

Keep one section per iteration to make drift visible across runs.

```
### Iteration <N> — <yyyy-mm-dd>
- Scope:         <catalog.schema or table>
- Business:      <name>
- Session_id:    <bigint>
- Discover runtime: <minutes>
- UCs generated: <count>
- Domains:       <count>
- Subdomains:    <count>
- Techniques:    <count>

Validation (§4):
- GROUNDING:         <pass | N missing tables, M missing cols>
- DEDUPLICATION:     <pass | N exact dupes>
- RELEVANCE:         <pass | N warnings>
- RECALL:            <pass | missing patterns: …>
- INDUSTRY DEBIAS:   <$ count, % count, brand count>
- ORG CONSTRUCTS:    <count of invented constructs>

Genie (§4.7–§4.9, only if Generate ran):
- Flagged UCs:       <ids>
- $ figures:         <count>
- % figures:         <count>
- Real col cites:    <count>
- Enrich phantoms:   <count>
- Scale fabrications:<count>
- Semantic drifts:   <list>

Prompt edits applied this iteration:
- <prompt name>: <rule # and short description>

Outcome: <clean | issues remain, plan for next iteration>
```

---

## Appendix C — Cross-schema generalization checklist

Before declaring the agent ready for a new customer, run it against at least three structurally different schemas:

1. **Thin schema** — 1 table, <15 columns, single domain. (Baseline; tests handling of narrow scope.)
2. **Normalized OLTP** — 5–10 tables with foreign keys and dimension tables. (Tests join-awareness and cross-table UCs.)
3. **Denormalized warehouse** — wide fact tables, few joins, many numeric measures. (Tests whether the agent over-proposes joins.)

For each schema, complete the iteration log (Appendix B). A prompt rule that passes on schema 1 but fails on schema 2 is overfit — go back and re-generalize before shipping.

---

## Appendix D — Current ABSOLUTE RULES in `BASE_USE_CASE_GEN_PROMPT` (13 rules)

The rules below were added iteratively in response to specific failures on real runs. Apply the identical numbering; each rule's number is referenced elsewhere in this guide.

1. **REFERENCES ≥ 1 TABLE FROM SCHEMA** — every UC must cite at least one table from the supplied schema.
2. **HIGH LEVEL DESIGN COLUMNS EXIST EXACTLY** — every column in the implementation design must exist verbatim in the schema.
3. **COPY TABLE / COLUMN NAMES EXACTLY** — use `catalog.schema.table` format, copy column names character-for-character.
4. **COLUMN-LEVEL GROUNDING (MANDATORY)** — `Statement` AND `Solution` each name ≥ 2 specific columns from `Tables Involved`, referenced as backticked identifiers. Pure business prose without column anchors is REJECTED.
5. **NO INVENTED CAPABILITIES** — do not propose UCs that require concepts, fields, or signals the schema does not evidence. Every organizational/program/tier/score concept must map to an existing column OR be explicitly derived in the Solution.
6. **FULL PORTFOLIO** — generate the COMPLETE set of impactful UCs the data structurally supports, INCLUDING operational/foundational ones (trend on date+measure, top-N on high-cardinality dim, SLA/anomaly on status+date, basket/funnel on grouping id, subject-360 on fact+dim FK).
7. **NO INVENTED NUMBERS** — no `$` or `%` figures in any field unless a named column from `Tables Involved` could compute the value; use `[ESTIMATE: depends on <column>]` for unavoidable quantification.
8. **NO NEAR-DUPLICATE USE CASES** — no two UCs with identical `Tables Involved` + functionally-same business question + only technique differs. (Prompt cannot enforce across LLM batches → also needs a code dedup gate.)
9. **NO INVENTED ORGANIZATIONAL CONSTRUCTS** — every program / system / initiative / tier / committee / partner relationship referenced must map to a column in `Tables Involved`.
10. **NO INFERRED-EXTERNALITY CLAIMS** — no cost/fee/rate/benchmark/competitive-dynamic claims that depend on knowledge outside the schema.
11. **TECHNIQUE–DATA FIT** — the chosen `Analytics Technique` must be structurally supported by the columns of `Tables Involved`. Prerequisites per technique (Funnel needs stage columns, Survival needs start+status, Cohort needs onboarding timestamp, Basket needs grouping id, Forecasting needs date+measure, Top-N needs numeric+dimension).
12. **NO CATCH-ALL TECHNIQUE NAMES** — `"AI Analysis"`, `"General Analytics"`, `"Data Science"` are REJECTED. Use specific names.
13. **OUTPUT DISCIPLINE** — response MUST be pure CSV. No preamble, no afterword, no commentary between rows, no narrative phrases like `Let me...`, `Wait...`, `I need to...`. First char of response = CSV header's first char; last char = last row's last char. Rule applies equally to Pass 1 and Pass 2.

`BUSINESS_CONTEXT_WORKER_PROMPT` has a parallel rule in Step 1: all 6 fields must be grounded in supplied inputs or labeled `UNKNOWN_FROM_METADATA`. No Fortune-500, revenue, location-count, employee-count fabrication.

`USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT` Section 1 Persona and Section 2 B/C/D have been rewritten to forbid invented scale, competitors, and vendor product names; all numeric quantification must be `[ESTIMATE: depends on <column>]`.

---

## Appendix E — Code fixes (when prompt alone cannot)

| Fix | Location in agent notebook | Diagnostic | Resolution |
|---|---|---|---|
| **Generate wipes Discover's docs/ folder** | `DatabricksInspire.__init__` `workspace.delete(base_output_dir, recursive=True)` | After Generate, the 6 docs files (CSV/PDF/XLSX/JSON/MD/log) are missing and only the flagged-UC notebooks remain | Guard the delete on `self.operation == "Discover Use Cases"`. Generate mode preserves existing artifacts. |
| **Small lookup tables dropped from validation schema** | In `all_columns_for_sql` construction | `nation`, `region`, or small dim tables appear in the input schema but are never cited by any UC, and Pass 2 flags them as hallucinated | Remove the `if reference_tables_set and fqtn in reference_tables_set: continue` skip. REFERENCE tables remain classified but available for joins. |
| **Domain-name LLM retries exhaust → silent Domain1..DomainN fallback** | `_assign_default_domains` is called with no second attempt | CSV `Business Domain` column contains `Domain1`, `Domain2`, ... | Add `_rename_placeholder_domains_from_subdomains(use_cases)` after subdomain detection. For each DomainN cluster, use its detected subdomains as LLM context to ask for a single-word umbrella name; fail-safe keeps placeholder only as last resort. |
| **Output path has extra subfolder** | Widget `11_generation_path` default `./../demos/inspire_gen/` | Files land at `demos/inspire_gen/<business>/...` when user wants `demos/<business>/...` | Change widget default to `./../demos/`; path construction concatenates business slug directly. |

More patterns (for future iterations, not yet landed):
- Portfolio-wide dedup code gate (post-Discover; plan Q2)
- Heartbeat events during long LLM calls (plan N6)
- Catalog drift check at Generate entry (plan E0)
- UC volume log persistence (plan O)
- Structured event dual-write to `__inspire_step` with UTC ISO-8601 + `event_seq` (plan N1a)

---

## Appendix F — Session-iteration ledger

Keep this ledger updated after every iteration; it's the institutional memory of what worked / what didn't.

| Iter | Scope | Change applied | Metric before → after | Outcome |
|---|---|---|---|---|
| 1 | Bakehouse baseline | none (current agent) | 29 UCs, 43 col cites, 71 invented $ in Genie | Baseline — revealed weak grounding + heavy Genie hallucination |
| 2 | Bakehouse | BASE prompt Rules 4–7; BUSINESS_CONTEXT worker strip Fortune-500; Genie Persona + §2 rewrite | 31 UCs, col cites 43→126 (+193%); Genie $=71→0; real col cites 171→419 | Grounding wins; Genie cleaned |
| 3 | Bakehouse | Generate-mode-wipe code fix | 26 UCs; docs folder survives Generate; 3 Genies clean (0/3 semantic drift) | Bug fixed |
| 4 | TPC-H baseline (vanilla) | none further | 138 UCs, 5 domains, 21 techniques; 10 exact-canonical dupes, 5 `AI Analysis`, `Domain1..Domain5` placeholders | Uncovered 3 failures: dedup, catch-all, domain naming |
| 5 | TPC-H (with Rules 8–12) | Rules 8–12 added; industry-specific examples stripped | 126 UCs, 7 real domains (`Orders`, `Procurement`, `Catalog`, `Fulfillment`, `Suppliers`, `Customers`, `Revenue`); multi-table UC rate 7.2% → 14.3%; `nation`/`region` still 0 | Domain-naming fixed via primary LLM; REFERENCE filter still blocks small dims |
| 6 | TPC-H (with Rules 1–13 + Iter5 code fixes) | Rule 13 output discipline; REFERENCE-skip removed from schema filter; domain subdomain-rename fallback; path strips inspire_gen | *in progress at time of writing* | Expected: nation/region cited, no Pass-2 chain-of-thought leaks, path at `demos/tpc_h_benchmark/` |

Add one row per iteration going forward. Columns are deliberately short so the ledger is skimmable.

---

## Appendix G — Quick-start for a fresh environment

If you're starting from zero on a new workspace / catalog:

1. `databricks auth login --profile $PROFILE`
2. Create the Inspire schema: `CREATE SCHEMA IF NOT EXISTS <catalog>.<schema>`
3. Import the agent notebook: `databricks workspace import-dir ./ <workspace_path>`
4. Submit a smoke run via §3.1 against `samples.bakehouse.sales_transactions` with empty `08_generation_instructions`.
5. Watch §3.2 until the session progresses past `Business Understanding`. If stuck > 20 min, the Foundation Model endpoint may be throttling; wait and retry before suspecting a code bug.
6. After success, run §4.1–§4.11 on the CSV.
7. Pick 3 UCs, run Generate (§3.3 + §3.4), re-run §4.7–§4.9 on the Genies.
8. Only after the Bakehouse smoke passes do you run §10 multi-schema sweep.

If any check fails, go to §9 to find the fix.

---

## Appendix H — Testing history (v0.5.x sweep, 2026-04-18)

This appendix captures every smoke + fix cycle from v0.5.0 → v0.5.23 with the §4.11 dimensions exercised.

### Smoke runs

| Ver | Schema | Mode | Duration | Multi-table | Phase L | Q drops | Result |
|---|---|---|---|---|---|---|---|
| v0.5.5 | samples.bakehouse.sales_transactions | single-table | 14.1 min | N/A (1 table) | n/a (L not live) | 0/0/0/0 | 22 UCs, 7 domains, 14 techniques |
| v0.5.9 | samples.bakehouse.sales_transactions | single-table | 12.9 min | N/A | swallowed (see bug) | 0/0/0/0 | 27 UCs |
| v0.5.11 | samples.bakehouse.sales_transactions | single-table | 13.4 min | N/A | L5 false-positive BLOCKING | 0/0/0/0 | 29 UCs; Phase L placement wrong |
| v0.5.13 | samples.bakehouse.sales_transactions | single-table | 11.7 min | N/A | 17/17 PASS | 0/0/0/0 | 22 UCs; Phase L repositioned + L14 tuple-fix |
| v0.5.17 | samples.bakehouse (schema-scope) | multi-table target | 16.8 min | 0/75 (0%) | L18 FAIL | 0/0/0/0 | Prompt mandate alone insufficient |
| v0.5.18 | samples.bakehouse (schema-scope) | multi-table target | 16.7 min | 0/76 (0%) | L18 FAIL | 0/0/0/0 | Structural-name FK fallback applied per-batch but batches were 1-table each |
| v0.5.19 | samples.bakehouse (schema-scope) | multi-table target | 16.8 min | 0/68 (0%) | L18 FAIL | 0/0/2/0 | Early FK inference wired pre-UC-gen; still empty because camelCase not matched |
| v0.5.21 | samples.bakehouse (schema-scope) | multi-table target | 16.8 min | 11/67 (16%) | L3+L18 FAIL | 0/0/1/0 | tables_per_call fix unblocked; 20 G2 false-positive HIGHs |
| v0.5.22 | samples.tpcds_sf1 (schema-scope, cross-table hint) | multi-table target | 17.1 min | 3/10 (30%) | **18/18 PASS** | 0/0/1/0 | First full Phase L pass including L18 |

### Root causes discovered + fixed

| Discovery run | Bug | Fix ver |
|---|---|---|
| v0.5.9 | Phase L called str.strip() on float Priority values | v0.5.11 |
| v0.5.11 | Phase L ran at G+Q wire before Primary Table was derived (29/29 false positive L5) | v0.5.13 |
| v0.5.11 | L14 assumed dict rows but schema_details returns 6-tuples | v0.5.13 |
| v0.5.16 | 0/60 multi-table; prompt "FK exploitation" mandate too weak without declared FKs | v0.5.17 prompt + L18 check |
| v0.5.17 | Still 0%; per-batch structural fallback only sees 1-2 tables | v0.5.18 |
| v0.5.18 | Still 0%; merge_inferred_foreign_keys runs AFTER UC generation | v0.5.19 moved earlier |
| v0.5.19 | Still 0%; camelCase IDs (customerID, franchiseID) didn't match underscore regex | v0.5.20 |
| v0.5.20 | Still 0%; UC gen called one table per call, blocking multi-table reasoning | v0.5.21 |
| v0.5.21 | 16% multi-table, but 20 G2 false-positive UC_COLUMN_UNGROUNDED (table names treated as columns) | v0.5.22 |
| v0.5.22 | Prompt missing §4.11-B (Coherence), §4.11-C (Self-test), §4.11-I (Portfolio smell) | v0.5.23 |

### §4.11 coverage inside the prompt (v0.5.23)

The PRE-EMISSION SELF-REVIEW in BASE_USE_CASE_GEN_PROMPT now mirrors every §4.11 dimension:

| §4.11 dim | Prompt section | Scope |
|---|---|---|
| A. Relevance | §A PURPOSE | per UC |
| B. Coherence | §I COHERENCE | per UC |
| C. Self-test | §J SELF-TEST | per UC |
| D. Blindspots | §C COVERAGE (pattern signals) | portfolio |
| E. Coverage completeness | §C COVERAGE | portfolio |
| F. Business-completeness | §D STAKEHOLDER | per UC |
| G. Reality | §B FEASIBILITY | per UC |
| H. Data-fit | §B FEASIBILITY (data-fit sanity) | per UC |
| I. Portfolio smell | §K PORTFOLIO-SMELL | portfolio |

### Multi-schema sweep (v0.5.22 baseline)

Running on: samples.bakehouse, samples.accuweather, samples.nyctaxi, samples.healthverity, samples.tpcds_sf1 — all schema-scope with cross-table hint.

| Schema | Tables | UCs | Multi-table | Phase L | L18 |
|---|---|---|---|---|---|
| tpcds_sf1 | 24 | 10 | 3/10 (30%) | 18/18 PASS | ✅ |
| bakehouse | 6 | *pending* | | | |
| accuweather | *pending* | | | | |
| nyctaxi | *pending* | | | | |
| healthverity | *pending* | | | | |


---

## Appendix I — v0.5.27 5-schema sweep results (post-fix)

After the CI/CD loop, v0.5.26 + R6 demote (52bdd68) + R2 string-type name-stem fallback (5b1a358), tagged as v0.5.27. Table-coverage fix from v0.5.24 verified under load.

### Scorecard

| Schema | UCs | Q1 drops | Q2 drops | Q3 drops | Phase L fails | Tables used |
|---|---|---|---|---|---|---|
| nyctaxi | 25 | 0 | 0 | 1 | 0/18 ✓ | 1 of 1 |
| bakehouse | 39 | 0 | 0 | 1 | L3, L18 | 5 of 6 |
| healthverity | 34 | 0 | 0 | 2 | 0/18 ✓ | 1 of 1 |
| tpcds_sf1 | 149 | 0 | 1 | 14 | L3, L9, L18 | 7 of 24 |
| accuweather | 100 | 0 | 0 | 6 | L3, L9, L18 | 12 of 12 |

### Coverage wins vs pre-fix baseline

| Schema | Pre-fix UCs | Pre-fix tables | Post-fix UCs | Post-fix tables |
|---|---|---|---|---|
| tpcds_sf1 | 10 | 2 | **149** | **7** |
| accuweather | 70 | 4 | **100** | **12** |
| nyctaxi | 14 | 1 | 25 | 1 (genuinely single-table) |
| healthverity | 33 | 1 | 34 | 1 (genuinely single-table) |
| bakehouse | 91 | 5 | 39 | 5 (quality-filtered, not regression) |

Root-cause of pre-fix coverage gap: `information_schema.columns` returned 0 for 22 of 24 tpcds_sf1 tables. v0.5.24 added DESCRIBE TABLE fallback — unlocked the full fact-table stack.

### Rule-drop improvements

| Rule | tpcds_sf1 pre | tpcds_sf1 post | healthverity pre | healthverity post |
|---|---|---|---|---|
| R6 DROP (FP) | 50 | 0 (166 INFO) | 5 | 0 (21 INFO) |
| R2 DROP | 36 | ~8 | 13 | 0 |

R6 demoted to INFO (user flag about overfit was valid); R2 gained name-stem fallback for STRING-typed schemas.

### Known remaining gaps

- **L18 multi-table ratio** fails on tpcds_sf1 (6%) and accuweather (0%). Prompt mandate works on small schemas (bakehouse 20%) but doesn't scale as primary-table count grows. Candidate fix: post-generation Q6 rebalance pass that rewrites some single-table UCs as multi-table based on inferred FKs. Not shipped this cycle — requires more sweep data before tuning.
- **L9 duplicate names** on tpcds_sf1 (149 UCs) and accuweather (100 UCs). Large portfolios collide on "Forecast [X] with ..." style names. Candidate fix: Phase Q2 canonical name dedup; currently Q2 uses table+technique signature, not name. Not shipped — would drop valid UCs without more data.
- **L3 subdomain diversity** fails on 3 schemas. Lower priority (INFO severity in Phase L).

These gaps are surfaced as `NEXT_ACTIONS` entries per run so operators can prioritize.

---

## Appendix J — v0.6.0 CI/CD Captain Loop (2026-04-19)

**Context.** Extension of Appendix I. User granted full "captain" authority to run the CI/CD loop autonomously across all sample DBs, prioritizing production-grade UC quality over metric optimization. This appendix documents the operating contract, the fixes applied this cycle, and the handoff state so a fresh LLM can pick up mid-loop without losing context.

### J.1 Captain operating contract

Enforced by memory `project_inspire_north_star.md`. Fresh LLMs must read it before acting.

1. **Run without approval at each step.** No pause for user confirmation on routine fixes, relaunches, commits, or rotation. Only escalate for: multi-run no-progress, architectural decisions, destructive actions (force-push, schema delete, repo wipe).
2. **Cycle through sample DBs.** Order: `samples.tpcds_sf1 → samples.healthverity → samples.nyctaxi → samples.bakehouse → samples.accuweather → samples.tpc_h_benchmark`. Rotate when current DB hits ≥95% production-readiness.
3. **Quality bar.** Every UC in final portfolio must be fundable by a 20-year Principal Business Analyst. Target ~95%+, not ~65%.
4. **Every fix is shared prompt/code.** NEVER dataset-specific. Test mentally against 3 other schemas before shipping (see Appendix C).
5. **Pulse cadence.** 2 min while a run is active. Report progress + errors + warnings from the volume log on each pulse.
6. **Single-digit semver.** 0.5.9 → 0.6.0 → … → 0.9.9 → 1.0.0. No double-digit segments.
7. **2-run test protocol every cycle.** Run 1 Discover → audit portfolio → flag 3 UCs → Run 2 Generate → PBA-grade the 3 Genie instructions (see §3.4 + §4.10).
8. **(v0.7.2+) BoB validation every cycle.** After Run 1 Discover, run the Appendix L.4 verification queries. Confirm: (a) final UC count lands in the **50-100** target zone; (b) `bob_score` is **populated** on every row (`COUNT(bob_score) = COUNT(*)`); (c) `idea_theme` distribution is reasonable (expect ~60-80% of themes to have only 1 UC until a theme-canonicalization pass ships); (d) flag any UC with `bob_score = 2.0` as a **known hard-veto survivor** (see "Known Issues in v0.7.2"). This check is a **BLOCKING** addition to the two-run protocol. Cycles that skip it are invalid.

### J.2 Fix inventory shipped in v0.6.0 work (dev commits `75e1771` → `adc697e` → `1971ee3` → `813293a` → `fix14`)

| Fix | Commit | Target | What it does |
|---|---|---|---|
| Q5 R19 generic-title rejection | `75e1771` | `_phaseQ5_decision_readiness` | Rejects "Increase Customer Value to Grow Revenue" class. Anchored on generic-verb + generic-object + preposition pattern; keeps UCs with specific-signal content (method / phenomenon / metric keyword). Cross-schema test: 11 positive + negative cases. |
| Schema visibility for TECHNICAL | `75e1771` | `all_columns_for_sql` builder | Merges `technical_details` into the schema-for-validation passed to Combined Scoring. Stops the hallucination flagger from rejecting legit joins to classified-out tables (ship_mode, etc.). |
| REFERENCE schema visibility | `dd5ae08` | `_filter_business_tables` | Adds `reference_details` bucket + `self._reference_details_last`; merged into `all_columns_for_sql`. Without this, REFERENCE tables (the common case — 7 of 24 in tpcds_sf1) would still be flagged as hallucinations. |
| Flat demo folder | `adc697e` | `DatabricksInspire.__init__` output-path block | Removed `session_{id}/` subfolder. Each Discover run wipes `base_output_dir` and writes into a flat `notebooks/` + `docs/` layout. |
| Remove useless docs artifacts | `1971ee3` | `_phaseO_persist_run_artifacts` + `generation_log.txt` writer | No-op'd: `next_actions.jsonl`, `manifest.json`, `NEXT_ACTIONS_REPORT.md`, `generation_log.txt`. Users only needed the CSV catalog + per-UC notebooks. |
| AccuWeather backup | `813293a` | `demos/accuweather/` | 125-UC AW run restored to git after over-delete incident. Only DB with git-tracked artifacts so far. |
| Schema-only folder name | `fix14` | `_folder_name` derivation | Drops catalog prefix. `samples.tpcds_sf1` → `tpcds_sf1`. Preserves dots inside schema names if present. |

### J.3 Cross-schema validation — 5 of 5 PASSED

| DB | Session (latest) | UCs | Domains | Phase L | Genie grade (3-UC avg) | Notes |
|---|---|---|---|---|---|---|
| tpcds_sf1 | `123456789000000008` | 289 | 12 | 17/19 | 9.9/10 | Fixes validated end-to-end |
| healthverity | `123456789000000009` | 28 | 5 | **19/19** ✓ | 9.6/10 | First perfect Phase L |
| nyctaxi | `123456789000000010` | 40 | 6 | 18/19 | 9.5/10 | L3 fails (single-table) |
| bakehouse | `123456789000000011` | 42 | 6 | 17/19 | 9.6/10 | L18 multi-table ratio low |
| accuweather | `123456789000000012` | 125 | 9 | 17/19 | 9.7/10 | 12 tables all-primary |

Each produced distinct schema-appropriate techniques (proof of no overfit):
- **Retail (TPC-DS)** → Isolation Forest+LOF, Monte Carlo+Bootstrap, DBSCAN+Moran's I
- **Medical (HV)** → Isolation Forest specialty-normalized on NPI taxonomy
- **Trips (NYC)** → STL+CUSUM+Isolation Forest change-point detection
- **Food (BH)** → Prophet+SARIMA hybrid time-series
- **Weather (AW)** → Wind forecasting, UV safety, humidity-corrosion

### J.4 Known remaining Phase L gaps

- **L3_subdomain_diversity** — fails on 3 of 5 schemas. Smaller DBs (1 table) naturally have limited subdomain spread. Low severity.
- **L18_multi_table_ratio** — fails on tpcds_sf1 (6%) and accuweather (0%). Prompt mandate works on small schemas but doesn't scale. Candidate: post-gen Q6 rebalance pass that rewrites single-table UCs as multi-table via FK graph.
- **L19_production_readiness** — opaque; needs investigation of criteria.
- **L9_no_duplicate_names** — cycle 2 had 3 dup names; cycle 3 passed. Intermittent. Candidate: Phase Q2 name-canonical dedup (currently table+technique signature).

These are logged as `NEXT_ACTIONS` entries per run and tracked in the task list.

### J.5 Resume protocol for a fresh LLM

A new LLM joining mid-cycle should:

1. **Read `~/.claude/projects/<user>/memory/MEMORY.md`** first — north-star goal + single-digit semver + two-run protocol live there.
2. **Check current run state.** `databricks jobs list-runs --job-id <job_id> --active-only --profile <profile>`. The sample-DB job IDs are in §J.7.
3. **Fetch volume logs.** `databricks fs cp dbfs:/Volumes/<catalog>/<schema>/vol_root/logs/<business>/session_<id>/log.log /tmp/<anything>.log` — 60 s flush; authoritative source of truth.
4. **Query the UC table.** `<catalog>.<schema>.__inspire_usecases WHERE session_id=<id>` for portfolio metrics, domain dist, PBA spot-checks. Use warehouse `<warehouse_id>` ("Serverless Starter Warehouse"). Start with the statement-API endpoint (§1.3).
5. **Never cancel a running job** without log-visibility justification. Let it finish; Discover runs take 15–50 min depending on schema size.
6. **Respect memory rules.** Particularly: TECHNICAL-filter is about UC-gen *eligibility only*; classified-out tables remain joinable and must be visible in `all_columns_for_sql`. Overfit to current test schema is zero-tolerance — see Appendix C mental test.

### J.6 Useful queries (for instant portfolio audit)

```sql
-- Portfolio summary per session
SELECT session_id, COUNT(*) ucs, COUNT(DISTINCT business_domain) domains,
       COUNT(DISTINCT primary_table) primary_tables,
       ROUND(AVG(priority_score), 2) avg_score,
       ROUND(MIN(priority_score), 2) min_score
FROM <catalog>.<schema>.__inspire_usecases
GROUP BY session_id
ORDER BY MAX(updated_at) DESC LIMIT 10;

-- 5 random UCs for PBA spot-check (seeded for reproducibility)
SELECT id, business_domain, subdomain, ROUND(priority_score, 2) AS psc, use_case
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = <SESSION_ID>
ORDER BY RAND(42)
LIMIT 5;

-- Flag 3 UCs for Genie Code regeneration
UPDATE <catalog>.<schema>.__inspire_usecases
SET generate_genie_code_instruction = 'Yes'
WHERE session_id = <SESSION_ID> AND id IN ('Nxx-Uyy', 'Nxx-Uyy', 'Nxx-Uyy');

-- Check coverage for previously-blocked tables (validates fix #10 + #11)
SELECT COUNT(*) FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = <SESSION_ID>
  AND (tables_involved LIKE '%ship_mode%'
       OR tables_involved LIKE '%household_demographics%'
       OR tables_involved LIKE '%income_band%');
```

### J.7 Job IDs (<profile> workspace)

```
samples.tpcds_sf1       -> <job_id_tpcds_sf1>
samples.healthverity    -> <job_id_healthverity>
samples.nyctaxi         -> <job_id_nyctaxi>
samples.bakehouse       -> <job_id_bakehouse>
samples.accuweather     -> <job_id_accuweather>
samples.tpc_h_benchmark -> <job_id_tpc_h_benchmark>
samples.bakehouse_cross_table           -> <job_id_bakehouse_cross_table>
samples.accuweather_forecast_provider   -> <job_id_accuweather_forecast_provider>
```

Launch template:
```bash
databricks jobs run-now --profile <profile> --json '{
  "job_id": <JOB_ID>,
  "notebook_params": {
    "14_session_id": "<NEW_OR_EXISTING_SESSION_ID>",
    "15_operation": "Discover Use Cases"
  }
}'
```

Use `"15_operation": "Generate Use Cases"` for Run 2 (after flagging rows with `generate_genie_code_instruction = 'Yes'`).

### J.8 Pulse protocol (user-mandated 2-min cadence)

Each pulse must report:
1. **Run state** — `life_cycle_state`, `result_state`, `run_duration`.
2. **Errors** — `grep -E "ERROR|CRITICAL|FATAL|Exception|failed"` on volume log, excluding `DEBUG` chatter.
3. **Warnings** — `grep -E "WARNING|⚠️"`.
4. **Latest progress** — `Pass 1 complete`, `Pass 2 complete`, `G+Q gates complete`, `Phase L`, `Quality filter`, Scoring-complete-per-domain lines.
5. **Next expected milestone** + schedule next wakeup.

Use `ScheduleWakeup` with `delaySeconds=120` and pass `<<autonomous-loop-dynamic>>` as the prompt to continue the loop.

### J.9 Demo folder layout (post-fix14)

```
inspire-ai/demos/
├── .gitkeep
├── tpcds_sf1/                  (schema name only, no catalog prefix)
│   ├── docs/
│   │   ├── Samples tpcds_sf1-dbx_inspire.csv    (catalog — keep)
│   │   ├── Samples tpcds_sf1-dbx_inspire.json   (UC JSON — keep)
│   │   ├── readme.md     (markdown catalog — keep)
│   │   ├── Samples tpcds_sf1-dbx_inspire.xlsx   (Excel catalog — keep)
│   │   └── Samples tpcds_sf1-dbx_inspire_en.pdf (PDF catalog — keep)
│   └── notebooks/
│       └── <domain>/<subdomain>/Nxx-Uyy - <name>.ipynb
├── healthverity/ ...
└── accuweather/ (only DB with git-tracked run as of this appendix)
```

Fix13 removed: `next_actions.jsonl`, `manifest.json`, `NEXT_ACTIONS_REPORT.md`, `generation_log.txt`. These will NOT re-appear in future runs.

### J.10 EXACT operational playbook — every trick used by this test run

Written so a fresh LLM can reproduce the session *bit-for-bit* without re-discovering anything. If your environment differs, substitute placeholders explicitly.

#### J.10.1 Hard-coded environment constants (<profile> workspace)

```
Databricks profile name       : <profile>
Workspace hostname            : <workspace-host>
Inspire database              : <catalog>.<schema>
Inspire tracking tables       : <catalog>.<schema>.__inspire_usecases
                                <catalog>.<schema>.__inspire_step
                                <catalog>.<schema>.__inspire_session
                                <catalog>.<schema>.__inspire_lock
SQL warehouse ID              : <warehouse_id>   ("Serverless Starter Warehouse")
Workspace repo ID (inspire-ai): <repo_id>
Workspace repo branch         : dev
Volume log root               : dbfs:/Volumes/<catalog>/<schema>/vol_root/logs/
Volume log per-session path   : dbfs:/Volumes/<catalog>/<schema>/vol_root/logs/<BUSINESS>/session_<SESSION_ID>/log.log
Log flush interval            : 60 s
Local scratch directory       : /tmp/inspire-out/   (freely writable; wipe between sessions if needed)
```

The Serverless Starter Warehouse auto-stops when idle. If a `databricks api post /api/2.0/sql/statements` call returns `WAREHOUSE_NOT_FOUND` or times out, start it with:

```bash
databricks warehouses start <warehouse_id> --profile <profile>
```

Give it ~60 s before retrying. First query after start pays the warm-up cost; subsequent queries are fast.

#### J.10.2 Critical memory files that override default behavior

Fresh LLMs must read these BEFORE taking any action. They live under `~/.claude/projects/<user>/memory/`:

- `project_inspire_north_star.md` — the one-and-only goal, captain-mode contract, multi-DB rotation rule, TECHNICAL-filter semantics, overfit-is-forbidden zero-tolerance rule.
- `feedback_two_run_test_protocol.md` — mandatory 2-run pattern (Discover + Generate) with 3-UC Genie spot check.
- `feedback_semver_single_digit.md` — 0.5.9 → 0.6.0 rollover rule.
- `feedback_inspire_session_id.md` — step-table querying (use `result_json:event_at`, not `last_updated`).
- `reference_databricks_run_logs.md` — `databricks jobs get-run-output <run_id>` for driver errors; volume log path.
- `feedback_fixer_not_tester.md` — if you find a bug while testing, patch it in the same pass, don't just report it.
- `feedback_token_refresh.md` — OAuth: never cache statically in long-running apps.

These override anything the code or prior testing appendix suggests.

#### J.10.3 Run-now template (the only launch command you need)

```bash
databricks jobs run-now --profile <profile> --json '{
  "job_id": <job_id_tpcds_sf1>,
  "notebook_params": {
    "14_session_id": "<SESSION_ID>",
    "15_operation": "Discover Use Cases"
  }
}'
```

Generate your `SESSION_ID` as a random 17–18 digit integer (caller-assigned):

```bash
python3 -c "import random; print(random.randint(10**17, 10**18))"
```

**Concurrency cap.** Each job has `max_concurrent_runs = 1`. A second `run-now` while the first is active returns `MAXIMUM_CONCURRENT_RUNS_REACHED`. Use `databricks jobs list-runs --job-id <id> --active-only --profile <profile>` to see what's live.

**Reuse session_id to "restore" a run.** Passing an existing `session_id` to Discover mode wipes `base_output_dir` and regenerates. UC rows in `__inspire_usecases` for that session may get overwritten with similar-but-not-identical UCs (LLM temperature). If you want byte-exact artifacts, export them to local disk *before* relaunching.

**`run_duration` is in milliseconds.** `2137759` means 35.6 min, not seconds. Divide by 60000 for minutes.

#### J.10.4 Log fetch + triage (run every 2 min while a run is active)

```bash
# BUSINESS = "Samples tpcds_sf1" (with space replaced by underscore in path)
BUSINESS=Samples_tpcds_sf1
SESSION=123456789000000008

databricks fs cp \
  dbfs:/Volumes/<catalog>/<schema>/vol_root/logs/$BUSINESS/session_$SESSION/log.log \
  /tmp/inspire-out/$BUSINESS.log --profile <profile> --overwrite

# Errors / warnings (grep out noisy Databricks SDK chatter)
grep -E "ERROR|CRITICAL|FATAL|Exception|failed" /tmp/inspire-out/$BUSINESS.log | grep -v "DEBUG"
grep -E "WARNING|⚠️" /tmp/inspire-out/$BUSINESS.log | grep -v "DEBUG"

# Pipeline milestones
grep -E "Pass 1 complete|Pass 2 complete|PASS 2\\] Batch|Schema-for-validation|clustering|Scoring complete|G\\+Q gates|PHASE 4.5|Phase L|Quality filter|Pipeline completed" \
  /tmp/inspire-out/$BUSINESS.log | grep -v "DEBUG" | tail -10
```

**Always filter out `urllib3`, `databricks.sdk`, `HTTP/1.1`, `POST /api`, `GET /api`** — they quadruple the log size and add no signal.

**60-s flush means "eventually consistent".** A milestone happening now may not appear in the file for up to a minute. Don't panic if the log looks stale.

#### J.10.5 Portfolio audit queries (statement API, no python dependencies)

```bash
# Portfolio summary
databricks api post /api/2.0/sql/statements --profile <profile> --json '{
  "statement": "SELECT COUNT(*) total, COUNT(DISTINCT business_domain) domains, COUNT(DISTINCT primary_table) tables, ROUND(AVG(priority_score),2) avg_score, ROUND(MIN(priority_score),2) min_score FROM <catalog>.<schema>.__inspire_usecases WHERE session_id=<SESSION_ID>",
  "warehouse_id": "<warehouse_id>",
  "wait_timeout": "30s"
}' | python3 -c "import sys,json; d=json.load(sys.stdin); r=d['result']['data_array'][0]; print(f'UCs={r[0]} domains={r[1]} tables={r[2]} avg={r[3]} min={r[4]}')"

# 5 random UCs for PBA spot-check (seed=42 for reproducibility)
databricks api post /api/2.0/sql/statements --profile <profile> --json '{
  "statement": "SELECT id, business_domain, subdomain, ROUND(priority_score,2) psc, use_case FROM <catalog>.<schema>.__inspire_usecases WHERE session_id=<SESSION_ID> ORDER BY RAND(42) LIMIT 5",
  "warehouse_id": "<warehouse_id>",
  "wait_timeout": "30s"
}' | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'{r[0]} | {r[1]}/{r[2]} | {r[3]} | {r[4]}') for r in d.get('result',{}).get('data_array',[])]"
```

**`ORDER BY RAND(42)` is the canonical seed** across all spot-checks this session. Different seeds produce different samples — if a peer LLM's PBA grade differs from yours, confirm both used seed 42.

#### J.10.6 Two-run test protocol (EXACT mechanics)

1. **Launch Run 1 (Discover).** Wait for `life_cycle_state=TERMINATED` + `result_state=SUCCESS`.
2. **Query portfolio.** Summary + 5 random UCs (seed 42).
3. **Pick 3 UCs to PBA-grade.** Rule of thumb:
   - 1 high-score (near top) that uses multiple tables
   - 1 mid-score in a different domain
   - 1 that explicitly references a previously-blocked table (ship_mode, household_demographics, reason — validates fix #10 + #11)
4. **Flag the 3 UCs:**
   ```sql
   UPDATE <catalog>.<schema>.__inspire_usecases
   SET generate_genie_code_instruction = 'Yes'
   WHERE session_id = <SESSION_ID> AND id IN ('Nxx-Uyy', 'Nxx-Uyy', 'Nxx-Uyy');
   ```
5. **Launch Run 2 (Generate Use Cases)** with SAME `session_id`. Genie regeneration takes ~160 s/UC → ~8 min for 3 UCs + ~10 min init = ~18 min total.
6. **Export the 3 notebooks:**
   ```bash
   databricks workspace export \
     "/Users/<user>@<workspace>.com/inspire-ai/demos/<schema>/notebooks/<domain>/<subdomain>/Nxx-Uyy - <name>.ipynb" \
     --profile <profile> --format SOURCE > /tmp/inspire-out/genie/Nxx-Uyy.py
   ```
7. **PBA-grade each (1-10 scale).** Criteria from Appendix F:
   - Primary table + dimension tables clearly listed
   - Enrichment tables with MANDATORY-load declaration
   - Analytical technique family named (not just "ML")
   - `ai_query` contract: model, temperature, `format_string` mandate
   - MLflow experiment registration with `infer_signature`
   - Output columns in 7 categories (business / analytical / data quality / AI-generated / MLflow / metadata / auditability)
   - `CREATE OR REPLACE` forbidden; `MERGE INTO` mandatory
   - Self-critique markdown cell required
   - Job Launcher block verbatim
   - `ZERO-FAILURE` claim for high-confidence UCs
   - Concrete external-data recommendations with accuracy-improvement estimates
8. **Target: each Genie instruction ≥ 9.5/10.** Below that, dig into which of the 11 criteria above is missing.

Average cycle time (5 DBs each running full 2-run test): **~2–4 hours** depending on concurrency and schema size.

#### J.10.7 Git + workspace-repo sync tricks

The workspace repo (`/Users/<user>@<workspace>.com/inspire-ai`, repo ID `<repo_id>`) is the notebook the job runs. To pick up local commits:

```bash
# push from local
git push origin dev

# pull into workspace
databricks api patch /api/2.0/repos/<repo_id> \
  --profile <profile> --json '{"branch":"dev"}'
```

**Conflict trick.** If the workspace has locally-modified notebook files (e.g., you edited one in the workspace, or Databricks auto-saved a tracking-table row), `PATCH` returns `Conflict pulling from remote`. Resolve by:

```bash
# delete the conflicting file in the workspace, then retry
databricks api post /api/2.0/workspace/delete --profile <profile> --json '{
  "path":"/Users/<user>@<workspace>.com/inspire-ai/agent/dbx_inspire_ai_agent.ipynb",
  "recursive":false
}'
databricks api patch /api/2.0/repos/<repo_id> \
  --profile <profile> --json '{"branch":"dev"}'
```

This is destructive to workspace-side edits but safe if your local branch is the source of truth.

**Force-rename via `api patch` to main then back to dev** is not reliable — also returns conflict if any file differs. Prefer the delete-then-pull trick above.

**Branch move API** (`/api/2.0/workspace/move`) is DISABLED on this workspace. Never rely on it.

#### J.10.8 Exporting generated notebooks (the only way to preserve artifacts across destructive ops)

```bash
# Export a full session to local disk
SRC="/Users/<user>@<workspace>.com/inspire-ai/demos/tpcds_sf1"
DEST="/tmp/inspire-out/backup/tpcds_sf1"

databricks workspace export-dir "$SRC" "$DEST" --profile <profile>

# Re-import to different location (or same) as needed
databricks workspace import-dir "$DEST" "$SRC_NEW" --profile <profile> --overwrite
```

**File format.** `.ipynb` in workspace → `.ipynb.py` on disk (Databricks SOURCE format, Python-commented cells). The re-import converts back to `.ipynb`.

**Duplicate filenames bug** (pre-v0.6.0 runs): notebooks were sometimes written twice with two filename variants (`Nxx-Uyy - name.ipynb` AND `Nxx-Uyy-name.ipynb`). The space-hyphen variant is canonical. Remove hyphen-only duplicates from local backup before committing to git:

```bash
find demos/<schema>/notebooks -name "N*-U*-*.ipynb.py" ! -name "N*-U* - *" -delete
```

#### J.10.9 Background tasks + the ScheduleWakeup pattern

Long-running `run-now` launches block this session for 10–20 s before responding. Run them in background:

- If using Claude Code's `Bash` tool with `run_in_background=true`: the output lands in `/private/tmp/claude-.../tasks/<id>.output` and the runtime notifies on completion. Don't poll.
- For wakeup pacing, use `ScheduleWakeup(delaySeconds=120, prompt="<<autonomous-loop-dynamic>>", reason="…")`. This is the ONLY reliable way to pulse every 2 min without burning the prompt cache.

**Cache-window rule:** don't sleep 300 s (worst-of-both — pays the cache miss without amortizing it). Either ≤270 s (stay warm) or ≥1200 s (long idle justified by cost). See `ScheduleWakeup` tool docs.

#### J.10.10 Destructive ops — what NOT to do, ever

- **Never delete a running job's session folder.** The pipeline writes artifacts mid-run; deletion mid-flight produces half-written notebooks.
- **Never delete `__inspire_usecases` rows.** They're append-only by design; dropped rows break the Generate-mode flag → regenerate path.
- **Never cancel a run at <5 min** unless you see zero log output for >2 min. Clusters have spin-up cost; thrashing wastes compute.
- **Never force-push to `main`.** Tags `v0.5.x` are from prior work and should stay.
- **Never skip hooks (`--no-verify`).** The pre-commit secret scan is load-bearing.
- **Never commit `.env` or auth tokens.** `.gitignore` catches common cases; still `git status` before every commit.

#### J.10.11 Scratch-file discipline

Every fix script this session was written to `/tmp/inspire-out/fix<N>_<name>.py` and run via `python3`. Convention:

```
/tmp/inspire-out/
├── fix9_r19_generic_title.py
├── fix10_schema_visibility.py
├── fix11_include_reference.py
├── fix12_folder_layout.py
├── fix13_remove_docs_files.py
├── fix14_schema_only.py
├── current_log.log             (rolling latest volume log)
├── genie/                      (3 Genie exports from cycle 1 tpcds)
├── genie2/                     (3 Genie exports from cycle 2 tpcds)
├── genie3/                     (3 Genie exports from cycle 3 tpcds)
├── genie_hv/                   (HV Genie exports)
├── genie_nyc/                  (NYC Genie exports)
├── genie_bh/                   (BH Genie exports)
└── rename_tmp/                 (pre-rename backup of AW session)
```

Do not commit `/tmp/inspire-out/`. It's scratch.

#### J.10.12 Directly editing the notebook cell[1]

The pipeline is in cell[1] of `agent/dbx_inspire_ai_agent.ipynb`, which is ~2.1 MB and exceeds the Read tool's 256 KB limit. Read/edit it via Python:

```python
import json
NB = "/Users/<user>/inspire-ai/agent/dbx_inspire_ai_agent.ipynb"
nb = json.load(open(NB))
src = "".join(nb["cells"][1]["source"])

# Make your replacement
src = src.replace(OLD, NEW, 1)  # anchor + replacement strings

# Write back
nb["cells"][1]["source"] = [l + "\n" for l in src.split("\n")]
if nb["cells"][1]["source"]:
    nb["cells"][1]["source"][-1] = nb["cells"][1]["source"][-1].rstrip("\n")
json.dump(nb, open(NB, "w"), ensure_ascii=False, indent=1)
open(NB, "a").write("\n")

# ALWAYS verify with ast.parse after editing
import ast
ast.parse("".join(json.load(open(NB))["cells"][1]["source"]))
```

The `ast.parse` check catches 99% of accidental breakage (unterminated strings, indentation errors, unmatched brackets). Never commit without it.

**Anchor-string discipline.** Pick a 3–10 line unique snippet from the current source. Python `str.replace` is exact-match; whitespace matters. Use `assert OLD in src, "anchor missing"` before `replace` to fail loud.

#### J.10.13 Honesty-Report Template (End Of Every Cycle) — v0.7.1 Form

```markdown
## CYCLE <N> HONESTY REPORT — <schema>, session <id>

| Dimension                 | Cycle <N-1> | Cycle <N> | Change |
|---------------------------|-------------|-----------|--------|
| UC count                  | <x>         | <y>       | <+/-%> |
| Domains                   | <x>         | <y>       |        |
| Primary tables            | <x>         | <y>       |        |
| Avg priority score        | <x>         | <y>       |        |
| PBA 5-UC pass rate        | <x/5>       | <y/5>     |        |
| Genie 3-UC avg grade      | <x>         | <y>       |        |
| Phase L pass              | <x/19>      | <y/19>    |        |

**Wins:** <what improved, with evidence>
**Regressions / gaps:** <what got worse or still fails>
**Goal completion estimate:** <%>
**Next actions:** <fixes to apply before cycle N+1>
```

**≥95% → rotate to next DB.** **100% → tag `v0.X.0`, merge dev→main, sync main→dev.** Never tag at <100%.

#### J.10.14 v0.7.2 Cycle Honesty Report Template

Starting in v0.7.2, the honesty report gained **Best-of-Best columns** so reviewers can see whether BoB ran and whether the composite score aligns with the historical priority_score.

```markdown
## v0.7.2 CYCLE <N> HONESTY REPORT — <schema>, session <id>

| Dimension                        | Cycle <N-1> | Cycle <N>   | Change |
|----------------------------------|-------------|-------------|--------|
| UC count (pre-BoB)               | <x>         | <y>         | <+/-%> |
| UC count (post-BoB / final)      | <x>         | <y>         | <+/-%> |
| Target zone hit? (50 ≤ n ≤ 100)  | Y/N         | Y/N         |        |
| Domains                          | <x>         | <y>         |        |
| Primary tables                   | <x>         | <y>         |        |
| `idea_theme` count               | <x>         | <y>         |        |
| Largest theme size               | <x>         | <y>         |        |
| Themes with 1 UC (% of total)    | <x%>        | <y%>        |        |
| Avg priority_score               | <x>         | <y>         |        |
| Avg bob_score                    | n/a         | <y>         |        |
| Avg bob_tier1_score              | n/a         | <y>         |        |
| Avg bob_tier2_score              | n/a         | <y>         |        |
| Avg bob_tier3_score              | n/a         | <y>         |        |
| Hard-veto survivors (bob≤2.0)    | n/a         | <x>         |        |
| PBA 5-UC pass rate               | <x/5>       | <y/5>       |        |
| Genie 3-UC avg grade             | <x>         | <y>         |        |
| Phase L pass                     | <x/19>      | <y/19>      |        |

**BoB validation:**
- [ ] bob_score populated on 100% of surviving rows
- [ ] idea_theme populated on 100% of surviving rows
- [ ] Per-tier scores (tier1, tier2, tier3) all populated
- [ ] Hard-veto survivors enumerated (by id) and documented
- [ ] Theme-level QA: every theme has ≥ 1 UC with bob_score ≥ 6 (see Appendix L.6)

**Wins:** <what improved, with evidence>
**Regressions / gaps:** <what got worse or still fails>
**Goal completion estimate:** <%>
**Next actions:** <fixes to apply before cycle N+1>
```

**≥95% → rotate to next DB.** **100% → tag `v0.X.0`, merge dev→main, sync main→dev.** Never tag at <100%.

#### J.10.15 v0.7.3 Cycle Honesty Report Template (Current)

Starting in v0.7.3, the honesty report adds the **hard-veto count check** (must be 0), the **non-round-portfolio expectation** (in-band `[91, 110]`), the **parallel-Genie-regen timing check**, and the **multi-language filename check**.

```markdown
## v0.7.3 CYCLE <N> HONESTY REPORT — <schema>, session <id>

| Dimension                        | Cycle <N-1> | Cycle <N>   | Change |
|----------------------------------|-------------|-------------|--------|
| UC count (pre-BoB)               | <x>         | <y>         | <+/-%> |
| UC count (post-BoB / final)      | <x>         | <y>         | <+/-%> |
| In jitter band [91, 110]?        | Y/N/n/a     | Y/N/n/a     |        |
| Portfolio is non-round?          | Y/N/n/a     | Y/N/n/a     |        |
| Target zone hit? (50 ≤ n ≤ 110)  | Y/N         | Y/N         |        |
| Domains                          | <x>         | <y>         |        |
| Primary tables                   | <x>         | <y>         |        |
| `idea_theme` count               | <x>         | <y>         |        |
| Largest theme size               | <x>         | <y>         |        |
| Themes with 1 UC (% of total)    | <x%>        | <y%>        |        |
| Avg priority_score               | <x>         | <y>         |        |
| Avg bob_score                    | <x>         | <y>         |        |
| Avg bob_tier1_score              | <x>         | <y>         |        |
| Avg bob_tier2_score              | <x>         | <y>         |        |
| Avg bob_tier3_score              | <x>         | <y>         |        |
| **Hard-veto survivors (bob≤2.01)** | <x>       | **0**       | MUST be 0 |
| PBA 5-UC pass rate               | <x/5>       | <y/5>       |        |
| Genie 3-UC avg grade             | <x>         | <y>         |        |
| Phase L pass                     | <x/19>      | <y/19>      | L12 expected FAIL on BoB runs |
| Route 1/2 Genie regen wall-clock | <x>         | <y>         | Parallel expected |

**v0.7.3 hard-gate checks (all must pass):**
- [ ] **Hard-veto count = 0** (Appendix L.7 / P'.2) — REGRESSION BLOCKER IF NOT 0
- [ ] Portfolio count in `[91, 110]` when BoB triggered (P'.1)
- [ ] bob_score populated on 100% of surviving rows
- [ ] idea_theme populated on 100% of surviving rows
- [ ] Per-tier scores (tier1, tier2, tier3) all populated
- [ ] Route 1/2 Genie regen wall-clock within P'.3 band
- [ ] Multi-language filenames present with `_{lang_abbr}` suffix (if multi-lang) — P'.4

**v0.7.3 soft checks (informational):**
- [ ] Theme-level QA: every theme has ≥ 1 UC with bob_score ≥ 6 (Appendix L.6)
- [ ] Portfolio count is non-round (= suspicious if exactly 100 on BoB run)
- [ ] L12_q3_drop_under_50pct flagged "L12 FAIL (expected — BoB trim)" per O.3

**Wins:** <what improved, with evidence>
**Regressions / gaps:** <what got worse or still fails>
**Goal completion estimate:** <%>
**Next actions:** <fixes to apply before cycle N+1>
```

**≥95% → rotate to next DB.** **100% → tag `v0.X.0`, merge dev→main, sync main→dev.** Never tag at <100%. **Hard-veto-count > 0 on a v0.7.3+ session = regression blocker, cycle fails regardless of %.**

---

With §J.10 you can pick up where this session left off by:
1. Reading `MEMORY.md` entries (listed in §J.10.2)
2. Running `databricks jobs list-runs --job-id <job_id_tpcds_sf1> --active-only` to see what's live
3. Fetching volume log for the active session and triaging per §J.10.4
4. Continuing the CI/CD rotation per §J.1

Nothing else is in my head.

---

## Appendix K — The 19 Quality Gates (v0.7.1 Reference, v0.7.2 Updated For Best-Of-Best)

**Full spec: [`../readme.md#the-19-quality-gates`](../readme.md#the-19-quality-gates).**

Every UC Inspire produces must survive 19 gates. All gates are **LLM-evaluated** — zero regex, zero pattern matching, pure judgment. Use this appendix as the audit checklist when grading a session's portfolio.

### K.0 Important Change In v0.7.2 — Best-Of-Best Scoring Replaces Pure Hard-Veto

Starting in **v0.7.2** the aggressive-vetting path (triggered when the post-G+Q portfolio exceeds `aggressive_prune_threshold`, currently **75**) has been rewritten.

- In **v0.7.1 and earlier**, aggressive vetting was a binary exercise: the pipeline called `_deduplicate_use_cases` which dropped only the semantic-duplicate offenders. Hard-veto gates were binary pass/fail. On `samples.tpcds_sf1` this produced **249 UCs**, far above `target_max=100`.
- In **v0.7.2**, each of the 19 gates is scored on a continuous **0-10** scale by a per-UC pass of `BEST_OF_BEST_SCORING_PROMPT`. The binary HARD VETO is no longer a bit; it is an input to a continuous composite with a hard-veto FLOOR (any gate < 3 caps the UC's total at **2.0**). The stratified trim then selects UCs to land in the **50-100** target zone.

**Practical implication for testers.** When you read the § K.1 gate catalog below, treat the veto column as the **0-10 interpretation**:

| Historical veto label | v0.7.2 interpretation |
|---|---|
| Hard veto (≤ 2.5) | Per-gate score 0-2 → contributes 2.0 cap to `bob_score` |
| Soft veto (≤ 2.5) | Per-gate score 0-2 → heavily penalizes composite; no absolute cap |
| Score reduction | Per-gate score 3-5 → composite drops proportionally |
| (pass) | Per-gate score 6-10 → composite maintained |

See **Appendix L** below for the full Best-of-Best testing playbook, formulae, and validation queries.

### K.1 Gate Catalog

**Tier 1 — Technical Grounding (D1–D11)**

| # | Gate | Question | Veto |
|---|------|----------|------|
| D1 | Causal Signal | Do the data columns directly cause or indicate the outcome? | ≤ 2.5 → Hard veto |
| D2 | Cause-Effect Validity | Is the cause-effect relationship logical, proven, industry-recognized? | ≤ 2.5 → Hard veto |
| D3 | Data Granularity | Is the data at the right level of detail? | ≤ 2.5 → Soft veto |
| D4 | Critical Dimensions | Are all required columns actually present? | Hallucination → Hard veto |
| D5 | Logical Possibility | Can the operation be performed on the given types? | — |
| D6 | Metric Validity | Can the claimed metric actually be calculated? | — |
| D7 | Design–Schema Match | Does the design cite columns that exist? | ≤ 2.5 → Soft veto |
| D8 | Semantic Uniqueness | After verb / noun / entity-metric normalization — is it a duplicate? | ≤ 2.5 → Hard veto |
| D9 | Analytical Depth (Strip Test) | Remove ML-technique mentions — is there real substance left? | ≤ 2.5 → Hard veto |
| D10 | Activation Quality (Action Test) | Does the `Name` start with the owner's action and name the items it picks, with no technique, no "with ..." tail and no value phrase? | ≤ 2.0 → Hard veto |
| D11 | Domain & Technique Balance | Is the portfolio clustered too heavily on one domain+technique? | Score reduction |

**Tier 2 — Business Value (D12–D14)** — *"would you actually fund this?"*

| # | Gate | Persona | Question | Veto |
|---|------|---------|----------|------|
| D12 | Business Relevance & Opportunity | Stakeholder | Is it relevant to day-to-day operations? Does it deliver tangible value (revenue / cost / risk / opportunity)? Can you name the team or role that consumes the output? Is it a current pain or a future opportunity? | Any "no" → Hard veto |
| D13 | Sponsor Test | Sponsor / CFO | Would you fund this use case with a real budget line? Could you pitch it to the CEO without caveats? | Any "no" → Hard veto |
| D14 | Engineering Test | Production Engineer | Can it go to production on existing Databricks capabilities? Can you support and maintain it long-term? Can you fix issues without bespoke infrastructure? | Any "no" → Hard veto |

**Tier 3 — Principal-Business-Analyst (D15–D19)** — the questions a 20-year PBA asks before sign-off

| # | Gate | Question | Veto |
|---|------|----------|------|
| D15 | Decision Cadence Match | Does data refresh speed match decision speed? | "No" → Hard veto |
| D16 | The Monday Test | Would a stakeholder's Monday look different? Must name a concrete action. | "No" → Hard veto |
| D17 | Explainability & Audit Defensibility | Can you explain the output in 5 minutes without proprietary magic? | "No" → Hard veto (high-stakes) |
| D18 | 18-Month Longevity | In 18 months, is this still running or abandoned? | "No" → Hard veto |
| D19 | Attributable Impact | Can the team prove 6 months later that this moved a measurable dollar amount? | "No" → Hard veto |

### K.2 Cycle PBA Spot-Check — the 19 questions

When grading 5 random UCs each cycle, walk the 19 questions per UC. **A UC that fails ANY Tier-2 or D16-D19 question is a fail.** Tally:

```
K.2 PBA Grid — cycle <N>, session <id>

UC#  D12 D13 D14 D15 D16 D17 D18 D19  PASS?
1    ✓   ✓   ✓   ✓   ✓   ✓   ✓   ✓   PASS
2    ✓   ✗   ✓   ✓   ✓   ✓   ✓   ✗   FAIL (no sponsor, no measurable $)
3    ...
4    ...
5    ...

Pass rate: <x/5>.  Target: 5/5 before rotating DB.
```

### K.3 Red-flag phrases (drop on sight during PBA grading)

Zero regex — just LLM / human reading. UCs containing these phrases almost always fail D16 or D19:

- "gain insights into..." → decorative (D16 fail)
- "enhance visibility..." → diffuse impact (D19 fail)
- "raise awareness of..." → no action triggered (D16 fail)
- "support decision-making" → no stakeholder named (D12 fail)
- "detect anomalies" *without* "with investigation queue / playbook / scorecard" → D10 fail (technique, not deliverable)

### K.4 Target-Zone Expectations

| Portfolio size | v0.7.1 Interpretation | v0.7.2 Interpretation | v0.7.3 Interpretation |
|---|---|---|---|
| count < 50 | Recovery triggered — best-scored UCs pulled from rejection pool | Same behavior; recovery pulls from rejected-at-score pool using `bob_score` ranking | Same as v0.7.2 |
| 50 ≤ count ≤ 100 | Sweet spot — no vetting action | Same — BoB does NOT fire in this band | Same as v0.7.2 |
| 75 < count ≤ 100 | Within sweet spot; no action | Same — BoB fires only when count > `aggressive_prune_threshold` (75) AND > `target_max` (100) | Same trigger; output count is NOT clamped to 100 (see below) |
| count > 100 | LLM re-review triggered — D12-D19 lens, "drop if in doubt" | **Best-of-Best fires** — 0-10 per-gate scoring + stratified trim to target 100 (see Appendix L) | **BoB fires with target-max jitter** — trim lands in `[target_max_use_cases + 1, target_max_use_cases + target_max_jitter]`, default `[91, 110]` (see P'.1) |

**Post-vetting ideal (v0.7.1 – v0.7.2):** 75-100 fundable, operable, explainable, durable, measurable UCs.

**Post-vetting ideal (v0.7.3+):** `target_max_use_cases + 1` to `target_max_use_cases + target_max_jitter` UCs, default **[91, 110]**. Portfolio counts will look **non-round** (e.g., 105, 97, 103) — this is deliberate, not a bug. A round count like exactly 100 from a BoB-triggered run is itself a red flag in v0.7.3+.

**v0.7.2 note.** On `samples.tpcds_sf1` the v0.7.2 validation run (session `1234567890000002`) trimmed **244 → 100** UCs, producing **75 themes** with the largest theme (Anomaly Detection) containing 11 UCs. See Appendix L.4 for verification queries.

**v0.7.3 note.** On `samples.tpcds_sf1` the v0.7.3 validation run (session `1234567890000001`) trimmed to **105 UCs** (first-ever non-round BoB result), producing **69 themes** with **0 hard-veto survivors** — demonstrates both the jitter band and the pre-filter fix working in concert.

### K.5 Query: Gate-Veto Distribution For A Session

```sql
-- Distribution of HARD VETO reasons in Combined Scoring results (v0.7.1 and earlier)
SELECT
    result_json:veto_reason::STRING AS veto,
    COUNT(*) AS n
FROM <catalog>.<schema>.__inspire_step
WHERE session_id = :session_id
  AND stage_name = 'Use Case Prioritization'
  AND result_json:quality_score < 2.5
GROUP BY veto
ORDER BY n DESC;
```

This tells you **which gate is firing the most** and whether your prompt needs strengthening or your data is genuinely thin on that axis.

### K.6 v0.7.2 — Per-Gate 0-10 Distribution Query

In v0.7.2 the per-gate output is **score-based**, not veto-based. Use the following to see the distribution across the 19 gates on surviving UCs:

```sql
-- Per-gate 0-10 mean & min across the portfolio (post-BoB)
SELECT
    ROUND(AVG(bob_score), 2)         AS mean_bob,
    ROUND(MIN(bob_score), 2)         AS min_bob,
    ROUND(AVG(bob_tier1_score), 2)   AS mean_tier1,
    ROUND(AVG(bob_tier2_score), 2)   AS mean_tier2,
    ROUND(AVG(bob_tier3_score), 2)   AS mean_tier3,
    COUNT(*)                         AS n_surviving_ucs,
    COUNT_IF(bob_score <= 2.0)       AS hard_veto_survivors
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id;
```

The `hard_veto_survivors` count is **zero in v0.7.3+** (confirmed on all three v0.7.3 validation sessions — see Appendix N.v0.7.3). In v0.7.2 it is typically **2-3** due to the theme-floor overriding the hard-veto cap — now resolved by the pre-filter in `_stratified_trim_by_theme` (see Appendix O.1 and Appendix P'.2).

---

## Appendix L — Best-Of-Best Testing Playbook (v0.7.2+)

Appendix K established WHAT the 19 gates ask. Appendix L tells operators HOW to test that the **Best-of-Best** (BoB) ranking — newly introduced in v0.7.2 — actually selected the right 100 UCs out of the initial 200-300 the agent produced. Use Appendix L every cycle where BoB fires (portfolio count > 75 at the aggressive-prune boundary).

### L.1 What BoB Is And When It Fires

**Best-of-Best** is the v0.7.2 replacement for the aggressive-vetting branch of the quality filter.

**Trigger condition.** BoB fires when — after the G+Q gates and Phase L — the surviving portfolio count exceeds `aggressive_prune_threshold`. Default: **75**. On small DBs (e.g., single-table `nyctaxi`, `healthverity`) the post-G+Q portfolio is usually < 75 and BoB does NOT fire; the pipeline keeps the v0.7.1 behavior of no further trimming.

**Why it exists.** The pre-v0.7.2 path called `_deduplicate_use_cases`, which dropped only exact semantic duplicates. On fat schemas (`tpcds_sf1` with 24 tables) this left **249 UCs** — more than double the `target_max=100`. The old code had no way to pick which 149 to drop beyond crude dedup. BoB provides a principled ranking using the 19 gates.

**Scoring pass.** For every UC in the portfolio, the pipeline runs the `BEST_OF_BEST_SCORING_PROMPT` LLM call. The prompt emits a JSON object with 19 integer scores (0-10), one per gate, plus rationales. These land in `__inspire_usecases` as three new DOUBLE columns — `bob_tier1_score`, `bob_tier2_score`, `bob_tier3_score` — plus the composite `bob_score`. A new STRING column `idea_theme` captures an LLM-assigned 2-4-word thematic label (e.g., "Anomaly Detection", "Demand Forecasting", "Customer Segmentation").

**Trim pass.** After every UC has a score, the stratified-trim algorithm (L.3) selects ~100 survivors with theme diversity preserved.

### L.2 The Composite Formula And Hard-Veto Floor

The composite `bob_score` is computed as a **tier-weighted average** with a **hard-veto floor**:

```
bob_tier1_score   = mean(score_D1, score_D2, ..., score_D11)     # 11 gates
bob_tier2_score   = mean(score_D12, score_D13, score_D14)        #  3 gates
bob_tier3_score   = mean(score_D15, score_D16, ..., score_D19)   #  5 gates

raw_composite     = 0.30 * bob_tier1_score
                  + 0.35 * bob_tier2_score
                  + 0.35 * bob_tier3_score

# Hard-veto floor — if ANY of the 19 per-gate scores is < 3,
# the composite is capped at 2.0 regardless of the raw value.
hard_veto_trip    = any(score_Dx < 3 for x in 1..19)
bob_score         = min(raw_composite, 2.0) if hard_veto_trip else raw_composite
```

**Weight rationale.** Tier-2 (Business Value) and Tier-3 (PBA) together carry 70% of the composite because a UC that is technically sound (Tier 1) but un-fundable (Tier 2) or un-operational (Tier 3) is the most common failure mode. Tier-1 still matters because hallucinated columns or illogical ops produce UCs that cannot be implemented at all.

**Hard-veto floor = 2.0.** Any UC that fails one gate hard lands at `bob_score = 2.0` exactly. During the trim pass these are ranked last within their theme, BUT can still survive via the theme-floor rule (L.3) — see Known Issues.

**Score interpretation bands.**

| `bob_score` | Interpretation |
|---|---|
| 9-10 | Exemplar UC — strong across all tiers, no veto flags |
| 7-9 | Production-ready — may have a minor weakness in one tier |
| 5-7 | Acceptable — survives trim, but not a showpiece |
| 3-5 | Weak — trims first when theme has multiple UCs |
| 2.0 | Hard-veto — failed one gate with score < 3; see Known Issues |
| 0-2 (non-floor) | Should not occur; all three tiers averaged < 6 |

### L.3 Stratified Trim Algorithm Explained

After every UC has a `bob_score` and an `idea_theme`, the trim selects survivors to land at `target_max = 100`:

```
1. Sort all UCs by bob_score DESC.
2. Group by idea_theme.
3. Apply the 15% theme cap:
     theme_cap = max(1, floor(0.15 * target_max))   # e.g., 15 for target=100
   For each theme, keep only the top theme_cap UCs by bob_score.
4. Apply the 1-UC-per-theme FLOOR:
     Every theme with at least one UC retains at least its top-scored UC,
     EVEN IF that UC's bob_score is at the 2.0 hard-veto cap.
   This prevents whole themes from disappearing due to aggressive trimming.
5. Among remaining UCs (post-cap, post-floor), take the top N by bob_score
   until total = target_max.
```

**Why a 15% cap per theme.** Without it, a technique-biased LLM run (e.g., 30 Anomaly Detection UCs) would squeeze out all other themes. 15% of 100 = 15 UCs/theme keeps portfolio diversity.

**Why a 1-UC-per-theme floor.** Without it, tight trimming could wipe out a small-but-legitimate theme (e.g., the only two "Pricing Optimization" UCs both scoring 5.8 would get beaten by a flood of 6.2 "Anomaly Detection" UCs). The floor preserves topical breadth.

**Conflict: floor vs hard-veto.** A theme with ONE UC that happens to be hard-veto-floored at 2.0 will **retain that UC** because the 1-per-theme floor wins. This is the v0.7.2 slip-through bug — see Known Issues and planned v0.7.3 fix.

### L.4 How To Verify BoB Ran Successfully — SQL Queries

Run these after every Discover cycle that triggers BoB. All queries assume the Inspire database is `<catalog>.<schema>` and the session_id is bound to `:session_id`.

**L.4.a — Did BoB run at all?**

```sql
SELECT
    COUNT(*)                                     AS n_rows,
    COUNT(bob_score)                             AS n_scored,
    COUNT(idea_theme)                            AS n_themed,
    COUNT(bob_tier1_score)                       AS n_tier1,
    COUNT(bob_tier2_score)                       AS n_tier2,
    COUNT(bob_tier3_score)                       AS n_tier3
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id;
```

**Pass criterion:** `n_scored == n_rows == n_themed == n_tier1 == n_tier2 == n_tier3`.
**Fail signature:** `n_scored = 0` → BoB didn't run; investigate the aggressive_prune_threshold and whether the portfolio count triggered it.

**L.4.b — Final count in target zone?**

```sql
SELECT COUNT(*) AS final_count
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id;
```

**Pass criterion:** `50 <= final_count <= 100`.
**Fail signature:** `final_count > 100` → trim didn't apply; `final_count < 50` → trim was too aggressive OR recovery fired (see K.4).

**L.4.c — Theme distribution sanity.**

```sql
SELECT
    idea_theme,
    COUNT(*)               AS n_ucs,
    ROUND(AVG(bob_score),2) AS avg_bob,
    ROUND(MAX(bob_score),2) AS max_bob,
    ROUND(MIN(bob_score),2) AS min_bob
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id
GROUP BY idea_theme
ORDER BY n_ucs DESC, avg_bob DESC;
```

**Pass criterion:** No theme has more than `ceil(0.15 * final_count) + 1` UCs. Every theme has at least one UC with `max_bob >= 6` (L.6 strong-anchor rule).
**Fail signature:** A theme exceeds the 15% cap → trim logic bug. A theme has `max_bob < 6` → portfolio has no strong anchor in that theme.

**L.4.d — Tier-weighted composite consistency check.**

```sql
SELECT id, bob_score,
       bob_tier1_score, bob_tier2_score, bob_tier3_score,
       ROUND(0.30*bob_tier1_score + 0.35*bob_tier2_score + 0.35*bob_tier3_score, 2)
           AS computed_composite,
       ROUND(bob_score - (0.30*bob_tier1_score + 0.35*bob_tier2_score + 0.35*bob_tier3_score), 2)
           AS drift
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id
ORDER BY ABS(bob_score - (0.30*bob_tier1_score + 0.35*bob_tier2_score + 0.35*bob_tier3_score)) DESC
LIMIT 20;
```

**Pass criterion:** For non-floored UCs (`bob_score > 2.0`), `drift` should be ~0.00 ± 0.01 (rounding). For floored UCs (`bob_score = 2.0`), the drift equals `raw_composite - 2.0` and is **expected** to be large (the cap IS the drift).
**Fail signature:** Large drift on non-floored rows → formula drift or LLM stored wrong per-tier values.

**L.4.e — Hard-veto survivors enumeration.**

```sql
SELECT id, idea_theme, use_case, bob_score, bob_tier1_score, bob_tier2_score, bob_tier3_score
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id
  AND bob_score <= 2.0
ORDER BY idea_theme, id;
```

**Expected in v0.7.2:** 2-3 survivors, all occupying singleton themes.
**Expected in v0.7.3+:** zero survivors (pre-filter planned).

### L.5 BoB PBA Spot-Check Grid

Appendix K.2 gives a per-UC 8-column Tier-2 + Tier-3 grid (D12-D19 PASS/FAIL). **L.5 extends the grid with the per-gate 0-10 score from BoB**, so an operator can see whether their human PBA grade aligns with the machine grade.

```
L.5 BoB PBA Grid — cycle <N>, session <id>

UC#   D1  D2  D3  D4  D5  D6  D7  D8  D9  D10 D11 D12 D13 D14 D15 D16 D17 D18 D19  composite  bob_score
1     9   9   8   9   9   9   9   8   8   9   7   9   8   9   9   9   8   8   9    8.55       8.55
2     8   8   7   9   9   9   8   9   7   8   7   5   5   9   7   6   8   6   5    6.85       6.85
3     9   9   8   9   9   9   9   8   8   9   7   9   8   9   2   9   8   8   9    (floor)    2.00
4     ...
5     ...

Human PBA grade (1-10, holistic): ___
BoB composite             : ___
Delta (|human - bob|)     : ___         # target: < 1.5 to claim BoB is well-calibrated
```

**How to run it.**

1. Pull the 5 PBA-spot-check UCs with seed 42 (Appendix J.10.5).
2. For each, open the row in `__inspire_usecases` and read off the 19 BoB sub-scores from `bob_tier1_score` / `bob_tier2_score` / `bob_tier3_score` (NOTE: the DB only stores the three tier-averages, not the 19 individual scores — the per-gate breakdown is in the `__inspire_step` table under `stage_name = 'Best of Best Scoring'`).
3. Manually answer each of the 19 questions (K.1) on a 0-10 basis.
4. Compare your grade to BoB's. A disagreement > 2 points on a single gate is a signal that either (a) the BoB prompt is miscalibrated for that gate, or (b) your read of the UC differs from the LLM's.
5. Record the average **|human - bob| delta** across the 5 UCs in the cycle honesty report.

**L.5 calibration target.** Average delta across 5 UCs should be **< 1.5 points**. Deltas > 2.0 suggest the BoB prompt needs another iteration — typically around the concrete gate where humans disagree (often D16 The Monday Test, where LLMs over-credit vague "enable X for the team" phrasing).

**Query: pull the per-gate 19 scores from `__inspire_step`.**

```sql
SELECT
    result_json:uc_id::STRING        AS uc_id,
    result_json:per_gate_scores      AS gate_scores,
    result_json:bob_score::DOUBLE    AS composite,
    result_json:idea_theme::STRING   AS theme
FROM <catalog>.<schema>.__inspire_step
WHERE session_id = :session_id
  AND stage_name = 'Best of Best Scoring'
  AND result_json:uc_id IS NOT NULL
ORDER BY composite DESC;
```

### L.6 Theme-Level QA — Strong-Anchor Rule

A healthy BoB portfolio has at least one **strong UC** (`bob_score >= 6`) in every theme. Themes where the best UC scores below 6 are "weak themes" — they made the trim only because the floor-of-1 rule kept a mediocre UC alive.

**Query: weak themes.**

```sql
SELECT idea_theme,
       COUNT(*)                AS n_ucs,
       ROUND(MAX(bob_score),2) AS max_bob
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id
GROUP BY idea_theme
HAVING MAX(bob_score) < 6.0
ORDER BY max_bob ASC;
```

**Interpretation.**

- **Zero weak themes** — portfolio is coherent; every topic earns its place.
- **1-3 weak themes** — acceptable for wide-schema sessions (tpcds_sf1, accuweather).
- **≥ 4 weak themes** — possible signal the trim is preserving too many niche topics. Consider raising the strong-anchor threshold or tightening L.1 theme-merge.

**Fix path if too many weak themes.** Tighten `BASE_USE_CASE_GEN_PROMPT` to emit fewer fragmentary topics; OR implement a pre-BoB theme-canonicalization pass that merges near-synonyms (see Known Issues "too-granular themes").

### L.7 Hard-Veto Audit Query — Enumerate All bob_score ≤ 2 Survivors

Required every cycle. **In v0.7.3+, expected count is 0** — the pre-filter in `_stratified_trim_by_theme` removes hard-veto UCs before the 1-UC-per-theme floor rule runs. Any non-zero count on a v0.7.3+ session indicates a regression and must block the cycle.

**v0.7.3+ PASS criterion:** `COUNT(*) = 0` for `bob_score <= 2.01` (use 2.01 to catch floating-point drift). **v0.7.2 expected:** 2-3 survivors, all in singleton themes (documented known issue — see O.1).

```sql
SELECT
    id,
    idea_theme,
    SUBSTRING(use_case, 1, 80)  AS use_case_preview,
    bob_score,
    bob_tier1_score,
    bob_tier2_score,
    bob_tier3_score,
    priority_score               -- legacy column for comparison
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id
  AND bob_score <= 2.01
ORDER BY idea_theme;
```

**v0.7.2 workflow.** For each survivor, record the row in a cycle-level audit log and check whether the UC's theme has any OTHER UC in the portfolio. If yes, the slip-through is a trim-logic bug (floor rule fired on a non-singleton theme); if no, the slip-through is the documented v0.7.2 floor-override.

**v0.7.3+ workflow.** Run the query; confirm zero rows; record "hard-veto survivors: 0" in the cycle honesty report (J.10.15). If non-zero, halt the cycle and investigate `_stratified_trim_by_theme` — the pre-filter has regressed.

### L.8 Regression Guard — After Any Pipeline Change

When you ship a pipeline change that touches the BoB code path (prompt, composite formula, trim algorithm), rerun `samples.tpcds_sf1` as the canonical regression fixture and diff against the v0.7.2 baseline:

**v0.7.2 baseline for tpcds_sf1 (session `1234567890000002`):**

| Metric | Baseline | Acceptable band |
|---|---|---|
| pre-BoB UC count | 244 | 200-300 |
| post-BoB UC count | 100 | 95-105 |
| Theme count | 75 | 60-90 |
| Largest theme | Anomaly Detection (11) | ≤ 15 |
| Avg `bob_score` | 6.7 | 6.0-7.5 |
| Hard-veto survivors | 3 | 0-5 (0 after v0.7.3 fix) |
| Themes with only 1 UC | 61 | ≤ 70 |
| Themes with `max_bob` < 6 | see Appendix L.6 | ≤ 3 |

**v0.7.3 baseline for tpcds_sf1 (session `1234567890000001`):**

| Metric | Baseline | Acceptable band |
|---|---|---|
| pre-BoB UC count | ~244 | 200-300 |
| post-BoB UC count | **105** (non-round — jittered) | `[91, 110]` (target_max + 1 to target_max + jitter) |
| Theme count | 69 | 55-85 |
| Avg `bob_score` | ~6.7 | 6.0-7.5 |
| Hard-veto survivors | **0** | **must be 0** (hard gate) |
| Route 1/2 Genie regen runtime | ~30 min | ≤ 45 min (parallel) |

Any metric outside its acceptable band is a **regression candidate** and must be investigated before merging the pipeline change. A band-break in the GOOD direction (e.g., hard-veto survivors dropping to 0) is also worth logging — it might mean a latent issue elsewhere was silently fixed.

**Why tpcds_sf1 is the canonical fixture.** It is the fattest schema in the sample catalog (24 tables, deep FK graph), it reliably produces > 200 UCs pre-trim so BoB always fires, and it has a known trim target (244 → 100) that is stable across temperature draws.

---

## Appendix M — Comparing v0.7.1, v0.7.2, v0.7.3

This appendix provides a side-by-side diff for operators upgrading a running workspace across minor versions. Every column, every metric, every default.

### M.1 Headline Numbers (samples.tpcds_sf1, schema-scope)

| Metric | v0.7.1 | v0.7.2 | v0.7.3 |
|---|---|---|---|
| Final UC count | 258 | 100 | **105** (non-round — jittered) |
| Avg `priority_score` (legacy) | 8.43 | 8.47 | ~8.5 |
| Avg `bob_score` (new) | n/a | 6.70 | ~6.7 |
| `bob_score` populated? | No | Yes (100% of rows) | Yes (100% of rows) |
| `idea_theme` populated? | No | Yes (100% of rows) | Yes (100% of rows) |
| Theme count | n/a | 75 | **69** |
| Largest theme | n/a | Anomaly Detection (11 UCs) | tbd |
| **Hard-veto survivors** | n/a | **3** (known issue L.7) | **0** (resolved — pre-filter) |
| Phase L pass | 17/19 | 17/19 | 17/19 (L12 still fires — O.3) |
| Genie 3-UC avg grade | 9.9 | 9.9 | 9.9 |
| Runtime (Discover) | ~35 min | ~42 min | ~42 min |
| Runtime (Route 1/2 Genie regen, NYC 30 UCs) | ~90 min | ~90 min | **~10-15 min** (parallel) |
| Runtime (Route 1/2 Genie regen, tpcds ~100 UCs) | ~5 hours | ~5 hours | **~30 min** (parallel) |
| Portfolio size deterministic? | yes (258) | yes (100) | **no** (jittered in `[91, 110]`) |

### M.2 Schema Diff — New Columns On `__inspire_usecases`

| Column | Type | Introduced | Purpose |
|---|---|---|---|
| `idea_theme` | STRING | v0.7.2 | LLM-assigned 2-4 word thematic label per UC; drives stratified trim |
| `bob_score` | DOUBLE | v0.7.2 | 0-10 composite of the 19-gate BoB scoring pass |
| `bob_tier1_score` | DOUBLE | v0.7.2 | Mean of per-gate 0-10 scores for D1-D11 (Tier 1 — Technical Grounding) |
| `bob_tier2_score` | DOUBLE | v0.7.2 | Mean for D12-D14 (Tier 2 — Business Value) |
| `bob_tier3_score` | DOUBLE | v0.7.2 | Mean for D15-D19 (Tier 3 — Principal Business Analyst) |

All five columns are NULL for sessions run prior to v0.7.2. v0.7.3 did NOT add new columns — all v0.7.3 changes are behavioral (pre-filter, jitter, parallelism, filename suffix). When querying mixed-version sessions, filter with `WHERE bob_score IS NOT NULL` to isolate v0.7.2+ data.

### M.3 Code-Path Diff

| Component | v0.7.1 | v0.7.2 | v0.7.3 |
|---|---|---|---|
| Aggressive vetting fn | `_deduplicate_use_cases` | `_best_of_best_scoring` + `_stratified_trim` | `_best_of_best_scoring` + `_stratified_trim_by_theme` (pre-filter added) |
| Aggressive vetting trigger | `count > 100` | `count > aggressive_prune_threshold` (75) AND `count > target_max` (100) | Same trigger |
| Output schema | 35 columns | 40 columns (+ 5 BoB columns) | 40 columns (unchanged) |
| LLM prompt for vetting | n/a (pure code) | `BEST_OF_BEST_SCORING_PROMPT` | same |
| Trim mechanism | Drop semantic dupes | Stratified by `idea_theme`, 15% cap, 1-UC floor | Hard-veto pre-filter FIRST, then stratified; target-max jitter applied |
| Hard-veto handling | Binary drop | Floor at 2.0 (survives — bug) | **Removed pre-trim** (fix) |
| Portfolio cap | Unbounded | Fixed 100 | `[target_max + 1, target_max + jitter]`, default `[91, 110]` |
| Route 1/2 Genie regen | Serial | Serial | **Parallel** |
| Excel/Markdown filenames | single-lang only | single-lang only | `_{lang_abbr}` suffix when multi-language |

### M.4 Operator-Facing Behavior Diff

| Behavior | v0.7.1 | v0.7.2 | v0.7.3 |
|---|---|---|---|
| Final count on wide schema | Can exceed 100 unbounded | Always ≤ 100 (except recovery edge) | Jittered in `[target_max + 1, target_max + jitter]` |
| Portfolio theme diversity | Implicit (LLM-driven) | Explicit (stratified by `idea_theme`) | Same as v0.7.2 |
| Hard-veto enforcement | Binary (drop row) | Soft (cap composite at 2.0, trim last) | Pre-filter (hard drop before trim) |
| Hard-veto can survive to final | No | **Yes** (known issue L.7) | **No** (resolved) |
| Operator visibility into scoring | None per-UC | Per-tier scores in DB | Same |
| Multi-language Excel/MD filenames | Overwrite collision | Overwrite collision | Distinct `_{lang_abbr}` files per language |
| Genie regen wall-clock | linear in UC count | linear in UC count | ~parallel (bounded by thread pool) |

### M.5 Upgrade Checklist

Before rotating a workspace from v0.7.1 → v0.7.2:

1. **Schema migration.** Run `ALTER TABLE <catalog>.<schema>.__inspire_usecases ADD COLUMNS (idea_theme STRING, bob_score DOUBLE, bob_tier1_score DOUBLE, bob_tier2_score DOUBLE, bob_tier3_score DOUBLE)` in each workspace's Inspire DB if the table predates v0.7.2. (The pipeline auto-adds on first run, but explicit migration is recommended for observability.)
2. **Reprocess baselines.** The v0.7.1 baseline sessions (e.g., Appendix J.3 table) should NOT be re-run as v0.7.2 baselines — their portfolio was sized differently. Treat v0.7.2 as a new epoch and capture fresh baselines per DB.
3. **Update honesty-report template.** Switch from J.10.13 (v0.7.1 form) to J.10.14 (v0.7.2 form) in cycle reports.
4. **Wire validate_bob.py** (Appendix A.6) into the post-Discover smoke-check suite.

Before rotating a workspace from v0.7.2 → v0.7.3:

1. **No schema migration needed** — v0.7.3 reuses v0.7.2 columns.
2. **Reset baseline expectations.** Portfolio sizes are no longer round (100 → something in `[91, 110]`). Update CI gates that assert `count = 100`.
3. **Update honesty-report template.** Switch from J.10.14 (v0.7.2) to **J.10.15 (v0.7.3)** — adds the hard-veto count check (must be 0) and the non-round-portfolio expectation.
4. **Update regression test for hard-veto.** Change the L.7 audit from "document survivors" to "assert count = 0". Any non-zero count blocks the cycle.
5. **Recalibrate Genie regen timing expectations.** Route 1/2 Genie regen on ~100-UC portfolios drops from ~5 hours to ~30 min. If a run still takes hours, the parallelism is not working — investigate before shipping.
6. **Verify multi-language file suffixes** — if running multi-language, expect `*_{lang_abbr}.xlsx` and `*_{lang_abbr}.md` artifacts in the demo folder (see P'.4).

---

## Appendix N — Reproducing The v0.7.2 Validation Run

This appendix documents the **exact** parameters used to produce the v0.7.2 canonical validation session on `samples.tpcds_sf1`. Any peer LLM should be able to re-execute and obtain statistically equivalent results (modulo LLM temperature variance).

### N.1 Canonical Session Identifiers

```
Business name      : Samples tpcds_sf1 BoB
Session_id         : 1234567890000002
Schema under test  : samples.tpcds_sf1 (Databricks Samples catalog, 24 tables)
Inspire database   : <catalog>.<schema>
Warehouse          : <warehouse_id>   (Serverless Starter Warehouse)
Job ID             : <job_id_tpcds_sf1>    (samples.tpcds_sf1 launcher, see J.7)
Workspace profile  : <profile>
Code version       : v0.7.2 (tag: v0.7.2; commit SHA: captured in release notes)
```

### N.2 Launch Command (Run 1 Discover)

```bash
databricks jobs run-now --profile <profile> --json '{
  "job_id": <job_id_tpcds_sf1>,
  "notebook_params": {
    "00_business_name": "Samples tpcds_sf1 BoB",
    "01_uc_metadata": "samples.tpcds_sf1",
    "02_inspire_database": "<catalog>.<schema>",
    "14_session_id": "1234567890000002",
    "15_operation": "Discover Use Cases",
    "08_generation_instructions": "Treat store_sales, store_returns, web_sales, web_returns, catalog_sales, catalog_returns as pre-joined to customer/item/date_dim via their standard FKs. Prefer subject-360 UCs on customer; prefer trend UCs at the month grain."
  }
}'
```

**Generation-instructions contract.** The hint above is structural (no industry words); 3 sentences; under 300 chars. It follows the §10.2 rules and is the same hint used during the v0.7.2 validation. Do not substitute any other hint — results will diverge.

### N.3 Join Instructions In Full

Expanded form of the `08_generation_instructions` above, for operators who want to understand the reasoning:

1. **Pre-joined fact tables.** `store_sales`, `store_returns`, `web_sales`, `web_returns`, `catalog_sales`, `catalog_returns` all join to `customer`, `item`, and `date_dim` via their standard sales/returns FKs. The hint declares this so Pass 1 UC generation considers multi-table analytics (subject-360 on customer, cross-channel trend) rather than single-table-only UCs.
2. **Subject-360 on customer.** Explicit technique preference — the schema supports enrichment of customer rows with sales behavior across the 3 channels. Without this hint, the agent produces channel-specific UCs but rarely a customer-centric one.
3. **Trend at month grain.** Many fact columns are daily-grain but a stakeholder-useful trend is monthly. Pinning the grain keeps the agent from producing one-UC-per-grain redundancy.

### N.4 Expected Post-Run Artifacts

After the job reaches `TERMINATED / SUCCESS`:

**In `__inspire_usecases`:**
- Exactly 100 rows with `session_id = 1234567890000002` (post-trim; the pre-trim 244-row state is not retained).
- All rows have `bob_score`, `bob_tier1_score`, `bob_tier2_score`, `bob_tier3_score`, `idea_theme` populated.
- Average `bob_score` in the range 6.5-6.9 (canonical: 6.7).
- 75 distinct `idea_theme` values; largest = "Anomaly Detection" with 11 UCs.
- 3 UCs with `bob_score = 2.0` (hard-veto survivors; see L.7).
- 61 themes containing exactly 1 UC (known granularity issue; see "Known Issues in v0.7.2").

**In `__inspire_step`:**
- Rows with `stage_name = 'Best of Best Scoring'` — one per UC scored pre-trim (244 rows).
- A final `stage_name = 'Stratified Trim'` row with the trim summary blob in `result_json`.

**In the demo folder (`demos/tpcds_sf1/`):**
- `docs/Samples tpcds_sf1 BoB-dbx_inspire.csv` — the portfolio catalog.
- `docs/Samples tpcds_sf1 BoB-dbx_inspire.xlsx` — Excel version.
- `docs/readme.md` — Markdown.
- `docs/Samples tpcds_sf1 BoB-dbx_inspire.json` — JSON.
- `docs/Samples tpcds_sf1 BoB-dbx_inspire_en.pdf` — PDF.
- `notebooks/<domain>/<subdomain>/Nxx-Uyy - <name>.ipynb` — 100 skeleton notebooks (one per surviving UC).

### N.5 Validation Commands To Run After The Job Succeeds

```bash
# 1. Confirm BoB columns populated
databricks api post /api/2.0/sql/statements --profile <profile> --json '{
  "statement": "SELECT COUNT(*) total, COUNT(bob_score) scored, COUNT(idea_theme) themed FROM <catalog>.<schema>.__inspire_usecases WHERE session_id = 1234567890000002",
  "warehouse_id": "<warehouse_id>",
  "wait_timeout": "30s"
}'
# Expected: total=100, scored=100, themed=100

# 2. Theme distribution
databricks api post /api/2.0/sql/statements --profile <profile> --json '{
  "statement": "SELECT idea_theme, COUNT(*) n, ROUND(AVG(bob_score),2) avg_bob FROM <catalog>.<schema>.__inspire_usecases WHERE session_id = 1234567890000002 GROUP BY idea_theme ORDER BY n DESC LIMIT 10",
  "warehouse_id": "<warehouse_id>",
  "wait_timeout": "30s"
}'
# Expected top entry: Anomaly Detection, n=11

# 3. Hard-veto survivors
databricks api post /api/2.0/sql/statements --profile <profile> --json '{
  "statement": "SELECT id, idea_theme, bob_score FROM <catalog>.<schema>.__inspire_usecases WHERE session_id = 1234567890000002 AND bob_score <= 2.0",
  "warehouse_id": "<warehouse_id>",
  "wait_timeout": "30s"
}'
# Expected: 3 rows, each in a singleton theme
```

### N.6 Run 2 Generate (BoB Does Not Affect Generate)

BoB is a Discover-side feature. The Run-2 Generate step is unchanged from v0.7.1. For completeness, flag 3 UCs and launch Generate as follows:

```sql
UPDATE <catalog>.<schema>.__inspire_usecases
SET generate_genie_code_instruction = 'Yes'
WHERE session_id = 1234567890000002
  AND id IN (
    (SELECT id FROM <catalog>.<schema>.__inspire_usecases
     WHERE session_id = 1234567890000002
     ORDER BY bob_score DESC LIMIT 1),
    (SELECT id FROM <catalog>.<schema>.__inspire_usecases
     WHERE session_id = 1234567890000002 AND bob_score BETWEEN 6.0 AND 7.0
     ORDER BY RAND(42) LIMIT 1),
    (SELECT id FROM <catalog>.<schema>.__inspire_usecases
     WHERE session_id = 1234567890000002 AND tables_involved LIKE '%ship_mode%'
     LIMIT 1)
  );
```

Then launch Run 2:

```bash
databricks jobs run-now --profile <profile> --json '{
  "job_id": <job_id_tpcds_sf1>,
  "notebook_params": {
    "00_business_name": "Samples tpcds_sf1 BoB",
    "01_uc_metadata": "samples.tpcds_sf1",
    "02_inspire_database": "<catalog>.<schema>",
    "14_session_id": "1234567890000002",
    "15_operation": "Generate Use Cases"
  }
}'
```

Run 2 runtime: ~18 min (3 UCs × ~160 s/UC Genie generation + ~10 min init). PBA-grade the three output notebooks per Appendix J.10.6.

### N.v0.7.3 Reproducing The v0.7.3 Validation Runs

v0.7.3 validation was conducted across three schemas (thin, mid, fat) to exercise the pre-filter fix, target-max jitter, and parallel Genie regen. All three sessions are the canonical v0.7.3 baseline.

#### N.v0.7.3.1 Canonical Session Identifiers

| Schema | Size | Session ID | UCs | BoB Fired? | Hard-veto Survivors | Notes |
|---|---|---|---|---|---|---|
| `samples.nyctaxi` | thin (~5 tables) | `7301073301073001` | **30** | No (count < 75) | 0 (vacuously) | BoB did not trigger — sweet-spot zone |
| HealthVerity (customer sample) | mid | `7302073002073002` | **39** | No (count < 75) | 0 (vacuously) | BoB did not trigger — sweet-spot zone |
| `samples.tpcds_sf1` | fat (24 tables) | `1234567890000001` | **105** | **Yes** | **0** | First-ever non-round BoB result; 69 themes; hard-veto pre-filter verified |

Together, these three sessions cover (a) BoB non-triggering at count < 75, (b) BoB non-triggering in sweet spot, and (c) BoB triggering with jitter + pre-filter on a fat schema.

#### N.v0.7.3.2 Launch Commands (Run 1 Discover)

**NYC taxi (session `7301073301073001`):**

```bash
databricks jobs run-now --profile <profile> --json '{
  "job_id": <job_id_tpcds_sf1>,
  "notebook_params": {
    "00_business_name": "Samples nyctaxi v0.7.3",
    "01_uc_metadata": "samples.nyctaxi",
    "02_inspire_database": "<catalog>.<schema>",
    "14_session_id": "7301073301073001",
    "15_operation": "Discover Use Cases"
  }
}'
```

**HealthVerity (session `7302073002073002`):**

```bash
databricks jobs run-now --profile <profile> --json '{
  "job_id": <job_id_tpcds_sf1>,
  "notebook_params": {
    "00_business_name": "HealthVerity v0.7.3",
    "01_uc_metadata": "<customer catalog>.healthverity",
    "02_inspire_database": "<catalog>.<schema>",
    "14_session_id": "7302073002073002",
    "15_operation": "Discover Use Cases"
  }
}'
```

**tpcds_sf1 (session `1234567890000001`):**

```bash
databricks jobs run-now --profile <profile> --json '{
  "job_id": <job_id_tpcds_sf1>,
  "notebook_params": {
    "00_business_name": "Samples tpcds_sf1 v0.7.3",
    "01_uc_metadata": "samples.tpcds_sf1",
    "02_inspire_database": "<catalog>.<schema>",
    "14_session_id": "1234567890000001",
    "15_operation": "Discover Use Cases",
    "08_generation_instructions": "Treat store_sales, store_returns, web_sales, web_returns, catalog_sales, catalog_returns as pre-joined to customer/item/date_dim via their standard FKs. Prefer subject-360 UCs on customer; prefer trend UCs at the month grain."
  }
}'
```

Identical `08_generation_instructions` hint as the v0.7.2 fat-schema run for direct comparability.

#### N.v0.7.3.3 Expected Post-Run Artifacts

**NYC taxi (30 UCs):**
- `__inspire_usecases`: exactly 30 rows; `bob_score` and `idea_theme` populated on all rows (scoring still runs even when BoB does not trim).
- `__inspire_step`: no `Stratified Trim` row — BoB short-circuited since count < `aggressive_prune_threshold`.
- Demo folder `demos/nyctaxi/docs/` contains single-language artifacts (no `_{lang_abbr}` suffix).

**HealthVerity (39 UCs):**
- Same shape as NYC taxi but with the customer schema metadata.
- No trim occurred; all 39 UCs pass through to Generate stage eligibility.

**tpcds_sf1 (105 UCs):**
- `__inspire_usecases`: **105 rows** (non-round — jittered). Count must fall in `[91, 110]`.
- `__inspire_step`: `Best of Best Scoring` rows (one per pre-trim UC); `Stratified Trim` row with `hard_veto_prefilter_count` populated (new in v0.7.3).
- **Hard-veto survivors: 0.** Verified via L.7 query.
- 69 distinct `idea_theme` values.
- Demo folder: single-language (no `_{lang_abbr}` suffix unless multi-language was selected).

#### N.v0.7.3.4 Validation Commands

```bash
# 1. Hard-veto pre-filter assertion (applies to BoB-triggered session only)
databricks api post /api/2.0/sql/statements --profile <profile> --json '{
  "statement": "SELECT COUNT(*) AS n FROM <catalog>.<schema>.__inspire_usecases WHERE session_id = 1234567890000001 AND bob_score <= 2.01",
  "warehouse_id": "<warehouse_id>",
  "wait_timeout": "30s"
}'
# Expected: n = 0

# 2. Portfolio count jitter assertion
databricks api post /api/2.0/sql/statements --profile <profile> --json '{
  "statement": "SELECT COUNT(*) AS n FROM <catalog>.<schema>.__inspire_usecases WHERE session_id = 1234567890000001",
  "warehouse_id": "<warehouse_id>",
  "wait_timeout": "30s"
}'
# Expected: n IN [91, 110]; canonical = 105

# 3. Theme count
databricks api post /api/2.0/sql/statements --profile <profile> --json '{
  "statement": "SELECT COUNT(DISTINCT idea_theme) AS themes FROM <catalog>.<schema>.__inspire_usecases WHERE session_id = 1234567890000001",
  "warehouse_id": "<warehouse_id>",
  "wait_timeout": "30s"
}'
# Expected: themes IN [55, 85]; canonical = 69

# 4. Sweet-spot non-trigger assertion (NYC)
databricks api post /api/2.0/sql/statements --profile <profile> --json '{
  "statement": "SELECT COUNT(*) AS n FROM <catalog>.<schema>.__inspire_usecases WHERE session_id = 7301073301073001",
  "warehouse_id": "<warehouse_id>",
  "wait_timeout": "30s"
}'
# Expected: n = 30 (BoB not fired)
```

#### N.v0.7.3.5 Run 2 Generate (Parallel Regen Timing)

Route 1/2 Genie regen is now parallel. Expected wall-clock for the three baselines:

| Session | UCs flagged | v0.7.2 baseline | v0.7.3 expected |
|---|---|---|---|
| NYC (30 UCs all flagged) | 30 | ~90 min | **~10-15 min** |
| HealthVerity (39 all flagged) | 39 | ~2 hours | **~15-20 min** |
| tpcds_sf1 (~100 flagged) | ~100 | ~5 hours | **~30 min** |

If a run exceeds 2× the expected wall-clock, halt and investigate — parallel Genie regen may have degraded to serial. Check `__inspire_step` rows for `Genie Generate` stage timestamps; they should overlap significantly (not be strictly sequential).

---

## Appendix O — v0.7.2 Known Issues Resolved In v0.7.3

This appendix tracks the v0.7.2 known-issue inventory against the v0.7.3 fix pass. Each entry records the original symptom, the v0.7.3 resolution status, and the validation query operators should run on a v0.7.3 session to confirm the fix (or the continued workaround).

**Summary status:**

| # | Issue | Status |
|---|---|---|
| O.1 | Hard-Veto Slip-Through Via Theme Floor | **✅ Resolved in v0.7.3** |
| O.2 | Too-Granular Themes — 61 of 75 singletons | **⚠ Partially addressed** (jitter + cap refinement; canonicalization deferred) |
| O.3 | Phase L L12_q3_drop_under_50pct Fires On Intentional Trim | **⏳ Still pending** — planned for v0.7.4+ |
| O.4 | Misc smaller issues (precision, capitalization, runtime) | Mixed — see below |

### O.1 Hard-Veto Slip-Through Via Theme Floor — ✅ RESOLVED IN v0.7.3

**Original symptom.** A UC with `bob_score = 2.0` (hard-veto floor) survived the stratified trim.

**Original root cause.** The 1-UC-per-theme floor rule in `_stratified_trim` preserved the top-scored UC in every theme, regardless of that UC's composite. Singleton-theme hard-veto UCs slipped through.

**v0.7.2 reproducibility.** On session `1234567890000002`, 3 of 100 surviving UCs (3%) were hard-veto-floored, each in a singleton theme.

**v0.7.3 fix.** `_stratified_trim` was renamed `_stratified_trim_by_theme` and given a **hard-veto pre-filter** that runs BEFORE the 15% cap and 1-UC floor. Hard-veto UCs (`bob_score <= 2.0`, equivalently `any(per_gate_score < 3)`) are dropped unconditionally, even if they are the only UC in their theme. The theme is dropped along with them.

**v0.7.3 validation.** On canonical v0.7.3 fat-schema session `1234567890000001` (tpcds_sf1, 105 UCs):

```sql
SELECT COUNT(*) FROM <catalog>.<schema>.__inspire_usecases
WHERE bob_score <= 2.01 AND session_id = 1234567890000001;
-- Expected: 0
```

All v0.7.3 sessions must return **0** from this query. Any non-zero count is a regression blocker.

**Operator workaround (v0.7.2 only).** After every run, execute Appendix L.7 and manually suppress (`UPDATE ... SET generate_genie_code_instruction = 'No'`) any surviving hard-veto UC before the Run 2 Generate pass. **No workaround needed in v0.7.3+.**

### O.2 Too-Granular Themes — 61 Of 75 Themes Have Only 1 UC — ⚠ PARTIALLY ADDRESSED IN v0.7.3

**Original symptom.** After BoB, the `idea_theme` distribution was heavily tail-heavy: most themes contained exactly one UC. On v0.7.2 session `1234567890000002`, 61 of 75 themes (81%) had `COUNT(*) = 1`.

**Original root cause.** The `BEST_OF_BEST_SCORING_PROMPT` asks the LLM to emit a 2-4 word thematic label without a canonicalization pass to merge synonyms.

**v0.7.3 partial resolution.** v0.7.3 did NOT add theme canonicalization. However, the **target-max jitter** (new in v0.7.3) combined with the pre-filter from O.1 refines the cap-and-floor interaction: hard-veto singletons are no longer force-preserved, and the jittered cap allows 5-10 extra UCs to survive in non-singleton themes instead of being forcibly dropped to hit a round 100. On the v0.7.3 tpcds_sf1 run, theme count dropped from 75 → 69 and singleton-theme ratio dropped modestly (exact % measured per-run; still above 50% on fat schemas).

**Still pending.** Full theme canonicalization is deferred to v0.7.4+. The LLM mapping pass (raw_theme → canonical_theme) remains unshipped.

**v0.7.3 reproducibility.** Every v0.7.3 BoB-triggering run on a fat schema still shows 50-70% singleton themes. Improvement over v0.7.2 is real but modest.

**Operator workaround (still valid in v0.7.3).** Treat `idea_theme` as advisory, not load-bearing. When reporting portfolio diversity, count distinct `business_domain` values (legacy column), not distinct `idea_theme`.

### O.3 Phase L L12_q3_drop_under_50pct Flag Fires When 244 → 100 Trim Occurs — ⏳ STILL PENDING IN v0.7.3

**Symptom.** Phase L gate L12 (`q3_drop_under_50pct`) reports FAIL because the quality filter dropped > 50% of UCs during BoB trim.

**Status in v0.7.3.** L12 was **not retuned** in v0.7.3. The fix is deferred to v0.7.4+. All three v0.7.3 validation sessions where BoB fires (tpcds_sf1 at minimum) still show L12 FAIL in the Phase L report.

**Root cause (unchanged).** L12 was designed in v0.6.x for Quality-filter drops > 50% as a prompt-instability indicator. v0.7.2 and v0.7.3 both treat > 50% drop as **intentional** during BoB. The gate threshold has not been retuned and no BoB-aware carve-out has been added.

**Reproducibility in v0.7.3.** Session `1234567890000001` shows L12 FAIL. Thin-schema sessions (NYC, HealthVerity) do NOT show L12 FAIL because BoB does not trigger.

**Downstream impact (unchanged).** Non-blocking (INFO severity), but creates misleading "17/19 pass" vs "19/19 pass" noise in cycle reports.

**Planned fix (v0.7.4+).** Change threshold from `> 50% drop` to `> 75% drop`, AND add a carve-out that suppresses L12 entirely when BoB fired (detect via `bob_score IS NOT NULL`).

**Operator workaround (still valid in v0.7.3).** When recording Phase L results in the cycle honesty report, note "L12 FAIL (expected — BoB trim)" to prevent peer-LLM confusion.

### O.4 Miscellaneous Smaller Issues — Mixed Status In v0.7.3

- **No per-gate persistence in `__inspire_usecases`.** UNCHANGED in v0.7.3 — still must query `__inspire_step` for 19 individual scores. Planned fix v0.8.x.
- **`bob_score` DOUBLE precision quirks.** UNCHANGED — still use `ROUND(bob_score, 2)` in display queries.
- **Theme labels inherit LLM capitalization.** UNCHANGED — canonicalization pass still deferred (see O.2).
- **Runtime +7 min vs v0.7.1 from BoB scoring pass.** UNCHANGED in Discover. HOWEVER — Route 1/2 Genie regen in Generate is now **parallel in v0.7.3** (was serial in v0.7.2), cutting ~5 hours on tpcds_sf1 down to ~30 min. See Appendix M.4 and P'.3.

---

## Appendix P — Validation-Script Index (v0.7.2)

Cross-reference of every validator script mentioned in this guide, their Appendix-A location, and when to run them.

| Script | Appendix | Input | When to run |
|---|---|---|---|
| `validate_uc_grounding.py` | A.1 | exported UC CSV + scope | After every Discover |
| `validate_dedup.py` | A.2 | exported UC CSV | After every Discover |
| `validate_relevance.py` | A.3 | exported UC CSV | After every Discover |
| `validate_recall.py` | A.4 | exported UC CSV | After every Discover (wide-schema focus) |
| `validate_constructs.py` | A.5 | exported UC CSV | After every Discover |
| `validate_bob.py` | A.6 | session_id + profile + warehouse + db | After every Discover that triggers BoB (v0.7.2+) |
| `audit.py` | A.7 | SQL-API genie-rows JSON + schema cols | After every Generate |

**Smoke-check batch for v0.7.2.**

```bash
# Where CSV = exported portfolio, SCOPE = catalog.schema
python3 /tmp/validate_uc_grounding.py "$CSV" "$PROFILE" "$WAREHOUSE" "$SCOPE"
python3 /tmp/validate_dedup.py        "$CSV"
python3 /tmp/validate_relevance.py    "$CSV"
python3 /tmp/validate_recall.py       "$CSV"
python3 /tmp/validate_constructs.py   "$CSV"
python3 /tmp/validate_bob.py          "$SESSION" "$PROFILE" "$WAREHOUSE" "$INSPIRE_DB"
```

Exit-code 0 across all six = green for the cycle. Any non-zero = investigate before advancing.

---

## Appendix P' — v0.7.3 Validation Playbook

This appendix covers the four v0.7.3-specific behaviors testers must validate every cycle. It complements Appendix L (BoB Playbook) and Appendix N (v0.7.2 + v0.7.3 reproducer) — P' is a checklist with expected values, not a narrative.

### P'.1 Expected Non-Round Portfolio Sizes

**What changed.** v0.7.3 introduces `target_max_jitter` (default 10), making the final BoB portfolio count land anywhere in `[target_max_use_cases + 1, target_max_use_cases + target_max_jitter]`. With defaults, this is **`[91, 110]`**.

**Why.** A round-count portfolio (always 100) is suspicious: it reveals to the end-user that a hard cap was applied, which leaks implementation detail and can imply arbitrariness. A jittered count lands naturally and is consistent with how a human analyst would say "about 100."

**Validation query (v0.7.3 BoB-triggered session):**

```sql
SELECT COUNT(*) AS final_count
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id;
-- Expected: final_count IN [91, 110]
-- Regression flag: final_count = 100 exactly is suspicious (may indicate jitter did not apply)
-- Regression flag: final_count > 110 or < 91 is out-of-band
```

**Notes.**
- When BoB does NOT trigger (count ≤ 75 pre-trim), the jitter does not apply — count is the natural UC count produced by Pass-1 + Pass-2 (e.g., NYC 30, HealthVerity 39 in the v0.7.3 baselines).
- If `target_max_use_cases` or `target_max_jitter` is overridden in `notebook_params`, adjust the expected band accordingly.
- Historical rows (v0.7.2 sessions) will always show exactly 100 — do not compare a v0.7.3 session against a v0.7.2 count without accounting for the band.

### P'.2 Expected 0 Hard-Veto Survivors

**What changed.** v0.7.3's `_stratified_trim_by_theme` runs a hard-veto pre-filter BEFORE the stratified trim, dropping any UC with `bob_score <= 2.0` unconditionally. This resolves v0.7.2 known issue O.1.

**Validation query (EVERY v0.7.3 session, not just BoB-triggered):**

```sql
SELECT COUNT(*) AS hard_veto_survivors
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :session_id
  AND bob_score <= 2.01;   -- 2.01 to absorb floating-point drift
-- Expected: hard_veto_survivors = 0
-- Regression blocker: hard_veto_survivors > 0 on any v0.7.3+ session
```

**Enforcement.** This is a hard gate — treat any non-zero result as a regression blocker. Halt the cycle, investigate `_stratified_trim_by_theme`, and report to dev before proceeding.

**Why vacuously 0 on thin schemas.** On NYC (30 UCs) and HealthVerity (39 UCs), BoB does not trigger. The pre-filter is still applied but has nothing to filter because the scoring pass is calibrated so that UCs rarely score below 3 on all gates. Even on thin schemas, any non-zero count is a red flag.

### P'.3 Parallel Genie Regen — Cycle Timing Expectations

**What changed.** Route 1/2 Genie regen in the Generate stage is now parallel (v0.7.2 was serial). Thread-pool size is bounded by the cluster config but typically ~10-20 concurrent Genie calls.

**Expected cycle wall-clock:**

| Cycle artifact | UC count flagged | v0.7.2 (serial) | v0.7.3 (parallel) | Acceptable v0.7.3 band |
|---|---|---|---|---|
| NYC (30 UCs all flagged) | 30 | ~90 min | **~10-15 min** | ≤ 25 min |
| HealthVerity (39 flagged) | 39 | ~2 hours | ~15-20 min | ≤ 30 min |
| tpcds_sf1 (~100 flagged) | ~100 | ~5 hours | **~30 min** | ≤ 60 min |

**How to verify.** After the Run 2 Generate job terminates, fetch the `__inspire_step` rows for `stage_name = 'Genie Generate'`. In v0.7.2 these were strictly sequential — each row's `event_at` ≥ previous row's `event_at + ~160s`. In v0.7.3 they should **overlap** significantly — multiple rows with `event_at` within the same minute. If all rows are still sequential, parallelism is not active.

**Regression triage.** If Genie regen takes > 2× the "acceptable v0.7.3 band" above:
1. Check cluster config for thread-pool reduction.
2. Check `__inspire_step` for sequential timestamps (indicates fallback to serial).
3. Check for rate-limiting errors in the Databricks run logs (`databricks jobs get-run-output`).

### P'.4 Multi-Language Filename Verification

**What changed.** v0.7.3 fixes a filename collision bug where Excel + Markdown artifacts would overwrite each other when the Generate stage was run in multiple languages. v0.7.3 appends a language suffix: `_{lang_abbr}.xlsx` and `_{lang_abbr}.md`.

**Single-language runs** (most common): no suffix is appended; files look like `<business_name>-dbx_inspire.xlsx`. This matches v0.7.2 behavior.

**Multi-language runs** (e.g., `en`, `es`, `fr`): each language produces a distinct file:
- `<business_name>-dbx_inspire_en.xlsx`
- `<business_name>-dbx_inspire_es.xlsx`
- `<business_name>-dbx_inspire_fr.xlsx`

And similarly for `.md`:
- `<business_name>-dbx_inspire_en.md`
- `<business_name>-dbx_inspire_es.md`
- `<business_name>-dbx_inspire_fr.md`

**Validation (multi-language runs only).**

```bash
# List demo folder; expect one file per (format, language) pair
databricks workspace list --profile <profile> \
  /Workspace/Users/<user>/inspire/demos/<schema>/docs/
# Expected files for en+es+fr run:
#   <business_name>-dbx_inspire_en.xlsx
#   <business_name>-dbx_inspire_es.xlsx
#   <business_name>-dbx_inspire_fr.xlsx
#   <business_name>-dbx_inspire_en.md
#   <business_name>-dbx_inspire_es.md
#   <business_name>-dbx_inspire_fr.md
#   (plus PDFs per language — already had _{lang_abbr} suffix in v0.7.2)
```

**Regression flag.** If you ran multi-language and see only one `.xlsx` or `.md` file (without language suffix), the fix did not apply — the earlier language has been overwritten by a later one. Halt the cycle.

**Single-language regression flag.** If a single-language run produces an `_{lang_abbr}` suffix unexpectedly, dev has introduced a suffix-always branch — verify against the intent before shipping. PDFs are the reference for "always suffixed" behavior; xlsx/md should only suffix when multi-language.

## Appendix Q — v0.7.3 Operational Runbook

This appendix captures the concrete operational knowledge another agent needs to reproduce the v0.7.3 validation cycle end-to-end. Appendices A–P' document the what/why; this one documents the how, with exact CLI, SQL, and constants.

### Q.1 — Environment Constants

```
Databricks CLI profile:     <profile>
Workspace repo ID:          <repo_id>
Inspire job ID:             <job_id_tpcds_sf1> (name: dbx_inspire_ai_samples_tpcds_sf1)
SQL warehouse ID:           <warehouse_id> (Serverless Starter Warehouse)
Inspire database:           <catalog>.<schema>
Volume log path format:     dbfs:/Volumes/<catalog>/<schema>/vol_root/logs/<Business_Name_Snake>/session_<id>/log.log
Workspace demos base path:  /Users/<user>@<workspace>.com/inspire-ai/demos/<biz>
```

All of these constants appear throughout this file in earlier appendices; this section is the single-source cheat sheet.

### Q.2 — Launching a Discover Run (template)

Inspire's job expects 11 `notebook_params`. Example for `tpcds_sf1` with the canonical join instructions:

```bash
databricks jobs run-now --profile <profile> --json '{
  "job_id": <job_id_tpcds_sf1>,
  "notebook_params": {
    "operation": "Discover Use Cases",
    "business_name": "TPC-DS SF1 Retail",
    "business_description": "TPC-DS SF1 retail benchmark dataset covering store, catalog, and web sales with customer demographics, promotions, and inventory.",
    "database_name": "samples.tpcds_sf1",
    "language": "en",
    "target_use_cases": "75",
    "persona_list": "CEO, CFO, VP of Sales, VP of Marketing, VP of Supply Chain, Head of Merchandising, Head of Customer Analytics, Head of Inventory",
    "genie_code_instructions": "Always join through the surrogate date key (d_date_sk) from date_dim for any time-based filter. For customer-centric metrics join through c_customer_sk. Use ss_item_sk / cs_item_sk / ws_item_sk for item joins. Prefer date_dim filters over raw ss_sold_date_sk when expressing calendar ranges.",
    "additional_instructions": "",
    "genie_regen_parallelism": "10",
    "dry_run": "false",
    "debug": "false"
  }
}'
```

The response returns `{"run_id": ...}`. Capture it — every subsequent pulse/cancel/query needs it.

### Q.3 — Launching a Generate (Genie) Run

Route 1 generation is DB-flag driven. Two steps:

**(a) Flag UCs via SQL.** Set the `regenerate_genie_code` flag on every UC that should be regenerated (typically: all of them for a fresh Generate pass).

```sql
UPDATE <catalog>.<schema>.__inspire_usecases
SET regenerate_genie_code = TRUE
WHERE session_id = :sid;
```

Run against warehouse `<warehouse_id>` (or via `databricks api post /api/2.0/sql/statements`).

**(b) Launch the Generate operation.** Reuse `job_id = <job_id_tpcds_sf1>` with `operation = "Generate Use Cases"`:

```bash
databricks jobs run-now --profile <profile> --json '{
  "job_id": <job_id_tpcds_sf1>,
  "notebook_params": {
    "operation": "Generate Use Cases",
    "business_name": "TPC-DS SF1 Retail",
    "business_description": "TPC-DS SF1 retail benchmark dataset covering store, catalog, and web sales with customer demographics, promotions, and inventory.",
    "database_name": "samples.tpcds_sf1",
    "language": "en",
    "target_use_cases": "75",
    "persona_list": "CEO, CFO, VP of Sales, VP of Marketing, VP of Supply Chain, Head of Merchandising, Head of Customer Analytics, Head of Inventory",
    "genie_code_instructions": "Always join through the surrogate date key (d_date_sk) from date_dim for any time-based filter. For customer-centric metrics join through c_customer_sk.",
    "additional_instructions": "",
    "genie_regen_parallelism": "10",
    "dry_run": "false",
    "debug": "false"
  }
}'
```

The notebook picks up every UC with `regenerate_genie_code = TRUE` for the target `session_id` (resolved from `business_name`) and regenerates their notebooks in parallel.

### Q.4 — Pulsing a Running Job

Commands in order — do all three on every pulse:

**1. Run state.**

```bash
databricks jobs get-run <run_id> --profile <profile> | grep -E '"life_cycle_state"|"run_duration"'
```

**2. Log tail.**

```bash
databricks fs cp dbfs:/Volumes/<catalog>/<schema>/vol_root/logs/<Business_Name_Snake>/session_<id>/log.log /tmp/x.log --overwrite --profile <profile>
tail -200 /tmp/x.log
```

**3. Phase markers to grep for** (Discover flow):

| Marker | Meaning |
|---|---|
| `pre-deduplication` | Phase 1 raw candidate count emitted |
| `Phase 1 complete:` | Dedup done, moving to enrichment |
| `Quality filter [Balanced]` | Phase 2 quality pass active |
| `BEST-OF-BEST` | Phase 3 BoB triggered (portfolio ≥ 75) |
| `Hard-veto pre-filter` | BoB hard-veto stage dropping bob_score ≤ 2.01 |
| `Stratified trim` | BoB stratified trim to final target |
| `Phase L final-gate` | 19-gate final validation |
| `🏁` | Run finished (look for this before declaring success) |

**4. Route 1 Genie progress.**

```bash
# Started (per UC):
grep 'Route 1 — DB flag.*Regenerating' /tmp/x.log | wc -l
# Finished (per UC):
grep 'regenerated and notebook written' /tmp/x.log | wc -l
```

When the finished count equals the flagged count, the Generate run is effectively done — the trailing Summary step may still be running.

### Q.5 — Cancelling a Stuck Run

```bash
databricks jobs cancel-run <run_id> --profile <profile>
```

**When to cancel.** If a run is stuck in Summary generation for 30+ minutes with no log progress (no new lines in the tail, no new `🏁` marker), cancel it. The artifacts through Phase 4 (Excel, CSV, skeleton notebooks, DB rows) are already persisted by the time Summary starts — you do not lose the run by cancelling.

Verify artifacts survived the cancel with Q.8.1 and the `databricks workspace list` on the demos docs folder.

### Q.6 — Raising Job Concurrency

Databricks jobs default to `max_concurrent_runs = 1`, which blocks parallel launches across databases. To run NYC + HV + TPCDS in parallel:

```bash
databricks jobs update --profile <profile> --json '{
  "job_id": <job_id_tpcds_sf1>,
  "new_settings": {"max_concurrent_runs": 3}
}'
```

Verify:

```bash
databricks api get "/api/2.1/jobs/get" --profile <profile> --json '{"job_id": <job_id_tpcds_sf1>}' | grep max_concurrent_runs
```

Reset to 1 when validation is done if parallel runs are not the norm.

### Q.7 — Workspace Repos Sync Gotcha (critical)

`databricks repos update ... --branch X` **silently fails** on conflicts. Symptoms:

- Command returns a Request ID but no "switched to branch X" confirmation in stdout.
- Subsequent `databricks api get /api/2.0/repos/<id>` still shows the old branch / old head_commit_id.
- No non-zero exit code, no stderr.

**Cause.** The workspace has files (typically run-generated artifacts under `demos/*/docs/`) that differ from the target branch's tree. Databricks refuses to overwrite them and returns success anyway.

**Resolution.** Delete the conflicting files from the workspace first, then retry the switch:

```bash
databricks workspace delete "/Users/<user>@<workspace>.com/inspire-ai/demos/<biz>/docs/<conflicting_file>" --profile <profile>
databricks repos update <repo_id> --branch main --profile <profile>
```

After the retry, confirm the switch landed:

```bash
databricks api get "/api/2.0/repos/<repo_id>" --profile <profile> | grep -E '"branch"|"head_commit_id"'
```

### Q.8 — Validation SQL Queries (v0.7.3 Baseline)

All queries run against warehouse `<warehouse_id>` on `<catalog>.<schema>`. Substitute `:sid` with the session_id from the run.

**Q.8.1 — Portfolio summary per session.**

```sql
SELECT session_id, COUNT(*) n, COUNT(DISTINCT business_domain) domains,
       COUNT(DISTINCT idea_theme) themes,
       ROUND(AVG(priority_score),2) avg_priority,
       ROUND(AVG(bob_score),2) avg_bob,
       ROUND(MIN(bob_score),2) min_bob,
       SUM(CASE WHEN bob_score <= 2.01 THEN 1 ELSE 0 END) hard_veto_survivors
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :sid
GROUP BY session_id;
```

**Expected v0.7.3:** `hard_veto_survivors = 0`. Any non-zero value is a regression of the hard-veto pre-filter (see Appendix tracking bug #71).

**Q.8.2 — BoB decile distribution.**

```sql
SELECT FLOOR(bob_score) decile, COUNT(*) n
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :sid
GROUP BY FLOOR(bob_score)
ORDER BY decile;
```

Expect ≥ 3 distinct deciles for a healthy run — a single-bucket spread means the BoB scorer collapsed and should be investigated.

**Q.8.3 — Theme size distribution.**

```sql
SELECT n AS bucket, COUNT(*) themes_with_n_ucs
FROM (
  SELECT idea_theme, COUNT(*) n
  FROM <catalog>.<schema>.__inspire_usecases
  WHERE session_id = :sid
  GROUP BY idea_theme
)
GROUP BY n
ORDER BY n DESC;
```

**v0.7.3 expectation:** most themes have 1 UC. This is a known soft issue (theme consolidation is weak), **not a release blocker**. Tracked separately.

**Q.8.4 — Top-N by bob_score (PBA spot-check).**

```sql
SELECT id, business_domain, idea_theme, ROUND(bob_score,2) bob, use_case
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :sid
ORDER BY bob_score DESC LIMIT 10;
```

Feed these 10 into a PBA checklist pass (Appendix D / Captain contract).

**Q.8.5 — Bottom-N by bob_score (regression check).**

```sql
SELECT id, business_domain, idea_theme, ROUND(bob_score,2) bob, use_case
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :sid
ORDER BY bob_score ASC LIMIT 10;
```

Confirm `min(bob_score) ≥ 3` (no hard-veto survivors) and that the bottom UCs are **weak-but-defensible**, not hallucinated. A UC that references columns/tables the DB does not have is a regression of the L-series gates.

**Q.8.6 — has_genie_code coverage per session.**

After a Route 1 Generate run, verify every flagged UC was regenerated:

```sql
SELECT has_genie_code, COUNT(*) n
FROM <catalog>.<schema>.__inspire_usecases
WHERE session_id = :sid
GROUP BY has_genie_code;
```

**Expected:** 100% `has_genie_code = 'Yes'`. Anything else means Route 1 skipped or silently failed — check `regenerated and notebook written` log count against flagged count.

### Q.9 — v0.7.3 Canonical Sessions for Diffing

| DB | Session ID | UCs | Domains | BoB triggered? |
|---|---|---|---|---|
| nyctaxi | 7301073301073001 | 30 | 6 | No (below 75) |
| healthverity | 7302073002073002 | 39 | 6 | No (below 75) |
| tpcds_sf1 | 1234567890000001 | 105 | 8 | **Yes** (hard-veto pre-filter dropped 13) |

Use these as the v0.7.3 regression baseline. Any future run against the same DBs should not regress below these numbers (UC count, domain count) or above these numbers in ways that indicate gate failure (bob_score floor < 3, hard_veto_survivors > 0).

### Q.10 — Genie Regen Parallelism Tuning

Default `genie_regen_parallelism = 10`. Measured timings at parallelism=10:

| DB | UCs | Time @ p=10 | Baseline (v0.7.2 sequential) |
|---|---|---|---|
| nyctaxi | 30 | ~10–15 min | ~90 min |
| healthverity | 39 | ~15–20 min | ~120 min |
| tpcds_sf1 | 105 | **74 min measured** (run `123456789000013`) | N/A (never ran sequentially) |

**Tuning guidance.**

- Bump to **15–20** if the `ai_query` endpoint has headroom (no 429s in the log).
- Drop to **5** if rate-limited or if you see `TooManyRequestsException` in the Genie regen log section.
- Do not exceed 20 without checking workspace-level `ai_query` concurrency caps.

### Q.11 — Workspace Re-export / Demos Regen

When workspace demo artifacts are newer than git (a new run wrote newer `docs/` files and you want to pull them back into the repo):

```bash
databricks workspace export-dir \
  "/Users/<user>@<workspace>.com/inspire-ai/demos/<biz>" \
  "/tmp/demos_v073/<biz>" \
  --profile <profile>
```

The export often pulls both the full Genie notebook **and** a stale no-space skeleton variant for each UC. Clean the skeletons with:

```python
import re, glob, os
pattern = re.compile(r'/N\d+-U\d+-[a-z]')  # UC ID with NO space after U## = stale skeleton
for f in glob.glob(f"{root}/**/*.py", recursive=True):
    if pattern.search(f):
        os.remove(f)
```

**Expected counts after cleanup** (matches Q.9 sessions):

- nyctaxi: 30
- healthverity: 39
- tpcds_sf1: 105

The heuristic: UC ID format with **NO space** after `U##` is the stale skeleton from Phase 4; UC ID format **with a space** is the full Genie notebook from Route 1. Keep the latter.

### Q.12 — Moving a Tag (when a release needs to include post-tag commits)

```bash
git tag -d v0.7.3
git push origin --delete v0.7.3
git tag -a v0.7.3 -m "v0.7.3: hard-veto pre-filter + parallel Route 1 Genie regen"
git push origin v0.7.3
```

**Policy.** Only move a tag in **pre-1.0** versions, and only before external consumers have pulled it. Once external pulls exist (or once post-1.0), create a new tag instead (`v0.7.3.1`, `v0.7.4`, etc.).

### Q.13 — End-to-End v0.7.3 Reproducer Checklist

Step-by-step from a fresh workspace to a fully validated release:

1. **Push code to `dev`** (git push from local to origin).
2. **Sync workspace repo to `dev`:**
   ```bash
   databricks repos update <repo_id> --branch dev --profile <profile>
   ```
   Verify the head_commit_id moved (Q.7). If it did not, resolve conflicts and retry.
3. **Launch Discover for smallest DB first** (NYC, 30 UCs expected).
   - Verify BoB does **not** trigger below 75 UCs (no `BEST-OF-BEST` marker in the log).
4. **PBA checks on the smallest DB** — run Q.8.1 + Q.8.4 + Q.8.5. If `hard_veto_survivors = 0` and min bob_score ≥ 3, **launch Genie** for NYC (Q.3).
5. **Pulse Genie every 5–10 min** using Q.4. Confirm finished count equals flagged count, then run Q.8.6 (expect 100% `Yes`).
6. **Repeat for HV (39 UCs), then TPCDS (105 UCs).** Raise concurrency (Q.6) if running them in parallel.
7. **TPCDS is the BoB validator** — this is the release-gating check:
   - BoB must trigger (`BEST-OF-BEST` marker present).
   - `hard_veto_survivors = 0`.
   - Final UC count is non-round (e.g., 105, not 100) — confirms stratified trim, not a hard cap.
8. **Export workspace demos, de-dupe skeletons, replace local `demos/`** (Q.11).
9. **Merge `dev` → `main`, tag `v0.7.3`, push both + tag** (use Q.12 policy if moving is needed).
10. **Sync workspace to `main`:**
    ```bash
    databricks repos update <repo_id> --branch main --profile <profile>
    ```
    If the switch silently fails (Q.7), delete the conflicting workspace artifact files first, then retry. Confirm the branch and head_commit_id via `databricks api get /api/2.0/repos/<repo_id>`.

The release is valid when all three canonical sessions in Q.9 are reproducible, Q.8.1 shows `hard_veto_survivors = 0` for all three, and Q.8.6 shows 100% `has_genie_code = 'Yes'` for all three.
