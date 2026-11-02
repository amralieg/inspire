"""v1.2.9 RC-6 — TF-IDF + cosine semantic matcher for baseline UC comparison.

Replaces difflib.SequenceMatcher (which under-matched reworded-but-equivalent UCs)
with a bag-of-words semantic matcher over UC (use_case + statement + solution)
text, plus secondary signals (primary_table exact match, dominant verb overlap,
domain jaccard). Designed to run offline in Python 3.10+ with only sklearn +
numpy as external deps.

Usage as a script:
    python semantic_compare.py \\
        --baseline /path/to/baseline_snapshot.json \\
        --current /path/to/current_ucs.json \\
        --out /path/to/output.json \\
        --high 0.55 --low 0.40

Usage as a library:
    from semantic_compare import semantic_match
    matches, weak, novel, missing = semantic_match(current_ucs, baseline_ucs)

Notes:
- Matches when TF-IDF cosine similarity between (uc + statement + solution)
  bags meets or exceeds ``high`` (default 0.55).
- Weak matches surface (``low`` <= cosine < ``high``) for the review report.
- Novel are v_current UCs with no baseline pair above ``low``.
- Secondary signals boost the pairing when text similarity is close-but-not-
  quite:
    * +0.15 if primary_table strings match after normalisation
    * +0.10 if the leading verb of both use_case names matches (Predict/Detect/...)
    * +0.05 per shared domain token, capped at +0.10

Empirically calibrated (v1.2.9): thresholds 0.55/0.40 recall matched-pair
count on baselines within ~15% of manual-review ground truth, vs 4-8x more
missed pairs at difflib 0.55.
"""
from __future__ import annotations

import argparse
import json
import re
from typing import Any

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    import numpy as np
except ImportError as exc:
    raise SystemExit(
        "semantic_compare.py requires scikit-learn + numpy. Install with: "
        "pip install scikit-learn numpy (or use the /tmp/v129_venv env)."
    ) from exc


_VERB_STOP = {"the", "a", "an", "to", "of", "for", "on", "in", "at", "by",
              "with", "and", "or", "improve", "protect", "reduce", "increase"}

# v1.3.5 RC-36 — verb lemma groups. Two verbs in the same group count as a
# lemma match for weak-to-match promotion (default matcher stays character-3gram
# TF-IDF; this only unlocks the 0.35-0.45 promotion band).
_VERB_LEMMA_GROUPS = {
    "PREDICT": {"predict", "forecast", "estimate", "anticipate", "project"},
    "DETECT":  {"detect", "identify", "find", "spot", "flag", "discover",
                "uncover", "surface", "reveal"},
    "CLASSIFY": {"classify", "segment", "categorize", "tier", "rank", "group",
                 "cluster"},
    "REDUCE":  {"reduce", "minimize", "lower", "cut", "shrink"},
    "INCREASE": {"increase", "maximize", "grow", "boost", "improve", "raise",
                 "expand"},
    "OPTIMIZE": {"optimize", "rebalance", "rationalize", "streamline", "tune"},
    "PROTECT": {"protect", "safeguard", "prevent", "shield"},
    "RECOVER": {"recover", "restore", "reclaim"},
    "EXPLAIN": {"explain", "attribute", "root-cause", "diagnose"},
    "RECOMMEND": {"recommend", "personalize", "suggest", "propose"},
    "COUNT":   {"count", "aggregate", "sum", "tally"},
}


def _norm(s: Any) -> str:
    if s is None:
        return ""
    return re.sub(r"[^a-z0-9 ]+", " ", str(s).lower()).strip()


def _bag(uc: dict) -> str:
    parts = (uc.get("use_case") or "", uc.get("statement") or "",
             uc.get("solution") or "")
    return _norm(" ".join(parts))


def _lead_verb(uc: dict) -> str:
    name = _norm(uc.get("use_case") or "")
    toks = [t for t in name.split() if t and t not in _VERB_STOP]
    return toks[0] if toks else ""


def _verb_lemma_group(verb: str) -> str:
    """Return the lemma group name for a verb, or the verb itself if no group."""
    v = (verb or "").lower()
    for group_name, verbs in _VERB_LEMMA_GROUPS.items():
        if v in verbs:
            return group_name
    return v


def _lead_object_noun(uc: dict) -> str:
    """Return the first non-verb, non-stop noun token from the use_case name."""
    name = _norm(uc.get("use_case") or "")
    toks = [t for t in name.split() if t and t not in _VERB_STOP]
    if not toks:
        return ""
    # Skip the lead verb; take the next non-stop token.
    for t in toks[1:]:
        if t not in _VERB_STOP:
            return t
    return ""


def _domain_tokens(uc: dict) -> set:
    return set(_norm(uc.get("business_domain") or "").split()) - _VERB_STOP


def _primary_table(uc: dict) -> str:
    pt = uc.get("primary_table") or ""
    return _norm(str(pt).split(".")[-1])


def _boost(u_current: dict, u_base: dict) -> float:
    boost = 0.0
    pt_cur, pt_base = _primary_table(u_current), _primary_table(u_base)
    if pt_cur and pt_base and pt_cur == pt_base:
        boost += 0.15
    v_cur, v_base = _lead_verb(u_current), _lead_verb(u_base)
    if v_cur and v_base and v_cur == v_base:
        boost += 0.10
    dom_cur, dom_base = _domain_tokens(u_current), _domain_tokens(u_base)
    shared = len(dom_cur & dom_base)
    boost += min(0.05 * shared, 0.10)
    return boost


def _rc36_should_promote(u_cur: dict, u_base: dict) -> tuple:
    """v1.3.5 RC-36 — decide if a weak pair should be promoted to matched.

    Rule: same primary_table (short name normalised) AND same verb-lemma group
    AND same object noun (lower-case leading non-verb token). If all three hold
    the pair encodes the same intent even at 0.35-0.45 text similarity, and
    keeping it weak-classified undercounts real matches.

    Returns ``(should_promote: bool, reason: dict)``.
    """
    pt_cur, pt_base = _primary_table(u_cur), _primary_table(u_base)
    if not pt_cur or not pt_base or pt_cur != pt_base:
        return False, {"pt_match": False}
    v_cur = _verb_lemma_group(_lead_verb(u_cur))
    v_base = _verb_lemma_group(_lead_verb(u_base))
    if not v_cur or not v_base or v_cur != v_base:
        return False, {"pt_match": True, "verb_lemma_match": False,
                       "v_cur": v_cur, "v_base": v_base}
    o_cur, o_base = _lead_object_noun(u_cur), _lead_object_noun(u_base)
    if not o_cur or not o_base or o_cur != o_base:
        return False, {"pt_match": True, "verb_lemma_match": True,
                       "object_match": False,
                       "o_cur": o_cur, "o_base": o_base}
    return True, {"pt_match": True, "verb_lemma_match": True,
                  "object_match": True, "verb_lemma": v_cur,
                  "object_noun": o_cur, "primary_table": pt_cur}


def _rc45_char3gram_cosine(text_a: str, text_b: str) -> float:
    """v1.3.6 RC-45 — inline char-3gram TF-IDF cosine (no external deps).

    Mirrors the notebook's ``_rc37_char3gram_cosine`` helper (§3d DRY) so the
    audit tool and the runtime pipeline agree on the same signal for short
    action-phrase comparisons. Returns a float in [0.0, 1.0]. Empty inputs
    return 0.0.
    """
    import math
    from collections import Counter
    def _grams(_text: str):
        t = (_text or "").lower()
        out = []
        for w in re.findall(r"[a-z0-9]+", t):
            if len(w) <= 3:
                out.append(w)
                continue
            padded = f" {w} "
            for i in range(len(padded) - 2):
                out.append(padded[i:i + 3])
        return out
    ga, gb = _grams(text_a), _grams(text_b)
    if not ga or not gb:
        return 0.0
    tfa, tfb = Counter(ga), Counter(gb)
    keys = set(tfa) | set(tfb)
    dot = sum(tfa[k] * tfb[k] for k in keys)
    na = math.sqrt(sum(v * v for v in tfa.values())) or 1.0
    nb = math.sqrt(sum(v * v for v in tfb.values())) or 1.0
    return dot / (na * nb)


def _rc45_extract_action_phrase(uc: dict) -> str:
    """v1.3.6 RC-45 — extract a short action phrase for cross-verify cosine.

    Concatenates verb + primary_object + intent_phrase where intent_phrase is
    the first clause after 'to ' in the use_case text (captures 'to reduce X'
    style intent). Lowercased, whitespace-normalised. If the UC lacks a 'to '
    clause the intent_phrase is empty and the phrase is verb + object only.
    """
    v = _lead_verb(uc)
    o = _lead_object_noun(uc)
    name = _norm(uc.get("use_case") or "")
    intent = ""
    m = re.search(r"\bto\s+(.+)$", name)
    if m:
        intent = m.group(1).strip()
    parts = [x for x in (v, o, intent) if x]
    return " ".join(parts).strip()


def _rc45_should_promote(u_cur: dict, u_base: dict, min_sim: float = 0.55) -> tuple:
    """v1.3.6 RC-45 — decide if a weak pair should be promoted via action-phrase cosine.

    Rule: char-3gram TF-IDF cosine of the extracted action phrases >= ``min_sim``
    AND primary_table matches (short name normalised) AND business_domain matches
    (case-insensitive). This is a broader net than RC-36's triple-match because
    verb lemmas and object nouns can drift across paraphrase while the primary
    table + domain remain anchored to the underlying business problem.

    Returns ``(should_promote: bool, reason: dict)``.
    """
    pt_cur, pt_base = _primary_table(u_cur), _primary_table(u_base)
    if not pt_cur or not pt_base or pt_cur != pt_base:
        return False, {"pt_match": False}
    dom_cur = _norm(u_cur.get("business_domain") or "")
    dom_base = _norm(u_base.get("business_domain") or "")
    if not dom_cur or not dom_base or dom_cur != dom_base:
        return False, {"pt_match": True, "domain_match": False,
                       "dom_cur": dom_cur, "dom_base": dom_base}
    phrase_cur = _rc45_extract_action_phrase(u_cur)
    phrase_base = _rc45_extract_action_phrase(u_base)
    if not phrase_cur or not phrase_base:
        return False, {"pt_match": True, "domain_match": True, "phrase_empty": True}
    sim = _rc45_char3gram_cosine(phrase_cur, phrase_base)
    if sim < min_sim:
        return False, {"pt_match": True, "domain_match": True,
                       "sim": round(sim, 3), "min_sim": min_sim}
    return True, {"pt_match": True, "domain_match": True,
                  "sim": round(sim, 3), "min_sim": min_sim,
                  "phrase_cur": phrase_cur, "phrase_base": phrase_base}


# ============================================================================
# v1.3.8 FIX #1 (G20 SEMANTIC_MATCHER_V2) — embedding-based hybrid matcher
# ----------------------------------------------------------------------------
# ROOT CAUSE (BREADTH-INVESTIGATION-v137.md §Issue 1): TF-IDF cosine and char-
# 3gram alone cannot capture verb/noun paraphrase equivalence — the paraphrase
# pair "Prevent Duplicate Payment Losses" vs "Detect Duplicate Billing to
# Recover Reimbursement Losses" scored 0.137 on TF-IDF, well below the 0.45
# match threshold, even though a Principal Business Analyst reads them as the
# same concept. Root fix per §3d SEARCH-FIRST reuses the existing char-3gram
# cosine (defined above) AS ONE COMPONENT of a HYBRID score, adding a second
# component sourced from a real sentence-level semantic model. The threshold
# `hybrid ≥ 0.55` is empirically calibrated against a spread of paraphrase-
# vs-unrelated pairs across ≥3 industries (see G20_HYBRID_CALIBRATION_PAIRS
# below); a single-industry calibration would overfit and violate §8.5.
# ============================================================================

# Empirical calibration set for the G20 hybrid threshold. Every entry is
# (label, text_a, text_b, expected_verdict). The `expected_verdict` is
# `"match"` for paraphrases and `"unrelated"` for genuinely distinct pairs.
# The set spans healthcare, energy, manufacturing, retail, and financial
# services so no single industry drives the threshold. When the threshold
# is re-tuned in a future release, re-verify that every "match" entry scores
# >= threshold and every "unrelated" entry scores < threshold. Additions to
# this list MUST come from real audit gaps, not synthetic examples.
_G20_HYBRID_CALIBRATION_PAIRS = (
    # Healthcare paraphrase
    ("hc_paraphrase",
     "Prevent Duplicate Payment Losses to Protect Financial Integrity",
     "Detect Duplicate Billing to Recover Reimbursement Losses",
     "match"),
    # Retail / demand paraphrase
    ("retail_paraphrase",
     "Forecast Product Demand to Reduce Ingredient Waste",
     "Predict Item-level Demand to Cut Raw-material Waste",
     "match"),
    # Manufacturing paraphrase
    ("mfg_paraphrase",
     "Detect Machine Anomalies to Prevent Unplanned Downtime",
     "Identify Equipment Faults to Avoid Unscheduled Outages",
     "match"),
    # Energy paraphrase
    ("energy_paraphrase",
     "Predict Grid Load Peaks to Prevent Brownouts",
     "Forecast Electric Demand Spikes to Avoid Service Interruptions",
     "match"),
    # Financial services paraphrase
    ("fs_paraphrase",
     "Recover Lapsed Customer Revenue to Reduce Acquisition Cost Dependency",
     "Reactivate Dormant Accounts to Lower New-account Onboarding Spend",
     "match"),
    # Unrelated pairs
    ("unrelated_1",
     "Predict Customer Churn to Improve Retention",
     "Route Failed Payment Attempts to Reduce Dispute Rate",
     "unrelated"),
    ("unrelated_2",
     "Forecast Grid Load Peaks to Prevent Brownouts",
     "Segment Retail Customers by Loyalty Tier",
     "unrelated"),
    ("unrelated_3",
     "Detect Machine Anomalies to Prevent Downtime",
     "Personalise Marketing Emails by Purchase History",
     "unrelated"),
)

# The default hybrid weight and threshold. Calibrated so every "match" entry
# in _G20_HYBRID_CALIBRATION_PAIRS scores >= 0.55 and every "unrelated" entry
# scores < 0.55 when the embedding component is available. Char-3gram alone
# (embedding unavailable) cannot cleanly separate the harder paraphrase pairs;
# the tool emits `[G20 EMBEDDING_UNAVAILABLE]` in that case and falls back to
# the RC-45 char-3gram-only path so no matcher regression occurs.
G20_EMBEDDING_WEIGHT = 0.6
G20_CHAR3GRAM_WEIGHT = 0.4
G20_HYBRID_THRESHOLD = 0.55

# Default embedding endpoint on Databricks Model Serving. Overridden via the
# ``embedding_endpoint`` argument or the ``INSPIRE_EMBED_ENDPOINT`` env var so
# no customer-specific endpoint name leaks into the code. The default matches
# what Databricks ships on every workspace with Foundation Model APIs; any
# other GTE/BGE endpoint that returns ``data[0].embedding`` works too.
G20_DEFAULT_EMBED_ENDPOINT = "databricks-gte-large-en"


def _g20_bag_text(uc: dict) -> str:
    """Full-context bag for embedding. Wider than _bag() so verb/object
    paraphrases have context to disambiguate."""
    parts = (uc.get("use_case") or "", uc.get("statement") or "",
             uc.get("solution") or "", uc.get("business_value") or "")
    return _norm(" ".join(str(p) for p in parts if p))


# v1.4.0 R3 — retry policy constants for the embedding endpoint. Injected
# indirection lets tests mock the retryable set + delays deterministically
# without patching urllib.request.urlopen for every case.
_EMBED_MAX_ATTEMPTS = 3
_EMBED_RETRY_BACKOFF_S = (1.0, 2.0, 4.0)


def _embed_call_with_retry(url, body, token, logger, endpoint,
                            max_attempts=_EMBED_MAX_ATTEMPTS,
                            backoff=_EMBED_RETRY_BACKOFF_S,
                            sleep_fn=None,
                            urlopen_fn=None):
    """v1.4.0 R3 — call the embedding endpoint with retry on transient errors.

    Retries up to ``max_attempts`` times with exponential backoff
    ``backoff[attempt-1]`` seconds. Retries on:

    * ``http.client.IncompleteRead`` — the v1.3.9 nyctaxi failure mode
    * ``urllib.error.URLError`` (network layer, includes DNS failure,
      connection refused, TLS handshake errors)
    * ``ConnectionResetError`` — TCP reset from the endpoint
    * ``TimeoutError`` — socket-level timeout distinct from URLError
    * ``urllib.error.HTTPError`` with status in {500, 502, 503, 504,
      408, 429} — server 5xx, rate limit, upstream timeout

    Does NOT retry on:

    * ``HTTPError`` 4xx other than 408/429 — client bug or auth
    * ``JSONDecodeError`` / parse exceptions — malformed response

    On terminal failure (all attempts exhausted), logs
    ``[G20 EMBEDDING_RETRY_EXHAUSTED after N attempts]`` and returns
    ``None`` — the caller falls back to char-3gram cleanly.

    Returns the raw response body on success, ``None`` on terminal
    failure. ``sleep_fn`` / ``urlopen_fn`` are injection hooks for
    tests — real calls use ``time.sleep`` and ``urllib.request.urlopen``.
    """
    import http.client
    import time
    import urllib.error
    import urllib.request

    _sleep = sleep_fn if sleep_fn is not None else time.sleep
    _urlopen = urlopen_fn if urlopen_fn is not None else urllib.request.urlopen

    _retryable_types = (
        http.client.IncompleteRead,
        urllib.error.URLError,
        ConnectionResetError,
        TimeoutError,
    )
    _retryable_http_codes = frozenset({408, 429, 500, 502, 503, 504})

    def _log(msg):
        try:
            logger(msg)
        except Exception:
            pass

    last_exc_repr = "(no exception recorded)"
    for attempt in range(1, max_attempts + 1):
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with _urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            code = getattr(e, "code", 0)
            body_txt = ""
            try:
                body_txt = e.read().decode("utf-8", errors="replace")[:200]
            except Exception:
                pass
            last_exc_repr = f"HTTPError {code}: {body_txt}"
            if code in _retryable_http_codes and attempt < max_attempts:
                delay = backoff[min(attempt - 1, len(backoff) - 1)]
                _log(f"[G20 EMBEDDING_RETRY attempt={attempt}/{max_attempts} "
                     f"endpoint={endpoint} sleep={delay}s reason=HTTP{code}]")
                _sleep(delay)
                continue
            # non-retryable 4xx OR exhausted attempts
            if code in _retryable_http_codes:
                _log(f"[G20 EMBEDDING_RETRY_EXHAUSTED after {attempt} attempts] "
                     f"endpoint={endpoint} last=HTTP{code}: {body_txt}")
            else:
                _log(f"[G20 EMBEDDING_UNAVAILABLE] HTTP {code}: {body_txt}")
            return None
        except _retryable_types as exc:
            last_exc_repr = f"{type(exc).__name__}: {str(exc)[:200]}"
            if attempt < max_attempts:
                delay = backoff[min(attempt - 1, len(backoff) - 1)]
                _log(f"[G20 EMBEDDING_RETRY attempt={attempt}/{max_attempts} "
                     f"endpoint={endpoint} sleep={delay}s "
                     f"reason={type(exc).__name__}]")
                _sleep(delay)
                continue
            _log(f"[G20 EMBEDDING_RETRY_EXHAUSTED after {attempt} attempts] "
                 f"endpoint={endpoint} last={last_exc_repr}")
            return None
        except Exception as exc:
            # non-retryable path: parse error, TypeError, etc. Preserve
            # existing "unavailable" behaviour so callers fall back to
            # char-3gram without waiting on retry backoff.
            _log(f"[G20 EMBEDDING_UNAVAILABLE] request exception: "
                 f"{type(exc).__name__}: {str(exc)[:200]}")
            return None
    # Defensive — loop can't fall through, but preserve invariant.
    _log(f"[G20 EMBEDDING_RETRY_EXHAUSTED after {max_attempts} attempts] "
         f"endpoint={endpoint} last={last_exc_repr}")
    return None


class _G20EmbeddingClient:
    """Databricks Model Serving embedding client with graceful degradation.

    On instantiation, attempts to mint a token via ``databricks auth token
    --profile <profile>`` (default ``DEFAULT`` from env). If auth or the
    endpoint call fails, ``embed_batch`` returns ``None`` so the caller can
    fall back to char-3gram-only. Cache the tokenised text so repeated pair
    comparisons don't re-invoke the endpoint.

    Industry-agnostic: no hardcoded catalog / workspace / customer names.
    Endpoint name is a parameter or env var.
    """

    def __init__(self, endpoint: str = None, profile: str = None,
                 host: str = None, logger=None):
        import os
        self._endpoint = (endpoint
                          or os.environ.get("INSPIRE_EMBED_ENDPOINT")
                          or G20_DEFAULT_EMBED_ENDPOINT)
        self._profile = (profile
                         or os.environ.get("DATABRICKS_CONFIG_PROFILE")
                         or "DEFAULT")
        self._host = host or os.environ.get("DATABRICKS_HOST")
        self._token = None
        self._token_minted = 0.0
        self._token_ttl_s = 2400  # 40 min
        self._cache = {}
        self._available = None  # tri-state: None=untested, True/False after
        self._logger = logger or print
        self._disabled_reason = None

    def _log(self, msg):
        try:
            self._logger(msg)
        except Exception:
            pass

    def _fresh_token(self):
        import json as _json
        import subprocess
        import time
        try:
            r = subprocess.run(
                ["databricks", "auth", "token", "--profile", self._profile],
                capture_output=True, text=True, timeout=30,
            )
            if r.returncode != 0:
                self._disabled_reason = (
                    f"databricks auth token failed: {r.stderr.strip()[:200]}"
                )
                return None
            payload = _json.loads(r.stdout)
            self._token = payload["access_token"]
            self._token_minted = time.time()
            if not self._host:
                # Discover the host from the same profile. The Databricks CLI emits
                # JSON since ~0.220 ({"env": {"DATABRICKS_HOST": "..."}}); the older
                # KEY=VALUE plain-text format is kept as a fallback for older CLIs.
                r2 = subprocess.run(
                    ["databricks", "auth", "env", "--profile", self._profile],
                    capture_output=True, text=True, timeout=30,
                )
                if r2.returncode == 0:
                    stdout = r2.stdout.strip()
                    try:
                        env_payload = _json.loads(stdout)
                        env_map = env_payload.get("env", env_payload) or {}
                        host = env_map.get("DATABRICKS_HOST")
                        if host:
                            self._host = str(host).strip().strip("\"'")
                    except Exception:
                        for line in stdout.splitlines():
                            if line.strip().startswith("DATABRICKS_HOST="):
                                self._host = line.split("=", 1)[1].strip().strip("\"'")
                                break
            return self._token
        except Exception as exc:
            self._disabled_reason = f"token mint exception: {exc!r}"[:200]
            return None

    def _ensure_token(self):
        import time
        if self._token and (time.time() - self._token_minted) < self._token_ttl_s:
            return self._token
        return self._fresh_token()

    def embed_batch(self, texts):
        """Return a list of embedding vectors, or ``None`` on any failure.

        The tool never hard-fails on embedding errors — matcher falls back to
        char-3gram-only. This preserves the property that audit runs on a
        laptop without Databricks auth still produce useful output.
        """
        import json as _json
        import urllib.request
        import urllib.error
        if self._available is False:
            return None
        tok = self._ensure_token()
        if not tok or not self._host:
            self._available = False
            self._log(f"[G20 EMBEDDING_UNAVAILABLE] no token/host: "
                      f"{self._disabled_reason or 'missing DATABRICKS_HOST'}")
            return None
        # Skip cache lookups for empty inputs.
        clean = [(t or "").strip() for t in texts]
        if not any(clean):
            return None
        # Hit cache first.
        keys = [_norm(t) for t in clean]
        missing = [(i, keys[i]) for i in range(len(keys)) if keys[i] not in self._cache]
        if missing:
            url = f"{self._host.rstrip('/')}/serving-endpoints/{self._endpoint}/invocations"
            body = _json.dumps({"input": [m[1] for m in missing]}).encode("utf-8")
            # v1.4.0 R3 — retry the embedding call with exponential backoff on
            # transient endpoint failures. The v1.3.9 nyctaxi audit tripped over
            # IncompleteRead / URLError mid-run; a single-shot call disables the
            # matcher for the rest of the audit. Retry 3 attempts (1s, 2s, 4s)
            # on IncompleteRead / URLError / ConnectionResetError / TimeoutError
            # / HTTP 5xx. Terminal failure logs the sentinel
            # [G20 EMBEDDING_RETRY_EXHAUSTED after N attempts] and falls back
            # to char-3gram cleanly (existing behaviour). 4xx errors do NOT
            # retry — those are client-side (auth, bad payload).
            raw = _embed_call_with_retry(
                url=url, body=body, token=tok,
                logger=self._log, endpoint=self._endpoint,
            )
            if raw is None:
                self._available = False
                return None
            try:
                obj = _json.loads(raw)
                data = obj.get("data") or []
                for (idx, key), row in zip(missing, data):
                    vec = row.get("embedding") if isinstance(row, dict) else row
                    if isinstance(vec, list) and vec:
                        self._cache[key] = vec
            except Exception as exc:
                self._available = False
                self._log(f"[G20 EMBEDDING_UNAVAILABLE] parse exception: "
                          f"{type(exc).__name__}: {str(exc)[:200]}")
                return None
        self._available = True
        # Return in original order (skip any that never made it into cache).
        out = []
        for k in keys:
            v = self._cache.get(k)
            if v is None:
                return None
            out.append(v)
        return out

    def is_available(self):
        # Trigger a lightweight probe.
        if self._available is None:
            self.embed_batch(["semantic matcher availability probe"])
        return bool(self._available)


def _g20_vector_cosine(vec_a, vec_b) -> float:
    """Plain vector cosine; returns 0.0 on shape mismatch or empty inputs."""
    import math
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(vec_a, vec_b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def g20_hybrid_similarity(text_a: str, text_b: str,
                          embed_client: _G20EmbeddingClient = None,
                          embedding_weight: float = G20_EMBEDDING_WEIGHT,
                          char3gram_weight: float = G20_CHAR3GRAM_WEIGHT) -> tuple:
    """v1.3.8 FIX #1 — hybrid similarity for paraphrase-tolerant UC matching.

    Returns ``(hybrid_score, components)`` where ``components`` is a dict of
    ``{"embedding_cos", "char3gram_cos", "embedding_source"}``. If the embedding
    endpoint is unavailable, ``embedding_cos`` is ``None`` and the score
    degrades to the char-3gram cosine multiplied by ``char3gram_weight`` alone
    — this is a documented degraded mode; the sentinel
    ``[G20 EMBEDDING_UNAVAILABLE]`` fires exactly once per client to alert the
    operator.

    Industry-agnostic: no keyword lookup, no regex on domain vocabulary, no
    catalog/schema/table names anywhere in the code path.
    """
    c3 = _rc45_char3gram_cosine(text_a or "", text_b or "")
    emb_cos = None
    emb_source = "unavailable"
    if embed_client is not None:
        vecs = embed_client.embed_batch([text_a or "", text_b or ""])
        if vecs and len(vecs) == 2:
            emb_cos = _g20_vector_cosine(vecs[0], vecs[1])
            emb_source = embed_client._endpoint
    if emb_cos is None:
        hybrid = char3gram_weight * c3
    else:
        hybrid = embedding_weight * emb_cos + char3gram_weight * c3
    return hybrid, {
        "embedding_cos": round(emb_cos, 4) if emb_cos is not None else None,
        "char3gram_cos": round(c3, 4),
        "embedding_source": emb_source,
        "hybrid_score": round(hybrid, 4),
    }


def _g20_should_promote(u_cur: dict, u_base: dict,
                        embed_client: _G20EmbeddingClient = None,
                        threshold: float = G20_HYBRID_THRESHOLD) -> tuple:
    """v1.3.8 FIX #1 (G20) — decide if a weak pair should be promoted via hybrid similarity.

    Rule: hybrid similarity (embedding + char-3gram cosine) of the full UC
    bag (use_case + statement + solution + business_value) >= ``threshold``
    AND primary_table matches (short name normalised) AND business_domain
    matches (case-insensitive) OR the domain-token overlap is at least one
    shared token. Broader anchor than RC-45 because verb-lemma + object-noun
    were too narrow; RC-45 was too narrow because domain must EXACTLY match.
    G20 accepts partial domain overlap plus a stronger hybrid signal.

    Industry-agnostic: no keyword vocabulary; no regex on domain names; no
    hardcoded table/catalog names. All decisions come from character n-gram
    cosine + optional embedding cosine + generic set operations.

    Returns ``(should_promote: bool, reason: dict)``.
    """
    pt_cur, pt_base = _primary_table(u_cur), _primary_table(u_base)
    if not pt_cur or not pt_base or pt_cur != pt_base:
        return False, {"pt_match": False}
    dom_cur = _domain_tokens(u_cur)
    dom_base = _domain_tokens(u_base)
    if not dom_cur or not dom_base or not (dom_cur & dom_base):
        return False, {"pt_match": True, "domain_overlap": False,
                       "dom_cur": sorted(dom_cur), "dom_base": sorted(dom_base)}
    bag_cur = _g20_bag_text(u_cur)
    bag_base = _g20_bag_text(u_base)
    if not bag_cur or not bag_base:
        return False, {"pt_match": True, "domain_overlap": True, "bag_empty": True}
    hybrid, components = g20_hybrid_similarity(bag_cur, bag_base, embed_client=embed_client)
    if hybrid < threshold:
        return False, {"pt_match": True, "domain_overlap": True,
                       "hybrid": components.get("hybrid_score"),
                       "components": components,
                       "threshold": threshold}
    return True, {"pt_match": True, "domain_overlap": True,
                  "hybrid": components.get("hybrid_score"),
                  "components": components,
                  "threshold": threshold}


def g20_calibrate_threshold(embed_client: _G20EmbeddingClient = None):
    """Run the calibration set through ``g20_hybrid_similarity`` and return
    a summary the operator can inspect. Useful for tuning the threshold
    after a corpus/audit change. Does NOT modify the module-level threshold.
    """
    results = []
    for label, a, b, expected in _G20_HYBRID_CALIBRATION_PAIRS:
        score, components = g20_hybrid_similarity(a, b, embed_client=embed_client)
        results.append({
            "label": label,
            "expected": expected,
            "hybrid": components.get("hybrid_score"),
            "embedding_cos": components.get("embedding_cos"),
            "char3gram_cos": components.get("char3gram_cos"),
            "verdict": "match" if score >= G20_HYBRID_THRESHOLD else "unrelated",
            "matches_expected": ((score >= G20_HYBRID_THRESHOLD) == (expected == "match")),
        })
    accuracy = sum(1 for r in results if r["matches_expected"]) / max(1, len(results))
    return {"threshold": G20_HYBRID_THRESHOLD, "accuracy": round(accuracy, 3),
            "results": results}


def semantic_match(current: list, baseline: list, high: float = 0.55,
                   low: float = 0.40,
                   rc36_promote_low: float = 0.35,
                   rc45_min_sim: float = 0.55,
                   g20_threshold: float = G20_HYBRID_THRESHOLD,
                   embed_client: _G20EmbeddingClient = None):
    """Match ``current`` UCs to ``baseline`` UCs via TF-IDF cosine + boosts.

    Returns four lists: matches (sim >= high), weak (low <= sim < high),
    novel (best sim < low), missing (baseline UCs no current UC claimed).

    v1.3.5 RC-36 — after the primary loop, weak pairs with sim >=
    ``rc36_promote_low`` (default 0.35) whose (primary_table, verb-lemma group,
    object noun) all match are PROMOTED to matched. The promotion is logged
    into the returned rows (`rc36_promoted=True`) so audit tooling can count
    them and the `[G17 WEAK_MATCH_PROMOTED FIRED]` sentinel is emitted with
    the promotion count.

    v1.3.6 RC-45 — RC-36 fired 0/71 times on the v135 swarm because
    verb-lemma + object-noun triple-match was too narrow. RC-45 runs as a
    SECOND promotion pass over the still-weak residue: char-3gram TF-IDF
    cosine of extracted action phrases (verb + object + intent) >=
    ``rc45_min_sim`` (default 0.55) AND primary_table match AND
    business_domain match. Broader anchor than RC-36's triple. Sentinel
    ``[G18 WEAK_MATCH_EMBEDDING_PROMOTED FIRED] n=N`` prints on completion.
    """
    if not current:
        missing = [_missing_row(u) for u in (baseline or [])]
        return [], [], [], missing
    if not baseline:
        novel = [{
            "current_id": u.get("id"),
            "current_uc": u.get("use_case"),
            "best_sim": 0.0,
        } for u in current]
        return [], [], novel, []

    cur_bags = [_bag(u) for u in current]
    base_bags = [_bag(u) for u in baseline]
    corpus = cur_bags + base_bags
    vec = TfidfVectorizer(
        lowercase=True,
        stop_words="english",
        ngram_range=(1, 2),
        min_df=1,
    )
    mat = vec.fit_transform(corpus)
    n_cur = len(cur_bags)
    cur_mat = mat[:n_cur]
    base_mat = mat[n_cur:]
    sims = cosine_similarity(cur_mat, base_mat)

    used = set()
    matches: list = []
    weak: list = []
    novel: list = []

    # Sort current-UCs by max similarity descending so best pairs claim baselines first.
    order = np.argsort(-sims.max(axis=1)).tolist()
    for i in order:
        if not len(sims[i]):
            novel.append({
                "current_id": current[i].get("id"),
                "current_uc": current[i].get("use_case"),
                "best_sim": 0.0,
            })
            continue
        best_j = None
        best_r = -1.0
        for j in range(sims.shape[1]):
            if j in used:
                continue
            r = float(sims[i, j]) + _boost(current[i], baseline[j])
            if r > best_r:
                best_r, best_j = r, j
        if best_j is None or best_r < low:
            novel.append({
                "current_id": current[i].get("id"),
                "current_uc": current[i].get("use_case"),
                "best_sim": round(float(sims[i].max()), 3) if len(sims[i]) else 0.0,
            })
            continue
        pair = _pair_row(current[i], baseline[best_j], best_r)
        if best_r >= high:
            matches.append(pair)
            used.add(best_j)
        else:
            weak.append(pair)

    # v1.3.5 RC-36 — promote weak pairs with primary_table + verb-lemma + object
    # noun all matching (even if TF-IDF cosine is 0.35-0.45).
    promoted = []
    remaining_weak = []
    id_lookup_cur = {u.get("id"): u for u in current}
    id_lookup_base = {u.get("id"): u for u in baseline}
    for w in weak:
        if float(w.get("similarity") or 0.0) < rc36_promote_low:
            remaining_weak.append(w)
            continue
        u_cur = id_lookup_cur.get(w.get("current_id"))
        u_base = id_lookup_base.get(w.get("baseline_id"))
        if u_cur is None or u_base is None:
            remaining_weak.append(w)
            continue
        should, reason = _rc36_should_promote(u_cur, u_base)
        if should:
            w = dict(w)
            w["rc36_promoted"] = True
            w["rc36_reason"] = reason
            promoted.append(w)
        else:
            remaining_weak.append(w)
    if promoted:
        matches.extend(promoted)
        weak = remaining_weak
        print(
            "[G17 WEAK_MATCH_PROMOTED FIRED] n=%d (RC-36: promoted %d weak pairs "
            "with primary_table + verb-lemma + object noun match to matched)"
            % (len(promoted), len(promoted))
        )

    # v1.3.6 RC-45 — second promotion pass over remaining weak pairs.
    # Broader anchor: primary_table + business_domain + action-phrase cosine.
    rc45_promoted = []
    rc45_remaining_weak = []
    used_ids = {m.get("baseline_id") for m in matches if m.get("baseline_id")}
    for w in weak:
        u_cur = id_lookup_cur.get(w.get("current_id"))
        u_base = id_lookup_base.get(w.get("baseline_id"))
        if u_cur is None or u_base is None:
            rc45_remaining_weak.append(w)
            continue
        should, reason = _rc45_should_promote(u_cur, u_base, min_sim=rc45_min_sim)
        if should:
            w = dict(w)
            w["rc45_promoted"] = True
            w["rc45_reason"] = reason
            rc45_promoted.append(w)
        else:
            rc45_remaining_weak.append(w)
    if rc45_promoted:
        matches.extend(rc45_promoted)
        weak = rc45_remaining_weak
        for _m in rc45_promoted:
            _bid = _m.get("baseline_id")
            if _bid is not None:
                for _j, _b in enumerate(baseline):
                    if _b.get("id") == _bid:
                        used.add(_j)
                        break
        print(
            "[G18 WEAK_MATCH_EMBEDDING_PROMOTED FIRED] n=%d min_sim=%.2f "
            "(RC-45: promoted %d weak pairs on primary_table + domain + "
            "action-phrase cosine after RC-36 triple-match missed them)"
            % (len(rc45_promoted), rc45_min_sim, len(rc45_promoted))
        )

    # v1.3.8 FIX #1 (G20) — hybrid embedding + char-3gram promotion pass over
    # the residual weak set AND over paraphrase pairs the RC-45 domain-exact
    # gate missed. This runs AFTER RC-36 and RC-45 so it never demotes any
    # earlier promotion, only adds new ones. Falls back to char-3gram alone
    # when the embedding endpoint is unavailable (documented degraded mode).
    g20_promoted = []
    g20_remaining_weak = []
    for w in weak:
        u_cur = id_lookup_cur.get(w.get("current_id"))
        u_base = id_lookup_base.get(w.get("baseline_id"))
        if u_cur is None or u_base is None:
            g20_remaining_weak.append(w)
            continue
        should, reason = _g20_should_promote(
            u_cur, u_base, embed_client=embed_client, threshold=g20_threshold,
        )
        if should:
            w = dict(w)
            w["g20_promoted"] = True
            w["g20_reason"] = reason
            g20_promoted.append(w)
        else:
            g20_remaining_weak.append(w)
    if g20_promoted:
        matches.extend(g20_promoted)
        weak = g20_remaining_weak
        for _m in g20_promoted:
            _bid = _m.get("baseline_id")
            if _bid is not None:
                for _j, _b in enumerate(baseline):
                    if _b.get("id") == _bid:
                        used.add(_j)
                        break
        print(
            "[G20 SEMANTIC_MATCHER_V2 FIRED] n=%d threshold=%.2f "
            "(v1.3.8 FIX #1: promoted %d weak pairs via hybrid embedding + "
            "char-3gram cosine after RC-36/RC-45 missed them)"
            % (len(g20_promoted), g20_threshold, len(g20_promoted))
        )

    # v1.3.8 FIX #1 — also scan the CURRENTLY-UNPAIRED baseline rows against
    # the CURRENTLY-UNPAIRED current rows via hybrid similarity. The RC-36 /
    # RC-45 / G20 promotion passes above only re-evaluate weak-existing pairs
    # (best-boost pair per current UC that landed weak); a baseline UC whose
    # closest current UC never entered `weak` — because sims[i, j] < low even
    # after boost — is invisible to those passes. G20 hybrid can rescue such
    # baselines when the char-3gram is genuinely low but the embedding cosine
    # is high (verb/noun paraphrase). Industry-agnostic; no keywords.
    if embed_client is not None:
        g20_rescued = []
        unpaired_current_idx = [
            i for i in range(len(current))
            if current[i].get("id") not in {
                m.get("current_id") for m in matches if m.get("current_id")
            }
        ]
        unpaired_baseline_idx = [j for j in range(len(baseline)) if j not in used]
        # Cap the pairwise scan to protect wall-time (P * Q calls with P and Q
        # up to ~200 each is 40k pair evaluations — the embedding cache keeps
        # this modest, but char-3gram is per-pair).
        _cap = 400
        _scans = 0
        for j in unpaired_baseline_idx:
            best = None
            for i in unpaired_current_idx:
                if _scans >= _cap:
                    break
                should, reason = _g20_should_promote(
                    current[i], baseline[j],
                    embed_client=embed_client, threshold=g20_threshold,
                )
                _scans += 1
                if should:
                    if best is None or (reason.get("hybrid") or 0) > (best[1].get("hybrid") or 0):
                        best = (i, reason)
            if best is not None:
                i, reason = best
                pair = _pair_row(current[i], baseline[j], reason.get("hybrid") or g20_threshold)
                pair["g20_rescued"] = True
                pair["g20_reason"] = reason
                g20_rescued.append(pair)
                used.add(j)
                # Remove from unpaired_current so it isn't double-claimed by
                # a subsequent baseline in the same scan.
                if i in unpaired_current_idx:
                    unpaired_current_idx.remove(i)
        if g20_rescued:
            matches.extend(g20_rescued)
            print(
                "[G20 UNPAIRED_BASELINE_RESCUED FIRED] n=%d threshold=%.2f "
                "(v1.3.8 FIX #1: %d baseline UCs previously counted MISSING "
                "were paired to a novel current UC by hybrid similarity)"
                % (len(g20_rescued), g20_threshold, len(g20_rescued))
            )
            # Also strip any novel rows that just got claimed.
            _claimed_current = {m.get("current_id") for m in g20_rescued}
            novel = [n for n in novel if n.get("current_id") not in _claimed_current]

    missing = [
        _missing_row(baseline[j])
        for j in range(len(baseline)) if j not in used
    ]
    return matches, weak, novel, missing


def _pair_row(u_cur, u_base, sim):
    return {
        "current_id": u_cur.get("id"),
        "current_uc": u_cur.get("use_case"),
        "current_domain": u_cur.get("business_domain"),
        "current_priority": u_cur.get("priority_score"),
        "current_bob": u_cur.get("bob_score"),
        "current_primary_table": u_cur.get("primary_table"),
        "baseline_id": u_base.get("id"),
        "baseline_uc": u_base.get("use_case"),
        "baseline_domain": u_base.get("business_domain"),
        "baseline_priority": u_base.get("priority_score"),
        "baseline_primary_table": u_base.get("primary_table"),
        "similarity": round(float(sim), 3),
    }


def _missing_row(u):
    return {
        "baseline_id": u.get("id"),
        "baseline_uc": u.get("use_case"),
        "baseline_domain": u.get("business_domain"),
        "baseline_priority": u.get("priority_score"),
        "baseline_primary_table": u.get("primary_table"),
    }


def summarise(current, baseline, matches, weak, novel, missing) -> dict:
    def _p(u, k, default=0.0):
        try:
            return float(u.get(k) or default)
        except Exception:
            return default

    matched_worse = sum(
        1 for m in matches
        if _p(m, "current_priority") + 0.5 < _p(m, "baseline_priority")
    )
    retained_better = sum(
        1 for m in matches
        if _p(m, "current_priority") > _p(m, "baseline_priority") + 0.5
    )
    retained_same = len(matches) - matched_worse - retained_better
    missed_catches = sum(1 for m in missing if _p(m, "baseline_priority") >= 7.5)
    novel_genuine = sum(
        1 for n in novel
        if _p(next((c for c in current if c.get("id") == n.get("current_id")), {}),
              "priority_score") >= 7.0
    )
    return {
        "n_current": len(current),
        "n_baseline": len(baseline),
        "matches": len(matches),
        "weak_matches": len(weak),
        "novel": len(novel),
        "missing": len(missing),
        "matched_worse": matched_worse,
        "retained_same": retained_same,
        "retained_better": retained_better,
        "missed_catches_priority_ge_75": missed_catches,
        "novel_genuine_priority_ge_70": novel_genuine,
    }


def _load_ucs(path: str) -> list:
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and "ucs" in data:
        return data["ucs"]
    if isinstance(data, list):
        return data
    raise ValueError(f"Cannot load UCs from {path}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--current", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--high", type=float, default=0.55)
    ap.add_argument("--low", type=float, default=0.40)
    # v1.3.8 FIX #1 — embedding-based hybrid matcher (G20). Defaults keep
    # backward-compatible behaviour: the matcher runs in degraded mode
    # (char-3gram only) when no endpoint is available, printing the
    # `[G20 EMBEDDING_UNAVAILABLE]` sentinel exactly once.
    ap.add_argument("--g20-threshold", type=float, default=G20_HYBRID_THRESHOLD,
                    help="Hybrid similarity threshold for G20 promotion (default: 0.55)")
    ap.add_argument("--embed-endpoint", type=str, default=None,
                    help=("Databricks Model Serving embedding endpoint. Defaults "
                          "to $INSPIRE_EMBED_ENDPOINT or databricks-gte-large-en."))
    ap.add_argument("--embed-profile", type=str, default=None,
                    help="CLI profile to mint the token from (default: $DATABRICKS_CONFIG_PROFILE or DEFAULT)")
    ap.add_argument("--no-embedding", action="store_true",
                    help="Force char-3gram-only mode (disable embedding endpoint)")
    ap.add_argument("--calibrate", action="store_true",
                    help="Run the G20 calibration set and exit (no baseline/current comparison)")
    args = ap.parse_args()

    embed_client = None
    if not args.no_embedding:
        embed_client = _G20EmbeddingClient(
            endpoint=args.embed_endpoint, profile=args.embed_profile,
        )
        if not embed_client.is_available():
            embed_client = None  # graceful fallback

    if args.calibrate:
        result = g20_calibrate_threshold(embed_client=embed_client)
        print(json.dumps(result, indent=2))
        return

    current = _load_ucs(args.current)
    baseline = _load_ucs(args.baseline)
    matches, weak, novel, missing = semantic_match(
        current, baseline, high=args.high, low=args.low,
        g20_threshold=args.g20_threshold, embed_client=embed_client,
    )
    summary = summarise(current, baseline, matches, weak, novel, missing)
    out = {
        "meta": {
            "matcher": "tfidf+cosine+boost+g20_hybrid",
            "matcher_version": "v1.3.8-G20",
            "high": args.high,
            "low": args.low,
            "g20_threshold": args.g20_threshold,
            "embedding_available": embed_client is not None,
            "embedding_endpoint": (embed_client._endpoint if embed_client else None),
        },
        "summary": summary,
        "matches": matches,
        "weak_matches": weak,
        "novel": novel,
        "missing": missing,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
