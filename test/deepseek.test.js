import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekProvider, pickBalance, classifyStatus } from '../src/server/providers/deepseek.js';
import { STATUS } from '../src/core/balance.js';
import { parseAmount } from '../src/core/money.js';

const m = parseAmount;

function fakeFetch(handler) {
  return async (url, init) => handler(url, init);
}

const response = (status, body, { json = false } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (json ? JSON.stringify(body) : String(body)),
});

function provider(opts = {}) {
  return createDeepSeekProvider({
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com',
    timeoutMs: 1000,
    fetchImpl: opts.fetchImpl,
    ...opts,
  });
}

test('pickBalance 兼容两种官方响应结构', () => {
  const legacy = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00077700' }] };
  const picked = pickBalance(legacy);
  assert.equal(picked.balanceMicro, m('10.00077700'));
  assert.equal(picked.currency, 'CNY');
  assert.equal(picked.matchedPath, 'balance_infos[0].total_balance');

  const flat = { is_available: true, total_balance: '3.50' };
  assert.equal(pickBalance(flat).balanceMicro, m('3.50'));

  const units = { balance_units: [{ currency: 'USD', amount: 1.25 }] };
  assert.equal(pickBalance(units).balanceMicro, m('1.25'));
});

test('pickBalance 找不到字段或字段脏时给业务错误', () => {
  assert.equal(pickBalance({}).error.code, 'field-not-found');
  assert.equal(pickBalance({ total_balance: 'abc' }).error.code, 'bad-amount');
});

test('classifyStatus 把上游状态码翻成可处理错误', () => {
  assert.equal(classifyStatus(401, 'Authentication Fails (governor)').code, 'auth-failed');
  assert.equal(classifyStatus(402).code, 'insufficient');
  assert.equal(classifyStatus(429).code, 'rate-limited');
  assert.equal(classifyStatus(503).code, 'upstream-5xx');
  assert.equal(classifyStatus(418).code, 'http-error');
  assert.match(classifyStatus(418, 'I am a teapot').message, /I am a teapot/);
});

test('正常取数返回 BigInt 微元并带上匹配到的字段', async () => {
  const seen = {};
  const fetchBalance = provider({
    fetchImpl: fakeFetch((url, init) => {
      seen.url = url;
      seen.init = init;
      return response(200, { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.34' }] }, { json: true });
    }),
  });
  const out = await fetchBalance();
  assert.equal(out.ok, true);
  assert.equal(out.balanceMicro, m('12.34'));
  assert.equal(seen.url, 'https://api.deepseek.com/user/balance');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-test');
});

test('没有密钥时明确报 unconfigured，不发请求', async () => {
  let called = 0;
  const fetchBalance = createDeepSeekProvider({ apiKey: '', baseUrl: 'https://api.deepseek.com', fetchImpl: async () => { called += 1; return response(200, '{}'); } });
  const out = await fetchBalance();
  assert.equal(called, 0);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'no-api-key');
  assert.equal(out.status, STATUS.unconfigured);
});

test('上游回纯文本 401 不会因为 JSON.parse 崩掉', async () => {
  // 实测形态：无 key 时 DeepSeek 回的是 text/plain 的一句人话。
  const fetchBalance = provider({ fetchImpl: fakeFetch(() => response(401, 'Authentication Fails (governor)')) });
  const out = await fetchBalance();
  assert.equal(out.ok, false);
  assert.equal(out.code, 'auth-failed');
  assert.equal(out.httpStatus, 401);
});

test('200 但不是 JSON 时报 bad-json', async () => {
  const fetchBalance = provider({ fetchImpl: fakeFetch(() => response(200, '<html>登录中</html>')) });
  const out = await fetchBalance();
  assert.equal(out.ok, false);
  assert.equal(out.code, 'bad-json');
});

test('is_available=false 是账户状态而不是网络故障', async () => {
  const fetchBalance = provider({ fetchImpl: fakeFetch(() => response(200, { is_available: false }, { json: true })) });
  const out = await fetchBalance();
  assert.equal(out.ok, false);
  assert.equal(out.code, 'balance-unavailable');
});

test('上游超时按 timeout 归类并可重试', async () => {
  const fetchBalance = provider({
    timeoutMs: 50,
    fetchImpl: fakeFetch((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })),
  });
  const out = await fetchBalance();
  assert.equal(out.ok, false);
  assert.equal(out.code, 'timeout');
  assert.equal(out.retryable, true);
});

test('网络层抛错按 network 归类，不向外冒异常', async () => {
  const fetchBalance = provider({ fetchImpl: fakeFetch(() => { throw new Error('ECONNREFUSED'); }) });
  const out = await fetchBalance();
  assert.equal(out.ok, false);
  assert.equal(out.code, 'network');
  assert.match(out.message, /ECONNREFUSED/);
});

test('运行环境没有 fetch 时如实报配置问题', async () => {
  const out = await createDeepSeekProvider({ apiKey: 'k', baseUrl: 'https://x', fetchImpl: null })();
  assert.equal(out.code, 'no-fetch');
  assert.equal(out.status, STATUS.unconfigured);
});
