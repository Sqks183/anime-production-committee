import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'apps/web/dist')
const screenshots = resolve(root, 'build/browser-tests')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }
let browser
let server
let baseUrl

before(async () => {
  await readFile(resolve(output, 'wasm/game-core.wasm'))
  await mkdir(screenshots, { recursive: true })
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const file = resolve(output, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!file.startsWith(`${output}${sep}`)) {
        response.writeHead(403).end()
        return
      }
      const body = await readFile(file)
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }).end(body)
    } catch {
      response.writeHead(404).end('Not found')
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE, headless: true }
    : { channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true })
})

after(async () => {
  await browser?.close()
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections() })
})

async function ready(page) {
  await page.getByRole('status').filter({ hasText: 'C++ / WASM 已就绪' }).waitFor()
}

async function textEquals(locator, value) {
  await locator.filter({ hasText: value }).waitFor()
  assert.equal(await locator.textContent(), value)
}

async function putSave(page, record) {
  await page.evaluate(async (record) => {
    await new Promise((done, fail) => {
      const request = indexedDB.open('anime-production-committee', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('saves')
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('saves', 'readwrite')
        transaction.objectStore('saves').put(record, 'current')
        transaction.oncomplete = () => { database.close(); done() }
        transaction.onerror = () => { database.close(); fail(transaction.error) }
      }
      request.onerror = () => fail(request.error)
    })
  }, record)
}

test('实际浏览器点击 → WASM 二进制 → C++ 返回值，无控制台异常', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  try {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    const wasmResponse = page.waitForResponse((response) => response.url().endsWith('/wasm/game-core.wasm'))
    await page.goto(baseUrl)
    await ready(page)
    const response = await wasmResponse
    assert.match(response.headers()['content-type'], /application\/wasm/)
    assert.deepEqual([...((await response.body()).subarray(0, 4))], [0, 97, 115, 109])
    await page.screenshot({ path: resolve(screenshots, 'home-desktop.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '开始经营' }).click()
    await textEquals(page.getByTestId('budget'), '¥100,000')
    await textEquals(page.getByTestId('progress'), '20%')
    await page.getByRole('button', { name: '推进一次制作进度' }).click()
    await textEquals(page.getByTestId('budget'), '¥95,000')
    await textEquals(page.getByTestId('progress'), '25%')
    assert.deepEqual(JSON.parse(await page.getByTestId('core-result').textContent()), {
      budget: 95000, progress: 25, message: '制作进度已更新',
    })
    await page.screenshot({ path: resolve(screenshots, 'studio-desktop.png'), fullPage: true, animations: 'disabled' })
    assert.deepEqual(errors, [])
  } finally {
    await context.close()
  }
})

test('真实 IndexedDB 保存、刷新后读取与无存档提示', async () => {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(baseUrl)
    await ready(page)
    await page.getByRole('button', { name: '读取本地存档' }).click()
    await page.getByText('此浏览器还没有存档。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '开始经营' }).click()
    await page.getByRole('button', { name: '推进一次制作进度' }).click()
    await textEquals(page.getByTestId('progress'), '25%')
    await page.getByRole('button', { name: '保存进度' }).click()
    await page.getByText('已保存到此浏览器。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '推进一次制作进度' }).click()
    await textEquals(page.getByTestId('progress'), '30%')
    await page.reload()
    await ready(page)
    await page.getByRole('button', { name: '读取本地存档' }).click()
    await textEquals(page.getByTestId('budget'), '¥95,000')
    await textEquals(page.getByTestId('progress'), '25%')
  } finally {
    await context.close()
  }
})

for (const asset of ['mjs', 'wasm']) {
  test(`${asset} 加载失败禁止推进，恢复资源后按钮重试成功`, async () => {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      const pattern = `**/wasm/game-core.${asset}*`
      await page.route(pattern, (route) => route.abort('failed'))
      await page.goto(baseUrl)
      await page.getByRole('alert').filter({ hasText: '游戏核心加载失败' }).waitFor()
      await page.getByRole('button', { name: '开始经营' }).click()
      assert.equal(await page.getByRole('button', { name: '推进一次制作进度' }).isDisabled(), true)
      await page.unroute(pattern)
      await page.getByRole('button', { name: '重试加载' }).click()
      await ready(page)
      await page.getByRole('button', { name: '推进一次制作进度' }).click()
      await textEquals(page.getByTestId('progress'), '25%')
      await textEquals(page.getByTestId('budget'), '¥95,000')
    } finally {
      await context.close()
    }
  })
}

test('真实 C++ 预算错误不改变状态；完成后禁用推进；损坏存档不覆盖状态', async () => {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(baseUrl)
    await ready(page)
    await putSave(page, { version: 1, savedAt: new Date().toISOString(), state: { budget: 0, progress: 20, seed: 12345 } })
    await page.getByRole('button', { name: '读取本地存档' }).click()
    await page.getByRole('button', { name: '推进一次制作进度' }).click()
    await page.getByRole('alert').waitFor()
    await textEquals(page.getByTestId('budget'), '¥0')
    await textEquals(page.getByTestId('progress'), '20%')
    await putSave(page, { version: 1, savedAt: new Date().toISOString(), state: { budget: 5000, progress: 98, seed: 0 } })
    await page.getByRole('button', { name: '读取存档', exact: true }).click()
    await textEquals(page.getByTestId('progress'), '98%')
    await page.getByRole('button', { name: '推进一次制作进度' }).click()
    await textEquals(page.getByTestId('progress'), '100%')
    await textEquals(page.getByTestId('budget'), '¥0')
    assert.equal(await page.getByRole('button', { name: '示例制作已完成' }).isDisabled(), true)
    await putSave(page, { version: 99, state: {} })
    await page.getByRole('button', { name: '读取存档', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '存档损坏或版本不受支持' }).waitFor()
    await textEquals(page.getByTestId('progress'), '100%')
  } finally {
    await context.close()
  }
})

for (const width of [375, 768]) {
  test(`${width}px 页面无横向溢出，实际按钮仍可操作`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    try {
      const page = await context.newPage()
      await page.goto(baseUrl)
      await ready(page)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: resolve(screenshots, `home-${width}.png`), fullPage: true, animations: 'disabled' })
      await page.getByRole('button', { name: '开始经营' }).click()
      await page.getByRole('button', { name: '推进一次制作进度' }).click()
      await textEquals(page.getByTestId('progress'), '25%')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: resolve(screenshots, `studio-${width}.png`), fullPage: true, animations: 'disabled' })
    } finally {
      await context.close()
    }
  })
}
