// 静态资源映射：src/core 挂到 /core/、src/widget 挂到 /widget/。
// 挂件模块里写的是 `import '../core/money.js'`，浏览器按脚本 URL 解析成 /core/money.js，
// Node 按文件位置解析成 src/core/money.js —— 同一份源码两边都能跑，不需要打包器。
// DSH 适配器复用这条规则，只是前缀换成 /dsh-whale/...。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

const PREFIXES = [
  { prefix: '/core/', dir: path.join(PROJECT_ROOT, 'src', 'core') },
  { prefix: '/widget/', dir: path.join(PROJECT_ROOT, 'src', 'widget') },
  { prefix: '/static/', dir: path.join(PROJECT_ROOT, 'public') },
];

/**
 * 把 URL 路径解析成磁盘路径。任何跳出允许目录的尝试（.. / 编码穿越 / 绝对路径）都返回 null，
 * 由调用方给 404 —— 不做重定向，避免把目录结构泄露出去。
 */
export function resolveStaticPath(pathname, { publicDir = path.join(PROJECT_ROOT, 'public'), prefixes = PREFIXES } = {}) {
  if (typeof pathname !== 'string' || pathname === '') return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.split('?')[0].split('#')[0]);
  } catch {
    return null; // 非法百分号编码
  }
  if (decoded.includes('\0')) return null;

  if (decoded === '/' || decoded === '/index.html') {
    return candidate(publicDir, 'index.html');
  }
  for (const { prefix, dir } of prefixes) {
    if (decoded.startsWith(prefix)) {
      return candidate(dir, decoded.slice(prefix.length));
    }
  }
  // 其余路径落回 public/：演示页要引 /app.css、/favicon.ico 这类资源，逐个登记前缀不如统一兜底，
  // 越界由 candidate() 的目录包含检查挡住。
  return candidate(publicDir, decoded.slice(1));
}

function candidate(dir, relative) {
  if (!relative || relative.endsWith('/')) return null;
  const resolved = path.resolve(dir, relative);
  const normalizedDir = path.resolve(dir);
  // Windows 大小写不敏感，比较前统一小写，否则 404 与越界判定都会飘。
  const caseFold = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
  if (!caseFold(resolved).startsWith(caseFold(normalizedDir) + path.sep)) return null;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return null;
    return { filePath: resolved, contentType: contentTypeFor(resolved), size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}
