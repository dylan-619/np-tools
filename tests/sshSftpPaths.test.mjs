import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
})
after(() => server.close())

const paths = await server.ssrLoadModule('/src/utils/sshSftpPaths.ts')

test('SSH 下载建议名去除远端目录和平台保留字符', () => {
  assert.equal(paths.safeSshDownloadName('/srv/releases/report.csv'), 'report.csv')
  assert.equal(paths.safeSshDownloadName('folder\\device:config?.json'), 'device_config_.json')
  assert.equal(paths.safeSshDownloadName('..'), 'download.bin')
  assert.equal(paths.safeSshDownloadName(''), 'download.bin')
})
