// 定点金额：以 1e-8 元为最小单位用 BigInt 表示，避免浮点误差在累加时漂移。
export const SCALE_DECIMALS = 8;
export const SCALE = 100000000n;

const DECIMAL_RE = /^([+-]?)(?:(\d+))?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function shiftDigits(intDigits, fracDigits, exponent) {
  // 把小数点整体右移 exponent 位：先拼成纯数字串，再按新的小数点位置切开。
  let all = intDigits + fracDigits;
  let pointPos = intDigits.length + exponent;
  if (pointPos <= 0) {
    all = '0'.repeat(1 - pointPos) + all;
    pointPos = 1;
  } else if (pointPos > all.length) {
    all += '0'.repeat(pointPos - all.length);
  }
  return { int: all.slice(0, pointPos) || '0', frac: all.slice(pointPos) };
}

/**
 * 把上游返回的金额（字符串 / 数字 / BigInt）解析成定点整数微元。
 * 超出 8 位小数按 half-up 收敛，因为记账差值必须可复现。
 */
export function parseAmount(value) {
  if (value === null || value === undefined) {
    throw new TypeError('金额不能为空');
  }
  if (typeof value === 'bigint') return value * SCALE;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`金额不是有限数: ${value}`);
    if (Math.abs(value) >= 1e21) throw new RangeError(`金额超出可安全转换的范围: ${value}`);
    return parseAmount(value.toFixed(12));
  }
  if (typeof value !== 'string') throw new TypeError(`不支持的金额类型: ${typeof value}`);

  const text = value.trim();
  const match = DECIMAL_RE.exec(text);
  if (!match || (!match[2] && !match[3])) throw new TypeError(`无法解析的金额: ${JSON.stringify(value)}`);
  const [, sign, intDigits = '', fracDigits = '', expPart] = match;
  const exponent = expPart ? Number(expPart) : 0;
  const { int, frac } = shiftDigits(intDigits, fracDigits, exponent);

  const fracPadded = frac.padEnd(SCALE_DECIMALS + 1, '0');
  const kept = fracPadded.slice(0, SCALE_DECIMALS);
  const roundup = Number(fracPadded[SCALE_DECIMALS] ?? 0) >= 5;

  let micro = BigInt(int || '0') * SCALE + BigInt(kept || '0');
  if (roundup) micro += 1n;
  return sign === '-' ? -micro : micro;
}

export function tryParseAmount(value) {
  try {
    return parseAmount(value);
  } catch {
    return null;
  }
}

export function formatAmount(micro, { decimals = 2, sign = 'auto' } = {}) {
  if (typeof micro !== 'bigint') throw new TypeError('formatAmount 需要 BigInt 微元');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > SCALE_DECIMALS) {
    throw new RangeError(`decimals 必须在 0..${SCALE_DECIMALS} 之间`);
  }
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const divisor = 10n ** BigInt(SCALE_DECIMALS - decimals);
  const rounded = (abs + divisor / 2n) / divisor; // half-up，正数域内等价
  // 补零到「至少一位整数」，0.5 元才不会被显示成 ".50"。
  const text = rounded.toString().padStart(decimals + 1, '0');
  const cut = text.length - decimals;
  const whole = text.slice(0, cut);
  const frac = text.slice(cut);
  const body = decimals > 0 ? `${whole}.${frac}` : whole;
  if (negative) return `-${body}`;
  if (sign === 'always') return `+${body}`;
  return body;
}

export function addAmount(a, b) {
  return a + b;
}

/**
 * 把「字段值 + 单位乘数」换算成微元。乘数允许小数（如「分」计费的 0.01），
 * 因此也走定点：先解析成微元，再按微元比例乘算并 half-up 收敛。
 */
export function toMicroUnits(value, scale = 1) {
  const micro = parseAmount(value);
  const scaleMicro = parseAmount(scale);
  if (scaleMicro === 0n) return 0n;
  const product = micro * scaleMicro;
  const half = SCALE / 2n;
  return product >= 0n ? (product + half) / SCALE : -((-product + half) / SCALE);
}

/**
 * 数字滚动动画的帧序列：缓出插值，首帧为起点、末帧严格等于终点。
 * 纯函数，前端只负责按帧写 DOM。
 */
export function rollingFrames(fromMicro, toMicro, frames = 28) {
  if (!Number.isInteger(frames) || frames < 1) throw new RangeError('frames 必须是正整数');
  const out = [];
  const delta = toMicro - fromMicro;
  if (delta === 0n) return [toMicro];
  for (let i = 1; i <= frames; i += 1) {
    const t = i / frames;
    const eased = 1 - (1 - t) ** 3;
    if (i === frames) {
      out.push(toMicro);
      continue;
    }
    // BigInt 只能做整数运算，用千分精度插值再缩放回去。
    const step = (delta * 1000n * BigInt(Math.round(eased * 1000))) / 1000000n;
    out.push(fromMicro + step / 1000n);
  }
  return out;
}
