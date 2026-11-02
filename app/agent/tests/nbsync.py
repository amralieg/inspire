"""Extract / re-inject `cells[1]` of the agent notebook as a plain .py mirror.

Editing a 36k-line source cell through JSON string escaping is error prone, so the working
loop is: `extract` to a mirror, edit the mirror with ordinary Python tooling, `inject` back.
`inject` refuses to write a mirror that does not `ast.parse`, and every other cell is left
byte-identical.
"""
import argparse
import ast
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nbload import strip_magic_lines  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT_NB = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
IMPL_CELL_INDEX = 1


def _load(nb_path):
    with open(nb_path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def extract(nb_path, out_path):
    nb = _load(nb_path)
    src = "".join(nb["cells"][IMPL_CELL_INDEX]["source"])
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(src)
    return src


def inject(nb_path, in_path):
    with open(in_path, "r", encoding="utf-8") as fh:
        src = fh.read()
    ast.parse(strip_magic_lines(src))
    nb = _load(nb_path)
    lines = src.splitlines(keepends=True)
    nb["cells"][IMPL_CELL_INDEX]["source"] = lines
    with open(nb_path, "w", encoding="utf-8") as fh:
        json.dump(nb, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return len(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["extract", "inject"])
    ap.add_argument("--mirror", default="/tmp/ship105/cell1.py")
    ap.add_argument("--notebook", default=AGENT_NB)
    args = ap.parse_args()
    if args.action == "extract":
        src = extract(args.notebook, args.mirror)
        print("extracted %d lines -> %s" % (len(src.splitlines()), args.mirror))
    else:
        n = inject(args.notebook, args.mirror)
        print("injected %d lines -> %s" % (n, args.notebook))


if __name__ == "__main__":
    main()
