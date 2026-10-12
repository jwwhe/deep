import test from 'node:test';
import assert from 'node:assert/strict';
import { createBalanceTracker, STATUS } from '../src/core/balance.js';
import { parseAmount } from '../src/core/money.js';

const m = parseAmount;

/** 假时钟：把 60 秒轮询与退避变成可断言的确定性测试。 */
function makeClock() {
  let nowMs = 1_000;
  const queue = [];
  let seq = 0;
  return {
    now: () => nowMs,
    schedule(fn, ms) {
      const handle = { id: ++seq, at: nowMs + ms, ms, fn };
      queue.push(handle);
      return handle;
    },
    unschedule(handle) {
      const i = queue.indexOf(handle);
      if (i >= 0) queue.splice(i, 1);
    },
    async advance(ms) {
      nowMs += ms;
      const due = queue.filter((t) => t.at <= nowMs).sort((a, b) => a.at - b.at);
      for (const t of due) {
        queue.splice(queue.indexOf(t), 1);
        t.fn();
        // 定时回调里的 fetcher 是 async，让微任务跑完再判断状态
        for (let i = 0; i < 4; i += 1) await Promise.resolve();
      }
    },
    pending: () => queue.length,
    /** 最早排定的那次延时，用来直接断言退避档位。 */
    peek: () => (queue.length === 0 ? null : Math.min(...queue.map((t) => t.ms))),
  };
}

function trackerWith(fetcher, extra = {}) {
  const clock = makeClock();
  const tracker = createBalanceTracker({
    fetcher,
    now: clock.now,
    schedule: clock.schedule,
    unschedule: clock.unschedule,
    ...extra,
  });
  return { tracker, clock };
}

const ok = (value, currency = 'CNY') => ({ ok: true, balanceMicro: m(value), currency });
const fail = (code = 'timeout', message = '上游超时', status) => ({ ok: false, code, message, status });

/** start() 返回 tracker（链式用），首轮取数靠 refresh() 复用在途请求来 await。 */
async function started(tracker) {
  tracker.start();
  return tracker.refresh();
}

test('首次取数成功进入 ok 并按间隔排下一次', async () => {
  let calls = 0;
  const { tracker, clock } = trackerWith(async () => { calls += 1; return ok('10.00'); }, { intervalMs: 60_000 });
  await started(tracker);

  const state = tracker.getState();
  assert.equal(state.status, STATUS.ok);
  assert.equal(state.balanceMicro, m('10.00'));
  assert.equal(state.error, null);
  assert.equal(calls, 1, 'start 后紧跟的 refresh 必须复用同一次请求');
  assert.equal(clock.peek(), 60_000, '应当按 intervalMs 排下一次');

  await clock.advance(60_000);
  assert.equal(calls, 2);
  tracker.stop();
});

test('stop 之后不再有轮询', async () => {
  const { tracker, clock } = trackerWith(async () => ok('1'));
  await started(tracker);
  tracker.stop();
  assert.equal(clock.pending(), 0);
  await clock.advance(180_000);
  assert.equal(clock.pending(), 0);
});

test('已有余额时网络抖动沿用旧值、只标 stale 不报 error', async () => {
  let mode = 'ok';
  const { tracker } = trackerWith(async () => (mode === 'fail' ? fail() : ok('88.8')));
  await tracker.refresh();
  mode = 'fail';
  const out = await tracker.refresh();
  assert.equal(out.ok, false);
  const state = tracker.getState();
  assert.equal(state.status, STATUS.stale);
  assert.equal(state.balanceMicro, m('88.8'), '抖动期间余额不能清空');
  assert.equal(state.stale, true);
  assert.equal(state.error.code, 'timeout');
});

test('从未取到过数时才以 error 呈现', async () => {
  const { tracker } = trackerWith(async () => fail('network', '连不上'));
  const out = await tracker.refresh();
  assert.equal(out.ok, false);
  assert.equal(tracker.getState().status, STATUS.error);
  assert.equal(tracker.getState().balanceMicro, null);
});

test('未配置密钥是配置状态：如实呈现且不快速重试', async () => {
  const { tracker, clock } = trackerWith(async () => fail('no-key', '未配置 DEEPSEEK_API_KEY', STATUS.unconfigured), {
    intervalMs: 60_000,
  });
  await started(tracker);
  const state = tracker.getState();
  assert.equal(state.status, STATUS.unconfigured);
  assert.equal(state.permanent, true);
  assert.equal(state.stale, false);
  assert.equal(clock.peek(), 60_000, '配置类错误不该进退避快重试');
});

test('provider 抛异常按一次失败处理，不会变成未捕获拒绝', async () => {
  const { tracker } = trackerWith(async () => { throw new Error('boom'); });
  const out = await tracker.refresh();
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'provider-throw');
  assert.match(out.error.message, /boom/);
  assert.equal(tracker.getState().consecutiveFailures, 1);
});

test('连续失败按 2s/4s/8s… 退避，封顶 maxRetryMs 且不超过间隔', async () => {
  const { tracker, clock } = trackerWith(async () => fail(), {
    intervalMs: 60_000,
    minRetryMs: 2_000,
    maxRetryMs: 30_000,
  });
  await started(tracker);
  assert.equal(clock.peek(), 2_000);
  await clock.advance(2_000);
  assert.equal(tracker.getState().consecutiveFailures, 2);
  assert.equal(clock.peek(), 4_000);
  await clock.advance(4_000);
  assert.equal(clock.peek(), 8_000);
  await clock.advance(8_000);
  assert.equal(clock.peek(), 16_000);
  await clock.advance(16_000);
  assert.equal(clock.peek(), 30_000, '2000×2^4=32000 应被压到 maxRetryMs');
  await clock.advance(29_999);
  assert.equal(tracker.getState().consecutiveFailures, 5, '没到点不该触发');
  await clock.advance(30_000);
  assert.equal(tracker.getState().consecutiveFailures, 6);
});

test('取数成功后失败计数归零', async () => {
  let broken = true;
  const { tracker, clock } = trackerWith(async () => (broken ? fail() : ok('5')));
  await started(tracker);
  assert.equal(tracker.getState().consecutiveFailures, 1);
  broken = false;
  await tracker.refresh();
  assert.equal(tracker.getState().consecutiveFailures, 0);
  assert.equal(tracker.getState().status, STATUS.ok);
  assert.equal(clock.peek(), 60_000);
});

test('并发刷新共用同一次请求', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { tracker } = trackerWith(async () => { calls += 1; await gate; return ok('1'); });
  const a = tracker.refresh();
  const b = tracker.refresh();
  assert.equal(b, a, '应当复用同一个 promise');
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});

test('订阅者收到状态推送、能退订，别的订阅者抛错不影响它', async () => {
  const { tracker } = trackerWith(async () => ok('3.00'));
  const seen = [];
  const unsubscribe = tracker.subscribe((s) => seen.push(s));
  tracker.subscribe(() => { throw new Error('监听器炸了'); });
  await tracker.refresh();

  assert.equal(seen[0].status, STATUS.idle, '订阅时立刻给一次当前状态');
  assert.equal(seen.at(-1).status, STATUS.ok);
  assert.ok(seen.some((s) => s.refreshing === true), '刷新中应当推送 refreshing=true');

  const count = seen.length;
  unsubscribe();
  await tracker.refresh();
  assert.equal(seen.length, count, '退订后不应再收到推送');
});

test('provider 返回非法结构按失败处理', async () => {
  const { tracker } = trackerWith(async () => ({ ok: true, balanceMicro: 12.34 }));
  const out = await tracker.refresh();
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'bad-balance-type');
  const none = trackerWith(async () => null);
  assert.equal((await none.tracker.refresh()).error.code, 'bad-provider-result');
});

test('缺少 fetcher 直接抛错', () => {
  assert.throws(() => createBalanceTracker({}), TypeError);
  assert.throws(() => createBalanceTracker({ fetcher: async () => ok('1') }).subscribe('nope'), TypeError);
});
