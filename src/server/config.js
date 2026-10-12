// 配置全部来自环境变量：不读任何宿主（含 DSH）的凭据文件，避免把别人的密钥目录变成本原型的隐式依赖。
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROVIDERS = ['auto', 'deepseek', 'mock'];

function intFromEnv(value, name, fallback, { min, max } = {}) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new TypeError(`${name} 必须是整数，收到 ${JSON.stringify(value)}`);
  if (min !== undefined && parsed < min) throw new RangeError(`${name} 不能小于 ${min}`);
  if (max !== undefined && parsed > max) throw new RangeError(`${name} 不能大于 ${max}`);
  return parsed;
}

function floatFromEnv(value, name, fallback, { min, max } = {}) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} 必须是数字，收到 ${JSON.stringify(value)}`);
  if (min !== undefined && parsed < min) throw new RangeError(`${name} 不能小于 ${min}`);
  if (max !== undefined && parsed > max) throw new RangeError(`${name} 不能大于 ${max}`);
  return parsed;
}

function listFromEnv(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/** 密钥只从环境变量取；日志与接口响应一律只回掩码。 */
export function maskSecret(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 8) return `${text.slice(0, 2)}****`;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

export function loadConfig(env = process.env) {
  const provider = (env.DSHW_PROVIDER ?? 'auto').trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new TypeError(`DSHW_PROVIDER 只能是 ${PROVIDERS.join('|')}，收到 ${JSON.stringify(env.DSHW_PROVIDER)}`);
  }
  const apiKey = (env.DEEPSEEK_API_KEY ?? '').trim();
  const script = (env.DSHW_MOCK_SCRIPT ?? '').trim();

  return {
    port: intFromEnv(env.DSHW_PORT, 'DSHW_PORT', 3080, { min: 1, max: 65535 }),
    host: (env.DSHW_HOST ?? '127.0.0.1').trim() || '127.0.0.1',
    dataDir: path.resolve(env.DSHW_DATA_DIR ?? path.join(tmpdir(), 'dshw-proto')),
    provider,
    apiKey,
    // 默认自动：有 key 走真接口，没 key 走 mock，保证「装完就能跑」。
    effectiveProvider: apiKey && provider !== 'mock' ? 'deepseek' : provider === 'deepseek' ? 'deepseek' : 'mock',
    upstreamBaseUrl: (env.DSHW_UPSTREAM_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
    upstreamTimeoutMs: intFromEnv(env.DSHW_UPSTREAM_TIMEOUT_MS, 'DSHW_UPSTREAM_TIMEOUT_MS', 8000, { min: 500, max: 60000 }),
    intervalMs: intFromEnv(env.DSHW_INTERVAL_MS, 'DSHW_INTERVAL_MS', 60000, { min: 1000, max: 3600000 }),
    // 写接口的额外放行地址，默认只有回环（对齐参考项目「配置改动只能来自本机」的边界）。
    adminHosts: listFromEnv(env.DSHW_ADMIN_HOSTS),
    widget: {
      scale: floatFromEnv(env.DSHW_SCALE, 'DSHW_SCALE', 1, { min: 0.5, max: 3 }),
      snapMode: env.DSHW_SNAP_MODE === 'px' ? 'px' : 'ratio',
      snapValue: floatFromEnv(env.DSHW_SNAP_VALUE, 'DSHW_SNAP_VALUE', 0.08, { min: 0, max: 500 }),
      mirrorOnLeft: env.DSHW_MIRROR_ON_LEFT !== '0',
      hideMenu: env.DSHW_HIDE_MENU === '1',
    },
    mockScript: script ? script.split(',').map((s) => s.trim()).filter(Boolean) : null,
    logLevel: env.DSHW_LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
  };
}
