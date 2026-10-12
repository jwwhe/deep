import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDotEnv, applyDotEnv } from '../src/server/env.js';
import { loadConfig } from '../src/server/config.js';

test('parseDotEnv 支持注释、空行、export 前缀与引号', () => {
  const parsed = parseDotEnv([
    '# 注释',
    '',
    'A=1',
    'export B = two',
    'C="quoted value"',
    "D='single'",
    'E=',
    '  F   =   3799  ',
  ].join('\n'));
  assert.deepEqual(parsed, { A: '1', B: 'two', C: 'quoted value', D: 'single', E: '', F: '3799' });
});

test('parseDotEnv 不截断值里的 #，也不去掉引号内的空格', () => {
  const parsed = parseDotEnv(['K=ab#cd', 'Q=" x "'].join('\n'));
  assert.equal(parsed.K, 'ab#cd');
  assert.equal(parsed.Q, ' x ');
});

test('parseDotEnv 对坏行报错并给出行号', () => {
  assert.throws(() => parseDotEnv('A=1\n不是键值对\n'), /第 2 行/);
  assert.throws(() => parseDotEnv('1BAD=x'), /第 1 行/);
});

test('applyDotEnv 只填环境里缺的键，真实环境变量优先', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'DSHW_PORT=3799\nDEEPSEEK_API_KEY=sk-from-file\n');
  const env = { DSHW_PORT: '4000' };
  const result = applyDotEnv(env, file);
  assert.equal(env.DSHW_PORT, '4000');
  assert.equal(env.DEEPSEEK_API_KEY, 'sk-from-file');
  assert.deepEqual(result.applied, ['DEEPSEEK_API_KEY']);
  assert.deepEqual(result.skipped, ['DSHW_PORT']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyDotEnv 把 .env 里的值接到 loadConfig 上', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'DSHW_PORT=3799\nDSHW_INTERVAL_MS=5000\nDSHW_PROVIDER=mock\n');
  const env = applyEnv(file);
  assert.equal(env.DSHW_PORT, '3799');
  assert.equal(loadConfig(env).intervalMs, 5000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('没有 .env 文件时静默跳过，读到坏文件才报错', () => {
  const missing = applyDotEnv({}, path.join(os.tmpdir(), 'dshw-definitely-not-here', '.env'));
  assert.deepEqual(missing, { applied: [], skipped: [], file: null });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, '坏行\n');
  assert.throws(() => applyDotEnv({}, file), /第 1 行/);
  fs.rmSync(dir, { recursive: true, force: true });
});

function applyEnv(file) {
  const env = {};
  applyDotEnv(env, file);
  return env;
}
