// 余额观测记账：不依赖任何令牌，只看余额怎么动。
// 规则来自「余额下降＝消费、余额上升＝充值/赠金」这条口径：上升不能冲掉已累计的消费，
// 否则一次充值会把今天的用量清零。

function day(state) {
  return state.days[state.currentDay];
}

export function createLedger({ maxDays = 365, maxEntries = 20000 } = {}) {
  return {
    version: 1,
    currentDay: null,
    lastBalanceMicro: null,
    days: {},
    entries: [],
    maxDays,
    maxEntries,
  };
}

function openDay(state, dateKey, balanceMicro, at) {
  state.days[dateKey] = {
    dateKey,
    baselineMicro: balanceMicro,
    lastMicro: balanceMicro,
    spendMicro: 0n,
    adjustmentMicro: 0n,
    observations: 0,
    startedAt: at,
    updatedAt: at,
  };
  state.currentDay = dateKey;
}

function pushEntry(state, entry) {
  state.entries.push(entry);
  if (state.entries.length > state.maxEntries) {
    state.entries.splice(0, state.entries.length - state.maxEntries);
  }
}

/**
 * 记录一次余额观测。dateKey 由调用方给出（服务端用本地日期，避免时区在纯函数里打架）。
 * 返回 kind 让调用方决定要不要冒泡：baseline / unchanged / spend / adjustment / rollover。
 */
export function recordObservation(state, { dateKey, balanceMicro, at = 0 }) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new TypeError(`dateKey 需要 YYYY-MM-DD，收到 ${JSON.stringify(dateKey)}`);
  }
  if (typeof balanceMicro !== 'bigint') throw new TypeError('balanceMicro 需要 BigInt 微元');

  if (state.currentDay === null) {
    openDay(state, dateKey, balanceMicro, at);
    state.lastBalanceMicro = balanceMicro;
    return { state, kind: 'baseline', deltaMicro: 0n, day: day(state) };
  }

  if (dateKey !== state.currentDay) {
    // 跨天：新的一天从当前余额重新起算，昨天的累计原样保留。
    openDay(state, dateKey, balanceMicro, at);
    state.lastBalanceMicro = balanceMicro;
    pruneDays(state);
    return { state, kind: 'rollover', deltaMicro: 0n, day: day(state) };
  }

  const bucket = day(state);
  const deltaMicro = balanceMicro - bucket.lastMicro;
  bucket.lastMicro = balanceMicro;
  bucket.observations += 1;
  bucket.updatedAt = at;
  state.lastBalanceMicro = balanceMicro;

  if (deltaMicro < 0n) {
    const spent = -deltaMicro;
    bucket.spendMicro += spent;
    pushEntry(state, { at, dateKey, kind: 'spend', deltaMicro: spent, balanceMicro });
    return { state, kind: 'spend', deltaMicro: spent, day: bucket };
  }
  if (deltaMicro > 0n) {
    bucket.adjustmentMicro += deltaMicro;
    pushEntry(state, { at, dateKey, kind: 'adjustment', deltaMicro, balanceMicro });
    return { state, kind: 'adjustment', deltaMicro, day: bucket };
  }
  return { state, kind: 'unchanged', deltaMicro: 0n, day: bucket };
}

function pruneDays(state) {
  const keys = Object.keys(state.days).sort();
  while (keys.length > state.maxDays) {
    delete state.days[keys.shift()];
  }
}

export function todaySpendMicro(state, dateKey) {
  const key = dateKey ?? state.currentDay;
  if (!key || !state.days[key]) return 0n;
  return state.days[key].spendMicro;
}

export function totalSpendMicro(state) {
  let sum = 0n;
  for (const bucket of Object.values(state.days)) sum += bucket.spendMicro;
  return sum;
}

export function serializeLedger(state) {
  return {
    version: state.version,
    currentDay: state.currentDay,
    lastBalanceMicro: state.lastBalanceMicro === null ? null : String(state.lastBalanceMicro),
    maxDays: state.maxDays,
    maxEntries: state.maxEntries,
    days: Object.fromEntries(
      Object.entries(state.days).map(([key, b]) => [
        key,
        {
          ...b,
          baselineMicro: String(b.baselineMicro),
          lastMicro: String(b.lastMicro),
          spendMicro: String(b.spendMicro),
          adjustmentMicro: String(b.adjustmentMicro),
        },
      ]),
    ),
    entries: state.entries.map((e) => ({
      ...e,
      deltaMicro: String(e.deltaMicro),
      balanceMicro: String(e.balanceMicro),
    })),
  };
}

export function deserializeLedger(raw) {
  if (!raw || typeof raw !== 'object') return createLedger();
  const micro = (value) => (typeof value === 'bigint' ? value : BigInt(value ?? 0));
  const state = createLedger({ maxDays: raw.maxDays, maxEntries: raw.maxEntries });
  state.currentDay = typeof raw.currentDay === 'string' ? raw.currentDay : null;
  state.lastBalanceMicro = raw.lastBalanceMicro === null || raw.lastBalanceMicro === undefined
    ? null
    : micro(raw.lastBalanceMicro);
  for (const [key, b] of Object.entries(raw.days ?? {})) {
    state.days[key] = {
      dateKey: key,
      baselineMicro: micro(b.baselineMicro),
      lastMicro: micro(b.lastMicro),
      spendMicro: micro(b.spendMicro),
      adjustmentMicro: micro(b.adjustmentMicro),
      observations: Number(b.observations ?? 0),
      startedAt: Number(b.startedAt ?? 0),
      updatedAt: Number(b.updatedAt ?? 0),
    };
  }
  state.entries = Array.isArray(raw.entries)
    ? raw.entries.map((e) => ({ ...e, deltaMicro: micro(e.deltaMicro), balanceMicro: micro(e.balanceMicro) }))
    : [];
  return state;
}
