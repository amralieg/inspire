-- Inspire usage report (REQ-079). Run statement by statement in the internal usage workspace.
-- Tables: main.centralized_system_tables.* (the same columns as system.lakeflow.jobs and system.billing.usage).
-- Where your principal is granted system.*, replace the table names with system.lakeflow.jobs and system.billing.usage.
-- Window: 90 days (edit the INTERVAL in each usage_date filter).
-- EXACT: every DBU below is joined on the id Inspire tagged on the job (job_id, app_id, project UID, warehouse_id).
-- NOT ATTRIBUTABLE: the share of a shared warehouse an Inspire App used. The App queries leave executed_by empty in query history, so no per-App split exists.
-- Counts are the assets live on each job's latest tags. An asset a rebuild removed stops counting.
-- Jobs come from lakeflow_jobs rows changed in the last 365 days (a full-history window scan does not finish on the shared warehouse).

-- 1. Per account: live Inspire assets and exact DBUs. Billing is read once (stack fans out the four id kinds).
WITH ws AS (
  SELECT workspace_id,
         coalesce(nullif(salesforce_account_id, ''), concat('unmapped:', workspace_id)) AS account_id,
         coalesce(nullif(salesforce_account_name, ''), concat('unmapped workspace ', workspace_id)) AS account_name
  FROM (
    SELECT workspace_id, salesforce_account_id, salesforce_account_name,
           ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY salesforce_account_id) AS rn
    FROM main.certified.workspaces_latest
  )
  WHERE rn = 1
),
jobs_latest AS (
  SELECT workspace_id, job_id, tags
  FROM (
    SELECT workspace_id, job_id, tags, delete_time,
           ROW_NUMBER() OVER (PARTITION BY workspace_id, job_id ORDER BY change_time DESC) AS rn
    FROM main.centralized_system_tables.lakeflow_jobs
    WHERE change_time >= current_timestamp() - INTERVAL 365 DAYS
  )
  WHERE rn = 1 AND delete_time IS NULL AND try_element_at(tags, 'dbx_inspire_ai_version') IS NOT NULL
),
asset_ids AS (
  SELECT ws.account_id, 'app' AS asset, coalesce(nullif(try_element_at(j.tags, 'dbx_inspire_ai_app_id'), ''), try_element_at(j.tags, 'dbx_inspire_ai_app_name')) AS asset_id
  FROM jobs_latest j JOIN ws ON j.workspace_id = ws.workspace_id
  UNION ALL
  SELECT ws.account_id, 'dashboard', try_element_at(j.tags, 'dbx_inspire_ai_dashboard_id')
  FROM jobs_latest j JOIN ws ON j.workspace_id = ws.workspace_id
  UNION ALL
  SELECT ws.account_id, 'genie_space', try_element_at(j.tags, 'dbx_inspire_ai_genie_space_id')
  FROM jobs_latest j JOIN ws ON j.workspace_id = ws.workspace_id
  UNION ALL
  SELECT ws.account_id, 'alert', alert_id
  FROM jobs_latest j JOIN ws ON j.workspace_id = ws.workspace_id
  LATERAL VIEW explode(split(coalesce(try_element_at(j.tags, 'dbx_inspire_ai_alert_ids'), ''), ',')) a AS alert_id
),
asset_counts AS (
  SELECT account_id,
         COUNT(DISTINCT CASE WHEN asset = 'app' THEN asset_id END) AS apps,
         COUNT(DISTINCT CASE WHEN asset = 'dashboard' THEN asset_id END) AS dashboards,
         COUNT(DISTINCT CASE WHEN asset = 'genie_space' THEN asset_id END) AS genie_spaces,
         COUNT(DISTINCT CASE WHEN asset = 'alert' THEN asset_id END) AS alerts
  FROM asset_ids
  WHERE coalesce(asset_id, '') <> ''
  GROUP BY account_id
),
keys AS (
  SELECT DISTINCT ws.account_id, j.workspace_id, kind, id, run_type
  FROM jobs_latest j
  JOIN ws ON j.workspace_id = ws.workspace_id
  LATERAL VIEW stack(4,
    'job', j.job_id, try_element_at(j.tags, 'dbx_inspire_ai_run_type'),
    'app', try_element_at(j.tags, 'dbx_inspire_ai_app_id'), CAST(NULL AS STRING),
    'lakebase', try_element_at(j.tags, 'dbx_inspire_ai_lakebase_project_id'), CAST(NULL AS STRING),
    'warehouse', CAST(NULL AS STRING), CAST(NULL AS STRING)) s AS kind, id, run_type
  WHERE coalesce(id, '') <> ''
),
warehouse_keys AS (
  SELECT DISTINCT ws.account_id, j.workspace_id, 'warehouse' AS kind, w.warehouse_id AS id, CAST(NULL AS STRING) AS run_type
  FROM jobs_latest j
  JOIN ws ON j.workspace_id = ws.workspace_id
  LATERAL VIEW explode(split(coalesce(try_element_at(j.tags, 'dbx_inspire_ai_warehouse_id'), ''), ',')) w AS warehouse_id
  WHERE coalesce(w.warehouse_id, '') <> ''
),
billed AS (
  SELECT workspace_id, kind, id, SUM(usage_quantity) AS dbu
  FROM (
    SELECT workspace_id, usage_quantity, s.kind, s.id
    FROM main.centralized_system_tables.billing_usage u
    LATERAL VIEW stack(4,
      'job', usage_metadata.job_id,
      'app', CASE WHEN billing_origin_product = 'APPS' THEN usage_metadata.app_id END,
      'lakebase', CASE WHEN billing_origin_product = 'LAKEBASE' THEN usage_metadata.project_id END,
      'warehouse', usage_metadata.warehouse_id) s AS kind, id
    WHERE usage_unit = 'DBU' AND usage_date >= current_date() - INTERVAL 90 DAYS
      AND (usage_metadata.job_id IS NOT NULL OR usage_metadata.app_id IS NOT NULL
           OR usage_metadata.project_id IS NOT NULL OR usage_metadata.warehouse_id IS NOT NULL)
  ) x
  WHERE id IS NOT NULL
  GROUP BY workspace_id, kind, id
),
dbu_by_account AS (
  SELECT k.account_id,
         SUM(CASE WHEN k.kind = 'job' AND coalesce(k.run_type, '') = 'discovery' THEN b.dbu END) AS discover_job_dbu,
         SUM(CASE WHEN k.kind = 'job' AND coalesce(k.run_type, '') <> 'discovery' THEN b.dbu END) AS mvp_job_dbu,
         SUM(CASE WHEN k.kind = 'app' THEN b.dbu END) AS app_dbu,
         SUM(CASE WHEN k.kind = 'lakebase' THEN b.dbu END) AS lakebase_dbu,
         SUM(CASE WHEN k.kind = 'warehouse' THEN b.dbu END) AS shared_warehouse_dbu
  FROM (SELECT * FROM keys UNION ALL SELECT * FROM warehouse_keys) k
  JOIN billed b ON k.workspace_id = b.workspace_id AND k.kind = b.kind AND k.id = b.id
  GROUP BY k.account_id
)
SELECT ws.account_name,
       coalesce(ac.apps, 0) AS apps, coalesce(ac.dashboards, 0) AS dashboards,
       coalesce(ac.genie_spaces, 0) AS genie_spaces, coalesce(ac.alerts, 0) AS alerts,
       round(d.discover_job_dbu, 2) AS discover_job_dbu_exact,
       round(d.mvp_job_dbu, 2) AS mvp_job_dbu_exact,
       round(d.app_dbu, 2) AS app_dbu_exact,
       round(d.lakebase_dbu, 2) AS lakebase_dbu_exact,
       round(d.shared_warehouse_dbu, 2) AS shared_warehouse_dbu_all_workloads
FROM (SELECT DISTINCT account_id, account_name FROM ws) ws
LEFT JOIN asset_counts ac ON ws.account_id = ac.account_id
LEFT JOIN dbu_by_account d ON ws.account_id = d.account_id
WHERE coalesce(ac.apps, 0) + coalesce(ac.dashboards, 0) + coalesce(ac.genie_spaces, 0) + coalesce(ac.alerts, 0) > 0
   OR d.account_id IS NOT NULL
ORDER BY ws.account_name;

-- 2. Audit trail: one row per live Inspire job, latest tags.
SELECT workspace_id, job_id, name,
       try_element_at(tags, 'dbx_inspire_ai_business') AS business,
       try_element_at(tags, 'dbx_inspire_ai_session_id') AS session_id,
       try_element_at(tags, 'dbx_inspire_ai_usecase_id') AS usecase_id,
       try_element_at(tags, 'dbx_inspire_ai_run_type') AS run_type,
       try_element_at(tags, 'dbx_inspire_ai_assets') AS assets,
       try_element_at(tags, 'dbx_inspire_ai_app_id') AS app_id,
       try_element_at(tags, 'dbx_inspire_ai_warehouse_id') AS warehouse_ids,
       try_element_at(tags, 'dbx_inspire_ai_backend') AS app_backend,
       try_element_at(tags, 'dbx_inspire_ai_lakebase_project_id') AS lakebase_project_uid,
       change_time
FROM (
  SELECT workspace_id, job_id, name, tags, change_time, delete_time,
         ROW_NUMBER() OVER (PARTITION BY workspace_id, job_id ORDER BY change_time DESC) AS rn
  FROM main.centralized_system_tables.lakeflow_jobs
    WHERE change_time >= current_timestamp() - INTERVAL 365 DAYS
)
WHERE rn = 1 AND delete_time IS NULL AND try_element_at(tags, 'dbx_inspire_ai_version') IS NOT NULL
ORDER BY workspace_id, change_time DESC;

-- 3. EXACT App compute DBUs per App (usage_metadata.app_id).
SELECT u.workspace_id, u.usage_metadata.app_id AS app_id, u.usage_metadata.app_name AS app_name,
       SUM(u.usage_quantity) AS app_dbu
FROM main.centralized_system_tables.billing_usage u
WHERE u.billing_origin_product = 'APPS' AND u.usage_unit = 'DBU' AND u.usage_metadata.app_id IS NOT NULL
  AND u.usage_date >= current_date() - INTERVAL 90 DAYS
GROUP BY u.workspace_id, u.usage_metadata.app_id, u.usage_metadata.app_name
ORDER BY app_dbu DESC;

-- 4. EXACT Lakebase DBUs per Autoscaling project (usage_metadata.project_id is the project UID).
SELECT u.workspace_id, u.usage_metadata.project_id AS project_uid, u.sku_name, SUM(u.usage_quantity) AS lakebase_dbu
FROM main.centralized_system_tables.billing_usage u
WHERE u.billing_origin_product = 'LAKEBASE' AND u.usage_unit = 'DBU' AND u.usage_metadata.project_id IS NOT NULL
  AND u.usage_date >= current_date() - INTERVAL 90 DAYS
GROUP BY u.workspace_id, u.usage_metadata.project_id, u.sku_name
ORDER BY lakebase_dbu DESC;
