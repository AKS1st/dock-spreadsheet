const id = 'dock-spreadsheet'
const external = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-runtime/client']
export default [{
  entry: ['src/index.ts'], outDir: 'lib', format: ['esm'], platform: 'node',
  target: 'es2022', fixedExtension: false, dts: false, clean: false,
}, {
  entry: { client: 'src/client/index.ts' }, outDir: 'lib', format: 'cjs',
  platform: 'browser', target: 'es2022', dts: false, sourcemap: true,
  clean: false, deps: { onlyBundle: ['xlsx', 'tabulator-tables', 'papaparse'], alwaysBundle: ['xlsx', 'tabulator-tables', 'papaparse'], neverBundle: external },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}]
