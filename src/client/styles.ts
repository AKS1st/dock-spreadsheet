/** Viewer-only chrome layered over Tabulator's bundled stylesheet. */
export const viewerCss = `
.ds-sheet {
  --ds-bg: var(--dsw-alias-bg-base, #fff);
  --ds-surface: var(--dsw-alias-bg-layer-2, #f8fafc);
  --ds-text: var(--dsw-alias-label-primary, #202631);
  --ds-muted: var(--dsw-alias-label-secondary, #667085);
  --ds-line: var(--dsw-alias-border-l2, #dce3e8);
  --ds-accent: var(--dsw-alias-state-business-primary, #1766d5);
  --ds-warn-bg: var(--dsw-alias-state-warn-bg, #fff7e6);
  --ds-warn-fg: var(--dsw-alias-state-warn-primary, #8a5b00);
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  container: ds-viewer / inline-size;
  overflow: hidden; background: var(--ds-bg); color: var(--ds-text);
  font: 12px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.ds-sheet * { box-sizing: border-box; }
.ds-sheet-head { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 12px; border-bottom: 1px solid var(--ds-line); flex: none; }
.ds-sheet-filemark { display: grid; place-items: center; flex: none; width: 25px; height: 25px; border-radius: 5px; background: #e6f3ed; color: #14734e; font-weight: 750; font-size: 14px; }
.ds-sheet-title { font-weight: 650; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.ds-sheet-readonly { flex: none; padding: 2px 7px; border: 1px solid var(--ds-line); border-radius: 10px; color: var(--ds-muted); background: var(--ds-surface); font-size: 11px; }
.ds-sheet-stale { flex: none; margin-left: auto; padding: 2px 8px; border: 1px solid var(--ds-warn-fg); border-radius: 10px; background: var(--ds-warn-bg); color: var(--ds-warn-fg); font: inherit; font-size: 11px; cursor: pointer; }
.ds-sheet-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 12px; min-height: 36px; border-bottom: 1px solid var(--ds-line); flex: none; }
.ds-sheet-tool { flex: none; display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 4px 9px; border: 1px solid var(--ds-line); border-radius: 5px; background: var(--ds-bg); color: var(--ds-text); font: inherit; cursor: pointer; }
.ds-sheet-tool:hover { background: var(--ds-surface); }
.ds-sheet-tool:disabled { opacity: .5; cursor: default; }
.ds-sheet-tool[aria-pressed='true'] { color: var(--ds-accent); border-color: var(--ds-accent); background: var(--ds-surface); }
.ds-sheet-tool:focus-visible, .ds-sheet-tab:focus-visible, .ds-sheet-search:focus-visible, .ds-sheet-stale:focus-visible { outline: 2px solid var(--ds-accent); outline-offset: 1px; }
.ds-sheet-search-wrap { position: relative; display: flex; align-items: center; min-width: 110px; max-width: 280px; flex: 1; }
.ds-sheet-search-icon { position: absolute; left: 9px; color: var(--ds-muted); font-size: 15px; pointer-events: none; line-height: 1; }
.ds-sheet-search { width: 100%; min-width: 0; height: 28px; padding: 4px 8px 4px 30px; border: 1px solid var(--ds-line); border-radius: 5px; outline: none; background: var(--ds-bg); color: var(--ds-text); font: inherit; }
.ds-sheet-search::placeholder { color: var(--ds-muted); }
.ds-sheet-search:disabled { opacity: .6; }
.ds-sheet-hint { margin-left: auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ds-muted); font-size: 11px; }
.ds-sheet-inspector { display: flex; align-items: stretch; flex: none; min-height: 30px; border-bottom: 1px solid var(--ds-line); }
.ds-sheet-address { display: grid; place-items: center; flex: none; width: 69px; padding: 4px; border-right: 1px solid var(--ds-line); color: var(--ds-accent); font-weight: 650; font-variant-numeric: tabular-nums; background: var(--ds-surface); }
.ds-sheet-value { display: block; min-width: 0; flex: 1; overflow-x: auto; overflow-y: hidden; white-space: nowrap; padding: 6px 12px; color: var(--ds-text); user-select: text; scrollbar-width: thin; }
.ds-sheet-value.is-empty { color: var(--ds-muted); }
.ds-sheet-badge { display: inline-flex; align-items: center; flex: none; margin: 3px 6px 3px 0; padding: 0 6px; border: 1px solid var(--ds-line); border-radius: 9px; color: var(--ds-muted); background: var(--ds-surface); font-size: 10px; }
.ds-sheet-warn { color: var(--ds-warn-fg); border-color: var(--ds-warn-fg); background: var(--ds-warn-bg); }
.ds-sheet-banner { display: flex; align-items: center; gap: 8px; flex: none; padding: 4px 12px; border-bottom: 1px solid var(--ds-line); background: var(--ds-warn-bg); color: var(--ds-warn-fg); font-size: 11px; }
.ds-sheet-actions { display: flex; gap: 6px; margin-top: 8px; }
.ds-sheet-grid { flex: 1; min-height: 0; overflow: hidden; }
.ds-sheet .tabulator { border: 0; height: 100%; background: var(--ds-bg); color: var(--ds-text); font-family: inherit; font-size: 12px; }
.ds-sheet .tabulator .tabulator-header { border: 0; border-bottom: 1px solid var(--ds-line); background: var(--ds-surface); color: var(--ds-muted); font-weight: 600; }
.ds-sheet .tabulator .tabulator-header .tabulator-col { border-right: 1px solid var(--ds-line); background: var(--ds-surface); text-align: center; }
.ds-sheet .tabulator .tabulator-header .tabulator-col .tabulator-col-content { padding: 7px 5px; }
.ds-sheet .tabulator .tabulator-header .tabulator-col .tabulator-col-title { text-align: center; }
.ds-sheet .tabulator .tabulator-header .tabulator-col.tabulator-sortable:hover { background: var(--ds-bg); }
.ds-sheet .tabulator-row, .ds-sheet .tabulator-row:nth-child(even) { background: var(--ds-bg); color: var(--ds-text); min-height: 29px; border-bottom: 1px solid var(--ds-line); }
.ds-sheet .tabulator-row:hover, .ds-sheet .tabulator-row:nth-child(even):hover { background: var(--ds-surface); }
.ds-sheet .tabulator-row .tabulator-cell { height: 29px; padding: 6px 8px; border-right: 1px solid var(--ds-line); vertical-align: middle; }
.ds-sheet .tabulator-row .tabulator-cell:first-child { position: sticky; left: 0; z-index: 2; text-align: right; font-variant-numeric: tabular-nums; color: var(--ds-muted); background: var(--ds-surface); }
.ds-sheet .tabulator .tabulator-header-filter { margin-top: 4px; }
.ds-sheet .tabulator .tabulator-header-filter input { width: 100%; min-width: 0; padding: 3px 5px; border: 1px solid var(--ds-line); border-radius: 4px; color: var(--ds-text); background: var(--ds-bg); font: inherit; }
.ds-sheet:not(.ds-filtering) .tabulator .tabulator-header-filter { display: none; }
.ds-cell { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.ds-cell.ds-right { display: block; text-align: right; }
.ds-cell.ds-error { color: var(--dsw-alias-state-error-primary, #b42318); }
.ds-cell.ds-covered { display: none; }
.ds-cell.ds-merged-anchor { font-weight: 600; }
.ds-cell.ds-nocache { color: var(--ds-warn-fg); font-style: italic; }
.ds-sheet .tabulator-range-overlay .tabulator-range { border-color: var(--ds-accent); }
.ds-sheet .ds-url { color: var(--ds-accent); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.ds-sheet .ds-url:hover { text-decoration-thickness: 2px; }
.ds-sheet-footer { display: flex; align-items: stretch; flex: none; min-height: 32px; border-top: 1px solid var(--ds-line); background: var(--ds-surface); }
.ds-sheet-tabs { display: flex; align-items: stretch; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: thin; padding-left: 8px; }
.ds-sheet-tab { position: relative; flex: none; max-width: 170px; min-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 6px 14px; border: 0; border-right: 1px solid var(--ds-line); background: transparent; color: var(--ds-muted); font: inherit; cursor: pointer; }
.ds-sheet-tab:hover { background: var(--ds-bg); color: var(--ds-text); }
.ds-sheet-tab.is-hidden-sheet { font-style: italic; }
.ds-sheet-tab[aria-selected='true'] { background: var(--ds-bg); color: var(--ds-accent); font-weight: 650; }
.ds-sheet-tab[aria-selected='true']::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--ds-accent); }
.ds-sheet-status { flex: none; display: flex; align-items: center; gap: 6px; max-width: 62%; padding: 0 10px; border-left: 1px solid var(--ds-line); color: var(--ds-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ds-sheet-message { padding: 16px; overflow: auto; }
body[data-ds-dark-theme] .ds-sheet-filemark { background: #1d2f29; color: #7fd7ae; }
body[data-ds-dark-theme] .ds-sheet .tabulator-row .tabulator-cell { border-right-color: #2b3440; }
@container ds-viewer (max-width: 440px) {
  .ds-sheet-hint { display: none; }
  .ds-sheet-status { padding: 0 6px; max-width: 55%; }
  .ds-sheet-tool { padding-left: 7px; padding-right: 7px; }
}
@media (max-width: 520px) {
  .ds-sheet-head, .ds-sheet-tools { padding-left: 8px; padding-right: 8px; }
  .ds-sheet-hint { display: none; }
  .ds-sheet-status { padding: 0 6px; }
  .ds-sheet-tool { padding-left: 7px; padding-right: 7px; }
}
`
