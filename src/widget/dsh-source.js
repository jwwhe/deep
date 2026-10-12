// 面向 DSH 宿主的取数适配：路径与字段名按参考项目的公开契约（/dsh-whale/balance.json 里的 totalBalance），
// 其余行为（退避、抖动沿用旧值、并发去重）与 createApiSource 共用同一份 balance.js 状态机。
import { createBalanceTracker, STATUS } from '../core/balance.js';
import { tryParseAmount } from '../core/money.js';

export function createDshSource({
  apiBase = '/dsh-whale',
  fetchImpl = globalThis.fetch,
  intervalMs = 60_000,
  timeoutMs = 10_000,
  logger = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createDshSource 需要可用的 fetch');

  async function getJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${apiBase}${path}`, {
        ...options,
        headers: { Accept: 'application/json', ...(options.headers ?? {}) },
        signal: controller.signal,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        return { ok: false, httpOk: response.ok, code: 'bad-json', message: `宿主返回的不是 JSON（HTTP ${response.status}）` };
      }
      return { ok: true, httpOk: response.ok, payload, status: response.status };
    } catch (error) {
      const aborted = error?.name === 'AbortError' || controller.signal.aborted;
      return { ok: false, code: aborted ? 'timeout' : 'network', message: aborted ? `${timeoutMs}ms 内没拿到余额` : `连不上宿主：${error?.message ?? error}` };
    } finally {
      clearTimeout(timer);
    }
  }

  async function readBalance() {
    const result = await getJson('/balance.json');
    if (!result.ok) return { ok: false, code: result.code, message: result.message, retryable: true };
    const payload = result.payload ?? {};
    if (payload.status === STATUS.unconfigured) {
      return { ok: false, code: payload.error?.code ?? 'no-api-key', message: payload.error?.message ?? '宿主未配置凭据', status: STATUS.unconfigured };
    }
    if (payload.stale) {
      return { ok: false, code: payload.error?.code ?? 'stale', message: payload.error?.message ?? '宿主暂时取不到数', retryable: true };
    }
    if (payload.status === STATUS.idle) {
      // 宿主机刚起来、第一次取数还没回来：这是等待，挂件这时显示灰脸会误导人。
      return { ok: false, code: 'pending', message: '宿主正在取第一次余额', retryable: true, status: STATUS.idle };
    }
    if (!result.httpOk || payload.ok === false) {
      return { ok: false, code: payload.error?.code ?? 'http-error', message: payload.error?.message ?? `宿主返回 HTTP ${result.status}` };
    }
    const micro = tryParseAmount(payload.totalBalance ?? payload.balance ?? '');
    if (micro === null) {
      return { ok: false, code: 'no-balance-field', message: '宿主响应里没有可用的 totalBalance 字段' };
    }
    return { ok: true, balanceMicro: micro, currency: payload.currency ?? 'CNY', meta: payload };
  }

  const tracker = createBalanceTracker({ fetcher: readBalance, intervalMs, logger });

  async function postSettings(patch) {
    const result = await getJson('/settings.json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    if (!result.ok) return { ok: false, code: result.code };
    if (!result.httpOk) return { ok: false, code: result.payload?.code ?? 'http-error', errors: result.payload?.errors, status: result.status };
    return { ok: true, settings: result.payload?.settings };
  }

  async function refreshNow() {
    const result = await getJson('/refresh.json', { method: 'POST' });
    return { ok: result.ok && result.httpOk, code: result.ok ? null : result.code };
  }

  return { tracker, postSettings, refreshNow, readBalance };
}
