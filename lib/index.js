// DSH 宿主侧入口：一个 cordis 插件。契约按真机运行时的包核实（@deepseek-ai/dsh-* 与官方模板）：
//   · 插件形态是 `export function apply(ctx, config)`，可带 `name` / `inject`，没有 install({register})。
//   · 路由用 ctx.webServer.register({kind:'prefix', path, handler(req, res)})，重复路径宿主直接抛错。
//   · 前端注入用 ctx.on('webserver/index-inject', table => table.push(row))。
//     web 组合把 row 渲染进 index.html；桌面组合把同一张表经 IPC 交给前端解释器执行（dsh-app://app
//     协议会把非静态路径转发回本宿主），所以一条 script row 在两种形态下都能挂上挂件。
// 本文件只依赖 node 标准库和本项目自己的 src/，不引第三方包：DSH 用 pnpm 装插件，
// 未声明的依赖在严格模式下会解析失败，「装完右下角什么都没有」就是这么来的。
import path from 'node:path';
import { createServices, normalizeRequest, writeResponse, internalErrorResponse } from '../src/server/start.js';
import { loadConfig } from '../src/server/config.js';
import { createDeepSeekProvider } from '../src/server/providers/deepseek.js';
import { mergeWallets } from '../src/core/wallets.js';
import { STATUS } from '../src/core/balance.js';

// 与 package.json 的 name、cordis.patch.yml 的 id 三处一致；不一致会让安装时指错模块。
export const PLUGIN_ID = 'dsh-whale-widget-proto';
export const name = PLUGIN_ID;

// 只有 webServer 是硬依赖：缺它就没有路由可注册。其余服务用 ctx.get 按需取，
// 这样即使账号服务比我们晚加载（或某个组合里根本没有），挂件也照样出现在右下角，只是显示「未配置」。
export const inject = ['webServer'];

const DSH_PREFIX = '/dsh-whale';
const API_KEY_REF = 'DEEPSEEK_API_KEY';
const BOOT_SCRIPT = `import('${DSH_PREFIX}/widget.js').catch((error) => {`
  + ` console.error('[dsh-whale] 挂件入口加载失败', error && error.message || String(error)); })`;

/**
 * 宿主可选服务的取法。真实 cordis 里读一个「没 inject 也没注册」的属性是**抛错**
 * （cannot get property ... without inject），不是返回 undefined，所以 cordis 上下文只走 ctx.get
 * （未注册或未激活都返回 undefined）；只有自建宿主/测试替身才退回属性访问。
 */
function optionalService(ctx, key) {
  if (ctx && typeof ctx.get === 'function') return ctx.get(key);
  return ctx ? ctx[key] : undefined;
}

function messageOf(error) {
  return String(error && error.message ? error.message : error);
}

function jsonError(status, code, message) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ok: false, code, message }),
  };
}

/** 宿主环境下的数据目录：DSH_HOME 是 harness 自己的家，配置落在这里才不会被临时目录清理掉。 */
export function hostEnv(env = process.env) {
  if (env.DSHW_DATA_DIR || !env.DSH_HOME) return env;
  return { ...env, DSHW_DATA_DIR: path.join(env.DSH_HOME, 'whale-widget') };
}

/** 账号服务要求的客户端标识；DSH 桌面宿主会被注入 DSH_CLIENT_VERSION，取不到就如实标原型版本。 */
function accountClientMetadata(env) {
  return {
    version: env.DSH_CLIENT_VERSION || '0.1.0-prototype',
    locale: env.DSHW_CLIENT_LOCALE || (Intl.DateTimeFormat().resolvedOptions().locale ?? 'zh-CN'),
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
}

/**
 * 三级余额来源，每次轮询都重新判定，因此不依赖插件与账号服务的加载顺序：
 *   1. ctx.deepseekAccount.getBalance —— 宿主已登录的 DeepSeek 账号，最贴合「显示余额」且不碰密钥；
 *   2. ctx.credentials.resolve('DEEPSEEK_API_KEY') —— 宿主凭据库里存的 API key；
 *   3. 环境变量 DEEPSEEK_API_KEY —— 独立跑那套的老路径。
 * 都没有时回 unconfigured，让挂件显示「未配置」而不是伪装成 0 元。
 */
export function createHostProvider(ctx, { env, config, logger, includeBonus = false }) {
  const accountMeta = () => accountClientMetadata(env);
  const notes = new Set();

  async function fromAccountService() {
    const account = optionalService(ctx, 'deepseekAccount');
    if (!account || typeof account.getBalance !== 'function') return null;
    let result;
    try {
      result = await account.getBalance(accountMeta());
    } catch (error) {
      // 账号服务抛错不等于「没登录」，记下来继续往下找来源，但绝不把这条错误丢掉。
      return { ok: false, code: 'account-throw', message: `账号服务抛错：${messageOf(error)}`, retryable: true };
    }
    const merged = mergeWallets(result, { includeBonus });
    if (merged.note && !notes.has(merged.note)) {
      notes.add(merged.note);
      logger.warn?.(`[dsh-whale] ${merged.note}`);
    }
    if (merged.ok) return merged;
    // 未登录是「这条路不通」，其它失败（上游 5xx、形状不对）本身就是答案，不再往下猜。
    return merged.code === 'not-signed-in' ? { ok: false, code: merged.code, message: merged.message, status: STATUS.unconfigured, next: true } : merged;
  }

  async function fromCredentialRef() {
    const credentials = optionalService(ctx, 'credentials');
    if (!credentials || typeof credentials.resolve !== 'function') return null;
    let hit;
    try {
      hit = await credentials.resolve(API_KEY_REF);
    } catch (error) {
      return { ok: false, code: 'credential-throw', message: `凭据服务抛错：${messageOf(error)}`, retryable: true };
    }
    if (!hit || !hit.value) return null;
    return createDeepSeekProvider({
      apiKey: hit.value,
      baseUrl: config.upstreamBaseUrl,
      timeoutMs: config.upstreamTimeoutMs,
    })();
  }

  return {
    name: 'host',
    async fetchBalance() {
      const chain = [];
      const account = await fromAccountService();
      if (account) {
        if (account.ok || !account.next) return account;
        chain.push(account.message);
      }
      const credential = await fromCredentialRef();
      if (credential) return credential;
      if (config.apiKey) {
        return createDeepSeekProvider({
          apiKey: config.apiKey,
          baseUrl: config.upstreamBaseUrl,
          timeoutMs: config.upstreamTimeoutMs,
        })();
      }
      return {
        ok: false,
        code: 'no-balance-source',
        // 说清查过哪些来源，否则「右下角显示未配置」在真机上根本无从下手。
        message: chain.length > 0
          ? `宿主没有可用的余额来源（${chain.join('；')}）`
          : `宿主既没登录 DeepSeek 账号，也没有 ${API_KEY_REF} 凭据或环境变量`,
        status: STATUS.unconfigured,
      };
    },
  };
}

/** 把宿主的 node req/res 接到本项目那套「归一化请求对象 → 响应对象」的 handler 上。 */
export function createRouteHandler({ handle, ctx, logger }) {
  let notedNoGuard = false;
  return async function handler(req, res) {
    const method = req.method ?? 'GET';
    // 宿主不会自动给插件路由做门禁：admit 同时校验 Host/Origin 围栏与浏览器会话，
    // 少了这一步，局域网里任何页面都能读到这个进程端口下的余额响应。
    // 每个请求现取连接服务：它可能比本插件晚加载，缓存下来就等于永久放行。
    const connection = ctx ? optionalService(ctx, 'connection') : null;
    if (connection && typeof connection.admit === 'function') {
      const admission = connection.admit(req);
      if (admission && admission.rejection) {
        const code = admission.rejection === 401 ? 'unauthenticated' : 'forbidden-origin';
        writeResponse(res, jsonError(admission.rejection, code, '宿主判定该请求不属于本机已登录会话'), method);
        return;
      }
    } else {
      // 连接服务还没起来 = 宿主此刻没有会话校验能力，这条路必须**拒绝**而不是放行。
      // 冷启动实测过代价：引擎端口刚监听的头两百毫秒里，连接服务尚未注册，
      // 不带会话的本地请求照样从 /dsh-whale/balance.json 拿到了 200 和真实余额数字。
      if (!notedNoGuard) {
        notedNoGuard = true;
        logger.warn?.('[dsh-whale] 宿主 connection 服务尚未就绪，挂件路由本次拒绝（503），挂件会自动重试');
      }
      writeResponse(res, jsonError(503, 'guard-unavailable', '宿主的会话校验服务尚未就绪，挂件稍后自动重试'), method);
      return;
    }
    let response;
    try {
      response = await handle(await normalizeRequest(req));
    } catch (error) {
      logger.error?.(`[dsh-whale] 处理 ${method} ${req.url} 失败：${messageOf(error)}`);
      response = internalErrorResponse();
    }
    writeResponse(res, response, method);
  };
}

/**
 * cordis 插件入口。
 * @param {object} ctx 宿主上下文，需含 webServer；可选 deepseekAccount / credentials / connection
 * @param {object} [config] 宿主 profile 传下来的插件配置，只认 includeBonus
 * @param {object} [options] 测试注入点
 * @param {object} [options.env]  环境对象，默认 process.env
 * @param {object} [options.logger] console 兼容对象
 */
export function apply(ctx, config = {}, options = {}) {
  if (!ctx || !ctx.webServer || typeof ctx.webServer.register !== 'function') {
    throw new TypeError(`${PLUGIN_ID}: 宿主上下文缺少 webServer.register，无法挂载挂件路由`);
  }
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const hosted = hostEnv(env);
  const probed = loadConfig(hosted);
  // 默认与官网「余额」行同口径（只算充值钱包）；要合并成一个总数得在 profile 的 config 里显式打开。
  const includeBonus = config && typeof config.includeBonus === 'boolean' ? config.includeBonus : false;
  const provider = createHostProvider(ctx, { env: hosted, config: probed, logger, includeBonus });
  const services = createServices({ env: hosted, logger, provider });

  const handler = createRouteHandler({ handle: services.dshHandle, ctx, logger });

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: DSH_PREFIX, handler }), `${PLUGIN_ID}: routes`);
  ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'body', text: BOOT_SCRIPT });
  }), `${PLUGIN_ID}: index injection`);
  ctx.effect(() => {
    services.tracker.start();
    return () => services.tracker.stop();
  }, `${PLUGIN_ID}: balance polling`);

  return services;
}

// 真 Loader 的 unwrapExports 先取 `default` 再取命名导出（@deepseek-ai/cordis-plugin-loader）。
// 这里若 `export default apply`，宿主拿到的是那个裸函数，本文件的 `inject` 会被整体丢掉，
// 于是 ctx.webServer 变成「没 inject 就读」→ 插件激活失败 → 右下角什么都没有。
// 官方插件（dsh-purge 等）要么不给 default，要么给 { name, inject, apply } 对象。
export default { name, inject, apply };
