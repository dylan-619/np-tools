// 只读核对实际 NP-Tools 模块；不连接设备、不修改工具工程。
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [toolRoot, inputPath, outputPath] = process.argv.slice(2)
const { createServer } = await import(pathToFileURL(path.join(toolRoot, 'node_modules/vite/dist/node/index.js')))
const { createPinia, setActivePinia, disposePinia } = await import(pathToFileURL(path.join(toolRoot, 'node_modules/pinia/dist/pinia.mjs')))
const server = await createServer({
  root: toolRoot, configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom'
})
try {
  const yaml = await server.ssrLoadModule('/src/utils/yamlHelper.ts')
  const manifest = await server.ssrLoadModule('/src/utils/kz3ProjectManifest.ts')
  const { useControllerStore } = await server.ssrLoadModule('/src/stores/controllerStore.ts')
  const inputs = JSON.parse(await fs.readFile(inputPath, 'utf8'))
  const results = []
  for (const input of inputs) {
    const pinia = createPinia()
    setActivePinia(pinia)
    try {
      const doc = yaml.deserializeProjectIoYaml(input.yaml)
      const store = useControllerStore()
      store.doc = doc
      let toolManifest, manifestError
      try { toolManifest = await manifest.buildKz3PointManifest(doc.project.northbound.fields) }
      catch (error) { manifestError = error.message }
      results.push({
        path: input.path, projectId: doc.project.id,
        manifestMatches: toolManifest?.hash === input.manifestHash,
        firmwareManifest: input.manifestHash, toolManifest: toolManifest?.hash,
        manifestError, exportedYaml: yaml.serializeProjectIoYaml(doc),
        issues: store.validationIssues
      })
    } catch (error) {
      results.push({ path: input.path, error: error.message })
    } finally { disposePinia(pinia) }
  }
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify({ inputs: inputs.length, completed: results.length,
    manifestMatched: results.filter(r => r.manifestMatches).length,
    importFailed: results.filter(r => r.error).length }))
} finally { await server.close() }
