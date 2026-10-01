# dock-spreadsheet

[简体中文](README.md) · [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/dock-spreadsheet.svg)](https://www.npmjs.com/package/dock-spreadsheet) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![Node.js ≥20](https://img.shields.io/badge/Node.js-%E2%89%A520-43853d)

**A read-only spreadsheet viewer for [dock-files](https://github.com/AKS1st/dock-files).** Open XLSX, XLS, ODS, CSV and TSV files inside the [dock](https://github.com/AKS1st/dock) workbench without uploading them to an external service. Parsing, virtual scrolling and grid interactions use [SheetJS CE](https://docs.sheetjs.com/), [Papa Parse](https://www.papaparse.com/) and [Tabulator](https://tabulator.info/). No runtime CDN requests are required.

> **Scope: read-only preview.** The plugin does not edit or save files, evaluate formulas, run macros, or reproduce source fonts, colors, merged cells, charts or print layouts.

## Screenshots

These screenshots come from an actual isolated `dsh web` + Chromium run using a synthetic workbook. They show only the viewer, with the workspace and conversation UI cropped out.

![Read-only spreadsheet viewer with sheet tabs, selected cell and data grid](assets/spreadsheet-viewer.png)

<details>
<summary>View column filtering</summary>

![Filtered column with the matching row and visible-row count](assets/spreadsheet-filter.png)

</details>

<details>
<summary>View the compact 360px window</summary>

![Spreadsheet viewer in a narrow floating window](assets/spreadsheet-compact.png)

</details>

## Features

- **Common file types:** dock-files dispatches `.xlsx`, `.xls`, `.ods`, `.csv` and `.tsv` to the viewer. Switch worksheets using bottom tabs, including arrow keys and Home/End.
- **Familiar grid:** lettered columns, frozen actual row numbers, fine gridlines and a selected-cell outline. A read-only inspector displays the cell address and text; hover over truncated values to see the full text. The first row stays data; no header inference.
- **Find and filter:** search across the current worksheet's data columns, click a column header to sort, and reveal per-column header filters on demand. Hiding the filter controls clears column filters so no invisible constraint remains. The footer displays visible / preview rows and column count.
- **Link navigation:** recognise `http://`, `https://` and `www.` in cells. **Ctrl+click** (or **⌘+click** on macOS) opens a new tab; a plain click only selects the cell. Bare domains and email addresses are not auto-linked.
- **Large-sheet preview:** Tabulator's virtual rendering limits DOM nodes to visible rows. Sheet tabs can scroll horizontally in a narrow floating window, where secondary toolbar hints are hidden.
- **Coordinate fidelity:** keep the original column letters and row numbers for sheets starting at an offset such as `C3`; empty cells remain empty.

## Installation

Requires DSH Web, Node.js ≥20, and the enabled [`dock-base`](https://github.com/AKS1st/dock) and [`dock-files`](https://github.com/AKS1st/dock-files) plugins. **Install all three as top-level plugins in this order:** downloading a base package as a dependency alone does not mount its bundle.

### npm (recommended)

```sh
dsh plugin --profile web add dock-base
dsh plugin --profile web add dock-files
dsh plugin --profile web add dock-spreadsheet
```

### GitHub (alternative)

```sh
dsh plugin --profile web add github:AKS1st/dock
dsh plugin --profile web add github:AKS1st/dock-files
dsh plugin --profile web add github:AKS1st/dock-spreadsheet
```

For local development, use `dsh plugin --profile web add link:/absolute/path/to/dock-spreadsheet`. **After installing or updating, restart dsh web yourself** to ensure the new bundle takes effect; the plugin never restarts your process. The Web profile's `node_modules/dock-spreadsheet` must resolve—merely listing its name as a bundle is not an installation. If the profile is on a read-only mount, make that directory writable before installing.

## Usage

1. Open a supported file in the dock-files explorer. The viewer appears in a dock floating window; it does not add a separate activity-bar item.
2. Click a data cell to inspect its original worksheet coordinate and text (hover over a long value to see it in full). Ctrl/⌘+click a detected link to open it in a new tab.
3. Search to filter the current worksheet; click a column header to sort; press the column-filter button to show or hide header inputs. Search and column filtering can be combined.
4. Click a worksheet tab to switch sheets, or focus a tab and use ←/→ or Home/End. Switching clears the previous cell selection.

## Formats, limits and security

| Topic | Actual behavior |
| --- | --- |
| Excel / OpenDocument | SheetJS CE 0.20.3 reads `.xlsx`, `.xls` and `.ods`; cached/formatted cell text is displayed without recalculating formulas. |
| Delimited text | Papa Parse reads `.csv` and `.tsv` using strict UTF-8 decoding; invalid encoding reports an error. The first row remains data. |
| Preview window | At most **5,000 rows and 256 columns** from each worksheet's used range; the footer marks truncated previews. |
| File access | The Host exposes only `POST /dock-spreadsheet/read` for raw bytes. It checks same-origin/trusted-host requests, absolute path, allowed extension, regular file and a **20 MiB** limit. There is no write API. |
| Workspace boundary | Like other dock viewers, the Host may read an **absolute path outside the workspace** referenced by the session. Do not deploy this plugin on an untrusted or publicly reachable Host. |
| Cell rendering | Treat workbook content as untrusted: render via DOM text nodes / `textContent`, never `innerHTML`; `<b>` in a cell stays text. Detected links use only HTTP(S) and open with `noopener,noreferrer`. |
| Performance | Virtual scrolling reduces DOM work, but parsing still runs on the browser main thread; a complex workbook near the limits may briefly pause the UI. |

This is not a full spreadsheet engine: no editing, saving, collaboration, formula evaluation, macro execution, chart rendering, source-style/merged-cell fidelity or automatic encoding detection for non-UTF-8 CSV.

## Development and verification

```sh
pnpm install
pnpm run check   # embed Tabulator styles and check TypeScript
pnpm test        # build Host / Client and run 18 tests
pnpm run build   # produce lib/ for GitHub/npm distribution
```

Unit/integration tests cover all five formats, coordinates and preview limits, Host read guards, browser bundle registration, and a real React + Tabulator mount exercising search, sort, sheet tabs, column-filter controls, cell selection and link interactions. A real `dsh web` on a random port in an isolated container, driven by Chromium, passed **29/29 checks**, including 360px layout, column filtering, HTML-as-text and Ctrl+click. This does not claim that your current GUI has hot-reloaded, or that npm publication succeeded.

The client artifact bundles SheetJS, Papa Parse, Tabulator and their styles; only platform React remains external in the browser. GitHub consumers use committed `lib/` files, without a consumer build step or `prepare`/`postinstall` script.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A workbook still opens in the default text viewer | Confirm dock-base, dock-files and dock-spreadsheet are enabled as Web-profile bundles and their packages resolve. Restart dsh web yourself, then reopen the file. |
| Install fails with `EROFS` | The Web profile's `node_modules` is on a read-only filesystem. Make the directory writable and reinstall rather than editing only the manifest. |
| CSV/TSV encoding error | Convert the file to UTF-8. The viewer will not silently display a different encoding as garbled text. |
| File rejected or data seems incomplete | Files over 20 MiB are rejected; each sheet previews at most 5,000 rows/256 columns. Check the footer for a truncated-preview indicator. |
| Ctrl+click does not open a link | The cell must contain an `http(s)://` or `www.` prefix; click the link itself and check whether the browser blocked a new tab. |

## License and acknowledgements

[MIT](LICENSE). Thanks to [SheetJS CE](https://docs.sheetjs.com/), [Papa Parse](https://www.papaparse.com/) and [Tabulator](https://tabulator.info/).
