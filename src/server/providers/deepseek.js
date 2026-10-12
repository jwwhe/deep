// DeepSeek 余额 provider：只把密钥发往配置里写死的端点，且对上游的各种返回形态做显式分类。
// 实测：无 key 时上游回的是纯文本 `Authentication Fails (governor)` + 401，所以 JSON.parse 失败是常态而非异常。
import { extractValue } from '../../core/jsonpath.js';
import { toMicroUnits } from '../../core/money.js';
import { STATUS } from '../../core/balance.js';

// 官方两种历史响应结构，按顺序取第一个能解析出来的字段。
export const BALANCE_FIELDS = ['total_balance', 'balance_infos[0].total_balance', 'balance_units[0].amount'];

export function pickBalance(json) {
  for (const path of BALANCE_FIELDS) {
    const found = extractValue(json, { path, currencyPath: 'balance_infos[0].currency' });
    if (!found.ok) continue;
    try {
      return { balanceMicro: toMicroUnits(found.value, 1), currency: found.currency ?? 'CNY', matchedPath: path };
    } catch {
      return { error: { code: 'bad-amount', message: `字段 ${path} 不是可解析的金额` } };
    }
  }
  return { error: { code: 'field-not-found', message: `响应里找不到余额字段（试过 ${BALANCE_FIELDS.join(', ')}）` } };
}

export function classifyStatus(status, bodyText) {
  if (status === 401 || status === 403) {
    return { code: 'auth-failed', message: '密钥被拒绝（401/403）', retryable: false };
  }
  if (status === 402) return { code: 'insufficient', message: '账户余额不足或欠费（402）', retryable: false };
  if (status === 429) return { code: 'rate-limited', message: '请求过于频繁（429）', retryable: true };
  if (status >= 500) return { code: 'upstream-5xx', message: `上游异常（HTTP ${status}）`, retryable: true };
  return { code: 'http-error', message: `上游返回 HTTP ${status}${bodyText ? `：${truncate(bodyText)}` : ''}`, retryable: false };
}

function truncate(text, max = 160) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.baseUrl
 * @param {number} options.timeoutMs
 * @param {typeof fetch} options.fetchImpl
 */
export function createDeepSeekProvider({ apiKey, baseUrl, timeoutMs = 8000, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  return async function fetchBalance() {
    if (!apiKey) {
      return { ok: false, code: 'no-api-key', message: '未配置 DEEPSEEK_API_KEY', status: STATUS.unconfigured };
    }
    if (typeof fetchImpl !== 'function') {
      return { ok: false, code: 'no-fetch', message: '当前运行时没有 fetch', status: STATUS.unconfigured };
    }

    const controller = new AbortController();
    // 这个超时不能 unref：一旦事件循环空闲它就永不触发，请求会永远挂在那里。
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/user/balance`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError' || controller.signal.aborted;
      return {
        ok: false,
        code: aborted ? 'timeout' : 'network',
        message: aborted ? `上游 ${timeoutMs}ms 内没有响应` : `请求上游失败：${error?.message ?? error}`,
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }

    const bodyText = await response.text().catch(() => '');
    if (!response.ok) {
      const classified = classifyStatus(response.status, bodyText);
      return { ok: false, ...classified, httpStatus: response.status };
    }

    let json;
    try {
      json = JSON.parse(bodyText);
    } catch {
      return { ok: false, code: 'bad-json', message: `上游返回的不是 JSON：${truncate(bodyText)}`, retryable: false };
    }
    if (!json || typeof json !== 'object') {
      return { ok: false, code: 'bad-json', message: '上游返回的 JSON 不是对象', retryable: false };
    }
    // is_available:false 表示账户侧当前不给余额（欠费/未实名等），不是网络问题。
    if (json.is_available === false) {
      return { ok: false, code: 'balance-unavailable', message: '上游标记余额不可用（is_available=false）', retryable: true };
    }

    const picked = pickBalance(json);
    if (picked.error) return { ok: false, ...picked.error, retryable: false };
    return { ok: true, balanceMicro: picked.balanceMicro, currency: picked.currency, matchedPath: picked.matchedPath, at: now() };
  };
}
