# Use case billing tags

Inspire tags the jobs, job runs and assets it creates so DBUs can be summed per use case from `system.billing.usage`.

## Tag keys

| Key | Value | Set on |
|---|---|---|
| `dbx_inspire_ai_version` | Agent version, for example `v1.5.3` | every Inspire job and asset |
| `dbx_inspire_ai_business` | Business name, cleaned | every Inspire job and asset |
| `dbx_inspire_ai_session_id` | Session id | every Inspire job and asset |
| `dbx_inspire_ai_run_type` | `discovery`, `implement`, `training`, `analysis`, `genie_regen` | every job |
| `dbx_inspire_ai_usecase_id` | Use case id, for example `AI01-UC01` | use case runs |
| `dbx_inspire_ai_usecase_name` | Full use case name, lower snake_case, for example `predict_customer_churn` | use case runs with one use case |
| `dbx_inspire_ai_usecase` | Same value as `dbx_inspire_ai_usecase_name` (legacy key, kept for existing readers) | Genie jobs |
| `dbx_inspire_ai_app_name` / `dbx_inspire_ai_app_id` | App name and id | the job that builds an App |

Encoding of `dbx_inspire_ai_usecase_name`:

- Lower case, every run of characters outside `a-z0-9` becomes one `_`, leading and trailing `_` are removed.
- Accents are folded (`Café` becomes `cafe`). Non-Latin characters become separators, so a name with no ASCII letters writes no name tag.
- Longer than the tag value limit (255 on AWS and Azure, 63 on GCP or when the cloud is unknown), the value is cut at the last `_` inside the limit.
- A Discover run, or any run that covers more than one use case, carries no name tag. It has no single name to report.

The encoder is `useCaseNameTag` in `app/backend/lib/inspireJobParams.js` and `inspire_usecase_name_tag` in the agent notebook. Both read `app/agent/tests/fixtures/usecase_name_cases.json`.

## Which billing rows carry which tags

| Compute | Attribution | Use case key |
|---|---|---|
| Job compute and serverless jobs | Job tags reach `custom_tags`; `usage_metadata.job_id` is set | `custom_tags['dbx_inspire_ai_usecase_name']`, or the tracking table |
| Databricks Apps | `usage_metadata.app_id` is set. `custom_tags` is filled only when the App runs under a serverless usage policy, which Inspire does not set | join `usage_metadata.app_id` to the tracking table (below) |
| SQL warehouse (App statements) | Statement `query_tags` carry `dbx_inspire_ai_app_name`, `dbx_inspire_ai_usecase_id` and `dbx_inspire_ai_usecase_name` (the name comes from the App page, written at build time). Warehouse DBUs are shared, so DBUs count only for a warehouse that one use case names | `docs/inspire_usage_report.sql`, statement 5 for apportionment by query duration |

## Inspire's tracking table

Every build writes one row to `<catalog>.<schema>.__inspire_implement`, keyed by session and use case. The row holds the billing ids of that build:

| Column | Billing id | Notes |
|---|---|---|
| `use_case_id`, `session_id` | the use case | |
| `use_case_name_tag` | encoded use case name | written by the App on each build row, from the same encoder as the job tags |
| `job_id` | `usage_metadata.job_id` | the build job |
| `asset_status:app.app_id` | `usage_metadata.app_id` | the App; `app_name` and `app_url` are also columns |
| `warehouse_id` | `usage_metadata.warehouse_id` | the warehouse the App queries; set on rows written after this change |
| `lakebase_project_id` | `usage_metadata.database_instance_id` | the Lakebase project or instance Inspire tagged on the build job (the project uid, else id). Written by the build after its assets are tagged |
| `genie_space_id`, `dashboard_id`, `alert_id` | Genie, dashboard and alert ids | these assets bill through a warehouse, so they are context, not a billing key |

Lakebase bills under `usage_metadata.database_instance_id` (Databricks billing system table docs). Inspire stores the project uid, else the id, in `lakebase_project_id`. The two match in the usual case, but confirm on one sample row before you rely on Lakebase totals. A build row written before this change has no `lakebase_project_id`.

Rows written before this change have no `use_case_name_tag` or `warehouse_id`. They show as `unattributed`.

## Example: DBUs per use case name

Run it in the workspace whose tracking table you query, so `workspace_id` matches. Replace `<catalog>.<schema>` and `<workspace_id>`.

```sql
WITH tracked AS (                             -- every billing id Inspire created, with its use case name
  SELECT DISTINCT use_case_name_tag, CAST(job_id AS STRING) AS asset_id, 'job' AS kind
  FROM <catalog>.<schema>.__inspire_implement
  WHERE job_id IS NOT NULL AND use_case_name_tag IS NOT NULL
  UNION ALL
  SELECT DISTINCT use_case_name_tag, CAST(asset_status:app.app_id AS STRING), 'app'
  FROM <catalog>.<schema>.__inspire_implement
  WHERE asset_status:app.app_id IS NOT NULL AND use_case_name_tag IS NOT NULL
  UNION ALL
  SELECT MIN(use_case_name_tag), warehouse_id, 'warehouse'
  FROM (SELECT DISTINCT use_case_name_tag, warehouse_id
        FROM <catalog>.<schema>.__inspire_implement
        WHERE warehouse_id IS NOT NULL AND use_case_name_tag IS NOT NULL)
  GROUP BY warehouse_id                       -- a warehouse counts only when one use case names it
  HAVING COUNT(DISTINCT use_case_name_tag) = 1
  UNION ALL
  SELECT DISTINCT use_case_name_tag, lakebase_project_id, 'lakebase'
  FROM <catalog>.<schema>.__inspire_implement
  WHERE lakebase_project_id IS NOT NULL AND use_case_name_tag IS NOT NULL
),
usage_ids AS (
  SELECT CAST(usage_metadata.job_id AS STRING) AS asset_id, 'job' AS kind, usage_quantity
  FROM system.billing.usage
  WHERE workspace_id = '<workspace_id>' AND usage_unit = 'DBU' AND usage_metadata.job_id IS NOT NULL
  UNION ALL
  SELECT CAST(usage_metadata.app_id AS STRING), 'app', usage_quantity
  FROM system.billing.usage
  WHERE workspace_id = '<workspace_id>' AND usage_unit = 'DBU' AND usage_metadata.app_id IS NOT NULL
  UNION ALL
  SELECT CAST(usage_metadata.warehouse_id AS STRING), 'warehouse', usage_quantity
  FROM system.billing.usage
  WHERE workspace_id = '<workspace_id>' AND usage_unit = 'DBU' AND usage_metadata.warehouse_id IS NOT NULL
  UNION ALL
  SELECT CAST(usage_metadata.database_instance_id AS STRING), 'lakebase', usage_quantity
  FROM system.billing.usage
  WHERE workspace_id = '<workspace_id>' AND usage_unit = 'DBU' AND usage_metadata.database_instance_id IS NOT NULL
)
SELECT coalesce(t.use_case_name_tag, 'unattributed') AS usecase_name,
       u.kind,
       SUM(u.usage_quantity) AS dbus
FROM usage_ids u
LEFT JOIN tracked t ON t.asset_id = u.asset_id AND t.kind = u.kind
GROUP BY 1, 2
ORDER BY dbus DESC;
```

Notes:

- Each billing id appears once in the tracking table, so the join does not multiply DBUs. Confirm that with one sample row per kind before you rely on the totals.
- A warehouse named by more than one use case has no single owner, so its DBUs show as `unattributed`. For an apportioned figure use statement 5 of `docs/inspire_usage_report.sql`.
- The App's statements carry the same name in `system.query.history`, at `query_tags['dbx_inspire_ai_usecase_name']`, so warehouse statements filter by use case without this table.

## Option not built: a usage policy per use case

Serverless usage policies write their tags into `custom_tags`, so a policy per use case would put the name on the billing row itself. Creating and assigning a policy needs a workspace admin write, so Inspire does not do it. The tracking table above gives the same totals without it.
