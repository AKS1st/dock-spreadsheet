import type {} from './contract.ts'
import type { WorkbenchContext, WorkbenchService } from './contract.ts'
import { SpreadsheetView } from './SpreadsheetView.tsx'

export const inject = ['workbench', 'files']
interface FilesService {
  registerFileViewer(def: { id: string; exts: string[]; icon?: { color?: string; path?: string; viewBox?: string } }): () => void
}
export function apply(ctx: WorkbenchContext): void {
  const workbench = ctx.get<WorkbenchService>('workbench')
  const files = ctx.get<FilesService>('files')
  if (!workbench || !files) return
  ctx.effect(() => workbench.registerPlugin({
    id: 'dock-spreadsheet', title: 'Spreadsheet',
    description: 'Read-only spreadsheet viewer for dock-files', hasEntry: false,
  }), 'dock-spreadsheet: metadata')
  ctx.effect(() => files.registerFileViewer({
    id: 'spreadsheet', exts: ['xlsx', 'xls', 'ods', 'csv', 'tsv'],
    icon: { color: '#398663' },
  }), 'dock-spreadsheet: file viewer')
  ctx.effect(() => workbench.registerEditorView({
    id: 'spreadsheet', title: 'Spreadsheet', order: 130, component: SpreadsheetView,
  }), 'dock-spreadsheet: view')
}
