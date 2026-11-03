# Inspire AI: Deployment

Install the **inspire-ai** Databricks App with **`inspire_installer.py`** from the latest release.

---

## Install path (no npm)

1. Download **`inspire_installer.py`** from the latest release: `https://github.com/amralieg/inspire/releases/latest/download/inspire_installer.py`.
2. Import it into a folder of your workspace (**Workspace, Import, File**).
3. Open it, attach **Serverless**, and **Run All**. Pick the **warehouse** and **catalog** from the lists in the widgets, or type the exact name (or the warehouse id), then run it again.

The installer downloads the latest release from GitHub, checks the size and sha256 of every file, installs the agent assets into **`/Workspace/Shared/inspire-ai/assets/<version>/`**, deploys the App and grants its service principal. Open **Compute, Apps, inspire-ai**.

**A workspace that cannot reach GitHub:** the installer then uses the release files imported next to it (`manifest.json`, `inspire-app.zip` and `inspire-assets.tar`; the workspace import unpacks `inspire-app.zip` into that folder, and the installer checks every unpacked file against `manifest.json`; `databricks workspace import --format RAW` keeps the file whole). When those are missing, it shows a page with the commands for macOS, Linux and Windows that download the 4 release files and check each sha256 against `manifest.json`, the exact folder to import the files into, and direct links with sizes. It never mixes files of two releases and never uses a partial download.

---

## Before you start

Confirm the following so the run does not fail halfway. The installer checks the rights below before it replaces anything, and a failed check leaves the installed App untouched.

| Requirement | Why it matters |
|---------------|----------------|
| **Databricks workspace** with **Unity Catalog** | The installer creates `{catalog}._inspire` and expects UC catalogs. |
| **SQL warehouse** you can use | You pick one in the notebook; it runs `CREATE SCHEMA` and SQL grants. |
| **Catalog rights** | You need ownership of or MANAGE on the catalog you pick, or metastore admin, because ALL PRIVILEGES does not include the right to grant. You also need CREATE SCHEMA (or ALL PRIVILEGES) when `_inspire` does not exist yet. |
| **Apps permission** | You need Can Manage on an existing **inspire-ai** App, or the right to create Apps. |
| **Workspace folders** | You need to write `/Shared/inspire-ai` and `/Shared/inspire-ai/assets`. |
| **Notebook compute** | **Run All** needs **Serverless** (or a cluster) that can call Workspace APIs. |

---

## 1. What a release holds

Every build is a GitHub Release with the same 4 files: `inspire_installer.py`, `manifest.json` (version, `starter_min_version`, the install entry point, and the size and sha256 of every file), `inspire-app.zip` (the App, its agent notebooks and the install steps in `installer/inspire_setup.py`) and `inspire-assets.tar` (the agent assets folder with its own `manifest.json`).

Build and check one on a machine with **Node.js** and Python 3:

```bash
cd app
python3 installer/release.py build --assets <agent assets folder> --out dist/release
python3 installer/release.py check --base https://github.com/amralieg/inspire/releases/latest/download
```

`check` downloads every file through the given links, checks each sha256 against `manifest.json`, confirms the release carries no other file name, and exits non-zero on any mismatch.

---

## 2. Parameters

| Widget | What to choose |
|--------|----------------|
| **00_sql_warehouse** | The SQL warehouse used for SQL statements, grants, and the value written into the app as **INSPIRE_WAREHOUSE_ID**. Pick it from the list or type its exact name or id. |
| **01_inspire_catalog** | The Unity Catalog where Inspire uses schema **_inspire** for session and tracking tables. Pick it from the list or type its exact name. |

**Jobs / automation (no UI):** put `inspire_installer_test.json` next to the installer with `warehouse_id` and `catalog` so the widgets are skipped. It also takes `app_name`, `release` (a pre-release of the test fork) and `test_tag`: every job the installed App launches then carries the tag `dbx_inspire_ai_test=<test_tag>`, so usage reports leave test runs out. A directly submitted agent run takes the same tag from its `dbx_inspire_ai_test` parameter. Never set it on a customer install.

**Testing without internet:** set `INTERNET_BLOCKED = True` near the top of the installer. Its GitHub check then answers no before any network call, so the installer uses the release files next to it, or shows the download page when there are none. It ships as `False`.

**Catalogs the App may read:** `SCAN_CATALOGS`, next to `INTERNET_BLOCKED`, is the word `"all"` (the App service principal gets **USE_CATALOG**, **USE_SCHEMA**, **SELECT** and **BROWSE** on every catalog you can see and grant on, meaning you own it, hold **MANAGE** on it, or are a metastore admin; the grant plan names every other catalog it skips and why, before the first grant) or a list such as `["main", "sales"]` (it gets them only on those, plus the Inspire catalog and the Lakebase catalog, and the rights check stops before any change if you cannot grant on a listed catalog). Discover runs read the metadata of the catalogs you pick on the Launch page as the App service principal, and builds run as the App and read the source tables of the use case, so list every catalog you plan to scan or build from.

**Catalog access for the Apps that Implement builds:** `NEW_APPS_CATALOG_ACCESS`, next to `SCAN_CATALOGS`, is `"account users"` (the default) or `"off"`. Each App that Implement builds has its own service principal, which needs **USE CATALOG** on the Inspire catalog to read its result table. With `"account users"`, when account users do not hold it and you own or hold **MANAGE** on the catalog, the installer lists every grant to account users below the catalog (schemas, tables, volumes and functions, leaving out the system grants of `information_schema`). When there is none, it runs `GRANT USE CATALOG ON CATALOG <catalog> TO account users`, which opens no data by itself. When there are some, it grants nothing and prints them with the two statements a catalog owner can choose from. With `"off"` it only prints those statements. The rights check refuses a name you cannot see or cannot grant on, and the installer prints every grant before it runs one.

---

## 3. What a run does

1. Gets the release (GitHub, or the files next to the installer) and checks every file.
2. Checks your rights on the App, the warehouse, the catalog, the catalogs in `SCAN_CATALOGS` and the workspace folders.
3. Unpacks the App into a new folder under **`/Workspace/Shared/inspire-ai/apps/<app name>/`**, so any workspace admin can reinstall or clean it up.
4. Installs the assets into **`/Workspace/Shared/inspire-ai/assets/<version>/`** (files already there with the same sha256 are kept).
5. Cleans up the old App and its service principals, unless the App runs implemented use cases.
6. Runs **`CREATE SCHEMA IF NOT EXISTS`** for **`{catalog}._inspire`**, publishes **`dbx_inspire_ai_agent`** and **`dbx_generate_demo_data`** under **`/Shared/inspire-ai/`**.
7. Writes **`app.yaml`** with **`INSPIRE_DATABASE`**, **`INSPIRE_WAREHOUSE_ID`**, **`NOTEBOOK_PATH`**, **`INSPIRE_ASSETS_PATH`** and **`INSPIRE_AUTO_SETUP`**, then creates and deploys the App. Every job the App launches receives the assets path as `inspire_assets_path`.
8. Prints the grant plan, then grants the App service principal its Unity Catalog, warehouse and folder rights, and Can Read on the assets for it and the users group.

---

## 4. Verify deployment succeeded

| Step | How to verify |
|------|----------------|
| **Notebook completed** | No uncaught error in the final cells; output shows the release version, the assets path, catalog, and warehouse. |
| **App exists** | In Databricks: **Compute, Apps, inspire-ai**. |
| **App URL opens** | Open the app URL from the notebook final summary link; it opens on its landing page, not on the workspace connection wizard. |
| **Health** | Visit **/api/defaults** on the app; `envSkipsSetupWizard` is `true`. |
| **Schema** | In Unity Catalog, confirm **{your_catalog}._inspire** exists. |
| **Assets** | `/Workspace/Shared/inspire-ai/assets/<version>/manifest.json` exists. |

---

## 5. Selecting Unity Catalog metadata (Launch page)

After the app is deployed, open **inspire-ai** and go to the **Launch** flow. Under **Unity Catalog Metadata**, choose what Inspire should analyze. How you select metadata has a large impact on **run time** and **use-case quality**.

### Recommended approach

| Do | Why |
|----|-----|
| Select **individual tables** (not whole catalogs) | Inspire reads table and column metadata only; a focused list runs faster and produces sharper use cases. |
| Keep the set **small**, ideally **fewer than 25 tables** | Discovery and scoring scale with breadth; large selections take much longer. |
| Stay in **one business domain** | Example: all **sales** tables together (orders, line items, customers), not sales + HR + finance in one run. |
| Prefer **transactional** tables | Tables that receive new rows often (e.g. `sales_transactions`, `orders`, `events`) support richer use cases. |
| Skip or minimize **static** tables | Reference data that rarely changes (e.g. `store_location`, `country_codes`) adds little discovery value. |
| Use **Generation Instructions** for joins | If Unity Catalog metadata does not show primary/foreign keys between tables, describe relationships there (e.g. *join orders to customers on customer_id*). |

### How to select in the UI

1. Expand **Browse catalogs** under **Unity Catalog Metadata**.
2. Pick one or more **catalogs**, then **schemas**, then **tables** (table selection is the primary, preferred level).
3. Selected items appear in the **Selected Metadata** basket. Remove chips you do not need.
4. Optionally set **Generation Instructions** for domain focus, joins, or exclusions.

Avoid leaving only a **catalog** or **schema** in the basket without naming tables unless you intentionally want Inspire to scan **everything** in that scope.

### In-app warnings

The Launch page shows an amber notice when your selection is likely to run long or produce weaker results:

| Your selection | Warning |
|----------------|---------|
| **More than 10 tables** | Many explicit tables: expect a longer run; narrow to transactional tables in one domain if possible. |
| **Whole schema** (schema in basket, no tables) | All tables in that schema are in scope. Open the table list and pick a focused subset instead. |
| **Whole catalog** (catalog only) | All schemas and tables in that catalog are in scope. Prefer drilling down to specific schemas and tables. |

These warnings are advisory; you can still launch. For the best outcomes, treat **under 25 transactional tables in one domain** as the target.

### “I don’t have data”

If you have no UC tables yet, use **I don’t have data, generate demo tables instead**. That runs a separate pipeline: an LLM generates demo Delta tables (with Unity Catalog table and column descriptions), then Inspire discovers use cases on those tables. See the in-app flow on that page for details.

**Permissions:** Run **`inspire_installer.py` once** before using this flow. The installer deploys the **inspire-ai** App and grants its **service principal** access to `{catalog}._inspire`, the SQL warehouse, and UC read access on the catalogs in `SCAN_CATALOGS`. The demo pipeline’s **first task** (`dbx_generate_demo_data`) then grants the same service principal on the new **`inspire_demo_*`** schema so the App and step 2 (Inspire discovery) work end-to-end without manual SQL grants.

---

## 6. Optional: install a local build from your laptop (npm run deploy)

1. Install **Databricks CLI** and create **.env** in `app/` with **DATABRICKS_HOST** and **DATABRICKS_TOKEN**, or set **DATABRICKS_CONFIG_PROFILE**.
2. Set **INSPIRE_ASSETS_DIR** (the agent assets folder with its `manifest.json`), **INSPIRE_WAREHOUSE_ID** and **INSPIRE_CATALOG**, and optionally **INSPIRE_APP_NAME**.
3. Run **npm run deploy** from `app/`.

The script builds a release, imports `inspire_installer.py` with `INTERNET_BLOCKED = True` (so it installs this build, not the latest release), `manifest.json`, `inspire-app.zip` and `inspire-assets.tar` into **`/Workspace/Users/<you>/inspire-install`**, writes `inspire_installer_test.json` there with the warehouse and catalog, and runs the installer once as a serverless job.

---

## 7. Permissions (short)

- **While you run the installer:** your user identity needs warehouse **CAN_MANAGE** (to grant the App service principal access to it), rights to create or use **{catalog}._inspire**, and permissions to create or update the App and the workspace folders the notebook touches.
- **After deployment:** the **App service principal** is what the running app uses. The installer grants:
  - On the **chosen Inspire catalog**: **USE_CATALOG**, **BROWSE**, **CREATE SCHEMA** (so demo schemas can be created), and on **`{catalog}._inspire`**: **USE_SCHEMA**, **CREATE_TABLE**, **SELECT**, **MODIFY** (session and `__inspire_*` tables live here), and **CREATE VOLUME**, **READ VOLUME**, **WRITE VOLUME** (each run streams its live log to the `vol_root` volume here), and **MANAGE** (so Implement can let the Apps it creates read their result tables).
  - The **“I don’t have data”** pipeline task 1 additionally grants **USE_SCHEMA**, **SELECT**, and **MODIFY** on each new **`{catalog}.inspire_demo_*`** schema after demo tables are created.
  - On the catalogs in **`SCAN_CATALOGS`** (with `"all"`, every catalog you can see and grant on, except a few system names): **USE_CATALOG**, **USE_SCHEMA**, **SELECT** and **BROWSE**, because Discover runs as the App service principal and reads the metadata of the catalogs you scan, and a build runs as the App and reads the source tables of the use case. Every build route first checks with your own sign-in that you can read those tables, so the App never reads for you a table you cannot read. The Launch page lists catalogs, schemas and tables with your own sign-in, so it needs none of these.
  - On the Lakebase catalog **`inspire_lakebase`**, when it exists: **ALL PRIVILEGES**.
  - **CAN_MANAGE** on the SQL warehouse you picked, so Implement can attach it to the Apps it creates.
  - **CAN_MANAGE** on `/Shared/inspire-ai`, and **CAN_READ** on `/Shared/inspire-ai/assets` for it and the users group.
  - Apps that Implement creates also need **USE_CATALOG** on the Inspire catalog. The installer checks that account users hold it or that the App service principal holds **MANAGE** on the catalog. Otherwise, with `NEW_APPS_CATALOG_ACCESS = "account users"` and your MANAGE or ownership, it grants USE CATALOG to account users when nothing below the catalog is granted to them, and in every other case prints the statements a catalog owner can run. The App runs the same check and grant with the signed-in person's own token, through `POST /api/inspire/implement/grant-access`, for a person who owns or manages the catalog.

If identity resolution fails, follow the SQL hints printed by the notebook.

---

## 8. Troubleshooting

| Symptom | What to do |
|---------|------------|
| **“I am not able to connect to GitHub to download the Inspire code”** | Follow the page: run the download commands on a computer that can reach GitHub, import the files next to the installer, and run it again. |
| **“not one Inspire release”** | Files from two releases are next to the installer. Download every file of one release again and import them. |
| **“This installer is too old”** | Download the latest `inspire_installer.py` and import it in place of the old one. |
| **“Nothing was replaced”** | The rights check failed; the message names each missing right and who can grant it. |
| **No warehouses in widget** | Create or start a SQL warehouse in the workspace; you need at least one warehouse with an id. |
| **App does not start** | **Compute, Apps, inspire-ai, Logs**. `start.sh` runs `node` on `backend/build/server.js`, the backend bundled into the App zip, with no npm install and no internet. If the log says that file is missing, install Inspire again from its release. |

---

## 9. Only the installer installs Inspire

Install and update Inspire only with `inspire_installer.py`. It writes the App environment (`INSPIRE_AUTO_SETUP`, `INSPIRE_WAREHOUSE_ID`, `INSPIRE_DATABASE`, `NOTEBOOK_PATH`, `INSPIRE_ASSETS_PATH`) and grants the App service principal, so the App opens on its landing page. A Git-backed App or a source-folder deploy sets none of these and opens on the workspace connection wizard.
