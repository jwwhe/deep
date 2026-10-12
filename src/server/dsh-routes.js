// DSH 宿主侧的路径与字段名和原型内部不是一套（参考项目实测：GET /dsh-whale/balance.json 里给的是 totalBalance）。
// 这一层只做「宿主契约 ↔ 内部 handler」的双向翻译，规则仍然只在 app.js 里存一份。
import fs from 'node:fs';
import path from 'node:path';
import { resolveStaticPath, contentTypeFor, PROJECT_ROOT } from './static.js';

export const DSH_PREFIX = '/dsh-whale';

/** 宿主接口名 → 内部路由。shape 非空表示响应体要改写成宿主认得的字段。 */
const API_ROUTES = new Map([
  ['/balance.json', { method: 'GET', to: '/api/state', shape: toDshBalance }],
  ['/state.json', { method: 'GET', to: '/api/state', shape: null }],
  ['/refresh.json', { method: 'POST', to: '/api/refresh', shape: toDshBalance }],
  ['/settings.json', { method: 'POST', to: '/api/settings', shape: null }],
]);

export function dshPrefixes(root = PROJECT_ROOT) {
  return [
    { prefix: `${DSH_PREFIX}/core/`, dir: path.join(root, 'src', 'core') },
    { prefix: `${DSH_PREFIX}/widget/`, dir: path.join(root, 'src', 'widget') },
    { prefix: `${DSH_PREFIX}/assets/`, dir: path.join(root, 'assets') },
  ];
}

export function dshRouteFor(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(`${DSH_PREFIX}/`)) return null;
  return API_ROUTES.get(pathname.slice(DSH_PREFIX.length)) ?? null;
}

/** 把内部状态改成宿主认得的形状。金额仍走字符串，避免 JSON 里的浮点漂移。 */
export function toDshBalance(payload) {
  return {
    ok: payload.status === 'ok' || payload.status === 'stale',
    totalBalance: payload.balance ?? null,
    balanceMicro: payload.balanceMicro ?? null,
    // 赠送钱包不并进 totalBalance（官网「余额」行也不并），单独给一行让挂件如实展示。
    bonusBalance: payload.bonus ?? null,
    bonusIncluded: payload.bonusIncluded ?? null,
    todayUsed: payload.todaySpend ?? null,
    currency: payload.currency ?? 'CNY',
    status: payload.status,
    stale: Boolean(payload.stale),
    updatedAt: payload.updatedAt ?? null,
    error: payload.error ?? null,
    settings: payload.settings ?? null,
  };
}

export function createDshBridge({ app, root = PROJECT_ROOT }) {
  const prefixes = dshPrefixes(root);
  const entryFile = path.join(root, 'assets', 'whale-widget.js');

  return async function handle(request) {
    const { pathname } = request;
    if (typeof pathname !== 'string' || !pathname.startsWith(`${DSH_PREFIX}/`)) {
      return json(404, { ok: false, code: 'not-dsh-route', message: `不属于 ${DSH_PREFIX} 命名空间：${pathname}` });
    }
    const rest = pathname.slice(DSH_PREFIX.length);

    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') {
      return json(405, { ok: false, code: 'method-not-allowed', message: `${request.method} 不支持` });
    }

    if (rest === '/widget.js') {
      return serveFile(entryFile, request.method);
    }

    const route = API_ROUTES.get(rest);
    if (route) {
      if (route.method !== request.method) {
        return json(405, { ok: false, code: 'method-not-allowed', message: `${rest} 只接受 ${route.method}` });
      }
      const response = await app.handle({ ...request, pathname: route.to });
      if (!route.shape || typeof response.body !== 'string') return response;
      let payload;
      try {
        payload = JSON.parse(response.body);
      } catch {
        return response; // 上游不是 JSON 就原样回，别在这里编数据
      }
      return { ...response, body: JSON.stringify(route.shape(payload)) };
    }

    // 不是接口名，就按模块前缀找文件：/dsh-whale/widget/x.js 与 /dsh-whale/core/x.js 都走这里。
    const found = resolveStaticPath(pathname, { publicDir: path.join(root, 'assets'), prefixes });
    if (!found) return json(404, { ok: false, code: 'not-found', message: `没有这个路径：${rest}` });
    return fileResponse(found, request.method);
  };
}

function serveFile(filePath, method) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // 入口脚本是随包发布的源码，正常不会缺；缺了说明安装不完整，直接说出缺哪个文件。
    return json(404, { ok: false, code: 'asset-missing', message: `入口脚本不存在：${filePath}` });
  }
  if (!stat.isFile()) return json(404, { ok: false, code: 'not-found', message: '不是文件' });
  return fileResponse({ filePath, contentType: contentTypeFor(filePath), size: stat.size, mtimeMs: stat.mtimeMs }, method);
}

function fileResponse(found, method) {
  const headers = {
    'content-type': found.contentType,
    'cache-control': 'no-cache',
    'last-modified': new Date(found.mtimeMs).toUTCString(),
  };
  if (method === 'HEAD') return { status: 200, headers, body: '' };
  return { status: 200, headers, body: fs.readFileSync(found.filePath) };
}

function json(status, payload) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}
