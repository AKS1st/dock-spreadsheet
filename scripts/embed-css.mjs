import { readFile, writeFile } from 'node:fs/promises'
const css = await readFile(new URL('../node_modules/tabulator-tables/dist/css/tabulator.min.css', import.meta.url), 'utf8')
await writeFile(new URL('../src/client/tabulator-css.generated.ts', import.meta.url), `// Generated from installed tabulator-tables CSS. Do not edit.\nexport default ${JSON.stringify(css)}\n`)
