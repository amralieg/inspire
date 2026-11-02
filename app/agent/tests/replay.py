"""Offline record and replay of LLM calls from _ailogs rows.

load_ailogs() reads successful rows of an _ailogs export (JSONL, or a list of row dicts) into
{request_hash: response}. ReplaySpark answers every ai_query statement with the recorded response of
the request with the same hash and raises MissingRecording for a request that was never recorded, so
a replayed test can never reach a live endpoint.
"""
import hashlib
import json
import threading
import types


class MissingRecording(LookupError):
    pass


def request_hash(text: str) -> str:
    return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()


def load_ailogs(source) -> dict:
    if isinstance(source, (list, tuple)):
        rows = list(source)
    else:
        with open(source, encoding="utf-8") as handle:
            rows = [json.loads(line) for line in handle if line.strip()]
    recordings = {}
    for row in rows:
        if row.get("status") == "success" and row.get("request_hash"):
            recordings.setdefault(row["request_hash"], row.get("response") or "")
    return recordings


class ReplaySpark:
    def __init__(self, recordings: dict):
        self.recordings = dict(recordings)
        self.served, self.missing = [], []
        self._lock = threading.Lock()

    def sql(self, statement, args=None):
        if "ai_query(" not in str(statement):
            return types.SimpleNamespace(collect=lambda: [])
        key = request_hash((args or {}).get("prompt_text", ""))
        with self._lock:
            if key not in self.recordings:
                self.missing.append(key)
                raise MissingRecording(f"no recorded response for request_hash {key[:12]}")
            self.served.append(key)
        response = self.recordings[key]
        return types.SimpleNamespace(collect=lambda: [types.SimpleNamespace(ai_response=response)])

    def addTag(self, tag):
        return None

    def removeTag(self, tag):
        return None

    def interruptTag(self, tag):
        return None
