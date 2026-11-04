# Databricks notebook source
# MAGIC %md
# MAGIC # Inspire AI, Step 1: Generate demo data (LLM code + execution)
# MAGIC
# MAGIC Genie-style flow: FM returns JSON (`display_name`, `tables`, `table_metadata`, `code`), then `exec(code)`.
# MAGIC Writes **5 Delta tables** with UC **table & column comments**, plus 13 seeded tables that carry the data signal of every use-case kind (widget `plant_kind_signals`), then passes FQNs to Inspire via `uc_metadata`.

# COMMAND ----------

NUM_DEMO_TABLES = 5

dbutils.widgets.text("user_description", "", "1. Describe the demo data you want")
dbutils.widgets.text("inspire_catalog", "", "2. UC catalog (must already exist)")
dbutils.widgets.text("inspire_database", "", "3. Inspire tracking: catalog._inspire")
dbutils.widgets.text("session_id", "", "4. Session ID")
dbutils.widgets.text("business_name", "Demo", "5. Business display name (fallback display_name)")
dbutils.widgets.text("demo_schema", "", "6. Demo schema name (under inspire_catalog)")
dbutils.widgets.text("warehouse_id", "", "7. SQL warehouse (SP CAN_USE)")
dbutils.widgets.text("app_sp_application_id", "", "8. Inspire App service principal applicationId")
dbutils.widgets.text("plant_kind_signals", "yes", "9. Add the tables that show every use-case kind (yes or no)")

user_description = (dbutils.widgets.get("user_description") or "").strip()
inspire_catalog = (dbutils.widgets.get("inspire_catalog") or "").strip()
inspire_database = (dbutils.widgets.get("inspire_database") or "").strip()
session_id = (dbutils.widgets.get("session_id") or "").strip()
business_name = (dbutils.widgets.get("business_name") or "Demo").strip()
demo_schema = (dbutils.widgets.get("demo_schema") or "").strip()
warehouse_id = (dbutils.widgets.get("warehouse_id") or "").strip()
app_sp_application_id = (dbutils.widgets.get("app_sp_application_id") or "").strip()
plant_kind_signals = (dbutils.widgets.get("plant_kind_signals") or "yes").strip().lower() not in ("no", "false", "0", "off")

if not user_description:
    raise ValueError("user_description is required")
if not inspire_catalog:
    raise ValueError("inspire_catalog is required (existing UC catalog with storage)")
if not inspire_database or "." not in inspire_database:
    raise ValueError("inspire_database must be catalog._inspire")
if not session_id:
    raise ValueError("session_id is required")
if not demo_schema:
    raise ValueError("demo_schema is required")

track_catalog, track_schema = inspire_database.split(".", 1)
demo_schema_fq = f"{inspire_catalog}.{demo_schema}"

print(f"My user intent: {user_description}")
print(f"Target catalog.schema: {demo_schema_fq} ({NUM_DEMO_TABLES} tables + UC comments)")

# COMMAND ----------

def _current_uc_principal():
    try:
        row = spark.sql("SELECT current_user() AS u").collect()[0]
        return (row["u"] if hasattr(row, "__getitem__") else row.u).strip()
    except Exception:
        return None


def _run_grant_sql(sql, label=None):
    try:
        spark.sql(sql)
        if label:
            print(f"  ✓ {label}")
        return True
    except Exception as e:
        print(f"  grant note{f' ({label})' if label else ''}: {e}")
        return False


def _grant_schema_access(catalog, schema, principal):
    if not principal:
        print(f"Skip grants for {catalog}.{schema}: no principal")
        return
    fq_schema = f"`{catalog}`.`{schema}`"
    fq_catalog = f"`{catalog}`"
    statements = [
        (f"GRANT USE CATALOG ON CATALOG {fq_catalog} TO `{principal}`", "USE CATALOG"),
        (f"GRANT CREATE SCHEMA ON CATALOG {fq_catalog} TO `{principal}`", "CREATE SCHEMA on catalog"),
        (f"GRANT USE SCHEMA ON SCHEMA {fq_schema} TO `{principal}`", "USE SCHEMA"),
        (f"GRANT CREATE TABLE ON SCHEMA {fq_schema} TO `{principal}`", "CREATE TABLE"),
        (f"GRANT SELECT ON SCHEMA {fq_schema} TO `{principal}`", "SELECT"),
        (f"GRANT MODIFY ON SCHEMA {fq_schema} TO `{principal}`", "MODIFY"),
    ]
    for sql, label in statements:
        _run_grant_sql(sql, label)


def _resolve_app_sp_application_id(explicit_id):
    sp = (explicit_id or "").strip()
    if sp:
        return sp
    try:
        import requests

        host, token = _notebook_api_context()
        if not host or not token:
            return None
        url = f"{host}/api/2.0/preview/scim/v2/ServicePrincipals?filter=displayName co \"inspire-ai\"&count=50"
        resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
        if resp.status_code >= 400:
            return None
        for row in resp.json().get("Resources", []):
            app_id = (row.get("applicationId") or "").strip()
            if app_id:
                print(f"Resolved inspire-ai SP: {row.get('displayName')} ({app_id[:8]}…)")
                return app_id
    except Exception as e:
        print(f"Could not resolve inspire-ai SP: {e}")
    return None


def _grant_warehouse_can_use(sp_app_id, wh_id):
    if not sp_app_id or not wh_id:
        return
    try:
        import requests

        host, token = _notebook_api_context()
        url = f"{host}/api/2.0/permissions/sql/warehouses/{wh_id}"
        resp = requests.patch(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={
                "access_control_list": [
                    {"service_principal_name": sp_app_id, "permission_level": "CAN_USE"}
                ]
            },
            timeout=60,
        )
        if resp.status_code == 200:
            print(f"  ✓ CAN_USE on warehouse {wh_id}")
        else:
            print(f"  warehouse grant note: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"  warehouse grant note: {e}")


def _grant_inspire_app_service_principal(sp_app_id, catalog, track_schema, demo_schema, warehouse_id):
    """
    Mirror inspire_installer.py Step 4 so the Databricks App SP can browse UC metadata,
    write session tables, and read demo data after this pipeline completes.
    """
    if not sp_app_id:
        raise RuntimeError(
            "app_sp_application_id is required. Run inspire_installer.py once (deploys inspire-ai App + SP) "
            "or set DATABRICKS_CLIENT_ID / SP_CLIENT_ID in the app environment."
        )

    print(f"Granting Inspire App service principal ({sp_app_id[:8]}…) …")
    fq_cat = f"`{catalog}`"
    fq_track = f"`{catalog}`.`{track_schema}`"
    fq_demo = f"`{catalog}`.`{demo_schema}`"

    core_grants = [
        (f"GRANT USE CATALOG ON CATALOG {fq_cat} TO `{sp_app_id}`", "SP USE CATALOG"),
        (f"GRANT BROWSE ON CATALOG {fq_cat} TO `{sp_app_id}`", "SP BROWSE catalog"),
        (f"GRANT CREATE SCHEMA ON CATALOG {fq_cat} TO `{sp_app_id}`", "SP CREATE SCHEMA on catalog"),
        (f"GRANT USE SCHEMA ON SCHEMA {fq_track} TO `{sp_app_id}`", "SP USE _inspire schema"),
        (f"GRANT CREATE TABLE ON SCHEMA {fq_track} TO `{sp_app_id}`", "SP CREATE in _inspire"),
        (f"GRANT SELECT ON SCHEMA {fq_track} TO `{sp_app_id}`", "SP SELECT _inspire"),
        (f"GRANT MODIFY ON SCHEMA {fq_track} TO `{sp_app_id}`", "SP MODIFY _inspire"),
        (f"GRANT USE SCHEMA ON SCHEMA {fq_demo} TO `{sp_app_id}`", "SP USE demo schema"),
        (f"GRANT CREATE TABLE ON SCHEMA {fq_demo} TO `{sp_app_id}`", "SP CREATE demo schema"),
        (f"GRANT SELECT ON SCHEMA {fq_demo} TO `{sp_app_id}`", "SP SELECT demo schema"),
        (f"GRANT MODIFY ON SCHEMA {fq_demo} TO `{sp_app_id}`", "SP MODIFY demo schema"),
    ]
    for sql, label in core_grants:
        _run_grant_sql(sql, label)

    _skip_catalogs = {"samples", "system", "__databricks_internal", "information_schema"}
    try:
        other_catalogs = [
            r.catalog
            for r in spark.sql("SHOW CATALOGS").collect()
            if r.catalog and r.catalog not in _skip_catalogs and r.catalog != catalog
        ]
        for cat in other_catalogs[:40]:
            _run_grant_sql(f"GRANT USE CATALOG ON CATALOG `{cat}` TO `{sp_app_id}`")
            _run_grant_sql(f"GRANT BROWSE ON CATALOG `{cat}` TO `{sp_app_id}`")
    except Exception as e:
        print(f"  browse-other-catalogs note: {e}")

    _grant_warehouse_can_use(sp_app_id, warehouse_id)
    print("Service principal grants complete.")


def _ensure_catalog_exists(catalog):
    try:
        spark.sql(f"DESCRIBE CATALOG `{catalog}`").collect()
        print(f"✓ Catalog exists: {catalog}")
    except Exception as e:
        raise RuntimeError(
            f"UC catalog `{catalog}` is not usable. Pick a catalog that already exists in this workspace "
            f"(e.g. your personal catalog from INSPIRE_DATABASE). Original error: {e}"
        ) from e


_runner = _current_uc_principal()

_ensure_catalog_exists(inspire_catalog)
spark.sql(f"CREATE SCHEMA IF NOT EXISTS `{track_catalog}`.`{track_schema}`")
_grant_schema_access(track_catalog, track_schema, _runner)
spark.sql(f"CREATE SCHEMA IF NOT EXISTS `{inspire_catalog}`.`{demo_schema}`")
_grant_schema_access(inspire_catalog, demo_schema, _runner)
spark.sql(f"USE CATALOG `{inspire_catalog}`")
spark.sql(f"USE SCHEMA `{demo_schema}`")
print(f"Ensured schemas: {inspire_database} and {demo_schema_fq}")

# COMMAND ----------

import math
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher

import numpy as np
import pandas as pd
from scipy.stats import theilslopes
from sklearn.cluster import KMeans
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, silhouette_score

KIND_SIGNAL_SEED = 1400
KIND_SIGNAL_WEEKS = 156
KIND_SIGNAL_START = date(2023, 1, 2)
KIND_SIGNAL_AS_OF = datetime(2025, 12, 29)


def _kind_signal_table(frame, description, columns, pk=None, fks=None):
    return {"frame": frame, "description": description, "columns": columns, "pk": pk, "fks": dict(fks or {})}


def _kind_signal_pick(rng, candidates, share):
    idx = np.flatnonzero(candidates)
    chosen = np.zeros(len(candidates), bool)
    chosen[rng.permutation(idx)[:int(round(share * len(idx)))]] = True
    return chosen


def _kind_signal_solve(fn, target, lo, hi):
    for _ in range(60):
        mid = (lo + hi) / 2
        if fn(mid) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _kind_signal_names(rng, n):
    first = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Rowan", "Harper",
             "Elliot", "Reese", "Skyler", "Dana", "Robin", "Kendall", "Parker", "Logan", "Emery", "Sasha", "Noel", "Ari",
             "Blake", "Cameron", "Drew", "Finley", "Hayden", "Jesse", "Kai", "Lane", "Marley", "Nico", "Oakley", "Peyton",
             "Remy", "Sage", "Tatum", "Wren"]
    last = ["Abbott", "Barnes", "Carver", "Dalton", "Ellison", "Fletcher", "Garrison", "Holloway", "Ingram", "Jennings",
            "Keller", "Lawson", "Mercer", "Norwood", "Osborne", "Prescott", "Quinlan", "Ramsey", "Sutton", "Thornton",
            "Underwood", "Vance", "Whitaker", "Yardley", "Ashford", "Bramley", "Calloway", "Denholm", "Everly", "Fairbanks",
            "Gilmore", "Hartley", "Irvington", "Kingsley", "Langford", "Montague", "Northcott", "Pemberton", "Radcliffe", "Stanton"]
    streets = ["Oak", "Maple", "Cedar", "Elm", "Pine", "Birch", "Willow", "Aspen", "Laurel", "Juniper", "Hazel", "Alder"]
    picks = rng.integers(0, len(first), n), rng.integers(0, len(last), n)
    names = [f"{first[a]} {last[b]}" for a, b in zip(*picks)]
    addresses = [f"{int(num)} {streets[int(street)]} Street" for num, street in zip(rng.integers(1, 400, n), rng.integers(0, len(streets), n))]
    return names, addresses


def _kind_signal_misspell(rng, text):
    letters = [i for i, ch in enumerate(text) if ch.isalpha() and i > 0]
    i = int(letters[int(rng.integers(0, len(letters)))])
    move = int(rng.integers(0, 3))
    if move == 0:
        return text[:i] + text[i + 1:]
    if move == 1 and i + 1 < len(text) and text[i + 1].isalpha():
        return text[:i] + text[i + 1] + text[i] + text[i + 2:]
    return text[:i] + text[i] + text[i:]


def _kind_signal_frames(seed=KIND_SIGNAL_SEED):
    rng = np.random.default_rng(seed)
    weeks, start, as_of = KIND_SIGNAL_WEEKS, KIND_SIGNAL_START, KIND_SIGNAL_AS_OF
    week_dates = [start + timedelta(weeks=int(w)) for w in range(weeks)]
    tables = {}

    n_sites = 30
    dense = (40.85, -2.25)
    lat, lon = [], []
    while len(lat) < n_sites:
        a, b = rng.uniform(40.0, 41.0), rng.uniform(-3.0, -2.0)
        if math.hypot(a - dense[0], (b - dense[1]) * 0.76) > 0.25:
            lat.append(round(float(a), 5))
            lon.append(round(float(b), 5))
    area = rng.integers(300, 2400, n_sites)
    size = area / 1000.0
    bound = np.zeros(n_sites, bool)
    bound[25:30] = True
    costly = np.zeros(n_sites, bool)
    costly[[3, 11, 17, 22]] = True
    off_plan = np.zeros(n_sites, bool)
    off_plan[[0, 5, 8, 13, 15, 19, 21, 24]] = True
    hubs = (1, 2)
    base_units = np.array([120.0, 160.0, 60.0, 90.0, 300.0, 100.0])
    capacity = np.round(np.where(bound, 1.45, 2.2) * size * base_units[:5].sum()).astype(int)
    site_ids = np.arange(1, n_sites + 1)
    tables["sites"] = _kind_signal_table(pd.DataFrame({
        "site_id": site_ids, "site_name": [f"Site {i:02d}" for i in site_ids],
        "postcode": [f"Z{int((a - 40) * 10):02d}{int((b + 3) * 10):02d}" for a, b in zip(lat, lon)],
        "latitude": lat, "longitude": lon, "floor_area_sqm": area.astype(int),
        "opened_date": [start - timedelta(days=int(d)) for d in rng.integers(400, 3000, n_sites)],
    }), "Every site that sells and serves customers, with its location and size.", {
        "site_id": "Site identifier.", "site_name": "Site display name.", "postcode": "Postal code area of the site.",
        "latitude": "Site latitude in degrees.", "longitude": "Site longitude in degrees.",
        "floor_area_sqm": "Selling floor area in square meters.",
        "opened_date": "Date the site opened.",
    }, pk="site_id")

    item_ids = np.arange(1, 7)
    list_price = np.array([9.5, 7.0, 14.0, 10.0, 3.5, 5.5])
    unit_cost = np.array([4.0, 3.0, 6.0, 4.5, 1.5, 2.2])
    launch_week = np.array([0, 0, 0, 0, 0, 80])
    tables["items"] = _kind_signal_table(pd.DataFrame({
        "item_id": item_ids, "item_name": ["Item A1", "Item A2", "Item B1", "Item B2", "Item C1", "Item A3"],
        "category": ["Category A", "Category A", "Category B", "Category B", "Category C", "Category A"],
        "list_price": list_price, "unit_cost": unit_cost, "launch_date": [week_dates[int(w)] for w in launch_week],
    }), "Every item the sites sell, with its category, list price, unit cost and launch date.", {
        "item_id": "Item identifier.", "item_name": "Item display name.", "category": "Item category.",
        "list_price": "Standard selling price per unit before any discount.", "unit_cost": "Cost to buy or make one unit.",
        "launch_date": "Date the item was first sold.",
    }, pk="item_id")

    z = np.zeros(weeks + 8)
    for t in range(1, weeks + 8):
        z[t] = 0.5 * z[t - 1] + rng.normal(0, math.sqrt(0.75))
    t_fit = np.arange(104)
    basis = np.column_stack([np.ones(104), t_fit / 52.0, np.sin(2 * np.pi * (t_fit % 52) / 52),
                             np.cos(2 * np.pi * (t_fit % 52) / 52), (t_fit >= 52).astype(float)])
    z[:104] -= basis @ np.linalg.lstsq(basis, z[:104], rcond=None)[0]
    z[104:weeks] -= z[104:weeks].mean()
    s_idx, i_idx, w_idx = [a.ravel() for a in np.meshgrid(np.arange(n_sites), np.arange(6), np.arange(weeks), indexing="ij")]
    keep = w_idx >= launch_week[i_idx]
    s_idx, i_idx, w_idx = s_idx[keep], i_idx[keep], w_idx[keep]
    n = len(w_idx)
    season = 1 + 0.25 * np.sin(2 * np.pi * ((w_idx % 52) - 13) / 52)
    trend = 1.08 ** (w_idx / 52.0)
    phase = rng.integers(0, 10, (n_sites, 6))[s_idx, i_idx]
    promo = (w_idx >= launch_week[i_idx] + 8 + phase) & (((w_idx - 8 - phase) % 10) < 2)
    cat_b = np.isin(i_idx, [2, 3]) & (w_idx >= 104)
    list_now = list_price[i_idx] * np.where(cat_b, 1.05, 1.0)
    price = np.round(list_now * (1 + 0.10 * rng.uniform(-1, 1, n)), 2)
    shift = np.where(cat_b & (i_idx == 2), 0.90, np.where(cat_b, 0.99, 1.0))
    cannibal = np.where((i_idx == 1) & (w_idx >= 80), 1 - 0.3 * base_units[5] / base_units[1], 1.0)
    missed = np.where(off_plan[s_idx] & (w_idx >= weeks - 13), 0.80, 1.0)
    expected = base_units[i_idx] * size[s_idx] * season * trend * np.where(promo, 1.08, 1.0) * shift * cannibal
    demand = expected * np.exp(0.04 * z[w_idx]) * (price / list_price[i_idx]) ** -1.5 * missed * np.exp(rng.normal(0, 0.08, n))
    plan_units = expected * (list_now / list_price[i_idx]) ** -1.5

    def capped(values):
        key = s_idx * weeks + w_idx
        totals = np.bincount(key, weights=values, minlength=n_sites * weeks)
        return values * np.minimum(1.0, capacity[s_idx] / np.maximum(totals[key], 1e-9))
    anomaly = _kind_signal_pick(rng, ~(off_plan[s_idx] & (w_idx >= weeks - 13)), 0.01 * n / (n - 13 * int(off_plan.sum()) * 6))
    demand = np.where(anomaly, demand * np.where(rng.uniform(0, 1, n) < 0.5, 3.0, 0.25), demand)
    units = capped(demand)
    plan_units = capped(plan_units)
    month = (w_idx * 7) // 30
    series_month = (s_idx * 6 + i_idx) * (int(month.max()) + 1) + month
    keys, first_row = np.unique(series_month, return_index=True)
    out_month = _kind_signal_pick(rng, np.ones(len(keys), bool), 0.10)
    stockout = np.zeros(n, bool)
    stockout[first_row[out_month]] = True
    units = np.where(stockout, units * 0.7, units)
    on_hand = np.where(stockout, 0, np.round(units * rng.uniform(0.5, 3.0, n)))
    units = np.maximum(1, np.round(units)).astype(int)
    cost_per_unit = 2.0 * size[s_idx] ** -0.2 * np.where(costly[s_idx], 1.25, 1.0) * np.exp(rng.normal(0, 0.03, n))
    lead = rng.integers(5, 22, (n_sites, 6))[s_idx, i_idx]
    tables["weekly_sales"] = _kind_signal_table(pd.DataFrame({
        "week_start": [week_dates[int(w)] for w in w_idx], "site_id": site_ids[s_idx], "item_id": item_ids[i_idx],
        "units_sold": units, "unit_price": price, "revenue_amount": np.round(units * price, 2),
        "plan_revenue_amount": np.round(plan_units * list_now, 2), "operating_cost": np.round(units * cost_per_unit, 2),
        "on_hand_units": on_hand.astype(int), "weekly_capacity_units": capacity[s_idx], "replenishment_lead_days": lead.astype(int),
        "promotion_active": np.where(promo, "Y", "N"),
    }), "Weekly sales per site and item: units, price, revenue against plan, operating cost, stock on hand, site capacity and promotions.", {
        "week_start": "Monday the sales week starts.", "site_id": "Site that sold the units.", "item_id": "Item sold.",
        "units_sold": "Units sold in the week.", "unit_price": "Average selling price per unit in the week.",
        "revenue_amount": "Revenue in the week: units sold times unit price.",
        "plan_revenue_amount": "Revenue the plan expected for the site and item in the week.",
        "operating_cost": "Cost of running the site attributed to this item in the week.",
        "on_hand_units": "Units in stock at the end of the week.",
        "weekly_capacity_units": "Most units the site can sell and hand over in one week with its current staff and space.",
        "replenishment_lead_days": "Days between ordering stock and receiving it for this site and item.",
        "promotion_active": "Y when the item was on promotion at the site that week, else N.",
    }, fks={"site_id": "sites", "item_id": "items"})

    campaign = np.zeros(weeks, bool)
    for b in range(4, weeks - 3, 10):
        campaign[b:b + 3] = True
    channels = {"tv_spend": 8000.0, "search_spend": 4000.0, "social_spend": 3000.0, "email_spend": 800.0}
    beta = {"tv_spend": 0.8, "search_spend": 1.0, "social_spend": 0.6, "email_spend": 0.3}
    w = np.arange(weeks)
    online = 20000 * (1 + 0.25 * np.sin(2 * np.pi * ((w % 52) - 13) / 52)) * 1.08 ** (w / 52.0)
    spends = {}
    for name, base in channels.items():
        flight = campaign if name == "tv_spend" else rng.uniform(0, 1, weeks) < 0.3
        spend = np.round(base * (1 + 2.0 * flight) * rng.uniform(0.7, 1.3, weeks), 2)
        stock = np.zeros(weeks)
        for t in range(weeks):
            stock[t] = spend[t] + (0.6 * stock[t - 1] if t else 0.0)
        half = base * 2.5
        online = online + beta[name] * 40000 * stock / (stock + half)
        spends[name] = spend
    online = np.round(online + rng.normal(0, 1500, weeks), 2)
    ahead = (z[4:weeks + 4] - z[4:weeks + 4].mean()) / z[4:weeks + 4].std()
    noise = rng.normal(0, 1, weeks)
    noise = noise - noise.mean() - ahead * (noise @ ahead) / (ahead @ ahead)
    lead_index = 0.65 * ahead + math.sqrt(1 - 0.65 ** 2) * noise / noise.std()
    tables["marketing_weekly"] = _kind_signal_table(pd.DataFrame({
        "week_start": week_dates, **spends, "campaign_active": np.where(campaign, "Y", "N"),
        "online_revenue_amount": online,
        "search_interest_index": np.round(100 + 10 * lead_index, 1),
    }), "Weekly marketing spend per channel, campaign weeks, online revenue and search interest.", {
        "week_start": "Monday the marketing week starts.", "tv_spend": "Television advertising spend in the week.",
        "search_spend": "Paid search spend in the week.", "social_spend": "Paid social media spend in the week.",
        "email_spend": "Email marketing spend in the week.", "campaign_active": "Y in weeks a brand campaign ran, else N.",
        "online_revenue_amount": "Revenue from online orders in the week.",
        "search_interest_index": "Index of how often people searched for the brand in the week, 100 is a normal week.",
    })

    n_orig, n_dup = 1900, 100
    names, addresses = _kind_signal_names(rng, n_orig)
    place = rng.uniform(0, 1, n_orig)
    near = rng.integers(0, n_sites, n_orig)
    c_lat = np.where(place < 0.70, np.array(lat)[near] + rng.normal(0, 0.05, n_orig),
                     np.where(place < 0.82, dense[0] + rng.normal(0, 0.03, n_orig), rng.uniform(40.0, 41.0, n_orig)))
    c_lon = np.where(place < 0.70, np.array(lon)[near] + rng.normal(0, 0.06, n_orig),
                     np.where(place < 0.82, dense[1] + rng.normal(0, 0.04, n_orig), rng.uniform(-3.0, -2.0, n_orig)))
    c_lat, c_lon = np.clip(c_lat, 40.0, 40.9999), np.clip(c_lon, -3.0, -2.0001)
    home = np.argmin((c_lat[:, None] - np.array(lat)[None, :]) ** 2 + ((c_lon[:, None] - np.array(lon)[None, :]) * 0.76) ** 2, axis=1)
    signup_offset = rng.integers(0, (date(2025, 6, 30) - start).days, n_orig)
    signup = np.array([start + timedelta(days=int(d)) for d in signup_offset])
    cohort = np.minimum(signup_offset // 182, 4)
    tier = rng.choice(["Basic", "Plus", "Premium", "Business"], n_orig, p=[0.40, 0.25, 0.20, 0.15])
    variant = np.where(_kind_signal_pick(rng, np.ones(n_orig, bool), 0.5), "treatment", "control")
    accept = np.zeros(n_orig, bool)
    for cell_tier in ("Basic", "Plus", "Premium", "Business"):
        for cell_variant in ("treatment", "control"):
            rate = 0.32 if (cell_tier, cell_variant) == ("Plus", "treatment") else 0.12
            accept |= _kind_signal_pick(rng, (tier == cell_tier) & (variant == cell_variant), rate)
    tenure = np.maximum(1, np.array([(as_of.date() - d).days for d in signup]) // 30)
    contacts = rng.poisson(1.5, n_orig)
    spend_change = np.round(rng.normal(0, 0.15, n_orig), 3)
    logit = -0.04 * tenure + 0.6 * contacts - 5.0 * spend_change + rng.normal(0, 0.4, n_orig)
    shift_by = _kind_signal_solve(lambda b: (1 / (1 + np.exp(-(logit + b)))).mean(), 0.10, -20.0, 20.0)
    prob = 1 / (1 + np.exp(-(logit + shift_by)))
    churned = np.zeros(n_orig, bool)
    for group, rate in enumerate([0.15, 0.12, 0.10, 0.08, 0.05]):
        members = np.flatnonzero(cohort == group)
        weight = prob[members] / prob[members].sum()
        churned[rng.choice(members, int(round(rate * len(members))), replace=False, p=weight)] = True
    raw = 1 / (1 + np.exp(-(np.log(prob / (1 - prob)) + rng.normal(0, 0.9, n_orig))))
    cut = np.quantile(raw[churned], 1 / 3)
    risk = np.clip(raw - cut + 0.7, 0.0, 1.0)
    limit = np.round(rng.choice([1000, 2500, 5000, 10000], n_orig) * 1.0, 2)
    band = np.argsort(rng.uniform(0, 1, n_orig)) / n_orig
    utilization = np.where(band < 0.94, rng.uniform(0.05, 0.80, n_orig),
                           np.where(band < 0.99, rng.uniform(0.84, 0.99, n_orig), rng.uniform(1.01, 1.15, n_orig)))
    customers = pd.DataFrame({
        "customer_id": np.arange(1, n_orig + 1), "customer_name": names, "street_address": addresses,
        "postcode": [f"Z{int((a - 40) * 10):02d}{int((b + 3) * 10):02d}" for a, b in zip(c_lat, c_lon)],
        "latitude": np.round(c_lat, 5), "longitude": np.round(c_lon, 5), "home_site_id": site_ids[home],
        "signup_date": signup, "customer_tier": tier, "offer_variant": variant,
        "offer_outcome": np.where(accept, "accepted", "declined"), "tenure_months": tenure.astype(int),
        "support_contacts_12m": contacts.astype(int), "spend_change_pct": np.round(spend_change * 100, 1),
        "is_churned": np.where(churned, "Y", "N"), "churn_risk_score": np.round(risk, 3),
        "credit_limit": limit, "balance_amount": np.round(limit * utilization, 2),
        "interest_rate": np.round(rng.uniform(0.08, 0.24, n_orig), 4),
    })
    dup_src = rng.choice(n_orig, n_dup, replace=False)
    dups = customers.iloc[dup_src].copy()
    dups["customer_id"] = np.arange(n_orig + 1, n_orig + n_dup + 1)
    dups["customer_name"] = [_kind_signal_misspell(rng, v) for v in dups["customer_name"]]
    dups["street_address"] = [v.replace(" Street", " St") for v in dups["street_address"]]
    dups["latitude"] = np.round(dups["latitude"] + rng.normal(0, 0.0005, n_dup), 5)
    dups["longitude"] = np.round(dups["longitude"] + rng.normal(0, 0.0005, n_dup), 5)
    dups["signup_date"] = [d + timedelta(days=int(k)) for d, k in zip(dups["signup_date"], rng.integers(30, 400, n_dup))]
    customers = pd.concat([customers, dups], ignore_index=True)
    tables["customers"] = _kind_signal_table(customers, "Every customer with contact details, location, home site, tier, "
                                             "the current offer test, churn status, risk score and credit position.", {
        "customer_id": "Customer identifier.", "customer_name": "Customer full name as entered at signup.",
        "street_address": "Street address as entered at signup.", "postcode": "Postal code area of the customer.",
        "latitude": "Customer home latitude in degrees.", "longitude": "Customer home longitude in degrees.",
        "home_site_id": "Site nearest to the customer's home.", "signup_date": "Date the customer signed up.",
        "customer_tier": "Membership tier: Basic, Plus, Premium or Business.",
        "offer_variant": "Group of the current offer test: treatment received the new offer, control did not; assigned at random.",
        "offer_outcome": "Whether the customer accepted the current offer: accepted or declined.",
        "tenure_months": "Months since the customer signed up.",
        "support_contacts_12m": "Support contacts the customer made in the last 12 months.",
        "spend_change_pct": "Change in the customer's monthly spend over the last 6 months, in percent.",
        "is_churned": "Y when the customer has left (no purchase in 90 days and account closed), else N.",
        "churn_risk_score": "Current churn risk score from 0 to 1; retention reviews start at 0.7 or above.",
        "credit_limit": "Credit the customer may use.", "balance_amount": "Credit balance the customer owes now.",
        "interest_rate": "Yearly interest rate on the customer's balance.",
    }, pk="customer_id", fks={"home_site_id": "sites"})

    group = rng.permutation(n_orig) % 4
    freq = np.where(group % 2 == 1, 10.0, 1.5) * np.exp(rng.normal(0, 0.25, n_orig))
    aov = np.where(group >= 2, 110.0, 25.0) * np.exp(rng.normal(0, 0.25, n_orig))
    affinity = rng.integers(0, 3, n_orig)
    pairs = [(1, 2), (3, 4), (5, 6)]
    window_start = as_of - timedelta(weeks=104)
    launch_dt = datetime.combine(week_dates[80], datetime.min.time())
    rows = []
    for c in range(n_orig):
        begin = max(window_start, datetime.combine(signup[c], datetime.min.time()))
        end = as_of
        if churned[c]:
            span = (as_of - timedelta(days=95) - begin).days
            end = begin + timedelta(days=int(rng.integers(0, max(span, 1)) + 1)) if span > 0 else begin + timedelta(days=1)
        days = max((end - begin).days, 1)
        count = 1 + rng.poisson(freq[c] * days / 365.0)
        for when in np.sort(rng.integers(0, days, count)):
            at = begin + timedelta(days=int(when), hours=int(rng.integers(8, 21)))
            pair = pairs[affinity[c]]
            item = pair[0] if rng.uniform() < 0.5 else pair[1]
            if rng.uniform() > 0.8:
                item = int(rng.integers(1, 7))
            if item == 6 and at < launch_dt:
                item = 5
            amount = round(float(aov[c] * math.exp(rng.normal(0, 0.5))), 2)
            rows.append((c + 1, int(site_ids[home[c]]), item, at, amount,
                         max(1, int(round(amount / list_price[item - 1])))))
    orders = pd.DataFrame(rows, columns=["customer_id", "site_id", "item_id", "ordered_at", "order_amount", "units_ordered"])
    orders.insert(0, "order_id", np.arange(1, len(orders) + 1))
    orders["freight_cost"] = np.round(7.0 + 0.02 * orders["order_amount"], 2)
    orders["handling_cost"] = np.round(8.0 + 0.5 * orders["units_ordered"], 2)
    tables["orders"] = _kind_signal_table(orders, "Every customer order of the last two years with its item, amount and the "
                                          "freight and handling it cost to serve.", {
        "order_id": "Order identifier.", "customer_id": "Customer who placed the order.", "site_id": "Site that served the order.",
        "item_id": "Main item ordered.", "ordered_at": "Date and time the order was placed.",
        "order_amount": "Amount the customer paid for the order.", "units_ordered": "Units in the order.",
        "freight_cost": "Freight cost to deliver the order.", "handling_cost": "Cost to pick, pack and hand over the order.",
    }, pk="order_id", fks={"customer_id": "customers", "site_id": "sites", "item_id": "items"})

    n_cases = 1500
    dow_w = np.array([1.6, 1.2, 1.0, 1.0, 0.9, 0.6, 0.5])
    hour_w = np.array([0.2] * 7 + [0.6, 1.2, 3.0, 3.0, 3.0, 1.2, 1.2, 2.0, 2.0, 2.0, 1.2, 0.6] + [0.2] * 5)
    window_days = np.arange(364)
    first_day = as_of - timedelta(days=364)
    day_p = dow_w[[(first_day + timedelta(days=int(d))).weekday() for d in window_days]]
    day = rng.choice(window_days, n_cases, p=day_p / day_p.sum())
    hour = rng.choice(24, n_cases, p=hour_w / hour_w.sum())
    created = [first_day + timedelta(days=int(d), hours=int(h), minutes=int(m))
               for d, h, m in zip(day, hour, rng.integers(0, 60, n_cases))]
    priority = rng.choice(["high", "normal", "low"], n_cases, p=[0.25, 0.5, 0.25])
    unit_days = np.array([{"high": 7.0, "normal": 16.0, "low": 32.0}[p] for p in priority]) * np.exp(rng.normal(0, 0.5, n_cases))
    jit = np.exp(rng.normal(0, 0.2, (n_cases, 5)))
    start_day = np.array([(c - first_day).total_seconds() / 86400 for c in created])
    horizon = (as_of - first_day).total_seconds() / 86400
    to_decision = unit_days * jit[:, :3].sum(axis=1)
    to_close = to_decision + unit_days * (3.0 * jit[:, 3] + jit[:, 4])
    rank = np.empty(n_cases, int)
    rank[np.argsort(rng.uniform(0, 1, n_cases))] = np.arange(n_cases)

    def split(scale):
        decided = start_day + scale * to_decision <= horizon
        approve = np.zeros(n_cases, bool)
        for part in (decided, ~decided):
            idx = np.flatnonzero(part)
            approve[idx[np.argsort(rank[idx])][:int(round(0.6 * len(idx)))]] = True
        return approve

    def open_share(scale, approve):
        return float((start_day + scale * np.where(approve, to_close, to_decision) > horizon).mean())
    scale, approves = 1.0, split(1.0)
    for _ in range(4):
        scale = _kind_signal_solve(lambda c: open_share(c, approves), 0.30, 0.01, 50.0)
        approves = split(scale)
    total_days = scale * np.where(approves, to_close, to_decision)
    done = start_day + total_days <= horizon

    def sla_for(q):
        return {p: float(np.quantile(total_days[priority == p], q)) for p in ("high", "normal", "low")}

    def breach_share(q):
        sla = np.array([sla_for(q)[p] for p in priority])
        return float(np.where(done, total_days > sla, horizon - start_day > sla).mean())
    sla_days = sla_for(_kind_signal_solve(lambda q: -breach_share(q), -0.15, 0.5, 0.999))
    reasons = [("late", ["The delivery arrived late again.", "My order came late, days after the promised date.",
                         "Delivery was late and nobody told me."]),
               ("wrong item", ["I received the wrong item.", "The wrong item was in the bag.", "They sent me the wrong item."]),
               ("billing", ["I was charged twice on my bill.", "There is a billing error on my last invoice.",
                            "My card was charged twice for one order."]),
               ("rude", ["The staff member was rude to me.", "Staff were rude at the counter.", "A rude reply from the staff."]),
               ("damaged", ["The package was damaged.", "The item arrived damaged.", "Damaged packaging and a broken seal."])]
    fillers = ["", " Please fix this.", " This is not the first time.", " I expect a call back.", " Not happy."]
    reason_of = np.zeros(n_cases, int)
    by_time = np.argsort(start_day, kind="stable")
    for half, billing in ((by_time[:n_cases // 2], 0.12), (by_time[n_cases // 2:], 0.26)):
        counts = [int(round(len(half) * (1 - billing) / 4))] * 4
        labels = np.repeat([0, 1, 3, 4], counts)
        labels = np.concatenate([labels, np.full(len(half) - len(labels), 2)])
        reason_of[half] = rng.permutation(labels)
    case_rows, event_rows = [], []
    for k in range(n_cases):
        r = int(reason_of[k])
        text = reasons[r][1][int(rng.integers(0, 3))] + fillers[int(rng.integers(0, len(fillers)))]
        waits = [("triaged", jit[k, 0]), ("reviewed", jit[k, 1])]
        waits += [("approved", jit[k, 2]), ("fulfilled", 3.0 * jit[k, 3]), ("closed", jit[k, 4])] if approves[k] else [("closed", jit[k, 2])]
        at = created[k]
        resolved = None
        event_rows.append((k + 1, "received", at, f"Team {int(rng.integers(1, 5))}"))
        for step, weight in waits:
            at = at + timedelta(days=float(scale * unit_days[k] * weight))
            if at > as_of:
                break
            event_rows.append((k + 1, step, at, f"Team {int(rng.integers(1, 5))}"))
            if step == "closed":
                resolved = at
        case_rows.append((k + 1, int(rng.integers(1, n_orig + 1)), int(rng.integers(1, n_sites + 1)), created[k],
                          created[k] + timedelta(hours=round(sla_days[priority[k]] * 24)), resolved,
                          "closed" if resolved is not None else "open", priority[k], text))
    cases = pd.DataFrame(case_rows, columns=["case_id", "customer_id", "site_id", "created_at", "due_at", "resolved_at",
                                             "case_status", "priority", "complaint_text"])
    tables["cases"] = _kind_signal_table(cases, "Every customer case opened in the last year, with its due date, resolution, "
                                         "priority and the customer's own words.", {
        "case_id": "Case identifier.", "customer_id": "Customer who raised the case.", "site_id": "Site the case is about.",
        "created_at": "Date and time the case was opened.", "due_at": "Date and time the case must be resolved by.",
        "resolved_at": "Date and time the case was resolved; empty while open.", "case_status": "open or closed.",
        "priority": "Case priority: high, normal or low.", "complaint_text": "What the customer wrote, in their own words.",
    }, pk="case_id", fks={"customer_id": "customers", "site_id": "sites"})
    events = pd.DataFrame(event_rows, columns=["case_id", "step_name", "event_at", "handled_by_team"])
    events.insert(0, "event_id", np.arange(1, len(events) + 1))
    tables["case_events"] = _kind_signal_table(events, "Every step each case went through, with the time it happened.", {
        "event_id": "Event identifier.", "case_id": "Case the step belongs to.",
        "step_name": "Step reached: received, triaged, reviewed, approved, fulfilled or closed.",
        "event_at": "Date and time the case reached the step.", "handled_by_team": "Team that handled the step.",
    }, pk="event_id", fks={"case_id": "cases"})

    late_payer = _kind_signal_pick(rng, np.ones(n_orig, bool), 0.20)
    inv_rows = []
    for c in range(n_orig):
        for issue in np.sort(rng.integers(0, 700, 3)):
            issued = (as_of - timedelta(days=int(issue) + 5)).date()
            due = issued + timedelta(days=30)
            paid = due + timedelta(days=int(rng.integers(5, 41))) if late_payer[c] else issued + timedelta(days=int(rng.integers(5, 29)))
            amount = round(float(400 * math.exp(rng.normal(0, 0.6))), 2)
            paid = paid if paid <= as_of.date() else None
            status = "paid" if paid else ("overdue" if due < as_of.date() else "open")
            inv_rows.append((c + 1, issued, due, paid, amount, amount if paid else 0.0, status))
    invoices = pd.DataFrame(inv_rows, columns=["customer_id", "issue_date", "due_date", "paid_date", "invoice_amount",
                                               "amount_paid", "invoice_status"])
    invoices.insert(0, "invoice_id", np.arange(1, len(invoices) + 1))
    tables["invoices"] = _kind_signal_table(invoices, "Every invoice sent to customers, with its due date, payment date and "
                                            "the amount the ledger shows as paid.", {
        "invoice_id": "Invoice identifier.", "customer_id": "Customer billed.", "issue_date": "Date the invoice was issued.",
        "due_date": "Date payment is due.", "paid_date": "Date the payment arrived; empty while unpaid.",
        "invoice_amount": "Amount billed.", "amount_paid": "Amount the ledger records as paid.",
        "invoice_status": "paid, open or overdue.",
    }, pk="invoice_id", fks={"customer_id": "customers"})
    paid_rows = invoices[invoices["paid_date"].notna()].reset_index(drop=True)
    m = len(paid_rows)
    clerks = [f"Clerk {i:02d}" for i in range(1, 13)]
    creator = rng.integers(0, 12, m)
    approver = (creator + rng.integers(1, 12, m)) % 12
    self_ok = _kind_signal_pick(rng, np.ones(m, bool), 0.01)
    approver = np.where(self_ok, creator, approver)
    short = _kind_signal_pick(rng, np.ones(m, bool), 0.02)
    payments = pd.DataFrame({
        "invoice_id": paid_rows["invoice_id"], "payment_date": paid_rows["paid_date"],
        "paid_amount": np.round(paid_rows["invoice_amount"] * np.where(short, rng.uniform(0.85, 0.99, m), 1.0), 2),
        "created_by": [clerks[i] for i in creator], "approved_by": [clerks[i] for i in approver],
    })
    payments = pd.concat([payments, payments.iloc[rng.choice(m, 12, replace=False)]], ignore_index=True)
    payments.insert(0, "payment_id", np.arange(1, len(payments) + 1))
    tables["payments"] = _kind_signal_table(payments, "Every payment received from the bank, with who entered and who approved it.", {
        "payment_id": "Payment identifier.", "invoice_id": "Invoice the payment settles.", "payment_date": "Date the bank received the payment.",
        "paid_amount": "Amount the bank received.", "created_by": "Clerk who entered the payment.",
        "approved_by": "Clerk who approved the payment.",
    }, pk="payment_id", fks={"invoice_id": "invoices"})

    n_meas = 1200
    meas_rows = []
    for line in range(1, 5):
        when = sorted(as_of - timedelta(hours=float(h)) for h in rng.uniform(0, 26 * 7 * 24, n_meas))
        values = rng.normal(500.0, 2.0, n_meas)
        if line == 3:
            values[int(n_meas * 0.8):] += 3.2
        meas_rows += [(f"Line {line}", t, round(float(v), 2), 494.0, 506.0) for t, v in zip(when, values)]
    measurements = pd.DataFrame(meas_rows, columns=["line_name", "measured_at", "fill_volume_ml", "lower_spec_limit",
                                                    "upper_spec_limit"])
    measurements.insert(0, "measurement_id", np.arange(1, len(measurements) + 1))
    tables["measurements"] = _kind_signal_table(measurements, "Quality measurements of the fill volume on each packing line "
                                                "with the specification limits.", {
        "measurement_id": "Measurement identifier.", "line_name": "Packing line measured.",
        "measured_at": "Date and time of the measurement.", "fill_volume_ml": "Measured fill volume in milliliters.",
        "lower_spec_limit": "Lowest fill volume the specification allows.",
        "upper_spec_limit": "Highest fill volume the specification allows.",
    }, pk="measurement_id")

    members = rng.permutation(n_orig)[:27] + 1
    rings = [members[:6], members[6:15], members[15:27]]
    link_rows = []
    for r, ring in enumerate(rings):
        for a, b in zip(ring[:-1], ring[1:]):
            link_rows.append((int(a), int(b), f"DEV-{r + 1:03d}", "shared_device"))
        for _ in range(len(ring) // 2):
            a, b = rng.choice(ring, 2, replace=False)
            link_rows.append((int(a), int(b), f"DEV-{r + 1:03d}", "shared_device"))
    others = np.setdiff1d(np.arange(1, n_orig + 1), members)
    pairs_drawn = rng.permutation(others)[:600].reshape(300, 2)
    for k, (a, b) in enumerate(pairs_drawn):
        kind = "shared_address" if k % 2 else "transfer"
        link_rows.append((int(a), int(b), f"DEV-{100 + k:03d}" if kind == "transfer" else "", kind))
    links = pd.DataFrame(link_rows, columns=["from_customer_id", "to_customer_id", "shared_device_id", "link_type"])
    links.insert(0, "link_id", np.arange(1, len(links) + 1))
    links["transfer_amount"] = np.round(np.exp(rng.normal(4.5, 0.8, len(links))), 2)
    tables["account_links"] = _kind_signal_table(links, "Links between customer accounts: a shared device, a shared address "
                                                 "or a money transfer.", {
        "link_id": "Link identifier.", "from_customer_id": "First customer of the link.", "to_customer_id": "Second customer of the link.",
        "shared_device_id": "Device both accounts used; empty when the link is not a device.",
        "link_type": "shared_device, shared_address or transfer.", "transfer_amount": "Money moved between the two accounts.",
    }, pk="link_id", fks={"from_customer_id": "customers", "to_customer_id": "customers"})

    tr_rows = []
    non_hubs = [s for s in site_ids if s not in hubs]
    via_hub = _kind_signal_pick(rng, np.ones(104 * 6, bool), 0.4)
    for wk in range(weeks - 104, weeks):
        for slot in range(6):
            if via_hub[(wk - weeks + 104) * 6 + slot]:
                hub, other = int(hubs[int(rng.integers(0, 2))]), int(rng.choice(non_hubs))
                a, b = (hub, other) if rng.uniform() < 0.5 else (other, hub)
            else:
                a, b = (int(x) for x in rng.choice(non_hubs, 2, replace=False))
            tr_rows.append((a, b, week_dates[wk], int(round(math.exp(rng.normal(math.log(50), 0.4))))))
    transfers = pd.DataFrame(tr_rows, columns=["from_site_id", "to_site_id", "week_start", "transfer_units"])
    hub_units = transfers.loc[via_hub, "transfer_units"].sum()
    other_units = transfers.loc[~via_hub, "transfer_units"].sum()
    transfers.loc[via_hub, "transfer_units"] = np.maximum(1, np.round(transfers.loc[via_hub, "transfer_units"]
                                                                      * (0.4 / 0.6) * other_units / hub_units)).astype(int)
    transfers.insert(0, "transfer_id", np.arange(1, len(transfers) + 1))
    tables["site_transfers"] = _kind_signal_table(transfers, "Stock moved between sites each week.", {
        "transfer_id": "Transfer identifier.", "from_site_id": "Site that sent the stock.", "to_site_id": "Site that received the stock.",
        "week_start": "Monday of the week the stock moved.", "transfer_units": "Units moved.",
    }, pk="transfer_id", fks={"from_site_id": "sites", "to_site_id": "sites"})
    return {"seed": seed, "as_of": as_of, "tables": tables}


def _ks_result(ok, detail, items):
    return {"ok": bool(ok), "detail": detail, "items": int(items)}


def _ks_week_index(values):
    return ((pd.to_datetime(pd.Series(values)) - pd.Timestamp(KIND_SIGNAL_START)).dt.days // 7).to_numpy()


def _ks_demand_fit(sales):
    caps = sales.groupby(["site_id", "week_start"])["units_sold"].transform("sum")
    clean = _ks_week_index(sales["week_start"]) < 104
    frame = sales[(sales["item_id"] == 5) & clean & (caps < sales["weekly_capacity_units"] * 0.97)].copy()
    week = _ks_week_index(frame["week_start"])
    y = np.log(frame["units_sold"].to_numpy(float))
    x = np.column_stack([np.log(frame["unit_price"].to_numpy(float)), (frame["promotion_active"] == "Y").to_numpy(float),
                         week / 52.0, np.sin(2 * np.pi * (week % 52) / 52), np.cos(2 * np.pi * (week % 52) / 52)])
    site = frame["site_id"].to_numpy()
    for col in range(x.shape[1]):
        x[:, col] -= pd.Series(x[:, col]).groupby(site).transform("mean").to_numpy()
    y = y - pd.Series(y).groupby(site).transform("mean").to_numpy()
    keep = np.abs(y - np.median(y)) < 0.6
    coef = np.linalg.lstsq(x[keep], y[keep], rcond=None)[0]
    return {"elasticity": float(coef[0]), "promo_lift": float(math.exp(coef[1]) - 1), "trend": float(math.exp(coef[2]) - 1)}


def _ks_steps(events):
    ordered = events.sort_values(["case_id", "event_at"])
    nxt = ordered.groupby("case_id")["step_name"].shift(-1)
    reviewed = ordered[ordered["step_name"] == "reviewed"]
    followed = nxt.loc[reviewed.index].dropna()
    return ordered, nxt, followed


def _ks_components(pairs):
    parent = {}

    def find(a):
        parent.setdefault(a, a)
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a, b in pairs:
        parent[find(a)] = find(b)
    sizes = {}
    for node in list(parent):
        root = find(node)
        sizes[root] = sizes.get(root, 0) + 1
    return sorted(sizes.values(), reverse=True)


def _kind_signal_checks(bundle):
    t = {name: spec["frame"] for name, spec in bundle["tables"].items()}
    as_of = pd.Timestamp(bundle["as_of"])
    sales, sites, items, cust = t["weekly_sales"], t["sites"], t["items"], t["customers"]
    week = _ks_week_index(sales["week_start"])
    out = {}

    recent = sales[week >= KIND_SIGNAL_WEEKS - 12].assign(month=(week[week >= KIND_SIGNAL_WEEKS - 12] - (KIND_SIGNAL_WEEKS - 12)) // 4)
    by_month = recent.groupby(["site_id", "month"])[["revenue_amount", "plan_revenue_amount"]].sum()
    ratio = (by_month["revenue_amount"] / by_month["plan_revenue_amount"]).unstack()
    totals = recent.groupby("site_id")[["revenue_amount", "plan_revenue_amount"]].sum()
    missed = ratio.index[(ratio < 0.97).all(axis=1) & (totals["revenue_amount"] / totals["plan_revenue_amount"] < 0.9)]
    earlier = sales[(week >= KIND_SIGNAL_WEEKS - 25) & (week < KIND_SIGNAL_WEEKS - 12)]
    price_move = (recent[recent["site_id"].isin(missed)]["unit_price"].mean()
                  / earlier[earlier["site_id"].isin(missed)]["unit_price"].mean() - 1)
    out["Variance to plan"] = _ks_result(len(missed) == 8 and abs(price_move) < 0.03,
                                         f"{len(missed)} sites under plan by over 10% across the last 3 months and in every one of them, price moved {price_move:+.1%}",
                                         len(ratio))

    cat_b = sales["item_id"].isin(items.loc[items["category"] == "Category B", "item_id"])
    y2, y3 = cat_b & (week >= 52) & (week < 104), cat_b & (week >= 104)
    price_rise = (sales.loc[y3, "revenue_amount"].sum() / sales.loc[y3, "units_sold"].sum()) / \
        (sales.loc[y2, "revenue_amount"].sum() / sales.loc[y2, "units_sold"].sum()) - 1
    list_rise = sales.loc[y3, "unit_price"].mean() / sales.loc[y2, "unit_price"].mean() - 1
    control = sales["item_id"] == 5
    vol_drop = (sales.loc[y3, "units_sold"].sum() / sales.loc[y2, "units_sold"].sum()) / \
        (sales.loc[control & (week >= 104), "units_sold"].sum() / sales.loc[control & (week >= 52) & (week < 104), "units_sold"].sum()) - 1
    cheap = int(items.loc[items["category"] == "Category B"].sort_values("list_price")["item_id"].iloc[0])
    share = [sales.loc[mask & (sales["item_id"] == cheap), "units_sold"].sum() / sales.loc[mask, "units_sold"].sum() for mask in (y2, y3)]
    out["Driver breakdown"] = _ks_result(0.04 <= list_rise <= 0.06 and -0.15 <= vol_drop <= -0.09 and share[1] > share[0],
                                         f"category price {list_rise:+.1%}, volume {vol_drop:+.1%} against the trend, cheaper item share "
                                         f"{share[0]:.0%} to {share[1]:.0%}, average price {price_rise:+.1%}", 3)

    unit_cost = sales.groupby("site_id")["operating_cost"].sum() / sales.groupby("site_id")["units_sold"].sum()
    area = sites.set_index("site_id")["floor_area_sqm"].reindex(unit_cost.index)
    slope, inter, _, _ = theilslopes(np.log(unit_cost), np.log(area))
    resid = np.sort(np.exp(np.log(unit_cost) - (slope * np.log(area) + inter)).to_numpy())[::-1]
    base = np.median(resid[4:])
    out["Peer benchmarking"] = _ks_result(1.18 <= resid[3] / base and resid[0] / base <= 1.35 and resid[4] / base < 1.08,
                                          f"top 4 sites run {resid[3] / base - 1:+.0%} to {resid[0] / base - 1:+.0%} above the size-adjusted peer cost per unit, "
                                          f"the next {resid[4] / base - 1:+.0%}", len(unit_cost))

    total = sales.groupby(week)[["revenue_amount", "plan_revenue_amount"]].sum()
    gap = np.log(total["revenue_amount"] / total["plan_revenue_amount"]).to_numpy()
    index = t["marketing_weekly"]["search_interest_index"].to_numpy()
    usable = KIND_SIGNAL_WEEKS - 13
    corr = {lag: float(np.corrcoef(index[:usable - lag], gap[lag:usable])[0, 1]) for lag in range(0, 9)}
    best = max(corr, key=corr.get)
    out["Leading indicators"] = _ks_result(best == 4 and 0.45 <= corr[4] <= 0.8,
                                           f"search interest leads sales by {best} weeks, correlation {corr[best]:.2f}", len(corr))

    series = sales.groupby(["site_id", "item_id"]).size()
    item5 = sales[sales["item_id"] == 5].groupby(week[sales["item_id"] == 5])["units_sold"].sum().to_numpy(float)
    detrended = item5 / pd.Series(item5).rolling(52, center=True, min_periods=26).mean().to_numpy()
    seasonal = float(pd.Series(detrended).autocorr(52))
    growth = item5[104:].sum() / item5[:52].sum()
    out["Forecast"] = _ks_result((series >= 104).sum() >= 5 and seasonal > 0.5 and growth > 1.08,
                                 f"{int((series >= 104).sum())} series with 104 or more weeks, yearly autocorrelation {seasonal:.2f}, "
                                 f"two-year growth {growth - 1:+.0%}", int((series >= 104).sum()))

    orig = cust[cust["customer_id"] <= int(cust["customer_id"].max()) - int((cust["street_address"].str.endswith(" St")).sum())]
    label = (orig["is_churned"] == "Y").to_numpy()
    feats = orig[["tenure_months", "support_contacts_12m", "spend_change_pct"]].to_numpy(float)
    model = LogisticRegression(max_iter=1000).fit(feats, label)
    auc = roc_auc_score(label, model.predict_proba(feats)[:, 1])
    out["Risk or propensity"] = _ks_result(0.08 <= label.mean() <= 0.12 and auc >= 0.7,
                                        f"churn base rate {label.mean():.1%}, 3 drivers give AUC {auc:.2f}", len(orig))

    cases = t["cases"]
    open_share = (cases["case_status"] == "open").mean()
    closed = cases[cases["case_status"] == "closed"]
    days = (closed["resolved_at"] - closed["created_at"]).dt.total_seconds() / 86400
    med = days.groupby(closed["priority"]).median()
    out["Time to event"] = _ks_result(0.25 <= open_share <= 0.35 and med["high"] < med["normal"] < med["low"],
                                      f"{open_share:.0%} of cases open, median days to close high {med['high']:.0f}, "
                                      f"normal {med['normal']:.0f}, low {med['low']:.0f}", int((cases["case_status"] == "open").sum()))

    ordered, nxt, followed = _ks_steps(t["case_events"])
    to_approved = float((followed == "approved").mean())
    out["Next event or sequence"] = _ks_result(0.52 <= to_approved <= 0.68, f"reviewed is followed by approved {to_approved:.0%} of the time",
                                   len(followed))
    out["Journey and path"] = _ks_result(0.32 <= 1 - to_approved <= 0.48,
                                     f"{1 - to_approved:.0%} of cases drop between reviewed and approved", len(followed))

    last_year = sales[week >= 104]
    load = last_year.groupby(["site_id", "week_start"]).agg(units=("units_sold", "sum"), cap=("weekly_capacity_units", "max")).reset_index()
    at_cap = (load["units"] >= load["cap"] * 0.98).groupby(load["site_id"]).mean()
    first_year = sales[week < 52].groupby(["site_id", "week_start"]).agg(units=("units_sold", "sum"), cap=("weekly_capacity_units", "max")).reset_index()
    at_cap_y1 = (first_year["units"] >= first_year["cap"] * 0.98).groupby(first_year["site_id"]).mean()
    bound = int((at_cap >= 0.2).sum())
    out["Allocation"] = _ks_result(3 <= bound <= 8 and int((at_cap < 0.05).sum()) >= 15,
                                   f"{bound} sites hit capacity in 20% or more of last-year weeks while "
                                   f"{int((at_cap < 0.05).sum())} have room", len(at_cap))

    fit = _ks_demand_fit(sales)
    out["Price, discount, markdown"] = _ks_result(-1.8 <= fit["elasticity"] <= -1.2 and "unit_cost" in items,
                                f"price elasticity {fit['elasticity']:.2f} with a cost per unit per item", len(items))

    month = (week * 7) // 30
    out_of_stock = (sales["on_hand_units"] == 0).groupby([sales["site_id"], sales["item_id"], month]).any()
    lead = sales["replenishment_lead_days"]
    out["Inventory and replenishment"] = _ks_result(0.08 <= out_of_stock.mean() <= 0.12 and lead.min() > 0,
                                                f"{out_of_stock.mean():.1%} of item-months run out, lead times {lead.min()} to {lead.max()} days",
                                                len(series))

    hours = cases["created_at"].dt.hour.value_counts().reindex(range(24), fill_value=0)
    dow = cases["created_at"].dt.dayofweek.value_counts().reindex(range(7), fill_value=0)
    out["Staffing and queueing"] = _ks_result(hours.max() >= 2 * hours.mean() and dow[0] == dow.max() and dow[0] >= 1.3 * dow.mean(),
                                          f"peak hour {hours.idxmax()}:00 at {hours.max() / hours.mean():.1f} times the average, "
                                          f"Monday at {dow[0] / dow.mean():.1f} times", 24)

    s_lat, s_lon = sites["latitude"].to_numpy(), sites["longitude"].to_numpy()
    dist = np.sqrt(((cust["latitude"].to_numpy()[:, None] - s_lat) * 111) ** 2
                   + ((cust["longitude"].to_numpy()[:, None] - s_lon) * 84) ** 2).min(axis=1)
    far = cust[dist > 20]
    cell = (far["latitude"] * 10).astype(int).astype(str) + "_" + (far["longitude"] * 10).astype(int).astype(str)
    gap_cell = cell.value_counts()
    out["Site and territory"] = _ks_result(len(gap_cell) > 0 and gap_cell.iloc[0] >= 100,
                                       f"{int(gap_cell.iloc[0]) if len(gap_cell) else 0} customers in one area more than 20 km from any site",
                                       len(sites))

    churn = orig[orig["is_churned"] == "Y"]
    missed_share = float((churn["churn_risk_score"] < 0.7).mean())
    out["Threshold and policy tuning"] = _ks_result(0.28 <= missed_share <= 0.38,
                                         f"the 0.7 threshold misses {missed_share:.0%} of churned customers",
                                         int((orig["churn_risk_score"] >= 0.7).sum()))

    i1 = sales[sales["item_id"] == 1].groupby(week[sales["item_id"] == 1])["units_sold"].sum()
    i2 = sales[sales["item_id"] == 2].groupby(week[sales["item_id"] == 2])["units_sold"].sum()
    i6 = sales[sales["item_id"] == 6].groupby(week[sales["item_id"] == 6])["units_sold"].sum()
    pre, post = (i2.index >= 40) & (i2.index < 80), (i2.index >= 80) & (i2.index < 120)
    expected_i2 = (i2[pre] / i1[pre]).mean() * i1[post]
    taken = float((expected_i2 - i2[post]).sum() / i6.loc[80:119].sum())
    out["Assortment and cannibalization"] = _ks_result(0.2 <= taken <= 0.4, f"the new item takes {taken:.0%} of its volume from one existing item",
                                   len(items))

    levers = {"price": -1.8 <= fit["elasticity"] <= -1.2, "promotion": 0.04 <= fit["promo_lift"] <= 0.12,
              "trend": 0.05 <= fit["trend"] <= 0.11}
    out["Driver-based scenarios"] = _ks_result(all(levers.values()),
                                         f"volume moves with price ({fit['elasticity']:.2f}), promotion ({fit['promo_lift']:+.1%}) "
                                         f"and trend ({fit['trend']:+.1%} a year)", sum(levers.values()))

    under = orig["balance_amount"] <= orig["credit_limit"]
    pushed = float(((orig["balance_amount"] * 1.2 > orig["credit_limit"]) & under).mean())
    out["Stress test"] = _ks_result(0.04 <= pushed <= 0.07, f"a 20% shock pushes {pushed:.1%} of balances over their limit",
                                    int(((orig["balance_amount"] * 1.2 > orig["credit_limit"]) & under).sum()))

    newly = int(((at_cap - at_cap_y1.reindex(at_cap.index)) >= 0.15).sum())
    free = sales["site_id"].isin(at_cap.index[at_cap < 0.05]) & control
    yoy = sales.loc[free & (week >= 52) & (week < 104), "units_sold"].sum() / sales.loc[free & (week < 52), "units_sold"].sum() - 1
    out["Capacity planning"] = _ks_result(0.04 <= yoy <= 0.12 and newly >= 3,
                                          f"demand grows {yoy:+.0%} a year and {newly} sites now hit their fixed capacity", len(at_cap))

    promo = sales["promotion_active"] == "Y"
    clean_before = True
    for _, grp in sales.assign(w=week).groupby(["site_id", "item_id"]):
        flags = grp.sort_values("w")["promotion_active"].eq("Y").to_numpy()
        starts = np.where(flags & ~np.r_[False, flags[:-1]])[0]
        if any(s < 8 or flags[s - 8:s].any() for s in starts):
            clean_before = False
            break
    out["Promotion or campaign lift"] = _ks_result(0.15 <= promo.mean() <= 0.25 and clean_before and 0.04 <= fit["promo_lift"] <= 0.12,
                                       f"promotions on {promo.mean():.0%} of weeks, 8 clean weeks before each: {clean_before}, lift {fit['promo_lift']:+.1%}",
                                       int(sales.loc[promo, "item_id"].nunique()))

    treated = orig["offer_variant"] == "treatment"
    accepted = orig["offer_outcome"] == "accepted"
    effect = accepted[treated].mean() - accepted[~treated].mean()
    out["Experiments and before/after"] = _ks_result(0.45 <= treated.mean() <= 0.55 and 0.03 <= effect <= 0.08,
                                           f"{treated.mean():.0%} treated, effect {effect:+.1%} on acceptance", orig["customer_tier"].nunique())

    by_tier = {tier: accepted[treated & (orig["customer_tier"] == tier)].mean() - accepted[~treated & (orig["customer_tier"] == tier)].mean()
               for tier in sorted(orig["customer_tier"].unique())}
    strong = [k for k, v in by_tier.items() if v >= 0.12]
    rest = max(abs(v) for k, v in by_tier.items() if k not in strong) if len(strong) < len(by_tier) else 1.0
    out["Uplift targeting"] = _ks_result(len(strong) == 1 and rest <= 0.08,
                                         f"the offer works only in {', '.join(strong) or 'no tier'} ({by_tier.get(strong[0], 0) if strong else 0:+.0%}), "
                                         f"elsewhere at most {rest:+.0%}", int((orig["customer_tier"].isin(strong)).sum()))

    mkt = t["marketing_weekly"]
    w = np.arange(len(mkt))
    cols = ["tv_spend", "search_spend", "social_spend", "email_spend"]
    stock = []
    for col in cols:
        spend, acc = mkt[col].to_numpy(float), np.zeros(len(mkt))
        for k in range(len(mkt)):
            acc[k] = spend[k] + (0.6 * acc[k - 1] if k else 0.0)
        stock.append(np.log1p(acc / 1000.0))
    x = np.column_stack(stock + [np.ones(len(mkt)), w / 52.0, np.sin(2 * np.pi * ((w % 52) - 13) / 52)])
    y = mkt["online_revenue_amount"].to_numpy(float)
    coef, *_ = np.linalg.lstsq(x, y, rcond=None)
    r2 = 1 - ((y - x @ coef) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    out["Marketing mix and attribution"] = _ks_result((coef[:4] > 0).all() and r2 >= 0.8,
                                      f"carry-over spend of 4 channels explains {r2:.0%} of online revenue, every channel positive", len(cols))

    ordered_sales = sales.assign(w=week).sort_values(["site_id", "item_id", "w"])
    logs = np.log(ordered_sales["units_sold"].to_numpy(float))
    ref = ordered_sales.assign(l=logs).groupby(["site_id", "item_id"])["l"].transform(
        lambda s: s.rolling(7, center=True, min_periods=3).median())
    flagged = int((np.abs(logs - ref.to_numpy()) > math.log(2)).sum())
    out["Anomaly"] = _ks_result(0.006 <= flagged / len(sales) <= 0.015, f"{flagged} points ({flagged / len(sales):.1%}) jump off their series",
                                flagged)

    pay, inv = t["payments"], t["invoices"]
    joined = pay.drop_duplicates(["invoice_id", "payment_date", "paid_amount", "created_by"]).merge(inv, on="invoice_id")
    differ = int((abs(joined["paid_amount"] - joined["amount_paid"]) > 0.01).sum())
    out["Leakage and reconciliation"] = _ks_result(0.015 <= differ / len(joined) <= 0.025,
                                               f"{differ} of {len(joined)} payments ({differ / len(joined):.1%}) differ from the ledger amount", differ)

    self_ok = int((pay["created_by"] == pay["approved_by"]).sum())
    dups = int(pay.duplicated(["invoice_id", "payment_date", "paid_amount", "created_by"]).sum())
    out["Controls tests"] = _ks_result(0.005 <= self_ok / len(pay) <= 0.015 and 10 <= dups <= 15,
                                         f"{self_ok} self-approved payments ({self_ok / len(pay):.1%}) and {dups} duplicate payments", self_ok + dups)

    meas = t["measurements"].sort_values("measured_at")
    shifts, warn = {}, 0
    for line, grp in meas.groupby("line_name"):
        vals = grp["fill_volume_ml"].to_numpy()
        base_end, recent_start = int(len(vals) * 0.6), int(len(vals) * 0.8)
        mu, sd = vals[:base_end].mean(), vals[:base_end].std()
        shifts[line] = (vals[recent_start:].mean() - mu) / sd
        warn += int((np.abs(vals[recent_start:] - mu) > 2 * sd).sum()) if abs(shifts[line]) > 1 else 0
    moved = [k for k, v in shifts.items() if abs(v) > 1]
    calm = max(abs(v) for k, v in shifts.items() if k not in moved) if len(moved) < len(shifts) else 0.0
    has_spec = {"lower_spec_limit", "upper_spec_limit"} <= set(meas.columns)
    out["Statistical process control"] = _ks_result(has_spec and len(moved) == 1 and calm < 0.4 and warn >= 20,
                                        f"{', '.join(moved) or 'no line'} shifted {max(shifts.values()):.1f} standard deviations, "
                                        f"{warn} points past the warning limit", warn)

    links = t["account_links"]
    sizes = _ks_components(zip(links["from_customer_id"], links["to_customer_id"]))
    rings = [s for s in sizes if s >= 5]
    out["Fraud rings"] = _ks_result(len(rings) == 3 and all(5 <= s <= 12 for s in rings),
                                    f"{len(rings)} linked rings of {', '.join(map(str, rings))} accounts", sum(rings))

    orders = t["orders"]
    stats = orders.groupby("customer_id").agg(n=("order_id", "size"), aov=("order_amount", "mean"),
                                              first=("ordered_at", "min"), last=("ordered_at", "max"))
    signup = pd.to_datetime(cust.set_index("customer_id")["signup_date"]).reindex(stats.index)
    window = signup.clip(lower=as_of - pd.Timedelta(weeks=104))
    churned_ids = set(cust.loc[cust["is_churned"] == "Y", "customer_id"])
    end = pd.Series([stats.at[c, "last"] + pd.Timedelta(days=30) if c in churned_ids else as_of for c in stats.index], index=stats.index)
    years = ((end - window).dt.days.clip(lower=60)) / 365.0
    feats = np.column_stack([np.log(stats["n"] / years), np.log(stats["aov"])])
    feats = (feats - feats.mean(axis=0)) / feats.std(axis=0)
    labels = KMeans(4, n_init=10, random_state=0).fit_predict(feats)
    sil = silhouette_score(feats, labels)
    small = np.bincount(labels).min() / len(labels)
    out["Segmentation"] = _ks_result(sil >= 0.35 and small >= 0.1,
                                     f"4 behavior groups by frequency and value, silhouette {sil:.2f}, smallest {small:.0%}", 4)

    revenue = orders.groupby("customer_id")["order_amount"].sum().sort_values(ascending=False)
    top = revenue.iloc[:max(1, len(revenue) // 10)].sum() / revenue.sum()
    cohort = (pd.to_datetime(orig["signup_date"]) - pd.Timestamp(KIND_SIGNAL_START)).dt.days // 182
    churn_by = (orig["is_churned"] == "Y").groupby(cohort).mean()
    out["Lifetime value"] = _ks_result(top >= 0.4 and churn_by.max() - churn_by.min() >= 0.08,
                                       f"top 10% of customers bring {top:.0%} of revenue, churn by signup half-year "
                                       f"{churn_by.min():.0%} to {churn_by.max():.0%}", len(churn_by))

    cost_share = orders["item_id"].map(items.set_index("item_id")["unit_cost"] / items.set_index("item_id")["list_price"])
    margin = orders["order_amount"] * (1 - cost_share) - orders["freight_cost"] - orders["handling_cost"]
    per = pd.DataFrame({"n": stats["n"], "aov": stats["aov"], "margin": margin.groupby(orders["customer_id"]).sum()})
    small_frequent = per[(per["n"] >= 12) & (per["aov"] < 35)]
    large = per[per["aov"] >= 80]
    losing = float((small_frequent["margin"] < 0).mean()) if len(small_frequent) else 0.0
    out["Cost to serve"] = _ks_result(len(small_frequent) >= 20 and losing >= 0.6 and (large["margin"] < 0).mean() <= 0.05,
                                      f"{losing:.0%} of {len(small_frequent)} small frequent buyers lose money, "
                                      f"{(large['margin'] < 0).mean():.0%} of large buyers do", 3)

    basket = pd.crosstab(orders["customer_id"], orders["item_id"]) > 0
    lifts = []
    for a, b in ((1, 2), (3, 4), (5, 6)):
        both = (basket[a] & basket[b]).mean()
        lifts.append(both / (basket[a].mean() * basket[b].mean()))
    out["Recommendation and next best action"] = _ks_result(min(lifts) >= 1.3,
                                         f"3 item affinity groups with lifts {', '.join(f'{v:.1f}' for v in lifts)}", len(basket))

    norm = cust.assign(addr=cust["street_address"].str.replace(r"\bSt$", "Street", regex=True).str.lower())
    near_dups = 0
    for _, grp in norm.groupby(["postcode", "addr"]):
        if len(grp) < 2:
            continue
        names = grp["customer_name"].tolist()
        near_dups += sum(1 for i in range(len(names)) for j in range(i + 1, len(names))
                         if SequenceMatcher(None, names[i].lower(), names[j].lower()).ratio() >= 0.85)
    out["Entity matching"] = _ks_result(0.04 <= near_dups / len(cust) <= 0.06,
                                        f"{near_dups} near-duplicate customers ({near_dups / len(cust):.1%}) differ only in spelling",
                                        near_dups)

    complete = ordered[ordered["case_id"].isin(cases.loc[cases["case_status"] == "closed", "case_id"])]
    gaps = complete.groupby("case_id")["event_at"].diff().dt.total_seconds() / 86400
    relative = gaps / gaps.groupby(complete["case_id"]).transform("median")
    step_wait = relative.groupby(complete["step_name"]).median().dropna()
    slow = step_wait.idxmax()
    factor = step_wait.max() / step_wait.drop(slow).median()
    out["Process mining"] = _ks_result(slow == "fulfilled" and 2.5 <= factor <= 3.6,
                                       f"work waits {factor:.1f} times longer before {slow} than before other steps",
                                       int((cases["case_status"] == "open").sum()))

    late = (cases["resolved_at"] > cases["due_at"]) | (cases["resolved_at"].isna() & (cases["due_at"] < as_of))
    out["SLA, backlog and aging"] = _ks_result(0.12 <= late.mean() <= 0.18, f"{late.mean():.0%} of cases breach their due date",
                                  int((cases["case_status"] == "open").sum()))

    paid = inv[inv["paid_date"].notna()]
    late_customers = paid[pd.to_datetime(paid["paid_date"]) > pd.to_datetime(paid["due_date"])]["customer_id"].nunique()
    late_share = late_customers / paid["customer_id"].nunique()
    out["Working capital and collections"] = _ks_result(0.17 <= late_share <= 0.23, f"{late_share:.0%} of customers pay after the due date",
                                        late_customers)

    cells = cust["postcode"].value_counts()
    out["Location intelligence"] = _ks_result(cells.iloc[0] >= 3 * cells.median(),
                                              f"postcode {cells.index[0]} holds {cells.iloc[0]} customers, {cells.iloc[0] / cells.median():.0f} "
                                              f"times the median area", len(cells))

    tr = t["site_transfers"]
    touch = pd.concat([tr[["from_site_id", "transfer_units"]].rename(columns={"from_site_id": "s"}),
                       tr[["to_site_id", "transfer_units"]].rename(columns={"to_site_id": "s"})]).groupby("s")["transfer_units"].sum()
    hubs = touch.sort_values(ascending=False).index[:2]
    hub_flow = tr.loc[tr["from_site_id"].isin(hubs) | tr["to_site_id"].isin(hubs), "transfer_units"].sum() / tr["transfer_units"].sum()
    out["Network dependency"] = _ks_result(0.35 <= hub_flow <= 0.45 and touch.sort_values().iloc[-3] < touch[hubs].min() * 0.6,
                                           f"2 hub sites carry {hub_flow:.0%} of the flow", len(touch))

    reason_of = cases["complaint_text"].str.lower().str.extract(r"(late|wrong item|charged twice|billing|rude|damaged)")[0]
    reason_of = reason_of.replace({"charged twice": "billing"})
    shares = reason_of.value_counts(normalize=True)
    half = cases["created_at"] >= cases["created_at"].min() + (cases["created_at"].max() - cases["created_at"].min()) / 2
    bill = [(reason_of[mask] == "billing").mean() for mask in (~half, half)]
    out["Reason codes from comments"] = _ks_result(len(shares) == 5 and shares.min() >= 0.05 and bill[1] >= 1.3 * bill[0] and reason_of.notna().all(),
                                     f"5 recurring reasons, billing grows from {bill[0]:.0%} to {bill[1]:.0%}", len(shares))

    specs = bundle["tables"]
    missing = [f"{name}.{col}" for name, spec in specs.items() for col in spec["frame"].columns if not spec["columns"].get(col)]
    no_desc = [name for name, spec in specs.items() if not spec["description"]]
    bad_fk = [f"{name}.{col}" for name, spec in specs.items() for col, target in spec["fks"].items()
              if target not in specs or not specs[target]["pk"]
              or not set(spec["frame"][col]).issubset(set(specs[target]["frame"][specs[target]["pk"]]))]
    out["Data agent"] = _ks_result(not missing and not no_desc and not bad_fk,
                                   f"{len(specs)} tables, every column described, {sum(len(s['fks']) for s in specs.values())} "
                                   f"foreign keys resolve" + (f"; missing {missing[:3]} {no_desc[:3]} {bad_fk[:3]}" if missing or no_desc or bad_fk else ""),
                                   len(specs))
    return out


KIND_SIGNAL_PREFIX = "core"


def _kind_signal_quoted(fqn):
    return ".".join(f"`{part}`" for part in fqn.split("."))


def _apply_kind_signal_keys(bundle, fqns):
    specs = bundle["tables"]
    for name, spec in specs.items():
        if spec["pk"]:
            spark.sql(f"ALTER TABLE {_kind_signal_quoted(fqns[name])} DROP PRIMARY KEY IF EXISTS CASCADE")
    for name, spec in specs.items():
        if spec["pk"]:
            table = _kind_signal_quoted(fqns[name])
            spark.sql(f"ALTER TABLE {table} ALTER COLUMN `{spec['pk']}` SET NOT NULL")
            spark.sql(f"ALTER TABLE {table} "
                      f"ADD CONSTRAINT `{fqns[name].split('.')[-1]}_pk` PRIMARY KEY (`{spec['pk']}`)")
    for name, spec in specs.items():
        for col, target in spec["fks"].items():
            spark.sql(f"ALTER TABLE {_kind_signal_quoted(fqns[name])} "
                      f"ADD CONSTRAINT `{fqns[name].split('.')[-1]}_{col}_fk` FOREIGN KEY (`{col}`) "
                      f"REFERENCES {_kind_signal_quoted(fqns[target])} (`{specs[target]['pk']}`)")
    print(f"  🔑 {sum(1 for s in specs.values() if s['pk'])} primary keys, {sum(len(s['fks']) for s in specs.values())} foreign keys")


def _plant_kind_signals(catalog, schema, taken):
    bundle = _kind_signal_frames()
    checks = _kind_signal_checks(bundle)
    failed = {kind: result["detail"] for kind, result in checks.items() if not result["ok"]}
    print(f"[DEMO-SIGNAL FIRED] seed {bundle['seed']}: {len(checks) - len(failed)} of {len(checks)} use-case kinds "
          f"have their signal in {len(bundle['tables'])} tables")
    for kind, result in checks.items():
        print(f"  {'✓' if result['ok'] else '✗'} {kind}: {result['detail']}")
    if failed:
        raise RuntimeError(f"Demo signal checks failed for {len(failed)} use-case kinds: {failed}")
    fqns = {name: f"{catalog}.{schema}.{KIND_SIGNAL_PREFIX}_{name}" for name in bundle["tables"]}
    clash = sorted(set(fqns.values()) & {t.strip() for t in taken})
    if clash:
        raise RuntimeError(f"Generated tables already use the signal table names: {clash}")
    for name, spec in bundle["tables"].items():
        spark.createDataFrame(spec["frame"]).write.mode("overwrite").option("overwriteSchema", "true") \
            .saveAsTable(_kind_signal_quoted(fqns[name]))
        print(f"  ✓ {fqns[name]}: {len(spec['frame'])} rows")
    _apply_kind_signal_keys(bundle, fqns)
    metadata = [{"fqn": fqns[name], "description": spec["description"], "columns": spec["columns"]}
                for name, spec in bundle["tables"].items()]
    return list(fqns.values()), metadata

# COMMAND ----------

import json
import re


def _notebook_api_context():
    ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
    host = (ctx.apiUrl().get() or "").rstrip("/")
    token = ctx.apiToken().get() or ""
    return host, token


def _sql_escape_comment(text):
    return str(text or "").replace("'", "''")


def _build_genie_prompt(user_intent, catalog_name, schema_name, num_tables):
    table_examples = [
        f'"{catalog_name}.{schema_name}.demo_topic_table_{i}"' for i in range(1, num_tables + 1)
    ]
    tables_json = ",\n    ".join(table_examples)
    table_nums = ", ".join(str(i) for i in range(1, num_tables + 1))

    return f"""
You are a Python code generator that produces realistic fake datasets for analytics demos.

The user will provide a query (e.g., "generate fake retail sales data" or "create fake airline bookings").

From the query, derive a short topic slug (lowercase, underscores only) for table names, e.g. `regional_airline` → table base `regional_airline_table`.

**Fixed Unity Catalog location (MANDATORY — do not change):**
- catalog_name = "{catalog_name}"  (already exists — NEVER create a catalog)
- schema_name = "{schema_name}"
- table base name = <topic>_table
- Create exactly {num_tables} related business tables named:
  {{catalog_name}}.{{schema_name}}.<topic>_table_1 … _{num_tables}

Additionally:
- display_name: exactly TWO capitalized words from the query (e.g. "Regional Airline", "Retail Sales").

OUTPUT FORMAT (STRICT) — return EXACTLY ONE JSON object:
{{
  "display_name": "<Two Word Name>",
  "tables": [
    {tables_json}
  ],
  "table_metadata": [
    {{
      "fqn": "{catalog_name}.{schema_name}.<topic>_table_1",
      "description": "<1-2 sentence business description of this table visible in Unity Catalog>",
      "columns": {{
        "<column_name>": "<column description for Unity Catalog>",
        "...": "..."
      }}
    }},
    ... repeat for all {num_tables} tables (one object per table, same order as tables array)
  ],
  "code": "<ENTIRE PYTHON CODE AS A SINGLE JSON STRING>"
}}

Rules:
- No prose before or after the JSON.
- "tables" must list exactly {num_tables} three-part FQNs under {catalog_name}.{schema_name}.
- "table_metadata" must have exactly {num_tables} entries; each "columns" map must include EVERY column written to that table with a meaningful UC comment.
- "code" must be valid Python only (JSON-escaped).

Code requirements (inside "code"):
- import pandas, numpy, random; from datetime import datetime, timedelta
- catalog_name = "{catalog_name}"; schema_name = "{schema_name}"; table_base = "<topic>_table"
- Do NOT call CREATE CATALOG.
- spark.sql(f'CREATE SCHEMA IF NOT EXISTS {{catalog_name}}.{{schema_name}}')
- spark.sql(f'USE CATALOG {{catalog_name}}'); spark.sql(f'USE {{catalog_name}}.{{schema_name}}')
- Build {num_tables} related pandas DataFrames (realistic domain data; ~80–200 rows on larger fact tables, fewer on dimensions).
- Write each as Delta overwrite: saveAsTable(f"{{catalog_name}}.{{schema_name}}.{{table_base}}_N") for N in ({table_nums}).
- Do NOT run COMMENT statements in code (comments are applied from table_metadata after execution).

User query to process: {user_intent}
"""


def _call_foundation_model(user_intent, catalog_name, schema_name):
    host, token = _notebook_api_context()
    if not host or not token:
        raise RuntimeError("Could not resolve Databricks workspace host/token from notebook context")

    import requests

    prompt = _build_genie_prompt(user_intent, catalog_name, schema_name, NUM_DEMO_TABLES)
    url = f"{host}/serving-endpoints/chat/completions"
    payload = {
        "model": "databricks-claude-sonnet-4",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 65536,
    }
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload),
        timeout=300,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Foundation model error {resp.status_code}: {resp.text[:800]}")

    data = resp.json()
    raw = (
        (((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    ).strip()
    if not raw:
        raise RuntimeError("Foundation model returned empty content")

    print(raw)

    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()

    return json.loads(raw)


def _assert_tables_in_target_schema(table_fqns, catalog_name, schema_name, expected_count):
    prefix = f"{catalog_name}.{schema_name}."
    out = []
    for fq in table_fqns:
        if not fq.startswith(prefix):
            raise RuntimeError(
                f"LLM returned table outside target schema: {fq} (expected prefix {prefix})"
            )
        out.append(fq)
    if len(out) != expected_count:
        raise RuntimeError(f"Expected exactly {expected_count} tables; got: {table_fqns!r}")
    return out


def _strip_create_catalog_from_code(code_str):
    lines = []
    for line in code_str.splitlines():
        if re.search(r"CREATE\s+CATALOG\b", line, re.I):
            print(f"  (stripped) {line.strip()}")
            continue
        lines.append(line)
    return "\n".join(lines)


def _apply_uc_table_metadata(table_metadata, expected_fqns):
    """Apply Unity Catalog table + column comments (visible in Catalog Explorer)."""
    if not table_metadata:
        raise RuntimeError("LLM response missing table_metadata (required for UC descriptions)")

    by_fqn = {}
    for entry in table_metadata:
        fqn = (entry.get("fqn") or "").strip()
        if fqn:
            by_fqn[fqn] = entry

    for fqn in expected_fqns:
        entry = by_fqn.get(fqn)
        if not entry:
            raise RuntimeError(f"table_metadata missing entry for {fqn}")

        parts = fqn.split(".")
        if len(parts) != 3:
            raise RuntimeError(f"Invalid FQN in table_metadata: {fqn}")
        catalog, schema, table = parts

        table_desc = (entry.get("description") or entry.get("table_description") or "").strip()
        if not table_desc:
            raise RuntimeError(f"table_metadata[{fqn}] missing description")

        spark.sql(
            f"COMMENT ON TABLE `{catalog}`.`{schema}`.`{table}` IS '{_sql_escape_comment(table_desc)}'"
        )
        print(f"  📝 table comment: {fqn}")

        columns = entry.get("columns") or {}
        if not columns:
            raise RuntimeError(f"table_metadata[{fqn}] missing columns map")

        for col_name, col_desc in columns.items():
            col_desc = str(col_desc or "").strip()
            if not col_desc:
                continue
            spark.sql(
                f"ALTER TABLE `{catalog}`.`{schema}`.`{table}` "
                f"ALTER COLUMN `{col_name}` COMMENT '{_sql_escape_comment(col_desc)}'"
            )
        print(f"     → {len(columns)} column comments")


def _read_table_comment(catalog, schema, table):
    rows = spark.sql(f"DESCRIBE TABLE EXTENDED `{catalog}`.`{schema}`.`{table}`").collect()
    for row in rows:
        key = row[0] if not hasattr(row, "col_name") else row.col_name
        if str(key).lower() == "comment":
            val = row[1] if len(row) > 1 else getattr(row, "data_type", None)
            return (val or "").strip()
    return ""


def _count_column_comments(catalog, schema, table):
    rows = spark.sql(f"DESCRIBE TABLE `{catalog}`.`{schema}`.`{table}`").collect()
    commented = 0
    total = 0
    for row in rows:
        col = row.col_name if hasattr(row, "col_name") else row[0]
        if not col or str(col).startswith("#"):
            continue
        total += 1
        comment = (row.comment if hasattr(row, "comment") else (row[2] if len(row) > 2 else "")) or ""
        if str(comment).strip():
            commented += 1
    return commented, total


def _verify_tables_for_inspire(table_fqns):
    verified = []
    for fq in table_fqns:
        catalog, schema, table = [p.strip() for p in fq.split(".")]
        try:
            cols = spark.sql(f"DESCRIBE TABLE `{catalog}`.`{schema}`.`{table}`").collect()
        except Exception as e:
            raise RuntimeError(f"Table not readable after code execution: {fq}: {e}") from e
        if not cols:
            raise RuntimeError(f"Table has no columns: {fq}")

        row_count = spark.sql(f"SELECT COUNT(*) AS c FROM `{catalog}`.`{schema}`.`{table}`").collect()[0][0]
        tbl_comment = _read_table_comment(catalog, schema, table)
        col_commented, col_total = _count_column_comments(catalog, schema, table)

        if not tbl_comment:
            raise RuntimeError(f"Unity Catalog table description missing on {fq}")
        if col_total > 0 and col_commented < max(1, col_total // 2):
            raise RuntimeError(
                f"Too few column comments on {fq} ({col_commented}/{col_total}). "
                "Unity Catalog column descriptions are required for Inspire metadata."
            )

        print(
            f"  ✓ {fq}: {col_total} columns ({col_commented} commented), "
            f"{row_count} rows, table description set"
        )
        verified.append(fq)
    return verified


# ── 1) LLM: generate code + metadata ──
parsed = _call_foundation_model(user_description, inspire_catalog, demo_schema)

display_name = (parsed.get("display_name") or business_name or "Demo Data").strip()
tables = _assert_tables_in_target_schema(
    parsed.get("tables") or [], inspire_catalog, demo_schema, NUM_DEMO_TABLES
)
table_metadata = parsed.get("table_metadata") or []
code_str = _strip_create_catalog_from_code(parsed.get("code") or "")

if not code_str.strip():
    raise RuntimeError("LLM response missing 'code'")

# ── 2) Execute generated Python (creates 5 Delta tables) ──
try:
    exec(code_str, {"spark": spark})
except Exception as e:
    raise RuntimeError(f"Generated code execution failed: {e}") from e

if plant_kind_signals:
    _signal_tables, _signal_metadata = _plant_kind_signals(inspire_catalog, demo_schema, tables)
    tables = tables + _signal_tables
    table_metadata = table_metadata + _signal_metadata
else:
    print("[DEMO-SIGNAL FIRED] skipped: plant_kind_signals is no, so only the generated tables are written")

# ── 3) Apply UC table + column descriptions ──
print("Applying Unity Catalog table and column comments…")
_apply_uc_table_metadata(table_metadata, tables)

# ── 4) Verify tables, comments, build uc_metadata for Inspire ──
tables = _verify_tables_for_inspire(tables)
uc_metadata = ",".join(tables)

print(f"display_name: {display_name}")
print(f"uc_metadata ({len(tables)} tables): {uc_metadata}")

# ── 5) Grant Inspire App service principal (inspire_installer parity) ──
_sp_id = _resolve_app_sp_application_id(app_sp_application_id)
_grant_inspire_app_service_principal(
    _sp_id,
    inspire_catalog,
    track_schema,
    demo_schema,
    warehouse_id,
)

# COMMAND ----------


def _set_task_value(key, value):
    dbutils.jobs.taskValues.set(key=key, value=str(value) if value is not None else "")


_set_task_value("uc_metadata", uc_metadata)
_set_task_value("display_name", display_name)
_set_task_value("business_name", business_name)
_set_task_value("catalog", inspire_catalog)
_set_task_value("schema", demo_schema)
_set_task_value("demo_catalog", inspire_catalog)
_set_task_value("demo_schema", demo_schema_fq)
_set_task_value("inspire_database", inspire_database)
_set_task_value("session_id", session_id)
_set_task_value("user_description", user_description)
_set_task_value("table_count", len(tables))
_set_task_value("data_source", "llm_genie_generator")

for i, t in enumerate(tables):
    _set_task_value(f"table_{i}", t)

print(f"Step 1 complete: {len(tables)} Delta tables with UC descriptions ready for Inspire.")
