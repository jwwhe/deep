import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSnap, snapZonePx, restingPosition, clamp } from '../src/core/layout.js';

const BASE = { width: 120, height: 120, viewportWidth: 1000, viewportHeight: 800 };

test('clamp 处理 min>max 的退化区间', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
  assert.equal(clamp(3, 10, 0), 10);
});

test('snapZonePx 支持比例与像素两种模式', () => {
  assert.equal(snapZonePx({ mode: 'ratio', value: 0.1 }, 1000), 100);
  assert.equal(snapZonePx({ mode: 'px', value: 64 }, 1000), 64);
  // 窗口很窄时按比例会算出比 minPx 更小的吸附区，取 minPx 兜底
  assert.equal(snapZonePx({ mode: 'ratio', value: 0.08, minPx: 24 }, 200), 24);
  assert.equal(snapZonePx({}, 1000), 80); // 默认 0.08
});

test('贴右吸附、贴左吸附并镜像', () => {
  const right = resolveSnap({ ...BASE, x: 900, y: 400, snap: { enabled: true } });
  assert.equal(right.horizontal, 'right');
  assert.equal(right.x, 880); // viewportWidth - width
  assert.equal(right.mirrored, false);

  const left = resolveSnap({ ...BASE, x: 5, y: 400, snap: { enabled: true } });
  assert.equal(left.horizontal, 'left');
  assert.equal(left.x, 0);
  assert.equal(left.mirrored, true);

  const noMirror = resolveSnap({ ...BASE, x: 5, y: 400, snap: { enabled: true }, mirrorOnLeft: false });
  assert.equal(noMirror.mirrored, false);
});

test('角落组合：右下同时吸水平边和垂直边', () => {
  const corner = resolveSnap({ ...BASE, x: 950, y: 750, snap: { enabled: true } });
  assert.equal(corner.horizontal, 'right');
  assert.equal(corner.vertical, 'bottom');
  assert.deepEqual({ x: corner.x, y: corner.y }, { x: 880, y: 680 });
});

test('allowCorners=false 时角落退回单边', () => {
  const edgeOnly = resolveSnap({ ...BASE, x: 950, y: 750, snap: { enabled: true, allowCorners: false } });
  assert.equal(edgeOnly.horizontal, 'right');
  assert.equal(edgeOnly.vertical, 'none');
  assert.equal(edgeOnly.y, 680); // 仍被夹在视口内，只是不吸底
});

test('关闭吸附只做边界收敛，保留自由摆放', () => {
  const free = resolveSnap({ ...BASE, x: 400, y: 300, snap: { enabled: false } });
  assert.deepEqual({ x: free.x, y: free.y, horizontal: free.horizontal }, { x: 400, y: 300, horizontal: 'none' });

  const oob = resolveSnap({ ...BASE, x: 5000, y: -200, snap: { enabled: false } });
  assert.deepEqual({ x: oob.x, y: oob.y }, { x: 880, y: 0 });
});

test('中间位置不吸附', () => {
  const mid = resolveSnap({ ...BASE, x: 500, y: 400, snap: { enabled: true } });
  assert.equal(mid.horizontal, 'none');
  assert.equal(mid.vertical, 'none');
  assert.equal(mid.x, 500);
});

test('视口小于挂件时不出现负坐标', () => {
  const tiny = resolveSnap({ width: 120, height: 120, viewportWidth: 100, viewportHeight: 90, x: 80, y: 80, snap: { enabled: true } });
  assert.equal(tiny.x, 0);
  assert.equal(tiny.y, 0);
});

test('resolveSnap 拒绝非有限数字', () => {
  assert.throws(() => resolveSnap({ ...BASE, x: NaN, snap: {} }), TypeError);
  assert.throws(() => resolveSnap({ ...BASE, x: 1, y: undefined, snap: {} }), TypeError);
});

test('restingPosition 默认右下、可切左上，并留出边距', () => {
  const br = restingPosition({ ...BASE, margin: 16 });
  assert.deepEqual(br, { x: 1000 - 120 - 16, y: 800 - 120 - 16 });
  assert.deepEqual(restingPosition({ ...BASE, margin: 16, resting: 'top-left' }), { x: 16, y: 16 });
  assert.deepEqual(restingPosition({ ...BASE, margin: 16, resting: 'top' }), { x: 864, y: 16 });
});

test('restingPosition 对缺字段直接抛错，不产出 NaN 位置', () => {
  // 曾经把视口尺寸写成 width/height，NaN 渗进 style.top 后挂件跑到视口外且毫无报错。
  assert.throws(() => restingPosition({ width: 120, height: 120, margin: 16 }), /需要有限数字/);
});

// —— margin 内缩：静置与吸附必须用同一套边距，否则 resize 一次鲸鱼就凭空往里跳 ——

test('带 margin 时四条边的吸附目标一起内缩', () => {
  const right = resolveSnap({ ...BASE, margin: 16, x: 900, y: 400, snap: { enabled: true } });
  assert.deepEqual({ x: right.x, edge: right.horizontal }, { x: 864, edge: 'right' });

  const left = resolveSnap({ ...BASE, margin: 16, x: 2, y: 400, snap: { enabled: true } });
  assert.deepEqual({ x: left.x, edge: left.horizontal }, { x: 16, edge: 'left' });

  const top = resolveSnap({ ...BASE, margin: 16, x: 400, y: 3, snap: { enabled: true } });
  assert.equal(top.y, 16);

  const corner = resolveSnap({ ...BASE, margin: 16, x: 950, y: 780, snap: { enabled: true } });
  assert.deepEqual({ x: corner.x, y: corner.y }, { x: 864, y: 664 });
});

test('静置位重算一次不会漂到贴边（真实故障：margin 16 落在吸附区内）', () => {
  const rest = restingPosition({ ...BASE, margin: 16 });
  assert.deepEqual(rest, { x: 864, y: 664 });
  // 以前这里传的是 margin=0，静置位被吸成 x=880：窗口一改尺寸挂件就往里跳。
  const again = resolveSnap({
    ...BASE, margin: 16, x: rest.x, y: rest.y,
    snap: { enabled: true, mode: 'ratio', value: 0.08 },
  });
  assert.deepEqual({ x: again.x, y: again.y }, rest);
  assert.equal(again.horizontal, 'right');
  assert.equal(again.vertical, 'bottom');
});

test('视口比挂件还小时，margin 不会把挂件推出屏幕', () => {
  const tiny = resolveSnap({ width: 120, height: 120, viewportWidth: 100, viewportHeight: 90, margin: 16, x: 5, y: 5, snap: { enabled: true } });
  assert.equal(tiny.x, 0);
  assert.equal(tiny.y, 0);
  assert.equal(tiny.horizontal, 'left');
});

test('resolveSnap 拒绝非有限的 margin', () => {
  assert.throws(() => resolveSnap({ ...BASE, x: 10, y: 10, margin: NaN, snap: {} }), /margin/);
});

