import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizePath, getPath, extractValue } from '../src/core/jsonpath.js';

test('tokenizePath 解析键与下标', () => {
  assert.deepEqual(tokenizePath('a.b[0].c'), ['a', 'b', 0, 'c']);
  assert.deepEqual(tokenizePath('total_balance'), ['total_balance']);
  assert.deepEqual(tokenizePath('list[12]'), ['list', 12]);
});

test('tokenizePath 拒绝空路径', () => {
  for (const bad of ['', '   ', null, undefined, 42]) {
    assert.throws(() => tokenizePath(bad), TypeError);
  }
});

test('getPath 逐层取值，越界与类型不符都返回 undefined', () => {
  const source = { a: { b: [{ c: 1 }, { c: 2 }] }, n: 5 };
  assert.equal(getPath(source, 'a.b[1].c'), 2);
  assert.equal(getPath(source, 'n'), 5);
  assert.equal(getPath(source, 'a.b[9].c'), undefined);
  assert.equal(getPath(source, 'n.c'), undefined);
  assert.equal(getPath(source, 'missing.deep.path'), undefined);
  assert.equal(getPath({}, 'a'), undefined);
});

test('extractValue 从 DeepSeek 风格响应取余额', () => {
  const payload = {
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '10.00077700', granted_balance: '2.00', topped_up_balance: '8.00' }],
  };
  const found = extractValue(payload, { path: 'balance_infos[0].total_balance' });
  assert.equal(found.ok, true);
  assert.equal(found.value, '10.00077700');
  assert.equal(found.currency, undefined);

  const withCurrency = extractValue(payload, {
    path: 'balance_infos[0].total_balance',
    currencyPath: 'balance_infos[0].currency',
  });
  assert.equal(withCurrency.currency, 'CNY');
});

test('extractValue 把取不到当业务错误', () => {
  assert.deepEqual(extractValue({}, { path: 'a.b' }), { ok: false, reason: 'not-found', path: 'a.b' });
  assert.deepEqual(extractValue({ a: '' }, { path: 'a' }), { ok: false, reason: 'not-found', path: 'a' });
  assert.deepEqual(extractValue({ a: { b: 1 } }, { path: 'a' }), { ok: false, reason: 'unsupported-type', type: 'object' });
  assert.deepEqual(extractValue({ a: 1 }, {}), { ok: false, reason: 'missing-path' });
});

test('extractValue 允许数字字段并保留原值', () => {
  const found = extractValue({ data: { credits: 12 } }, { path: 'data.credits', currency: 'USD' });
  assert.equal(found.ok, true);
  assert.equal(found.value, 12);
  assert.equal(found.currency, 'USD');
});
