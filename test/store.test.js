import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStore, FILENAMES } from '../src/server/store.js';
import { tempDir } from './helpers/tmp.js';

test('目录不存在时自动创建，读不存在的存档回退默认值', () => {
  const dir = path.join(tempDir('store'), 'nested', 'deeper');
  const store = createStore({ dataDir: dir, logger: { warn: () => {} } });
  assert.equal(fs.existsSync(dir), true);
  const out = store.read('settings', { scale: 1 });
  assert.deepEqual(out.value, { scale: 1 });
  assert.equal(out.existed, false);
});

test('写入后能原样读回，且不留 .tmp 垃圾', () => {
  const dir = tempDir('store');
  const store = createStore({ dataDir: dir, logger: { warn: () => {} } });
  store.write('ledger', { version: 1, currentDay: '2026-10-11' });
  const out = store.read('ledger', null);
  assert.equal(out.existed, true);
  assert.equal(out.value.currentDay, '2026-10-11');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
});

test('半截 JSON 留档并回退，而不是覆盖后静默丢数据', () => {
  const dir = tempDir('store');
  const warnings = [];
  const store = createStore({ dataDir: dir, logger: { warn: (m) => warnings.push(m) } });
  fs.writeFileSync(path.join(dir, FILENAMES.settings), '{"scale": 1,', 'utf8'); // 模拟写一半断电
  const out = store.read('settings', { scale: 1 });
  assert.deepEqual(out.value, { scale: 1 });
  assert.equal(out.corrupt, true);
  assert.equal(warnings.length, 1);
  const backups = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.equal(backups.length, 1, '坏文件必须留档，不能直接覆盖掉');
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), '{"scale": 1,');
});

test('同一份坏存档只告警一次', () => {
  const dir = tempDir('store');
  const warnings = [];
  const store = createStore({ dataDir: dir, logger: { warn: (m) => warnings.push(m) } });
  fs.writeFileSync(path.join(dir, FILENAMES.ledger), 'nope', 'utf8');
  store.read('ledger', null);
  fs.writeFileSync(path.join(dir, FILENAMES.ledger), 'nope again', 'utf8');
  store.read('ledger', null);
  assert.equal(warnings.length, 1);
});

test('未知存档名直接报错', () => {
  const store = createStore({ dataDir: tempDir('store'), logger: { warn: () => {} } });
  assert.throws(() => store.read('secrets', {}), TypeError);
  assert.throws(() => store.write('nope', {}), TypeError);
  assert.throws(() => createStore({}), TypeError);
});
