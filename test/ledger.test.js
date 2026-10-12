import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLedger,
  recordObservation,
  todaySpendMicro,
  totalSpendMicro,
  serializeLedger,
  deserializeLedger,
} from '../src/core/ledger.js';
import { parseAmount } from '../src/core/money.js';

const m = parseAmount;

test('首次观测只立基线，不计消费', () => {
  const { state, kind } = recordObservation(createLedger(), { dateKey: '2026-10-11', balanceMicro: m('100'), at: 1 });
  assert.equal(kind, 'baseline');
  assert.equal(todaySpendMicro(state), 0n);
  assert.equal(state.days['2026-10-11'].baselineMicro, m('100'));
});

test('余额下降累计成当日消费', () => {
  let { state } = recordObservation(createLedger(), { dateKey: '2026-10-11', balanceMicro: m('100') });
  const r1 = recordObservation(state, { dateKey: '2026-10-11', balanceMicro: m('99.5'), at: 2 });
  assert.equal(r1.kind, 'spend');
  assert.equal(r1.deltaMicro, m('0.5'));
  const r2 = recordObservation(r1.state, { dateKey: '2026-10-11', balanceMicro: m('99.25') });
  assert.equal(todaySpendMicro(r2.state, '2026-10-11'), m('0.75'));
});

test('充值不会冲掉已累计消费，但单独记为待核对调整', () => {
  let { state } = recordObservation(createLedger(), { dateKey: '2026-10-11', balanceMicro: m('10') });
  state = recordObservation(state, { dateKey: '2026-10-11', balanceMicro: m('9') }).state;
  const up = recordObservation(state, { dateKey: '2026-10-11', balanceMicro: m('50') });
  assert.equal(up.kind, 'adjustment');
  assert.equal(up.deltaMicro, m('41'));
  assert.equal(todaySpendMicro(up.state, '2026-10-11'), m('1'), '消费必须保持 1 元');
  assert.equal(up.state.days['2026-10-11'].adjustmentMicro, m('41'));
  // 充值后再消费，继续往消费上累
  const after = recordObservation(up.state, { dateKey: '2026-10-11', balanceMicro: m('49') });
  assert.equal(todaySpendMicro(after.state, '2026-10-11'), m('2'));
});

test('余额不变不产生记录', () => {
  let { state } = recordObservation(createLedger(), { dateKey: '2026-10-11', balanceMicro: m('8') });
  const same = recordObservation(state, { dateKey: '2026-10-11', balanceMicro: m('8') });
  assert.equal(same.kind, 'unchanged');
  assert.equal(same.state.entries.length, 0);
});

test('跨天重新起算，昨天累计保留', () => {
  let { state } = recordObservation(createLedger(), { dateKey: '2026-10-11', balanceMicro: m('10') });
  state = recordObservation(state, { dateKey: '2026-10-11', balanceMicro: m('7') }).state;
  const next = recordObservation(state, { dateKey: '2026-10-12', balanceMicro: m('7') });
  assert.equal(next.kind, 'rollover');
  assert.equal(todaySpendMicro(next.state, '2026-10-11'), m('3'));
  assert.equal(todaySpendMicro(next.state, '2026-10-12'), 0n);
  assert.equal(totalSpendMicro(next.state), m('3'));
  const spent = recordObservation(next.state, { dateKey: '2026-10-12', balanceMicro: m('6') });
  assert.equal(totalSpendMicro(spent.state), m('4'));
});

test('明细超出 maxEntries 时丢弃最旧的', () => {
  let { state } = recordObservation(createLedger({ maxEntries: 3 }), { dateKey: '2026-10-11', balanceMicro: m('10') });
  let balance = 10;
  for (let i = 0; i < 5; i += 1) {
    balance -= 1;
    state = recordObservation(state, { dateKey: '2026-10-11', balanceMicro: m(String(balance)) }).state;
  }
  assert.equal(state.entries.length, 3);
  assert.equal(state.entries[0].balanceMicro, m('7'));
  assert.equal(todaySpendMicro(state), m('5'), '截断明细不能影响累计消费');
});

test('逐日归档超出 maxDays 时丢掉最旧的一天', () => {
  let { state } = recordObservation(createLedger({ maxDays: 2 }), { dateKey: '2026-01-01', balanceMicro: m('10') });
  state = recordObservation(state, { dateKey: '2026-01-02', balanceMicro: m('9') }).state;
  state = recordObservation(state, { dateKey: '2026-01-03', balanceMicro: m('8') }).state;
  assert.deepEqual(Object.keys(state.days).sort(), ['2026-01-02', '2026-01-03']);
});

test('账本序列化后能原样读回 BigInt', () => {
  let { state } = recordObservation(createLedger(), { dateKey: '2026-10-11', balanceMicro: m('10'), at: 5 });
  state = recordObservation(state, { dateKey: '2026-10-11', balanceMicro: m('9.12345678'), at: 6 }).state;
  state = recordObservation(state, { dateKey: '2026-10-11', balanceMicro: m('20'), at: 7 }).state;

  const json = JSON.parse(JSON.stringify(serializeLedger(state)));
  const revived = deserializeLedger(json);
  assert.equal(revived.lastBalanceMicro, m('20'));
  assert.equal(todaySpendMicro(revived, '2026-10-11'), m('0.87654322'));
  assert.equal(revived.days['2026-10-11'].adjustmentMicro, m('10.87654322'));
  assert.equal(revived.entries.length, 2);
  assert.equal(typeof revived.entries[0].deltaMicro, 'bigint');
});

test('空/损坏的存档退回新账本', () => {
  assert.deepEqual(deserializeLedger(null).days, {});
  assert.deepEqual(deserializeLedger({ days: { 'bogus': {} } }).currentDay, null);
});

test('recordObservation 校验入参', () => {
  assert.throws(() => recordObservation(createLedger(), { dateKey: '2026-10-11', balanceMicro: 100 }), TypeError);
  assert.throws(() => recordObservation(createLedger(), { dateKey: '10/11', balanceMicro: 1n }), TypeError);
  assert.throws(() => recordObservation(createLedger(), { balanceMicro: 1n }), TypeError);
});
