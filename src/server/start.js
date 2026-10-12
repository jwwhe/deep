// HTTP 接线层：只做「读请求 → 交给纯 handler → 写响应」，业务规则都在 app.js。
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig, maskSecret } from './config.js';
import { applyDotEnv } from './env.js';
import { createStore } from './store.js';
import { createApp, VERSION } from './app.js';
import { createDshBridge } from './dsh-routes.js';
import { createBalanceTracker } from '../core/balance.js';
import { createDeepSeekProvider } from './providers/deepseek.js';
import { createMockProvider } from './providers/mock.js';

const MAX_BODY_BYTES = 64 * 1024;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish({ body: undefined, bodyError: 'too-large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') return finish({ body: undefined, bodyError: null });
      try {
        finish({ body: JSON.parse(text), bodyError: null });
      } catch {
        finish({ body: undefined, bodyError: 'bad-json' });
      }
    });
    req.on('error', () => finish({ body: undefined, bodyError: 'stream-error' }));
  });
}

function buildProvider(config) {
  if (config.effectiveProvider === 'deepseek') {
    return {
      name: 'deepseek',
      fetchBalance: createDeepSeekProvider({
        apiKey: config.apiKey,
        baseUrl: config.upstreamBaseUrl,
        timeoutMs: config.upstreamTimeoutMs,
      }),
    };
  }
  const mock = createMockProvider({ script: config.mockScript });
  return { name: 'mock', fetchBalance: mock.fetchBalance, queueValue: mock.queueValue, queueFailure: mock.queueFailure };
}

/** 把 node 请求读成 handler 认得的归一化对象；体积上限与 JSON 解析失败都编码进结果，不抛错。 */
export async function normalizeRequest(req) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const parsed = req.method === 'GET' || req.method === 'HEAD'
    ? { body: undefined, bodyError: null }
    : await readBody(req);
  return {
    method: req.method,
    pathname: url.pathname,
    query: url.searchParams,
    body: parsed.body,
    bodyError: parsed.bodyError,
    remoteAddress: req.socket?.remoteAddress,
    host: req.headers.host,
  };
}

/** 把响应对象写回 res：HEAD 不回体，content-length 按实际字节算。 */
export function writeResponse(res, response, method) {
  const headers = { ...response.headers };
  if (response.body === null || response.body === undefined) {
    delete headers['content-length'];
    res.writeHead(response.status, headers);
    res.end();
    return;
  }
  const buf = Buffer.isBuffer(response.body) ? response.body : Buffer.from(String(response.body));
  headers['content-length'] = String(buf.length);
  res.writeHead(response.status, headers);
  res.end(method === 'HEAD' ? undefined : buf);
}

export function internalErrorResponse() {
  return {
    status: 500,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ok: false, code: 'internal', message: '服务端内部错误' }),
  };
}

export function createServices({ env = process.env, logger = console, provider = null } = {}) {
  const config = loadConfig(env);
  const silent = config.logLevel === 'silent';
  const log = (...args) => {
    if (!silent) logger.log(...args);
  };

  const store = createStore({ dataDir: config.dataDir, logger: silent ? { warn: () => {} } : logger });
  const activeProvider = provider ?? buildProvider(config);
  // 宿主自带 provider（DSH 适配器走这条）时，对外报告的来源要跟着换，否则 /api/state 会说我用的是 mock/deepseek。
  const view = provider ? { ...config, effectiveProvider: activeProvider.name } : config;
  const tracker = createBalanceTracker({
    fetcher: activeProvider.fetchBalance,
    intervalMs: config.intervalMs,
    logger: (entry) => log(`[dshw] ${entry.message}：${entry.error}`),
  });
  const app = createApp({
    config: view,
    tracker,
    provider: activeProvider,
    store,
    logger: { warn: (m) => log(m), error: (m) => log(m) },
  });
  // /dsh-whale/* 是宿主契约那一套路径与字段名，与原型自己的 /api/* 并存：
  // 这样同一份代码既能当独立服务跑，也能被 DSH 适配器直接端出去。
  const dshHandle = createDshBridge({ app });
  return { config: view, store, provider: activeProvider, tracker, app, dshHandle, log, silent };
}

export function createServer({ env = process.env, logger = console } = {}) {
  const { config, tracker, app, dshHandle, log, store, provider } = createServices({ env, logger });

  const server = http.createServer(async (req, res) => {
    let response;
    try {
      const request = await normalizeRequest(req);
      response = await (request.pathname.startsWith('/dsh-whale/') ? dshHandle(request) : app.handle(request));
    } catch (error) {
      // handler 抛错也要落到响应上：不能让请求挂住，也不能把堆栈回给客户端。
      log(`[dshw] 处理 ${req.method} ${req.url} 失败：${error.message}`);
      response = internalErrorResponse();
    }
    writeResponse(res, response, req.method);
  });

  return { server, app, tracker, config, store, provider, version: VERSION };
}

/** 独立进程入口：npm start */
export function start({ env = process.env, port, logger = console, envFile = '.env' } = {}) {
  // .env 只在进程入口读一次：库用法（createServer）不该偷偷改调用方的环境。
  const loaded = applyDotEnv(env, envFile);
  const created = createServer({ env, logger });
  const listenPort = port ?? created.config.port;
  const base = `http://${created.config.host}:${listenPort}`;

  created.server.listen(listenPort, created.config.host, () => {
    // 服务端自己按间隔轮上游：否则第一次 GET /api/state 永远是空的，只有手动刷新才有数。
    created.tracker.start();
    const keyHint = created.config.apiKey ? `已配置（${maskSecret(created.config.apiKey)}）` : '未配置';
    logger.log(`鲸鱼娘余额挂件 v${created.version} 已启动`);
    logger.log(`  界面      ${base}/`);
    logger.log(`  状态      ${base}/api/state`);
    logger.log(`  provider  ${created.config.effectiveProvider} · DEEPSEEK_API_KEY ${keyHint}`);
    logger.log(`  数据目录  ${created.config.dataDir}`);
    if (loaded.file) {
      logger.log(`  环境文件  ${loaded.file}（应用 ${loaded.applied.length} 项，${loaded.skipped.length} 项已被真实环境变量覆盖）`);
    }
    if (created.config.effectiveProvider === 'mock') {
      logger.log('  提示：未检测到 DEEPSEEK_API_KEY，当前用 mock 数据驱动原型；配好 key 后重启即接真实余额。');
    }
  });

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    logger.log(`[dshw] 收到 ${signal}，正在关闭…`);
    created.tracker.stop();
    created.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return created;
}

// Windows 下 process.argv[1] 是 D:\ 形式的路径，必须经 pathToFileURL 归一后再比较。
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) start({});
