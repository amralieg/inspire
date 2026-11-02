"""Workspace double for the fingerprinted Genie notebook writer: export, import, mkdirs, status and listing."""
import base64
import json
import types


class FakeWorkspace:
    def __init__(self, existing=None, listing=None, export_error=None):
        self.existing = dict(existing or {})
        self.listing = list(listing or [])
        self.export_error = export_error
        self.imports = []
        self.exports = []

    def export(self, path, format=None):
        self.exports.append(path)
        if self.export_error is not None:
            raise self.export_error
        if path in self.existing:
            payload = self.existing[path]
            text = payload if isinstance(payload, str) else json.dumps(payload)
            return types.SimpleNamespace(content=base64.b64encode(text.encode("utf-8")).decode())
        raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: Path ({path}) doesn't exist.")

    def mkdirs(self, path):
        return None

    def import_(self, path, overwrite, format, content):
        self.imports.append({"path": path, "content": base64.b64decode(content).decode("utf-8"), "format": format})

    def get_status(self, path):
        return types.SimpleNamespace(path=path, object_id=1000 + len(self.imports))

    def list(self, path):
        return [types.SimpleNamespace(path=p) for p in self.listing]
