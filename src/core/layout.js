// 拖拽后的吸附判定：纯几何，不碰 DOM，方便把「贴左镜像」这类规则单测钉住。

export const EDGES = { none: 'none', left: 'left', right: 'right', top: 'top', bottom: 'bottom' };

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 吸附区宽度（像素）。比例模式下再垫一个最小值，否则窗口一窄吸附区就小到拖不进去。
 */
export function snapZonePx(snap, viewportSize) {
  const mode = snap?.mode ?? 'ratio';
  if (mode === 'px') return Math.max(0, num(snap?.value, 48));
  const ratio = clamp(num(snap?.value, 0.08), 0, 0.5);
  return Math.max(num(snap?.minPx, 24), Math.round(viewportSize * ratio));
}

/**
 * 把松手坐标收敛到视口内，并按四边（可组合成角落）吸附。
 * snap.enabled=false 时只做边界收敛，保留自由摆放。
 * 贴左时按 mirrorOnLeft 决定是否水平镜像（文字反向由前端 transform 处理）。
 *
 * margin 是「离视口边缘至少留多少」，默认 0 保持纯贴边。传了它，四条边的吸附目标
 * 就一起内缩：否则静置位（留了 margin）只要被 resize 触发一次重算，就会被吸成贴边，
 * 挂件凭空往里跳 16px。
 */
export function resolveSnap(input) {
  const {
    x,
    y,
    width,
    height,
    viewportWidth,
    viewportHeight,
    margin = 0,
    snap = {},
    mirrorOnLeft = true,
  } = input;

  for (const [name, value] of Object.entries({ x, y, width, height, viewportWidth, viewportHeight, margin })) {
    if (!Number.isFinite(value)) throw new TypeError(`resolveSnap 需要有限数字，${name}=${value}`);
  }

  const maxX = Math.max(0, viewportWidth - width - margin);
  const maxY = Math.max(0, viewportHeight - height - margin);
  // 视口比挂件还小时，左边/上边的目标不能真按 margin 走，否则又被推出屏幕。
  const leftX = Math.min(Math.max(0, margin), Math.max(0, viewportWidth - width));
  const topY = Math.min(Math.max(0, margin), Math.max(0, viewportHeight - height));
  let nextX = clamp(x, 0, maxX);
  let nextY = clamp(y, 0, maxY);

  if (snap.enabled === false) {
    return { x: nextX, y: nextY, horizontal: EDGES.none, vertical: EDGES.none, mirrored: false };
  }

  const zoneX = snapZonePx(snap, viewportWidth);
  const zoneY = snapZonePx(snap, viewportHeight);

  let horizontal = EDGES.none;
  if (nextX <= zoneX) {
    horizontal = EDGES.left;
    nextX = leftX;
  } else if (nextX >= maxX - zoneX) {
    horizontal = EDGES.right;
    nextX = maxX;
  }

  let vertical = EDGES.none;
  if (nextY <= zoneY) {
    vertical = EDGES.top;
    nextY = topY;
  } else if (nextY >= maxY - zoneY) {
    vertical = EDGES.bottom;
    nextY = maxY;
  }

  if (snap.allowCorners === false && horizontal !== EDGES.none && vertical !== EDGES.none) {
    // 只允许单边吸附时，优先水平边（贴左右是主用途），回到该边的默认纵位。
    vertical = EDGES.none;
    nextY = clamp(y, 0, maxY);
  }

  const mirrored = horizontal === EDGES.left && mirrorOnLeft;
  return { x: nextX, y: nextY, horizontal, vertical, mirrored };
}

/** 初始挂载位置：默认右下角，留出 margin。 */
export function restingPosition(input) {
  const { viewportWidth, viewportHeight, width, height, margin = 16, resting = 'bottom-right' } = input;
  // 与 resolveSnap 同一套契约：传错键名要立刻炸，不能让 NaN 渗进 style 变成"挂件看不见"这种最难查的故障。
  for (const [name, value] of Object.entries({ viewportWidth, viewportHeight, width, height, margin })) {
    if (!Number.isFinite(value)) throw new TypeError(`restingPosition 需要有限数字，${name}=${value}`);
  }
  const maxX = Math.max(0, viewportWidth - width - margin);
  const maxY = Math.max(0, viewportHeight - height - margin);
  const [vertical, horizontal = vertical] = String(resting).split('-');
  const anchorY = vertical === 'top' ? margin : maxY;
  const anchorX = horizontal === 'left' ? margin : maxX;
  return { x: clamp(anchorX, 0, Math.max(0, viewportWidth - width)), y: clamp(anchorY, 0, Math.max(0, viewportHeight - height)) };
}

/**
 * 控件层（☰ 按钮与设置面板）的贴位。
 *
 * 挂件本体靠 transform: scale() 缩放，控件**故意不参与缩放**：scale 0.5 时 208px 的面板会变成
 * 104px、12px 的字变成 6px，鼠标点不准、字也读不了。而 fixed 元素在带 transform 的祖先里仍然会被
 * 那个 transform 作用，所以控件只能挂在缩放层之外，坐标按「挂件画出来的矩形」逐次算。
 *
 * 默认：按钮居中对齐挂件底缘（脚边），面板右对齐挂件右缘、开在挂件上缘之外。
 * 面板头顶放不下就翻到脚下，两边都放不下就贴顶 —— 宁可盖住人，也别让人摸不到控件。
 */
export function placeControls(input) {
  const { anchor, menu, button, viewport, gap = 8 } = input;
  const flat = {
    'anchor.left': anchor?.left,
    'anchor.top': anchor?.top,
    'anchor.width': anchor?.width,
    'anchor.height': anchor?.height,
    'menu.width': menu?.width,
    'menu.height': menu?.height,
    'button.width': button?.width,
    'button.height': button?.height,
    'viewport.width': viewport?.width,
    'viewport.height': viewport?.height,
    gap,
  };
  for (const [name, value] of Object.entries(flat)) {
    if (!Number.isFinite(value)) throw new TypeError(`placeControls 需要有限数字，${name}=${value}`);
  }

  // 视口比控件还窄时上界会小于下界，这时以下界为准：贴边也比丢出屏幕好。
  const fitX = (want, width) => clamp(want, gap, Math.max(gap, viewport.width - width - gap));
  const fitY = (want, height) => clamp(want, gap, Math.max(gap, viewport.height - height - gap));

  const buttonPos = {
    x: fitX(anchor.left + (anchor.width - button.width) / 2, button.width),
    y: fitY(anchor.top + anchor.height - button.height, button.height),
  };

  let menuY = anchor.top - menu.height - gap;
  if (menuY < gap) {
    const below = anchor.top + anchor.height + gap;
    menuY = below + menu.height + gap <= viewport.height ? below : gap;
  }
  const menuPos = {
    x: fitX(anchor.left + anchor.width - menu.width, menu.width),
    y: fitY(menuY, menu.height),
  };

  return { button: buttonPos, menu: menuPos };
}
