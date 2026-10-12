import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server/app.js';
import { createBalanceTracker } from '../src/core/balance.js';
import { createMockProvider } from '../src/server/providers/mock.js';
import { createStore } from '../src/server/store.js';
import { loadConfig } from '../src/server/config.js';
import { createDshBridge, dshRouteFor, toDshBalance } from '../src/server/dsh-routes.js';
import { createDshSource } from '../src/widget/dsh-source.js';
import { tempDir } from './helpers/tmp.js';

const LOOPBACK = { remoteAddress: '127.0.0.1', host: '127.0.0.1:3080' };
const REMOTE = { remoteAddress: '192.168.1.20', host: '192.168.1.20:3080' };
const FIXED_TIME = 1_700_000_000_000;

function harness() {
  const dataDir = tempDir('dsh');
  const config = loadConfig({
    DSHW_DATA_DIR: dataDir,
    DSHW_PROVIDER: 'mock',
    DEEPSEEK_API_KEY: '',
    DSHW_LOG_LEVEL: 'silent',
  });
  const mock = createMockProvider({ script: ['88.42'], now: () => FIXED_TIME });
  const tracker = createBalanceTracker({
    fetcher: mock.fetchBalance,
    now: () => FIXED_TIME,
    schedule: () => () => {},
    unschedule: () => {},
  });
  const app = createApp({
    config,
    tracker,
    provider: mock,
    store: createStore({ dataDir, logger: { warn: () => {} } }),
    now: () => FIXED_TIME,
    logger: { warn: () => {}, error: () => {} },
  });
  return { app, bridge: createDshBridge({ app }), dataDir, mock, tracker };
}

const json = (res) => JSON.parse(res.body.toString('utf8'));

test('dshRouteFor 只认 /dsh-whale 命名空间下的接口', () => {
  assert.equal(dshRouteFor('/dsh-whale/balance.json').to, '/api/state');
  assert.equal(dshRouteFor('/dsh-whale/settings.json').method, 'POST');
  assert.equal(dshRouteFor('/api/state'), null);
  assert.equal(dshRouteFor('/dsh-whale/unknown.json'), null);
  assert.equal(dshRouteFor('/dsh-whale'), null);
});

test('toDshBalance 换成宿主的字段名，金额保持字符串', () => {
  const shaped = toDshBalance({ status: 'ok', balance: '12.30', balanceMicro: '1230000000', todaySpend: '0.70', currency: 'CNY', stale: false, updatedAt: 1 });
  assert.equal(shaped.totalBalance, '12.30');
  assert.equal(shaped.todayUsed, '0.70');
  assert.equal(shaped.ok, true);
  assert.equal(typeof shaped.totalBalance, 'string');
  // 没有赠送概念的来源（独立跑、API key）必须回 null，挂件才不会多画一行 0 元。
  assert.equal(shaped.bonusBalance, null);
  assert.equal(shaped.bonusIncluded, null);
  const withBonus = toDshBalance({ status: 'ok', balance: '12.30', bonus: '0.44', bonusIncluded: false, todaySpend: '0.70', currency: 'CNY' });
  assert.equal(withBonus.totalBalance, '12.30', '赠送不并进 totalBalance');
  assert.equal(withBonus.bonusBalance, '0.44');
  assert.equal(toDshBalance({ status: 'error', balance: null, error: { code: 'x' } }).ok, false);
});

test('宿主前缀下的整条 ESM 依赖链都能解析（无打包步骤的关键前提）', async () => {
  const { bridge } = harness();
  // 入口挂在 /dsh-whale/widget.js，它的 './widget/whale.js' 与 whale.js 的 '../core/money.js'
  // 必须各自解析到适配器登记的前缀上，否则浏览器会去要一个 404。
  const entryUrl = 'http://host/dsh-whale/widget.js';
  const whaleUrl = new URL('./widget/whale.js', entryUrl).pathname;
  const moneyUrl = new URL('../core/money.js', `http://host${whaleUrl}`).pathname;
  assert.equal(whaleUrl, '/dsh-whale/widget/whale.js');
  assert.equal(moneyUrl, '/dsh-whale/core/money.js');
  for (const pathname of [whaleUrl, moneyUrl]) {
    const response = await bridge({ method: 'GET', pathname, ...LOOPBACK });
    assert.equal(response.status, 200, `${pathname} 取不到`);
  }
});

test('GET /dsh-whale/balance.json 回宿主契约', async () => {
  const { bridge } = harness();
  const idle = await bridge({ method: 'GET', pathname: '/dsh-whale/balance.json', ...LOOPBACK });
  assert.equal(json(idle).status, 'idle', '还没取过数时如实报 idle，不编一个 0 出来');

  const refreshed = await bridge({ method: 'POST', pathname: '/dsh-whale/refresh.json', ...LOOPBACK });
  assert.equal(refreshed.status, 200);
  const response = await bridge({ method: 'GET', pathname: '/dsh-whale/balance.json', ...LOOPBACK });
  assert.equal(response.status, 200);
  const payload = json(response);
  assert.equal(payload.totalBalance, '88.42');
  assert.equal(payload.status, 'ok');
  assert.equal(payload.error, null);
});

test('宿主路由仍然吃回环规则：远端写设置 403', async () => {
  const { bridge } = harness();
  const denied = await bridge({ method: 'POST', pathname: '/dsh-whale/settings.json', body: { scale: 2 }, ...REMOTE });
  assert.equal(denied.status, 403);
  const allowed = await bridge({ method: 'POST', pathname: '/dsh-whale/settings.json', body: { scale: 2 }, ...LOOPBACK });
  assert.equal(allowed.status, 200);
  assert.equal(json(allowed).settings.scale, 2);
});

test('挂件模块经 /dsh-whale/widget/ 前缀可取到，且相对 import 能解析', async () => {
  const { bridge } = harness();
  const whale = await bridge({ method: 'GET', pathname: '/dsh-whale/widget/dsh-source.js', ...LOOPBACK });
  assert.equal(whale.status, 200);
  assert.match(whale.headers['content-type'], /javascript/);
  // whale.js 里写的是 './core/money.js'，相对它解析出来必须落在 src/core 上
  const core = await bridge({ method: 'GET', pathname: '/dsh-whale/core/money.js', ...LOOPBACK });
  assert.equal(core.status, 200);
  assert.match(core.body.toString('utf8'), /export const SCALE/);
  const escaped = await bridge({ method: 'GET', pathname: '/dsh-whale/widget/../../package.json', ...LOOPBACK });
  assert.equal(escaped.status, 404);
});

test('GET /dsh-whale/widget.js 回前端入口，且能自己挂载', async () => {
  const { bridge } = harness();
  const response = await bridge({ method: 'GET', pathname: '/dsh-whale/widget.js', ...LOOPBACK });
  assert.equal(response.status, 200);
  assert.match(response.body.toString('utf8'), /mountWhale/);
});

test('非 GET/POST 方法与未知路径分别 405/404', async () => {
  const { bridge } = harness();
  assert.equal((await bridge({ method: 'DELETE', pathname: '/dsh-whale/balance.json', ...LOOPBACK })).status, 405);
  assert.equal((await bridge({ method: 'GET', pathname: '/dsh-whale/nope.json', ...LOOPBACK })).status, 404);
  assert.equal((await bridge({ method: 'GET', pathname: '/other/thing', ...LOOPBACK })).status, 404);
  assert.equal((await bridge({ method: 'GET', pathname: '/dsh-whale/balance.json', ...LOOPBACK, body: undefined })).status, 200);
  assert.equal((await bridge({ method: 'POST', pathname: '/dsh-whale/balance.json', ...LOOPBACK })).status, 405);
});

// —— 客户端适配 ——

function fakeFetch(routes) {
  return async (url, options = {}) => {
    const key = `${options.method ?? 'GET'} ${url}`;
    const hit = routes[key];
    if (!hit) throw new Error(`未预置的请求：${key}`);
    return {
      ok: hit.status === undefined || hit.status === 200,
      status: hit.status ?? 200,
      json: async () => {
        if (hit.throwOnJson) throw new TypeError('not json');
        return hit.body;
      },
    };
  };
}

test('createDshSource 把 totalBalance 读成 BigInt 定点值', async () => {
  const source = createDshSource({
    fetchImpl: fakeFetch({ 'GET /dsh-whale/balance.json': { body: { ok: true, totalBalance: '12.34', currency: 'CNY' } } }),
  });
  const result = await source.readBalance();
  assert.equal(result.ok, true);
  assert.equal(result.balanceMicro, 1_234_000_000n);
  assert.equal(result.currency, 'CNY');
});

test('createDshSource 把宿主的 stale/unconfigured/缺字段分开处理', async () => {
  const stale = await createDshSource({
    fetchImpl: fakeFetch({ 'GET /dsh-whale/balance.json': { body: { ok: false, stale: true, totalBalance: '1', error: { code: 'timeout' } } } }),
  }).readBalance();
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'timeout');
  assert.equal(stale.retryable, true);

  const unconfigured = await createDshSource({
    fetchImpl: fakeFetch({ 'GET /dsh-whale/balance.json': { body: { ok: false, status: 'unconfigured', error: { code: 'no-api-key', message: '没配 key' } } } }),
  }).readBalance();
  assert.equal(unconfigured.status, 'unconfigured');

  const missing = await createDshSource({
    fetchImpl: fakeFetch({ 'GET /dsh-whale/balance.json': { body: { ok: true } } }),
  }).readBalance();
  assert.equal(missing.code, 'no-balance-field');

  const notJson = await createDshSource({
    fetchImpl: fakeFetch({ 'GET /dsh-whale/balance.json': { throwOnJson: true } }),
  }).readBalance();
  assert.equal(notJson.code, 'bad-json');
});

test('createDshSource 的写接口与刷新沿用同一套响应判断', async () => {
  const source = createDshSource({
    fetchImpl: fakeFetch({
      'POST /dsh-whale/settings.json': { body: { ok: true, settings: { scale: 1.2 } } },
      'POST /dsh-whale/refresh.json': { body: { ok: true, totalBalance: '3.00' } },
    }),
  });
  assert.deepEqual(await source.postSettings({ scale: 1.2 }), { ok: true, settings: { scale: 1.2 } });
  assert.deepEqual(await source.refreshNow(), { ok: true, code: null });

  const denied = await createDshSource({
    fetchImpl: fakeFetch({ 'POST /dsh-whale/settings.json': { status: 403, body: { ok: false, code: 'not-loopback' } } }),
  }).postSettings({ scale: 1 });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'not-loopback');
});

test('createDshSource 超时后报 timeout 而不是挂住', async () => {
  const source = createDshSource({
    timeoutMs: 30,
    fetchImpl: (_url, options = {}) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  const result = await source.readBalance();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'timeout');
});
