import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveStaticPath, contentTypeFor, PROJECT_ROOT } from '../src/server/static.js';
import { tempDir } from './helpers/tmp.js';

function fixtureDir() {
  const dir = tempDir('static');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>', 'utf8');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'app.css'), 'body{}', 'utf8');
  return dir;
}

test('contentTypeFor 覆盖用到的类型并回退二进制', () => {
  assert.equal(contentTypeFor('a.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('a.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('A.MJS'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('x.svg'), 'image/svg+xml');
  assert.equal(contentTypeFor('x.wav'), 'application/octet-stream');
});

test('/ 与 /index.html 指向演示页', () => {
  const dir = fixtureDir();
  for (const pathname of ['/', '/index.html']) {
    const hit = resolveStaticPath(pathname, { publicDir: dir });
    assert.equal(hit.contentType, 'text/html; charset=utf-8');
    assert.equal(fs.readFileSync(hit.filePath, 'utf8'), '<!doctype html>');
  }
});

test('core 挂在 /core/ 下，让 import "../core/x.js" 在浏览器里直接解析', () => {
  const hit = resolveStaticPath('/core/money.js');
  assert.equal(hit.filePath, path.join(PROJECT_ROOT, 'src', 'core', 'money.js'));
  assert.equal(hit.contentType, 'text/javascript; charset=utf-8');
  assert.ok(hit.size > 0);
  assert.equal(resolveStaticPath('/widget/no-such-file.js'), null);
});

test('目录请求与 /assets/ 下的文件', () => {
  const dir = fixtureDir();
  assert.equal(resolveStaticPath('/assets/app.css', { publicDir: dir }).contentType, 'text/css; charset=utf-8');
  assert.equal(resolveStaticPath('/assets/', { publicDir: dir }), null, '目录不给');
  assert.equal(resolveStaticPath('/assets', { publicDir: dir }), null);
  assert.equal(resolveStaticPath('/elsewhere/x.css', { publicDir: dir }), null, '未登记的前缀不给');
});

test('路径穿越与畸形编码一律 404，不做重定向', () => {
  const dir = fixtureDir();
  const cases = [
    '/assets/../../secrets.json', // 跳出 public/
    '/core/../../server/start.js', // 跳出 src/core/
    '/assets/%2e%2e/%2e%2e/os',
    '/assets/x.js%00.png',
    '/assets/%E4%B8', // 断了一半的 UTF-8 百分号序列
    '/assets//',
    '',
    null,
    undefined,
    42,
  ];
  for (const pathname of cases) {
    assert.equal(resolveStaticPath(pathname, { publicDir: dir }), null, `应当拒绝 ${String(pathname)}`);
  }
});

test('归一化后仍在允许目录内的路径照常提供（等价于直接访问它）', () => {
  const dir = fixtureDir();
  // /assets/../index.html 归一化就是 public/index.html，本来就挂在 / 上，不构成越界。
  const hit = resolveStaticPath('/assets/../index.html', { publicDir: dir });
  assert.equal(hit.filePath, path.join(dir, 'index.html'));
});

test('query 与 hash 不参与磁盘路径', () => {
  const hit = resolveStaticPath('/core/money.js?v=3#frag');
  assert.equal(hit.filePath, path.join(PROJECT_ROOT, 'src', 'core', 'money.js'));
});
