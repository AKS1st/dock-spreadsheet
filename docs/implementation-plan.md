# dock-spreadsheet implementation plan

Goal: A standalone, read-only dock-files viewer for XLSX/XLS/ODS/CSV/TSV. Approved in this conversation: SheetJS CE parsing, Tabulator grid, sheet selection, sorting, filtering and searching; implementation adds Papa Parse for delimited text after a regression exposed SheetJS CSV/HTML misdetection; no editing, formula execution, macro execution or source-file writes.

Architecture: dock-files retains file dispatch ownership. New plugin registers one viewer/editor view through `ctx.files`/`ctx.workbench`; Host implements a same-origin, size-limited binary read endpoint; Client parses Excel/ODS with SheetJS and CSV/TSV with Papa Parse as data, then renders text cells in Tabulator. No new dock-files API and no change to its dirty worktree.

Baseline: `plugins/dock-files/src/client/index.ts`, `plugins/dock-images/src/index.ts`, `plugins/dock-images/src/client/index.ts`, `plugins/dock-markdown/tsdown.config.mjs`; SheetJS CE official format/install docs and Tabulator documentation. Change necessity: no existing viewer supports workbook formats or sheet navigation; config-only change cannot deliver this behavior. TDD Route: off / skipped; add focused post-change regression tests and build checks.

Tasks:
1. Scaffold independent plugin manifest, build configuration, type-only dock contract and README; pin official SheetJS CE package and mature Tabulator runtime dependency.
2. Host read endpoint: trust fence, absolute path, extension allowlist, regular-file validation and 20 MiB size ceiling; return binary (not base64 JSON); tests cover path/size/trust and read-only behavior.
3. Client: parse workbook without evaluating formulas, preserve row/column coordinates and blank cells, render Tabulator with virtual scrolling, sheet chooser, column sorting/filter/search, loading/empty/error states; clean up instances on unmount/HMR.
4. Verify install/check/test/build, inspect emitted client bundle for unresolved imports; if feasible run an isolated profile without touching running dsh web. Stage deployment config/link only if authorized and writable; do not restart the active process. Report remaining runtime verification and user-controlled restart.

Outcome (2026-10-01):
- Tasks 1-3 delivered; `pnpm run check` and `pnpm test` pass with 9 tests. Task 4 partially delivered.
- Verification found and fixed two real defects: SheetJS misdetects CSV whose first cell begins with `<` as HTML (delimiter-separated files now parse with Papa Parse), and Tabulator silently drops filters applied before its initialization pass (the search term is now retained and re-applied on `tableBuilt`, gated on the table's own ready state instead of a self-managed flag).
- Runtime DOM verification runs in jsdom with the real `lib/client.js`, React 18 and Tabulator: mount, search, sort and worksheet switching are exercised. `react-dom/client` must be imported only after the jsdom globals exist, otherwise its event system never delivers dispatched events to React — a test-harness constraint, not a product constraint.
- Deployment is blocked in this environment: `/` is mounted read-only (`/home/zero/AgentX` is the only writable mount), `node_modules` under `/home/zero/.dsh/profiles/web/` cannot receive the package link, no root and `no_new_privs`. Profile manifest edits staged during the attempt were reverted so the next dsh web start cannot fail on an unresolvable bundle. Activation in the running GUI therefore remains user-owned: install the package into the profile (writable filesystem required) and restart dsh web.

Compatibility/security: same-origin/loopback-or-trusted-host request fence, no writing endpoints, no arbitrary HTML formatter, direct content text only. Large files fail explicitly. Parsing can remain expensive near the limit; document bounded risk. No old path retired, because this is an additive viewer. Stop if dependencies cannot be acquired or isolated execution cannot verify the integration; do not claim running GUI activation from build success.
