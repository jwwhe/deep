// mock provider：没有密钥也能把整个挂件跑起来（也是 E2E 的确定性数据源）。
// 脚本项支持 `!code` 表示这一拍模拟一次失败，用来验证「抖动沿用旧值」那条路径。
import { parseAmount } from '../../core/money.js';

const DEFAULT_START = '128.60';
const DEFAULT_STEP = '0.01';

export function createMockProvider({ script = null, start = DEFAULT_START, step = DEFAULT_STEP, now = () => Date.now() } = {}) {
  const sequence = (script ?? []).map((token) => String(token).trim()).filter(Boolean);
  const baseline = parseAmount(start);
  const stepMicro = parseAmount(step);
  let tick = 0;
  let pendingValue = null;
  let pendingFailure = null;

  function ok(balanceMicro) {
    return { ok: true, balanceMicro, currency: 'CNY', provider: 'mock', at: now() };
  }

  return {
    name: 'mock',

    async fetchBalance() {
      if (pendingFailure !== null) {
        const code = pendingFailure;
        pendingFailure = null;
        return { ok: false, code, message: `mock 模拟了一次失败（${code}）`, retryable: true };
      }
      if (pendingValue !== null) {
        const value = pendingValue;
        pendingValue = null;
        return ok(value);
      }
      if (sequence.length > 0) {
        const token = sequence[tick % sequence.length];
        tick += 1;
        if (token.startsWith('!')) {
          return { ok: false, code: token.slice(1) || 'timeout', message: `mock 按脚本模拟失败（${token}）`, retryable: true };
        }
        return ok(parseAmount(token));
      }
      // 无脚本：从起点缓慢下降，模拟持续调用扣费，方便肉眼看到数字滚动。
      tick += 1;
      return ok(baseline - stepMicro * BigInt(tick - 1));
    },

    /** 让下一次取数返回指定值：E2E 用它来钉住滚动动画的起止点。 */
    queueValue(value) {
      pendingValue = parseAmount(value);
      return pendingValue;
    },
    queueFailure(code = 'timeout') {
      pendingFailure = String(code);
    },
    reset() {
      tick = 0;
      pendingValue = null;
      pendingFailure = null;
    },
  };
}
