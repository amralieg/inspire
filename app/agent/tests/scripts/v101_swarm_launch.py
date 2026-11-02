"""v1.0.1 end-to-end swarm launcher (grind iter 1 after Fix #8).

Submits ONE Databricks job per corpus (bakehouse, nyctaxi, healthverity,
tpcds_sf1) against the newly deployed `dbx_inspire_ai_agent_v101` archive.
Pins `14_session_id` per section 9.0 so live logging and step-table
polling are stable from t=0.

Volume log root:  `/Volumes/<catalog>/<schema>/vol_root/logs/`
Inspire database: `<catalog>.<schema>` (set INSPIRE_TEST_CATALOG env var)
Notebook path:    `/Users/<workspace-user>/dbx_inspire_ai_agent_v101`

Environment variables:
    DATABRICKS_CONFIG_PROFILE — CLI profile (default: DEFAULT)
    DATABRICKS_USER_EMAIL     — workspace user email for notebook + gen paths
    INSPIRE_TEST_CATALOG      — <catalog>.<schema> for inspire_database

Writes `run_logs/v101_swarm/manifest.json` for the watcher and analyzer.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "run_logs" / "v101_swarm" / "manifest.json"
MANIFEST.parent.mkdir(parents=True, exist_ok=True)

PROFILE = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")
_USER_EMAIL = os.environ.get("DATABRICKS_USER_EMAIL", "user@example.com")
_INSPIRE_CATALOG = os.environ.get("INSPIRE_TEST_CATALOG", "main._inspire_v101_e2e")

CORPORA = ["bakehouse", "nyctaxi", "healthverity", "tpcds_sf1"]

NOTEBOOK_PATH = f"/Users/{_USER_EMAIL}/dbx_inspire_ai_agent_v101"

BASE_WIDGETS = {
    "02_inspire_database": _INSPIRE_CATALOG,
    "04_table_election": "All Tables",
    "05_use_cases_quality": "Balanced",
    "06_business_domains": "",
    "07_business_priorities": "",
    "08_generation_instructions": "",
    "09_generation_options": "PDF,XLSX,CSV,JSON,Markdown,Genie Code",
    "12_documents_languages": "English",
    "13_generate_genie_code_for": "10",
    "15_operation": "Discover Use Cases",
    "19_run_mode": "full",
    "20_inject_adversarial": "off",
}


def _mint_session_id() -> str:
    return str((uuid.uuid4().int >> 64) & 9223372036854775807)


def build_job_spec(corpus: str, session_id: str) -> dict:
    biz_name = f"{corpus}_v101_e2e_{session_id[:6]}"
    gen_path = f"/Workspace/Users/{_USER_EMAIL}/inspire_v101_e2e/{corpus}"
    base_params = {
        **BASE_WIDGETS,
        "00_business_name": biz_name,
        "01_uc_metadata": f"samples.{corpus}",
        "11_generation_path": gen_path,
        "14_session_id": session_id,
    }
    return {
        "run_name": f"v101_e2e_{corpus}_{session_id[:8]}",
        "tasks": [
            {
                "task_key": "main",
                "notebook_task": {
                    "notebook_path": NOTEBOOK_PATH,
                    "base_parameters": base_params,
                },
                "environment_key": "default",
            }
        ],
        "environments": [{"environment_key": "default", "spec": {"client": "2"}}],
    }


def submit(spec: dict) -> dict:
    result = subprocess.run(
        ["databricks", "jobs", "submit", "--no-wait", "--json", json.dumps(spec)],
        capture_output=True,
        text=True,
        env={**os.environ, "DATABRICKS_CONFIG_PROFILE": PROFILE},
    )
    if result.returncode != 0:
        raise RuntimeError(f"submit failed: {result.stderr}")
    return json.loads(result.stdout)


def main() -> int:
    manifest = {"version": "v1.0.1", "notebook_path": NOTEBOOK_PATH, "runs": []}

    for corpus in CORPORA:
        session_id = _mint_session_id()
        spec = build_job_spec(corpus, session_id)
        info = submit(spec)
        run_id = info.get("run_id") or info.get("id")
        entry = {
            "version": "v101",
            "corpus": corpus,
            "session_id": session_id,
            "run_id": run_id,
            "notebook_path": NOTEBOOK_PATH,
            "business_name": spec["tasks"][0]["notebook_task"]["base_parameters"][
                "00_business_name"
            ],
            "generation_path": spec["tasks"][0]["notebook_task"]["base_parameters"][
                "11_generation_path"
            ],
        }
        manifest["runs"].append(entry)
        print(f"[submit] v101 {corpus} run_id={run_id} sid={session_id}", flush=True)
        time.sleep(1.2)

    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f"[manifest] wrote {MANIFEST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
