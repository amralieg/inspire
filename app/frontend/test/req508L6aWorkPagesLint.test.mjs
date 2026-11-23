// REQ-508 L6a (Art Director pass, direction "A Calm Console", approved by Amr): the work-pages files meet the design rules of audit
// scratch/req508_art_director.md section 2 (F14 F15 F17 F18 F20 F23 F31, transition rule 5). Rules and file groups: test/req508Lint.mjs;
// the only exceptions are in test/req508DesignLint.allow.json (Landing decoration, canvas colours, the F33 orphans).
// Fail-pre (15eb146b9): the rules below have hits in these files (text under 12px, hex/rgba literals, arbitrary radii, transition-all,
// v3 gradients, gradient text, off-scale icon sizes, colour classes with no token).
import test from "node:test";
import assert from "node:assert/strict";
import { lintSuite } from "./req508Lint.mjs";

lintSuite(test, assert, "work-pages", "L6a");
