import hashlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _agentload import REFERENCE_DIR, load_agent_namespace, reference_notebook  # noqa: E402

PINNED = {
    "agent_v1.2.1.ipynb": "3b7653173d97d71e4435ea7fd3c9bc0ac61ed210",
    "agent_3e2543e.ipynb": "ba3dd4b2bf1a7ddaf2e76fdb92c8270460c7b919",
}


def git_blob_sha(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def pin_problems(directory, pinned):
    found = {path.name: git_blob_sha(path.read_bytes()) for path in Path(directory).iterdir() if path.is_file()}
    problems = [f"{name} missing" for name in pinned if name not in found]
    problems += [f"{name} not pinned" for name in found if name not in pinned]
    problems += [f"{name} changed" for name in found if name in pinned and found[name] != pinned[name]]
    return sorted(problems)


def test_every_reference_notebook_is_pinned_and_unchanged():
    assert pin_problems(REFERENCE_DIR, PINNED) == []


def test_a_changed_an_extra_and_a_missing_reference_notebook_all_fail(tmp_path):
    for name in PINNED:
        (tmp_path / name).write_bytes((REFERENCE_DIR / name).read_bytes())
    assert pin_problems(tmp_path, PINNED) == []
    tampered = tmp_path / "agent_3e2543e.ipynb"
    tampered.write_bytes(tampered.read_bytes() + b"\n")
    (tmp_path / "agent_v9.9.9.ipynb").write_text("{}", encoding="utf-8")
    (tmp_path / "agent_v1.2.1.ipynb").unlink()
    assert pin_problems(tmp_path, PINNED) == ["agent_3e2543e.ipynb changed", "agent_v1.2.1.ipynb missing",
                                              "agent_v9.9.9.ipynb not pinned"]


def test_reference_notebook_finds_a_vendored_ref_and_names_the_file_to_add_for_a_missing_one():
    assert reference_notebook("3e2543e") == REFERENCE_DIR / "agent_3e2543e.ipynb"
    with pytest.raises(FileNotFoundError, match=r"no reference notebook for v0\.0\.0: .*tests/regression/reference/agent_v0\.0\.0\.ipynb"):
        reference_notebook("v0.0.0")


def test_the_base_notebook_of_the_elite_differential_loads_as_its_own_version():
    ns = load_agent_namespace(str(reference_notebook("3e2543e")))
    assert callable(ns["DatabricksInspire"].run)
    assert ns["__AGENT_VERSION__"] == "v1.1.3"
