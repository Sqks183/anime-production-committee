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
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' }
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
      if (!file.startsWith(`${output}${sep}`)) { response.writeHead(403).end(); return }
      const body = await readFile(file)
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }).end(body)
    } catch { response.writeHead(404).end('Not found') }
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
async function ready(page) { await page.getByRole('status').filter({ hasText: 'C++ / WASM 已就绪' }).waitFor() }
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
async function savedState(page) {
  await page.getByRole('button', { name: '保存进度', exact: true }).click()
  await page.getByText('已保存到此浏览器。', { exact: true }).waitFor()
  return page.evaluate(() => new Promise((done, fail) => {
    const request = indexedDB.open('anime-production-committee', 1)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('saves', 'readonly')
      const entry = transaction.objectStore('saves').get('current')
      transaction.oncomplete = () => { database.close(); done(entry.result) }
      transaction.onerror = () => { database.close(); fail(transaction.error) }
    }
    request.onerror = () => fail(request.error)
  }))
}
async function newProject(page, seed = 12345) {
  await page.goto(`${baseUrl}/?seed=${seed}`)
  await ready(page)
  await page.getByRole('button', { name: '开始经营', exact: true }).click()
  await page.getByRole('button', { name: '接手：放学后的第七帧', exact: true }).click()
  await page.getByRole('button', { name: '推进今天', exact: true }).waitFor()
}
async function advanceUi(page) {
  const previous = await page.getByTestId('day').textContent()
  await page.getByRole('button', { name: '推进今天', exact: true }).click()
  await page.waitForFunction((previous) => document.querySelector('[data-testid="day"]')?.textContent !== previous
    || [...document.querySelectorAll('button')].some((button) => button.textContent.includes('结算项目')), previous)
}
async function finishUi(page) {
  let events = 0
  for (let step = 0; step < 100; step++) {
    const settlement = page.getByRole('button', { name: '结算项目', exact: true })
    if (await settlement.isVisible()) {
      await settlement.click()
      await page.getByTestId('project-result').waitFor()
      return events
    }
    const event = page.getByRole('region', { name: '制作事件' })
    if (await event.isVisible()) {
      await event.getByRole('button').last().click()
      await event.waitFor({ state: 'hidden' })
      events++
    } else await advanceUi(page)
  }
  assert.fail('100 步内未到达项目结算')
}
async function realCoreFixture(page, changes = {}) {
  return page.evaluate(async (changes) => {
    const { default: create } = await import('/wasm/game-core.mjs')
    const core = await create()
    const initial = JSON.parse(core.initialize_game(JSON.stringify({ seed: 12345 }))).state
    const state = JSON.parse(core.start_project(JSON.stringify({ state: initial, project_id: 'proj_ova_01' }))).state
    return { ...state, ...changes }
  }, changes)
}

test('浏览器真实 WASM 新游戏→决策→按期交付→结算，且同种子完整重放一致', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  try {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    const wasmResponse = page.waitForResponse((response) => response.url().endsWith('/wasm/game-core.wasm'))
    await page.goto(`${baseUrl}/?seed=12345`)
    await ready(page)
    const response = await wasmResponse
    assert.match(response.headers()['content-type'], /application\/wasm/)
    assert.deepEqual([...((await response.body()).subarray(0, 4))], [0, 97, 115, 109])
    await page.screenshot({ path: resolve(screenshots, 'home-desktop.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '开始经营', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: /接手：未寄出的夏天/ }).isDisabled(), true)
    await page.getByRole('button', { name: '接手：放学后的第七帧', exact: true }).click()
    await textEquals(page.getByTestId('funds'), '¥10,000,000')
    await page.getByRole('combobox', { name: '制作方针', exact: true }).selectOption('polish')
    await page.getByRole('combobox', { name: '制作方针', exact: true }).selectOption('normal')
    await advanceUi(page)
    await textEquals(page.getByTestId('funds'), '¥9,700,000')
    await textEquals(page.getByTestId('progress-pre'), '6%')
    await page.screenshot({ path: resolve(screenshots, 'studio-desktop.png'), fullPage: true, animations: 'disabled' })
    assert.equal(await finishUi(page), 1)
    const receipt = await page.getByTestId('project-result').textContent()
    assert.match(receipt, /79/)
    assert.match(receipt, /6,320,000/)
    assert.match(receipt, /1,220,000/)
    await textEquals(page.getByTestId('funds'), '¥11,220,000')
    await page.screenshot({ path: resolve(screenshots, 'settlement-desktop.png'), fullPage: true, animations: 'disabled' })
    const first = await savedState(page)
    assert.equal(first.version, 2)
    assert.equal(first.state.day, 18)
    assert.equal(first.state.reputation, 10)
    assert.equal(first.state.phase, 'idle')
    assert.equal(first.state.seed, 1702883732)
    await newProject(page)
    await page.getByRole('combobox', { name: '制作方针', exact: true }).selectOption('polish')
    await page.getByRole('combobox', { name: '制作方针', exact: true }).selectOption('normal')
    await finishUi(page)
    assert.equal(await page.getByTestId('project-result').textContent(), receipt)
    assert.deepEqual((await savedState(page)).state, first.state)
    await page.getByRole('button', { name: '接手：星轨列车', exact: true }).click()
    assert.equal((await savedState(page)).state.project.start_day, 18)
    assert.deepEqual(errors, [])
  } finally { await context.close() }
})

test('IndexedDB 保存、刷新恢复、无存档提示与继续经营', async () => {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(baseUrl); await ready(page)
    await page.getByRole('button', { name: '读取本地存档' }).click()
    await page.getByText('此浏览器还没有存档。', { exact: true }).waitFor()
    await newProject(page)
    await advanceUi(page)
    const saved = await savedState(page)
    await advanceUi(page)
    await page.getByRole('button', { name: '返回首页', exact: true }).click()
    await page.getByRole('button', { name: '继续经营', exact: true }).click()
    await textEquals(page.getByTestId('funds'), '¥9,400,000')
    await page.reload(); await ready(page)
    await page.getByRole('button', { name: '读取本地存档' }).click()
    await textEquals(page.getByTestId('funds'), '¥9,700,000')
    assert.deepEqual((await savedState(page)).state, saved.state)
  } finally { await context.close() }
})

for (const asset of ['mjs', 'wasm']) {
  test(`${asset} 加载失败禁止新建，恢复资源后重试并真实推进`, async () => {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      const pattern = `**/wasm/game-core.${asset}*`
      await page.route(pattern, (route) => route.abort('failed'))
      await page.goto(`${baseUrl}/?seed=12345`)
      await page.getByRole('alert').filter({ hasText: '游戏核心加载失败' }).waitFor()
      assert.equal(await page.getByRole('button', { name: '开始经营', exact: true }).isDisabled(), true)
      await page.unroute(pattern)
      await page.getByRole('button', { name: '重试加载' }).click()
      await ready(page)
      await page.getByRole('button', { name: '开始经营', exact: true }).click()
      await page.getByRole('button', { name: '接手：放学后的第七帧', exact: true }).click()
      await advanceUi(page)
      await textEquals(page.getByTestId('funds'), '¥9,700,000')
    } finally { await context.close() }
  })
}

test('事件阻塞、资金不足保持状态、破产结算与损坏/旧版存档拒绝', async () => {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await newProject(page, 13)
    await advanceUi(page)
    const event = page.getByRole('region', { name: '制作事件' })
    await event.waitFor()
    const advance = page.getByRole('button', { name: '推进今天', exact: true })
    assert.equal(await advance.count() === 0 || await advance.isDisabled(), true)
    const saved = await savedState(page)
    const poor = { ...saved.state, funds: 0 }
    await putSave(page, { version: 2, state: poor, savedAt: new Date().toISOString() })
    await page.getByRole('button', { name: '读取存档', exact: true }).click()
    await textEquals(page.getByTestId('funds'), '¥0')
    await event.getByRole('button').first().click()
    await page.getByRole('alert').filter({ hasText: '资金不足' }).waitFor()
    assert.deepEqual((await savedState(page)).state, poor)
    await event.getByRole('button').last().click()
    await event.waitFor({ state: 'hidden' })
    await advanceUi(page)
    await page.getByRole('button', { name: '结算项目', exact: true }).click()
    await page.getByTestId('project-result').waitFor()
    assert.match(await page.getByTestId('project-result').textContent(), /破产/)
    const settled = await savedState(page)
    assert.equal(settled.state.day, 2)
    assert.equal(settled.state.seed, 1035543048)
    for (const record of [{ version: 99, state: {} }, { version: 1, state: { budget: 100000, progress: 20, seed: 1 } }]) {
      await putSave(page, record)
      await page.getByRole('button', { name: '读取存档', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.deepEqual((await savedState(page)).state, settled.state)
    }
  } finally { await context.close() }
})

test('读取临近截止的合法边界存档并强制交付结算', async () => {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(baseUrl); await ready(page)
    const state = await realCoreFixture(page)
    state.project.deadline_day = 1
    await putSave(page, { version: 2, state, savedAt: new Date().toISOString() })
    await page.getByRole('button', { name: '读取本地存档' }).click()
    await advanceUi(page)
    await page.getByRole('button', { name: '结算项目', exact: true }).click()
    await page.getByTestId('project-result').waitFor()
    assert.equal((await savedState(page)).state.phase, 'idle')
    assert.match(await page.getByTestId('project-result').textContent(), /截止|超期|违约/)
  } finally { await context.close() }
})

for (const width of [375, 768]) {
  test(`${width}px 首页、报价、制作、事件、结算无横向溢出，控件可操作`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    try {
      const page = await context.newPage()
      const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.goto(`${baseUrl}/?seed=13`); await ready(page)
      await noOverflow()
      await page.screenshot({ path: resolve(screenshots, `home-${width}.png`), fullPage: true, animations: 'disabled' })
      await page.getByRole('button', { name: '开始经营', exact: true }).click()
      await page.getByRole('button', { name: '接手：放学后的第七帧', exact: true }).waitFor()
      await noOverflow()
      await page.getByRole('button', { name: '接手：放学后的第七帧', exact: true }).click()
      await page.getByRole('combobox', { name: '林导演排班', exact: true }).selectOption('rest')
      await page.getByRole('combobox', { name: '林导演排班', exact: true }).selectOption('pre')
      await advanceUi(page)
      await page.getByRole('region', { name: '制作事件' }).waitFor()
      await noOverflow()
      await page.screenshot({ path: resolve(screenshots, `studio-${width}.png`), fullPage: true, animations: 'disabled' })
      await finishUi(page)
      await noOverflow()
      await page.screenshot({ path: resolve(screenshots, `settlement-${width}.png`), fullPage: true, animations: 'disabled' })
    } finally { await context.close() }
  })
}
