import test from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { loadConfig, maskSecret } from '../src/server/config.js';

test('默认配置：只监听回环、60 秒轮询、无 key 走 mock', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3080);
  assert.equal(config.intervalMs, 60000);
  assert.equal(config.upstreamTimeoutMs, 8000);
  assert.equal(config.apiKey, '');
  assert.equal(config.provider, 'auto');
  assert.equal(config.effectiveProvider, 'mock');
  assert.deepEqual(config.adminHosts, []);
  assert.equal(config.widget.mirrorOnLeft, true);
});

test('有 key 时自动切到 deepseek，显式 mock 优先级更高', () => {
  assert.equal(loadConfig({ DEEPSEEK_API_KEY: 'sk-abc' }).effectiveProvider, 'deepseek');
  assert.equal(loadConfig({ DEEPSEEK_API_KEY: 'sk-abc', DSHW_PROVIDER: 'mock' }).effectiveProvider, 'mock');
  // 显式要求 deepseek 但没配 key：仍按 deepseek 走，由 provider 报 unconfigured（不能悄悄换成假数据）
  assert.equal(loadConfig({ DSHW_PROVIDER: 'deepseek' }).effectiveProvider, 'deepseek');
});

test('空白 key 视为未配置', () => {
  assert.equal(loadConfig({ DEEPSEEK_API_KEY: '   ' }).effectiveProvider, 'mock');
});

test('未知 provider 直接报错，不许拼错了一个字母就静默降级', () => {
  assert.throws(() => loadConfig({ DSHW_PROVIDER: 'deepseekk' }), TypeError);
});

test('端口/超时/间隔越界与非数字都拒绝', () => {
  assert.throws(() => loadConfig({ DSHW_PORT: '0' }), RangeError);
  assert.throws(() => loadConfig({ DSHW_PORT: '70000' }), RangeError);
  assert.throws(() => loadConfig({ DSHW_PORT: 'abc' }), TypeError);
  assert.throws(() => loadConfig({ DSHW_PORT: '3000.5' }), TypeError);
  assert.throws(() => loadConfig({ DSHW_UPSTREAM_TIMEOUT_MS: '100' }), RangeError);
  assert.throws(() => loadConfig({ DSHW_INTERVAL_MS: '10' }), RangeError);
  assert.throws(() => loadConfig({ DSHW_SCALE: '0' }), RangeError);
  assert.throws(() => loadConfig({ DSHW_SCALE: 'abc' }), TypeError);
});

test('空字符串回落到默认值而不是 0', () => {
  const config = loadConfig({ DSHW_PORT: '', DSHW_UPSTREAM_TIMEOUT_MS: '' });
  assert.equal(config.port, 3080);
  assert.equal(config.upstreamTimeoutMs, 8000);
});

test('DSHW_HOST 留空时仍绑回环，不能变成 0.0.0.0', () => {
  assert.equal(loadConfig({ DSHW_HOST: '' }).host, '127.0.0.1');
  assert.equal(loadConfig({ DSHW_HOST: '0.0.0.0' }).host, '0.0.0.0');
});

test('上游地址去掉尾部斜杠，避免拼出 //user/balance', () => {
  assert.equal(loadConfig({ DSHW_UPSTREAM_BASE_URL: 'https://example.com///' }).upstreamBaseUrl, 'https://example.com');
});

test('adminHosts 按逗号切并去空', () => {
  assert.deepEqual(loadConfig({ DSHW_ADMIN_HOSTS: ' a.lan , 10.0.0.9:3080 ,, ' }).adminHosts, ['a.lan', '10.0.0.9:3080']);
});

test('mock 脚本解析成数组，空串等于不用脚本', () => {
  assert.deepEqual(loadConfig({ DSHW_MOCK_SCRIPT: '10, 9.5 , !timeout ' }).mockScript, ['10', '9.5', '!timeout']);
  assert.equal(loadConfig({ DSHW_MOCK_SCRIPT: '' }).mockScript, null);
});

test('maskSecret 只回头尾，日志里拿不到完整密钥', () => {
  assert.equal(maskSecret('sk-1234567890abcdef'), 'sk-****cdef');
  assert.equal(maskSecret('short'), 'sh****');
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret(undefined), '');
  // 短密钥也不能把全部字符露出来
  assert.ok(!maskSecret('abcdefgh').includes('abcdefgh'));
});

test('dataDir 解析成绝对路径', () => {
  assert.equal(isAbsolute(loadConfig({ DSHW_DATA_DIR: 'relative-dir' }).dataDir), true);
});
