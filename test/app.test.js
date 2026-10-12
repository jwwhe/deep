import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp, DEFAULT_SETTINGS, validateSettings, isLoopback, canWrite } from '../src/server/app.js';
import { createBalanceTracker, STATUS } from '../src/core/balance.js';
import { createMockProvider } from '../src/server/providers/mock.js';
import { createStore } from '../src/server/store.js';
import { loadConfig } from '../src/server/config.js';
import { parseAmount, formatAmount } from '../src/core/money.js';
import { tempDir } from './helpers/tmp.js';

const m = parseAmount;
const LOOPBACK = { remoteAddress: '127.0.0.1', host: '127.0.0.1:3080' };
const REMOTE = { remoteAddress: '192.168.1.20', host: '192.168.1.20:3080' };
const FIXED_TIME = 1_700_000_000_000;

function harness({ script = null, fixedTime = FIXED_TIME, adminHosts = '', provider = 'mock' } = {}) {
  const dataDir = tempDir('app');
  const config = loadConfig({
    DSHW_DATA_DIR: dataDir,
    DSHW_PROVIDER: provider,
    DSHW_MOCK_SCRIPT: script ? script.join(',') : '',
    DSHW_ADMIN_HOSTS: adminHosts,
    DEEPSEEK_API_KEY: '',
    DSHW_LOG_LEVEL: 'silent',
  });
  const mock = createMockProvider({ script, now: () => fixedTime });
  const tracker = createBalanceTracker({
    fetcher: mock.fetchBalance,
    now: () => fixedTime,
    schedule: () => () => {},
    unschedule: () => {},
  });
  const store = createStore({ dataDir, logger: { warn: () => {} } });
  const app = createApp({
    config,
    tracker,
    provider: mock,
    store,
    now: () => fixedTime,
    logger: { warn: () => {}, error: () => {} },
    resolveStatic: () => null,
  });
  return { app, tracker, mock, config, dataDir, store };
}

const getJson = (res) => JSON.parse(res.body);

test('GET /healthz 与 /api/state 开箱可用', async () => {
  const { app } = harness({ script: ['100.00'] });
  const health = await app.handle({ method: 'GET', pathname: '/healthz', ...LOOPBACK });
  assert.equal(health.status, 200);
  assert.equal(getJson(health).ok, true);

  await app.handle({ method: 'POST', pathname: '/api/refresh', ...LOOPBACK });
  const state = getJson(await app.handle({ method: 'GET', pathname: '/api/state', ...LOOPBACK }));
  assert.equal(state.balance, '100.00');
  assert.equal(state.status, STATUS.ok);
  assert.equal(state.provider, 'mock');
  assert.equal(state.settings.scale, DEFAULT_SETTINGS.scale);
});

test('GET /api/balance 是 /api/state 的别名', async () => {
  const { app } = harness({ script: ['9.90'] });
  await app.handle({ method: 'POST', pathname: '/api/refresh', ...LOOPBACK });
  const a = await app.handle({ method: 'GET', pathname: '/api/balance', ...LOOPBACK });
  assert.equal(a.status, 200);
  assert.equal(getJson(a).balance, '9.90');
});

test('服务端还没取过数时状态是 idle，而不是假装 0 元', async () => {
  const { app } = harness({ script: ['9.90'] });
  const state = getJson(await app.handle({ method: 'GET', pathname: '/api/state', ...LOOPBACK }));
  assert.equal(state.status, STATUS.idle);
  assert.equal(state.balance, null);
  assert.equal(state.todaySpend, '0.00');
});

test('余额下降会进今日已用，上升不冲掉', async () => {
  const { app, mock } = harness({ script: null });
  mock.queueValue('100');
  await app.handle({ method: 'POST', pathname: '/api/refresh', ...LOOPBACK });
  mock.queueValue('96');
  let state = getJson(await app.handle({ method: 'POST', pathname: '/api/refresh', ...LOOPBACK }));
  assert.equal(state.todaySpend, '4.00');

  mock.queueValue('200');
  state = getJson(await app.handle({ method: 'POST', pathname: '/api/refresh', ...LOOPBACK }));
  assert.equal(state.balance, '200.00');
  assert.equal(state.todaySpend, '4.00', '充值不能把今日已用清零');
});

test('取数失败沿用最近余额并如实标 stale', async () => {
  const { app, mock } = harness({ script: ['50.00'] });
  await app.handle({ method: 'POST', pathname: '/api/refresh', ...LOOPBACK });
  mock.queueFailure('timeout');
  const res = await app.handle({ method: 'POST', pathname: '/api/refresh', ...LOOPBACK });
  assert.equal(res.status, 502, '刷新失败要给非 2xx');
  const state = getJson(res);
  assert.equal(state.status, STATUS.stale);
  assert.equal(state.balance, '50.00');
  assert.equal(state.error.code, 'timeout');
});

test('写设置：合法值落盘、未知字段进 ignored、非法值 400', async () => {
  const { app, dataDir } = harness();
  const ok = await app.handle({ method: 'POST', pathname: '/api/settings', body: { scale: 1.4, bogus: 1 }, ...LOOPBACK });
  assert.equal(ok.status, 200);
  const payload = getJson(ok);
  assert.equal(payload.settings.scale, 1.4);
  assert.deepEqual(payload.ignored, ['bogus']);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, '.dshw-settings.json'), 'utf8'));
  assert.equal(onDisk.scale, 1.4, '设置必须落盘，重启后还在');

  const bad = await app.handle({ method: 'POST', pathname: '/api/settings', body: { scale: 99 }, ...LOOPBACK });
  assert.equal(bad.status, 400);
  assert.match(getJson(bad).errors[0], /0\.5~3/);

  const badType = await app.handle({ method: 'POST', pathname: '/api/settings', body: { mirrorOnLeft: 'yes' }, ...LOOPBACK });
  assert.equal(badType.status, 400);
});

test('设置校验：NaN、布尔串、枚举越界都挡在门外', () => {
  assert.equal(validateSettings({ scale: NaN }).ok, false);
  assert.equal(validateSettings({ scale: '1.5' }).ok, true, '数字字符串按 Number 收敛，方便表单直传');
  assert.equal(validateSettings({ snapMode: 'diagonal' }).ok, false);
  assert.equal(validateSettings([1, 2]).ok, false);
  assert.equal(validateSettings(undefined).ok, true);
});

test('非回环来源不能写配置', async () => {
  const { app } = harness();
  const res = await app.handle({ method: 'POST', pathname: '/api/settings', body: { scale: 2 }, ...REMOTE });
  assert.equal(res.status, 403);
  assert.equal(getJson(res).code, 'not-loopback');
  // 但只读接口不受影响
  assert.equal((await app.handle({ method: 'GET', pathname: '/api/state', ...REMOTE })).status, 200);
});

test('DSHW_ADMIN_HOSTS 显式声明才放行远端写', async () => {
  const { app } = harness({ adminHosts: '192.168.1.20' });
  const res = await app.handle({ method: 'POST', pathname: '/api/settings', body: { scale: 2 }, ...REMOTE });
  assert.equal(res.status, 200);
});

test('isLoopback / canWrite 覆盖 IPv6 与映射地址', () => {
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('127.0.0.5'), true);
  assert.equal(isLoopback('10.0.0.1'), false);
  assert.equal(isLoopback(undefined), false);
  assert.equal(canWrite({ remoteAddress: '10.0.0.9', host: 'myhost.lan:3080', adminHosts: ['myhost.lan'] }), true);
  assert.equal(canWrite({ remoteAddress: '10.0.0.9', host: 'other.lan', adminHosts: ['myhost.lan:3080'] }), false);
});

test('mock 推进接口：只有 mock provider 能用，且要求回环', async () => {
  const { app } = harness({ script: ['10'] });
  const pushed = await app.handle({ method: 'POST', pathname: '/api/mock/next', body: { value: '7.25' }, ...LOOPBACK });
  assert.equal(pushed.status, 200);
  assert.equal(getJson(pushed).balance, '7.25');

  const denied = await app.handle({ method: 'POST', pathname: '/api/mock/next', body: { value: '1' }, ...REMOTE });
  assert.equal(denied.status, 403);

  const noArg = await app.handle({ method: 'POST', pathname: '/api/mock/next', body: {}, ...LOOPBACK });
  assert.equal(noArg.status, 400);

  // 坏输入要在边界上变成 400，不能让 parseAmount 的异常冒到 500。
  const badValue = await app.handle({ method: 'POST', pathname: '/api/mock/next', body: { value: 'abc' }, ...LOOPBACK });
  assert.equal(badValue.status, 400);
  assert.equal(getJson(badValue).code, 'bad-value');
  const badFail = await app.handle({ method: 'POST', pathname: '/api/mock/next', body: { fail: '../../etc' }, ...LOOPBACK });
  assert.equal(badFail.status, 400);
  assert.equal(getJson(badFail).code, 'bad-fail-code');

  const realProvider = harness({ provider: 'deepseek' });
  const conflict = await realProvider.app.handle({ method: 'POST', pathname: '/api/mock/next', body: { value: '1' }, ...LOOPBACK });
  assert.equal(conflict.status, 409);
});

test('路由兜底：未知路径 404、非 POST/GET 405、坏 JSON 体 400', async () => {
  const { app } = harness();
  assert.equal((await app.handle({ method: 'GET', pathname: '/nope', ...LOOPBACK })).status, 404);
  assert.equal((await app.handle({ method: 'PUT', pathname: '/api/settings', ...LOOPBACK })).status, 405);
  assert.equal((await app.handle({ method: 'POST', pathname: '/api/settings', bodyError: 'bad-json', ...LOOPBACK })).status, 400);
  assert.equal((await app.handle({ method: 'POST', pathname: '/api/whatever', ...LOOPBACK })).status, 404);
});

test('GET 静态资源：resolver 命中则回文件内容与类型，HEAD 只回长度', async () => {
  const dir = tempDir('fixture');
  const file = path.join(dir, 'whale.js');
  fs.writeFileSync(file, 'export const a = 1;\n', 'utf8');
  const dataDir = tempDir('app');
  const config = loadConfig({ DSHW_DATA_DIR: dataDir, DSHW_LOG_LEVEL: 'silent' });
  const tracker = createBalanceTracker({ fetcher: async () => ({ ok: true, balanceMicro: m('1'), currency: 'CNY' }), schedule: () => () => {}, unschedule: () => {} });
  const app = createApp({
    config,
    tracker,
    provider: null,
    store: createStore({ dataDir, logger: { warn: () => {} } }),
    resolveStatic: (pathname) => (pathname === '/widget/whale.js'
      ? { filePath: file, contentType: 'text/javascript; charset=utf-8', size: 20, mtimeMs: 0 }
      : null),
  });

  const get = await app.handle({ method: 'GET', pathname: '/widget/whale.js', ...LOOPBACK });
  assert.equal(get.status, 200);
  assert.equal(get.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(get.body.toString(), 'export const a = 1;\n');

  const head = await app.handle({ method: 'HEAD', pathname: '/widget/whale.js', ...LOOPBACK });
  assert.equal(head.status, 200);
  assert.equal(head.body, null, 'HEAD 不该带正文');
  assert.equal((await app.handle({ method: 'GET', pathname: '/widget/missing.js', ...LOOPBACK })).status, 404);
});

test('账本跨重启延续：设置与账本都从磁盘读回', async () => {
  const { app, mock, dataDir } = harness({ script: null });
  mock.queueValue('100');
  await app.handle({ method: 'POST', pathname: '/api/refresh', ...LOOPBACK });
  mock.queueValue('95');
  await app.handle({ method: 'POST', pathname: '/api/refresh', ...LOOPBACK });
  const before = getJson(await app.handle({ method: 'GET', pathname: '/api/state', ...LOOPBACK }));
  assert.equal(before.todaySpend, '5.00');

  // 用同一个目录再起一个 app，模拟重启
  const config2 = loadConfig({ DSHW_DATA_DIR: dataDir, DSHW_LOG_LEVEL: 'silent' });
  const tracker2 = createBalanceTracker({ fetcher: async () => ({ ok: true, balanceMicro: m('95'), currency: 'CNY' }), schedule: () => () => {}, unschedule: () => {} });
  const app2 = createApp({
    config: config2,
    tracker: tracker2,
    provider: null,
    store: createStore({ dataDir, logger: { warn: () => {} } }),
    now: () => FIXED_TIME, // 同一时刻重启，日期桶才对得上
    resolveStatic: () => null,
  });
  const after = getJson(await app2.handle({ method: 'GET', pathname: '/api/state', ...LOOPBACK }));
  assert.equal(after.todaySpend, '5.00', '重启后今日已用必须还在');
  assert.equal(formatAmount(m('5')), '5.00');
});
