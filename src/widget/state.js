// 客户端取数：复用与宿主同一份 balance.js 状态机，
// 于是「抖动沿用旧值 / 退避 / 并发去重」这些规则只有一份实现。
import { createBalanceTracker, STATUS } from '../core/balance.js';

export function createApiSource({
  apiBase = '/api',
  fetchImpl = globalThis.fetch,
  intervalMs = 60_000,
  timeoutMs = 10_000,
  logger = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createApiSource 需要可用的 fetch');
  }

  async function readState() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${apiBase}/state`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    } catch (error) {
      const aborted = error?.name === 'AbortError' || controller.signal.aborted;
      return { ok: false, code: aborted ? 'timeout' : 'network', message: aborted ? `${timeoutMs}ms 内没拿到状态` : `连不上宿主服务：${error?.message ?? error}`, retryable: true };
    } finally {
      clearTimeout(timer);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, code: 'bad-json', message: `宿主返回的不是 JSON（HTTP ${response.status}）`, retryable: false };
    }
    if (!response.ok) {
      return { ok: false, code: 'http-error', message: `宿主返回 HTTP ${response.status}`, retryable: response.status >= 500 };
    }
    // 宿主把「没配密钥」这类配置状态如实报上来，客户端原样转成 permanent 失败。
    if (payload.status === STATUS.unconfigured) {
      return { ok: false, code: payload.error?.code ?? 'no-api-key', message: payload.error?.message ?? '未配置 DEEPSEEK_API_KEY', status: STATUS.unconfigured };
    }
    if (payload.status === STATUS.stale) {
      // 宿主自己也在用最近一次余额：客户端同样按「抖动」处理，保留旧值并标 stale。
      return { ok: false, code: payload.error?.code ?? 'stale', message: payload.error?.message ?? '宿主暂时取不到数', retryable: true };
    }
    if (payload.balanceMicro === null || payload.balanceMicro === undefined) {
      // 宿主刚启动、第一次取数还在路上：这是等待而不是失败，让挂件保持中性显示。
      const waiting = payload.status === STATUS.idle;
      return {
        ok: false,
        code: waiting ? 'pending' : 'no-data',
        message: payload.error?.message ?? (waiting ? '宿主正在取第一次余额' : '宿主还没有取到余额'),
        retryable: true,
        status: waiting ? STATUS.idle : undefined,
      };
    }
    return { ok: true, balanceMicro: BigInt(payload.balanceMicro), currency: payload.currency, meta: payload };
  }

  const tracker = createBalanceTracker({ fetcher: readState, intervalMs, logger });

  async function postSettings(patch) {
    const response = await fetchImpl(`${apiBase}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch((error) => {
      logger(`保存设置失败：${error?.message ?? error}`);
      return null;
    });
    if (!response) return { ok: false, code: 'network' };
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* 空响应体按失败处理 */
    }
    if (!response.ok) return { ok: false, code: payload?.code ?? 'http-error', errors: payload?.errors, status: response.status };
    return { ok: true, settings: payload.settings, ignored: payload.ignored };
  }

  async function refreshNow() {
    const response = await fetchImpl(`${apiBase}/refresh`, { method: 'POST' }).catch(() => null);
    if (!response) return { ok: false, code: 'network' };
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, payload };
  }

  return { tracker, postSettings, refreshNow, readState };
}
