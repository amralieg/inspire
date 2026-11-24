
## 514b
- app/frontend/test/ui/implementApp.ui.test.mjs:831-832: `genie.getByText('Inspire has built none yet').waitFor()` -> assert `[data-merge="genie_space"]` count is 0. Reason: REQ-514 fixed the Genie Agent with the App (line 54 already pins no Genie card), Deliver has no Genie join row; product intentionally dropped it, old text is gone.
- app/frontend/test/ui/implement.ui.test.mjs:1238,1239: `bg-db-red-solid` -> `bg-primary-solid` (REQ-508 0697d25d9 rename). Same assert strength.
- app/frontend/test/ui/implement.ui.test.mjs:1265: same rename, same test (found when re-running; same stale-pin class).
- New app/frontend/test/appRefusalGrant.test.mjs (3 tests); red on b3f94b341 (key ignored the grant round), green after the fix.
