import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, tryParseAmount, formatAmount, toMicroUnits, rollingFrames } from '../src/core/money.js';

test('parseAmount 精确定位到 1e-8', () => {
  assert.equal(parseAmount('10.00077700'), 1000077700n);
  assert.equal(parseAmount('0.1'), 10000000n);
  assert.equal(parseAmount('0'), 0n);
  assert.equal(parseAmount('-2.5'), -250000000n);
  assert.equal(parseAmount(1234), 123400000000n);
  assert.equal(parseAmount(10.000777), 1000077700n);
});

test('parseAmount 处理科学计数法与浮点尾巴', () => {
  assert.equal(parseAmount('1e-7'), 10n);
  assert.equal(parseAmount('1.5e2'), 15000000000n);
  // 0.1+0.2 的 0.30000000000000004 必须收敛成干净的 0.3
  assert.equal(parseAmount(0.1 + 0.2), 30000000n);
});

test('parseAmount 第 9 位小数 half-up', () => {
  assert.equal(parseAmount('0.000000004'), 0n);
  assert.equal(parseAmount('0.000000005'), 1n);
  assert.equal(parseAmount('-0.000000005'), -1n);
});

test('parseAmount 拒绝脏输入而不是静默变 NaN', () => {
  for (const bad of ['abc', '', '   ', '--1', null, undefined, NaN, Infinity, {}, [], true]) {
    assert.throws(() => parseAmount(bad), TypeError, `应当拒绝 ${JSON.stringify(bad)}`);
  }
  assert.throws(() => parseAmount(1e21), RangeError);
});

test('tryParseAmount 取不到时给 null', () => {
  assert.equal(tryParseAmount('1.00'), 100000000n);
  assert.equal(tryParseAmount('n/a'), null);
});

test('formatAmount 显示两位并 half-up', () => {
  assert.equal(formatAmount(parseAmount('12.345')), '12.35');
  assert.equal(formatAmount(parseAmount('12.344')), '12.34');
  assert.equal(formatAmount(parseAmount('0.5')), '0.50');
  assert.equal(formatAmount(0n), '0.00');
  assert.equal(formatAmount(parseAmount('-3.14')), '-3.14');
  assert.equal(formatAmount(parseAmount('100'), { decimals: 0 }), '100');
  assert.equal(formatAmount(parseAmount('0.00000001'), { decimals: 8 }), '0.00000001');
  assert.equal(formatAmount(parseAmount('12.34'), { decimals: 2, sign: 'always' }), '+12.34');
});

test('formatAmount 只吃 BigInt', () => {
  assert.throws(() => formatAmount(12.34), TypeError);
  assert.throws(() => formatAmount(1n, { decimals: 9 }), RangeError);
});

test('toMicroUnits 按单位乘数换算', () => {
  assert.equal(toMicroUnits('1234', 0.01), 1234000000n); // 分 → 元
  assert.equal(toMicroUnits(1, '0.000001'), 100n);
  assert.equal(toMicroUnits('7.5'), 750000000n);
  assert.equal(toMicroUnits('7.5', 1), 750000000n);
  assert.equal(toMicroUnits('-4', 2), -800000000n);
});

test('rollingFrames 单调、末帧严格等于目标', () => {
  const up = rollingFrames(0n, 1000000000n, 20);
  assert.equal(up.length, 20);
  assert.equal(up[up.length - 1], 1000000000n);
  for (let i = 1; i < up.length; i += 1) assert.ok(up[i] >= up[i - 1], '上升序列不能回退');

  const down = rollingFrames(1000000000n, 0n, 20);
  assert.equal(down[down.length - 1], 0n);
  for (let i = 1; i < down.length; i += 1) assert.ok(down[i] <= down[i - 1], '下降序列不能反弹');

  assert.deepEqual(rollingFrames(5n, 5n), [5n]);
  assert.throws(() => rollingFrames(0n, 1n, 0), RangeError);
});
