// DSH 账号服务的余额归并：它回的是「充值钱包 + 赠送钱包」两组按币种分行的十进制字符串。
// 官网和官方设置页把这两笔钱分成「余额」「赠送余额」两行，从不相加；挂件默认跟着这个口径，
// 只显示充值钱包，赠送金额作为次级信息单独返回（includeBonus: true 才合并成一个总数）。
// 金额一律先转微元再相加，避免浮点把两位小数的账算成对不上的数。
import { tryParseAmount } from './money.js';
import { STATUS } from './balance.js';

/** 把一组钱包按币种累加；任何一行解析不了就整批作废，拿半截数据凑出来的余额比不显示更容易误导人。 */
function sumWallets(list) {
  const byCurrency = new Map();
  let rows = 0;
  for (const wallet of list) {
    const micro = tryParseAmount(wallet && wallet.balance);
    if (micro === null) {
      return {
        error: {
          ok: false,
          code: 'bad-wallet-amount',
          message: `钱包金额无法解析：${String(wallet && wallet.balance).slice(0, 40)}`,
          retryable: false,
        },
      };
    }
    const currency = (wallet && wallet.currency) || 'CNY';
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0n) + micro);
    rows += 1;
  }
  return { byCurrency, rows };
}

/**
 * @param {object|null} result 账号服务 getBalance 的返回：{status:'ready', value, bonusWallets} / {status:'failed'} / null
 * @param {object} [options]
 * @param {boolean} [options.includeBonus] 赠送钱包是否计入显示总额，默认 false（与官网「余额」行一致）
 * @returns {object} tracker 认得的取数结果对象；meta 里带 paid/bonus/total 三个分项，供展示与记账各自取用
 */
export function mergeWallets(result, { includeBonus = false } = {}) {
  // 未登录与上游失败必须分开：前者是配置状态（挂件显示「未配置」），后者是抖动（沿用旧值并标 stale）。
  if (result === null || result === undefined) {
    return { ok: false, code: 'not-signed-in', message: '宿主没有登录 DeepSeek 账号', status: STATUS.unconfigured };
  }
  if (result.status !== 'ready') {
    return { ok: false, code: 'account-balance-failed', message: '账号服务取余额失败', retryable: true };
  }

  const paid = sumWallets(Array.isArray(result.value) ? result.value : []);
  if (paid.error) return paid.error;
  const bonus = sumWallets(Array.isArray(result.bonusWallets) ? result.bonusWallets : []);
  if (bonus.error) return bonus.error;

  if (paid.rows + bonus.rows === 0) {
    return { ok: false, code: 'empty-wallets', message: '账号服务返回的钱包列表是空的', retryable: true };
  }

  const totalOf = (currency) => (paid.byCurrency.get(currency) ?? 0n) + (bonus.byCurrency.get(currency) ?? 0n);
  const currencies = [...new Set([...paid.byCurrency.keys(), ...bonus.byCurrency.keys()])];
  let currency = currencies[0];
  let note;
  if (currencies.length > 1) {
    // 现实中一个账号只属于一个区域；多币种同时出现说明上游形状变了。取金额最大的一族，其余写进 note 让人能查。
    currencies.sort((a, b) => (totalOf(a) < totalOf(b) ? 1 : totalOf(a) > totalOf(b) ? -1 : 0));
    currency = currencies[0];
    const hidden = currencies.slice(1).filter((c) => totalOf(c) > 0n);
    if (hidden.length > 0) {
      note = `出现多币种钱包，只显示 ${currency}，忽略 ${hidden.map((c) => `${c}=${totalOf(c)}`).join('、')}`;
    }
  }

  const paidMicro = paid.byCurrency.get(currency) ?? 0n;
  const bonusMicro = bonus.byCurrency.get(currency) ?? 0n;
  const shown = {
    ok: true,
    balanceMicro: includeBonus ? paidMicro + bonusMicro : paidMicro,
    currency,
    meta: { paidMicro, bonusMicro, totalMicro: paidMicro + bonusMicro, includeBonus },
  };
  if (note) shown.note = note;
  return shown;
}
