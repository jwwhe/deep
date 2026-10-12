// 余额轮询状态机：定时刷新 + 手动刷新 + 「抖动不报错」。
// 注入 fetcher / 时钟 / 定时器，因此在 Node 里可以用假时钟跑完整测试。

export const STATUS = {
  idle: 'idle',
  ok: 'ok',
  stale: 'stale',
  error: 'error',
  unconfigured: 'unconfigured',
};

const DEFAULTS = {
  intervalMs: 60_000,
  minRetryMs: 2_000,
  maxRetryMs: 30_000,
};

function normalizeResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, code: 'bad-provider-result', message: 'provider 未返回对象' };
  }
  if (result.ok && typeof result.balanceMicro !== 'bigint') {
    return { ok: false, code: 'bad-balance-type', message: `balanceMicro 需要 BigInt，收到 ${typeof result.balanceMicro}` };
  }
  return result;
}

export function createBalanceTracker(options = {}) {
  const {
    fetcher,
    intervalMs = DEFAULTS.intervalMs,
    minRetryMs = DEFAULTS.minRetryMs,
    maxRetryMs = DEFAULTS.maxRetryMs,
    now = () => Date.now(),
    schedule = (fn, ms) => setTimeout(fn, ms),
    unschedule = (handle) => clearTimeout(handle),
    logger = () => {},
  } = options;

  if (typeof fetcher !== 'function') throw new TypeError('createBalanceTracker 需要 fetcher 函数');

  const listeners = new Set();
  let state = {
    status: STATUS.idle,
    balanceMicro: null,
    currency: null,
    meta: null,
    updatedAt: null,
    error: null,
    stale: false,
    permanent: false,
    pending: false,
    consecutiveFailures: 0,
    refreshing: false,
  };
  let timer = null;
  let inFlight = null;
  let running = false;

  function notify(listener, current) {
    try {
      listener(current);
    } catch (err) {
      // 一个订阅者抛错不能带走整个挂件，也不能静默吞掉——记日志后继续。
      logger({ level: 'error', message: '余额监听器抛错', error: String(err?.message ?? err) });
    }
  }

  function publish(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) notify(listener, state);
    return state;
  }

  function nextDelay() {
    // 等宿主的第一个值时按最短间隔探路：整轮间隔干等会让挂件开机后一分钟才有数。
    if (state.pending) return Math.min(minRetryMs, intervalMs);
    // 配置类错误（没配 key）重试再快也不会自己变好，按正常间隔轮询即可。
    if (state.permanent || state.consecutiveFailures === 0) return intervalMs;
    const backoff = Math.min(maxRetryMs, minRetryMs * 2 ** (state.consecutiveFailures - 1));
    return Math.min(intervalMs, backoff);
  }

  function armNext() {
    if (!running) return;
    if (timer !== null) unschedule(timer);
    timer = schedule(() => {
      timer = null;
      refresh().catch(() => {});
    }, nextDelay());
    timer?.unref?.(); // 定时器不该拖住宿主进程退出
  }

  function failureOutcome(result) {
    const err = { code: result.code ?? 'unknown', message: result.message ?? '取数失败', status: result.status };
    // 「没配密钥」这类是配置状态而非网络抖动，要如实呈现，不能伪装成 stale。
    const permanent = result.status === STATUS.unconfigured;
    // 宿主明说「还没取过数」（刚启动、第一次取数在路上）时保持等待：拿到第一个值之前显示错误脸是误导。
    const waiting = result.status === STATUS.idle && state.balanceMicro === null;
    const hasKnown = state.balanceMicro !== null;
    publish({
      status: waiting ? STATUS.idle : permanent ? STATUS.unconfigured : hasKnown ? STATUS.stale : STATUS.error,
      stale: !permanent && !waiting && hasKnown,
      permanent,
      pending: waiting,
      error: err,
      consecutiveFailures: waiting ? state.consecutiveFailures : state.consecutiveFailures + 1,
      refreshing: false,
    });
    return { ok: false, error: err };
  }

  async function runFetch() {
    const result = normalizeResult(await fetcher());
    if (!result.ok) return failureOutcome(result);

    const changed = state.balanceMicro !== result.balanceMicro;
    publish({
      status: STATUS.ok,
      balanceMicro: result.balanceMicro,
      currency: result.currency ?? state.currency,
      // provider 可以附带宿主元信息（如今日已用），状态机原样透传，不解释其含义。
      meta: result.meta ?? null,
      updatedAt: now(),
      error: null,
      stale: false,
      permanent: false,
      pending: false,
      consecutiveFailures: 0,
      refreshing: false,
    });
    return { ok: true, changed, balanceMicro: result.balanceMicro };
  }

  /** 并发去重：手动点击和定时触发撞上同一次请求时，共用同一个 promise。 */
  function refresh() {
    if (inFlight) return inFlight;
    publish({ refreshing: true });
    inFlight = runFetch()
      .then((outcome) => {
        if (running) armNext();
        return outcome;
      })
      .catch((error) => {
        // provider 抛异常（而不是返回错误对象）也折算成一次失败，不能变成未捕获拒绝。
        const outcome = failureOutcome({ code: 'provider-throw', message: String(error?.message ?? error) });
        if (running) armNext();
        return outcome;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const tracker = {
    /** 立即取一次并排后续轮询；返回 tracker 便于链式调用。 */
    start() {
      running = true;
      refresh().catch(() => {});
      return tracker;
    },
    stop() {
      running = false;
      if (timer !== null) {
        unschedule(timer);
        timer = null;
      }
    },
    refresh,
    getState: () => state,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('subscribe 需要函数');
      listeners.add(listener);
      notify(listener, state);
      return () => listeners.delete(listener);
    },
  };
  return tracker;
}
