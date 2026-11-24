# intmerge2 edits
- Merge 1 (lane/v514_pins): no source conflicts; dist rename conflicts resolved by taking HEAD dist, rebuilt after merge 2.
- Merge 2 (int/req506): conflicts only in app_shell.b64, both ipynb, notebook_bundle.js; took ours then regenerated (embed.py write, scripts/bundle-agent-notebook.mjs). Not hand-edited.
- Test edit app/frontend/test/ui/implementScope.ui.test.mjs:559: 'bg-db-red-solid' -> 'bg-primary-solid' (RunScope.jsx uses bg-primary-solid; same assert, repointed).
- Test edit app/frontend/test/ui/valueCardBoxes.ui.test.mjs:81: probe class 'bg-db-red-solid' -> 'bg-primary-solid' (alias of same token; assert unchanged).
- Closing grep leftovers (kept on purpose): req508Lint.mjs / req508L7Primitives.test.mjs (lint rule must still flag the legacy class, planted fixtures), req508L1DesignTokens.test.mjs (tests the alias itself), ui/req508Headers.mjs:30 (comment).
