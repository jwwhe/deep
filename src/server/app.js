// 纯请求处理器：不碰 http 模块，输入一个描述请求的对象、输出一个响应对象，
// 这样路由、校验、回环边界这些关键路径能在 Node 里直接测，不必起监听端口。
import fs from 'node:fs';
import { formatAmount, tryParseAmount } from '../core/money.js';
import { STATUS } from '../core/balance.js';
import { recordObservation, serializeLedger, deserializeLedger, todaySpendMicro, createLedger } from '../core/ledger.js';
import { resolveStaticPath } from './static.js';

export const VERSION = '0.1.0';

export const DEFAULT_SETTINGS = {
  scale: 1,
  snapEnabled: true,
  snapMode: 'ratio',
  snapValue: 0.08,
  mirrorOnLeft: true,
  hideMenu: false,
};

// 白名单 + 范围校验：前端能改的只有外观，改不了上游地址与密钥，这是刻意的边界。
const SETTINGS_FIELDS = {
  scale: { type: 'number', min: 0.5, max: 3 },
  snapEnabled: { type: 'boolean' },
  snapMode: { type: 'enum', values: ['ratio', 'px'] },
  snapValue: { type: 'number', min: 0, max: 500 },
  mirrorOnLeft: { type: 'boolean' },
  hideMenu: { type: 'boolean' },
};

export function validateSettings(input) {
  const errors = [];
  const ignored = [];
  const value = {};
  if (input === undefined || input === null) return { ok: true, value, ignored, errors };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, value: {}, ignored, errors: ['请求体必须是对象'] };
  }
  for (const [key, raw] of Object.entries(input)) {
    const rule = SETTINGS_FIELDS[key];
    if (!rule) {
      ignored.push(key);
      continue;
    }
    if (rule.type === 'boolean') {
      if (typeof raw !== 'boolean') errors.push(`${key} 需要 true/false`);
      else value[key] = raw;
    } else if (rule.type === 'enum') {
      if (!rule.values.includes(raw)) errors.push(`${key} 只能是 ${rule.values.join('|')}`);
      else value[key] = raw;
    } else {
      const num = Number(raw);
      if (!Number.isFinite(num)) errors.push(`${key} 需要数字`);
      else if (num < rule.min || num > rule.max) errors.push(`${key} 必须在 ${rule.min}~${rule.max} 之间`);
      else value[key] = num;
    }
  }
  return { ok: errors.length === 0, value, ignored, errors };
}

function normalizeAddress(remoteAddress) {
  if (typeof remoteAddress !== 'string') return '';
  return remoteAddress.replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
}

export function isLoopback(remoteAddress) {
  const ip = normalizeAddress(remoteAddress);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.startsWith('127.');
}

/**
 * 写权限：默认只认回环，额外地址必须由 DSHW_ADMIN_HOSTS 显式声明。
 * 原因是「谁能改配置」等于「谁能决定密钥发往哪里」，这条不能放宽到局域网默认开放。
 */
export function canWrite({ remoteAddress, host, adminHosts = [] }) {
  if (isLoopback(remoteAddress)) return true;
  const ip = normalizeAddress(remoteAddress);
  const entries = adminHosts.map((s) => String(s).trim()).filter(Boolean);
  if (entries.includes(ip)) return true;
  const hostOnly = typeof host === 'string' ? host.split(':')[0] : '';
  return entries.some((entry) => entry === host || entry.split(':')[0] === hostOnly);
}

function json(status, payload, extraHeaders = {}) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders }, body: JSON.stringify(payload) };
}

export function createApp({ config, tracker, provider, store, now = () => Date.now(), logger = console, resolveStatic = resolveStaticPath }) {
  const clock = now;
  const localDateKey = () => {
    const d = new Date(clock());
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const loadedSettings = store ? store.read('settings', null).value : null;
  let settings = { ...DEFAULT_SETTINGS, ...(config.widget ?? {}), ...(loadedSettings && typeof loadedSettings === 'object' ? loadedSettings : {}) };
  const loadedLedger = store ? store.read('ledger', null).value : null;
  let ledger = deserializeLedger(loadedLedger);

  function persist(name, value) {
    if (!store) return;
    try {
      store.write(name, value);
    } catch (error) {
      logger.error(`[dshw] 写入 ${name} 失败：${error.message}`);
    }
  }

  function observe(balanceMicro) {
    const result = recordObservation(ledger, { dateKey: localDateKey(), balanceMicro, at: clock() });
    ledger = result.state;
    if (result.kind === 'spend' || result.kind === 'adjustment') persist('ledger', serializeLedger(ledger));
    return result;
  }

  // 每次成功取数都记一次观测；失败由 tracker 的 stale 语义兜住，不进账本。
  // 记账用的是「充值 + 赠送」总额而不是显示值：显示默认只含充值余额（与官网一致），
  // 而赠送钱包被扣掉时充值余额可以不动，按显示值算今日已用会漏记这一段。
  let lastRecorded = null;
  tracker.subscribe((state) => {
    if (state.status !== STATUS.ok || state.balanceMicro === null) return;
    const accounted = typeof state.meta?.totalMicro === 'bigint' ? state.meta.totalMicro : state.balanceMicro;
    if (lastRecorded === accounted) return;
    lastRecorded = accounted;
    observe(accounted);
  });

  function publicState() {
    const state = tracker.getState();
    const day = localDateKey();
    return {
      version: VERSION,
      provider: config.effectiveProvider,
      status: state.status,
      stale: state.stale,
      refreshing: state.refreshing,
      permanent: state.permanent,
      pending: state.pending,
      balanceMicro: state.balanceMicro === null ? null : String(state.balanceMicro),
      balance: state.balanceMicro === null ? null : formatAmount(state.balanceMicro),
      // 赠送钱包单列，口径对齐官网的「赠送余额」行；只有 DSH 账号服务这条路有分项，其它来源为 null。
      bonusMicro: state.meta?.bonusMicro === undefined ? null : String(state.meta.bonusMicro),
      bonus: state.meta?.bonusMicro === undefined ? null : formatAmount(state.meta.bonusMicro),
      bonusIncluded: state.meta?.bonusMicro === undefined ? null : Boolean(state.meta.includeBonus),
      currency: state.currency,
      updatedAt: state.updatedAt,
      consecutiveFailures: state.consecutiveFailures,
      error: state.error,
      todaySpend: formatAmount(todaySpendMicro(ledger, day)),
      todaySpendMicro: String(todaySpendMicro(ledger, day)),
      dateKey: day,
      settings,
    };
  }

  async function handle(request) {
    const { method = 'GET', pathname = '/', body, bodyError, remoteAddress, host } = request;
    const writable = canWrite({ remoteAddress, host, adminHosts: config.adminHosts });

    if (bodyError) return json(400, { ok: false, code: 'bad-json-body', message: '请求体不是合法 JSON' });

    if (method === 'GET' || method === 'HEAD') {
      switch (pathname) {
        case '/healthz':
          return json(200, { ok: true, version: VERSION, provider: config.effectiveProvider });
        case '/api/state':
        case '/api/balance':
          return json(200, publicState());
        default:
          break;
      }
      const asset = resolveStatic(pathname, { publicDir: config.publicDir });
      if (asset) {
        return {
          status: 200,
          headers: {
            'content-type': asset.contentType,
            'cache-control': 'no-cache',
            'content-length': String(asset.size),
          },
          body: method === 'HEAD' ? null : readFile(asset.filePath),
          filePath: asset.filePath,
        };
      }
      return json(404, { ok: false, code: 'not-found', message: `没有这个资源：${pathname}` });
    }

    if (method !== 'POST') return json(405, { ok: false, code: 'method-not-allowed', message: `${method} 不被支持` });
    if (!writable) {
      return json(403, {
        ok: false,
        code: 'not-loopback',
        message: '写操作只允许来自本机（回环地址），需要远端管理请设置 DSHW_ADMIN_HOSTS',
      });
    }

    switch (pathname) {
      case '/api/refresh': {
        const outcome = await tracker.refresh();
        return json(outcome.ok ? 200 : 502, { ...publicState(), refreshed: outcome.ok, reason: outcome.ok ? null : outcome.error });
      }
      case '/api/settings': {
        const result = validateSettings(body);
        if (!result.ok) return json(400, { ok: false, code: 'invalid-settings', errors: result.errors, ignored: result.ignored });
        settings = { ...settings, ...result.value };
        persist('settings', settings);
        return json(200, { ok: true, settings, ignored: result.ignored });
      }
      case '/api/mock/next': {
        if (config.effectiveProvider !== 'mock') {
          return json(409, { ok: false, code: 'provider-not-mock', message: '当前 provider 不是 mock' });
        }
        if (!provider || typeof provider.queueValue !== 'function') {
          return json(500, { ok: false, code: 'mock-unavailable', message: 'mock provider 不可用' });
        }
        const nextValue = body && body.value !== undefined ? body.value : null;
        const failCode = body && body.fail !== undefined ? body.fail : null;
        if (failCode !== null) {
          const code = String(failCode);
          // code 会被回显进响应和日志，限死字符集，别让接口变成任意字符串注入口。
          if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) {
            return json(400, { ok: false, code: 'bad-fail-code', message: 'fail 只允许字母、数字、下划线与短横线，长度不超过 32' });
          }
          provider.queueFailure(code);
        } else if (nextValue !== null) {
          const text = String(nextValue);
          if (tryParseAmount(text) === null) {
            return json(400, { ok: false, code: 'bad-value', message: `金额无法解析：${text.slice(0, 40)}` });
          }
          provider.queueValue(text);
        } else return json(400, { ok: false, code: 'missing-argument', message: '需要 {value} 或 {fail}' });
        const outcome = await tracker.refresh();
        return json(outcome.ok ? 200 : 502, { ...publicState(), refreshed: outcome.ok, reason: outcome.ok ? null : outcome.error });
      }
      default:
        return json(404, { ok: false, code: 'not-found', message: `没有这个接口：${pathname}` });
    }
  }

  function readFile(filePath) {
    // 静态文件按需读：原型不常驻缓存，改完刷新即可见（对齐参考项目「按 mtime 热读取」的做法）。
    return fs.readFileSync(filePath);
  }

  return { handle, publicState, validateSettings, getSettings: () => settings, getLedger: () => ledger, observe };
}
