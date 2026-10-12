// 挂件挂载层：只做「把核心纯逻辑的判定结果画出来、把手势翻译成状态」。
// 任何数值规则（吸附、金额、滚动序列、轮询）都在 ./core 里，这里不重复实现。
import { formatAmount, rollingFrames } from '../core/money.js';
import { resolveSnap, restingPosition, EDGES } from '../core/layout.js';
import { DEFAULT_SIZE, FIGURE_HTML, ensureStyle } from './skin.js';
import { createAudio } from './audio.js';

const CLICK_THRESHOLD_PX = 5;
const LONG_PRESS_MS = 700;
const ROLL_FRAMES = 26;

const BUBBLE_LINES = [
  '余额我盯着呢，你放心写代码～',
  '点我一下我就去问一次余额',
  '充值记得叫我，我要核对账本',
  '今天也辛辛苦苦地看着钱包',
  '余额掉了就是你在用钱，不是我吃的',
];

const STATUS_CLASS = {
  ok: '',
  idle: '',
  stale: 'stale',
  error: 'error',
  unconfigured: 'unconfigured',
};

export function mountWhale(options = {}) {
  const {
    doc = document,
    win = globalThis,
    source,
    settings: initialSettings = {},
    size = DEFAULT_SIZE,
    margin = 16,
    version = '',
    onEvent = () => {},
  } = options;
  if (!source || typeof source.tracker !== 'object') throw new TypeError('mountWhale 需要 source.tracker');

  ensureStyle(doc);

  const settings = {
    scale: 1,
    snapEnabled: true,
    snapMode: 'ratio',
    snapValue: 0.08,
    mirrorOnLeft: true,
    hideMenu: false,
    soundEnabled: true,
    volume: 0.4,
    ...initialSettings,
  };

  const audio = createAudio({ window: win, volume: settings.volume, enabled: settings.soundEnabled, logger: (m) => onEvent({ type: 'warn', message: m }) });
  const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const root = doc.createElement('div');
  root.className = 'dshw-root';
  root.setAttribute('data-widget', 'dshw-whale');
  root.innerHTML = `
    <div class="dshw-stage">
      <div class="dshw-figure">
        <div class="dshw-float">${FIGURE_HTML}</div>
      </div>
      <div class="dshw-card">
        <div class="dshw-balance">—</div>
        <div class="dshw-bonus" hidden></div>
        <div class="dshw-spend">今日 —</div>
        <div class="dshw-flag"></div>
      </div>
      <div class="dshw-bubble" hidden></div>
      <button type="button" class="dshw-menu-button" aria-label="鲸鱼娘菜单" aria-expanded="false">☰</button>
      <div class="dshw-menu" hidden role="menu" aria-label="鲸鱼娘设置">
        <h2>鲸鱼娘</h2>
        <div class="dshw-row"><label for="dshw-scale">大小</label><input id="dshw-scale" type="range" min="0.5" max="3" step="0.05"></div>
        <div class="dshw-row"><label for="dshw-volume">音量</label><input id="dshw-volume" type="range" min="0" max="1" step="0.05"></div>
        <div class="dshw-row"><button type="button" data-action="sound">音效：开</button><button type="button" data-action="snap">吸附：开</button></div>
        <div class="dshw-row"><button type="button" data-action="mirror">镜像：开</button><button type="button" data-action="hide-menu">隐藏菜单</button></div>
        <div class="dshw-row"><button type="button" data-action="refresh">立刻刷新</button></div>
        <div class="dshw-version"></div>
      </div>
    </div>`;

  const el = {
    stage: root.querySelector('.dshw-stage'),
    figure: root.querySelector('.dshw-figure'),
    body: root.querySelector('.dshw-body'),
    balance: root.querySelector('.dshw-balance'),
    bonus: root.querySelector('.dshw-bonus'),
    spend: root.querySelector('.dshw-spend'),
    flag: root.querySelector('.dshw-flag'),
    bubble: root.querySelector('.dshw-bubble'),
    menuButton: root.querySelector('.dshw-menu-button'),
    menu: root.querySelector('.dshw-menu'),
    scale: root.querySelector('#dshw-scale'),
    volume: root.querySelector('#dshw-volume'),
    version: root.querySelector('.dshw-version'),
  };
  el.version.textContent = version ? `v${version}` : '';

  // 立绘取不到（路径写错、素材被删）时把这一层藏掉：只留余额卡片，比一个裂图图标干净。
  // hidden 会一直留着，所以浏览器只会重试加载一次，不用再去重。
  el.body.addEventListener('error', () => {
    el.body.hidden = true;
    console.warn('[whale-widget] 立绘取不到，已隐藏形象层；把图片放成 src/widget/whale-girl.png 即可恢复');
  });

  const viewport = () => ({
    width: doc.documentElement.clientWidth || win.innerWidth || 0,
    height: doc.documentElement.clientHeight || win.innerHeight || 0,
  });

  let position = { x: 0, y: 0 };
  let mirrored = false;
  // 上一次吸附贴上了哪两条边：缩放改变了盒子尺寸后要靠它把鲸鱼按回原处。
  let lastEdge = { horizontal: EDGES.none, vertical: EDGES.none };
  let shownMicro = null;
  let rafId = null;
  let bubbleTimer = null;
  let lastLine = -1;
  let saveTimer = null;
  let destroyed = false;

  function applyGeometry() {
    // 盒尺寸保持逻辑值，缩放只走 transform：这样 CSS 里的所有 px 细节会跟着等比缩放，
    // 而吸附用的实际占地（size*scale）在调用 resolveSnap 处单独算，两边不打架。
    root.style.width = `${size}px`;
    root.style.height = `${size}px`;
    root.style.transform = `scale(${settings.scale})`;
    root.style.transformOrigin = 'top left';
    root.style.left = `${position.x}px`;
    root.style.top = `${position.y}px`;
    // 贴左缘时菜单要往右开，否则 208px 的面板会被视口切掉一半；按实际坐标判定，
    // 不用 mirrored 标志——关掉「左吸附镜像」后菜单同样得躲开视口外。
    // 阈值取 margin：吸附后的左边缘目标就是 margin，只有自由摆放能落在这条线以里。
    root.classList.toggle('at-left', position.x <= margin);
  }

  function placeAtRest() {
    const vp = viewport();
    position = restingPosition({
      viewportWidth: vp.width,
      viewportHeight: vp.height,
      width: size * settings.scale,
      height: size * settings.scale,
      margin,
      resting: 'bottom-right',
    });
    applyGeometry();
  }

  function commitSnap(snapped) {
    position = { x: snapped.x, y: snapped.y };
    mirrored = snapped.mirrored;
    lastEdge = { horizontal: snapped.horizontal, vertical: snapped.vertical };
    root.classList.toggle('mirrored', mirrored);
    applyGeometry();
  }

  function setStatusClass(state) {
    root.classList.remove('stale', 'error', 'unconfigured');
    const cls = STATUS_CLASS[state.status] ?? '';
    if (cls) root.classList.add(cls);
  }

  function paintFlag(state) {
    if (state.status === 'unconfigured') {
      // 宿主引擎的 stderr 看不见（Electron 收在内存里，只在启动整体失败时展示），卡片是唯一能说出
      // 「到底是哪一级来源没给数」的地方，所以要把 provider 的原文透出来，不能压成一句通用文案。
      el.flag.textContent = state.error?.message ?? '未配置 DEEPSEEK_API_KEY';
      el.balance.textContent = '—';
      shownMicro = null;
      return;
    }
    if (state.status === 'error') {
      el.flag.textContent = state.error?.message ?? '取数失败';
      el.balance.textContent = '—';
      shownMicro = null;
      return;
    }
    if (state.stale) {
      el.flag.textContent = `暂时取不到（${state.error?.code ?? '失败'}），显示最近一次`;
      return;
    }
    el.flag.textContent = '';
  }

  /** 数字滚动：帧序列来自 core/money.rollingFrames，这里只负责按帧写 DOM。 */
  function rollTo(nextMicro) {
    if (rafId !== null) {
      win.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (shownMicro === null || reducedMotion) {
      shownMicro = nextMicro;
      el.balance.textContent = formatBalance(nextMicro);
      return;
    }
    if (shownMicro === nextMicro) return;
    const frames = rollingFrames(shownMicro, nextMicro, ROLL_FRAMES);
    let i = 0;
    const step = () => {
      if (destroyed) return;
      if (i >= frames.length) {
        rafId = null;
        shownMicro = nextMicro;
        el.balance.textContent = formatBalance(nextMicro);
        return;
      }
      el.balance.textContent = formatBalance(frames[i]);
      i += 1;
      rafId = win.requestAnimationFrame(step);
    };
    rafId = win.requestAnimationFrame(step);
  }

  function formatBalance(micro) {
    const text = formatAmount(micro, { decimals: 2 });
    return text === '—' ? text : `¥ ${text}`;
  }

  function render(state) {
    setStatusClass(state);
    paintFlag(state);
    if (state.balanceMicro !== null && state.balanceMicro !== undefined) {
      rollTo(typeof state.balanceMicro === 'bigint' ? state.balanceMicro : BigInt(state.balanceMicro));
    }
    // 原型自己的 /api/state 给 todaySpend，DSH 契约的 balance.json 给 todayUsed，两个都认。
    const spend = state.meta?.todaySpend ?? state.meta?.todayUsed;
    el.spend.textContent = spend ? `今日 ¥${spend}` : '今日 —';
    renderBonus(state.meta);
    onEvent({ type: 'state', state });
  }

  /** 赠送钱包：官网也是单独一行，不并进余额。合并显示时改说「含赠送」，否则两个数字看着像少了一截。 */
  function renderBonus(meta) {
    const bonus = meta?.bonusBalance ?? meta?.bonus;
    if (!bonus || bonus === '0.00') {
      el.bonus.hidden = true;
      el.bonus.textContent = '';
      return;
    }
    el.bonus.hidden = false;
    el.bonus.textContent = `${meta.bonusIncluded ? '含赠送' : '赠送'} ¥${bonus}`;
  }

  function showBubble(text, ms = 2600) {
    el.bubble.textContent = text;
    el.bubble.hidden = false;
    if (bubbleTimer !== null) win.clearTimeout(bubbleTimer);
    if (ms > 0) bubbleTimer = win.setTimeout(() => { el.bubble.hidden = true; }, ms);
  }

  /** 先让宿主去问一次上游，再把结果拉回客户端，否则界面要等到下一个轮询点才动。 */
  async function manualRefresh() {
    const pushed = await Promise.resolve(source.refreshNow?.()).catch(() => ({ ok: false, code: 'network' }));
    await source.tracker.refresh().catch(() => ({ ok: false }));
    return pushed;
  }

  function nextLine() {
    let idx;
    do {
      idx = Math.floor(Math.random() * BUBBLE_LINES.length);
    } while (idx === lastLine && BUBBLE_LINES.length > 1);
    lastLine = idx;
    return BUBBLE_LINES[idx];
  }

  function persistSettings() {
    if (typeof source.postSettings !== 'function') return;
    if (saveTimer !== null) win.clearTimeout(saveTimer);
    saveTimer = win.setTimeout(() => {
      const { scale, snapEnabled, snapMode, snapValue, mirrorOnLeft, hideMenu } = settings;
      source.postSettings({ scale, snapEnabled, snapMode, snapValue, mirrorOnLeft, hideMenu }).then((result) => {
        if (!result.ok) onEvent({ type: 'warn', message: `设置保存失败：${result.code ?? '未知'}` });
      }, () => {});
    }, 260);
  }

  function syncMenuWidgets() {
    el.scale.value = String(settings.scale);
    el.volume.value = String(settings.volume);
    el.menu.querySelector('[data-action="sound"]').textContent = `音效：${settings.soundEnabled ? '开' : '关'}`;
    el.menu.querySelector('[data-action="snap"]').textContent = `吸附：${settings.snapEnabled ? '开' : '关'}`;
    el.menu.querySelector('[data-action="mirror"]').textContent = `镜像：${settings.mirrorOnLeft ? '开' : '关'}`;
    root.classList.toggle('menu-hidden', settings.hideMenu);
  }

  function toggleMenu(force) {
    const open = force ?? el.menu.hidden;
    el.menu.hidden = !open;
    el.menuButton.setAttribute('aria-expanded', String(open));
    if (!open) return;
    // 菜单默认向上开；贴顶吸附时会整块被推出视口，这时改成向下开。
    // 必须先取消 hidden 才量得到高度（display:none 时 offsetHeight 是 0）。
    root.classList.toggle('menu-below', el.menu.offsetHeight > root.getBoundingClientRect().top - 8);
  }

  // —— 指针交互：拖拽 / 点击 / 长按 ——
  const pointers = new Map();
  let gesture = null;

  el.stage.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.dshw-menu')) return;
    if (event.button !== undefined && event.button > 0) return; // 只跟主指针
    el.stage.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, event.pointerId);
    const vp = viewport();
    gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
      vpWidth: vp.width,
      vpHeight: vp.height,
      longPress: null,
    };
    root.classList.add('pressed');
    audio.press();
    if (event.pointerType === 'touch') {
      gesture.longPress = win.setTimeout(() => {
        if (gesture && !gesture.moved) {
          toggleMenu(true);
          gesture.moved = true; // 长按已经消费掉这次手势
        }
      }, LONG_PRESS_MS);
    }
  });

  el.stage.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < CLICK_THRESHOLD_PX) return;
    gesture.moved = true;
    if (gesture.longPress !== null) {
      win.clearTimeout(gesture.longPress);
      gesture.longPress = null;
    }
    root.classList.add('dragging');
    position = { x: gesture.originX + dx, y: gesture.originY + dy };
    applyGeometry();
  });

  function endGesture(event) {
    if (!gesture || (event && event.pointerId !== gesture.id)) return;
    if (gesture.longPress !== null) win.clearTimeout(gesture.longPress);
    pointers.delete(gesture.id);
    root.classList.remove('pressed');
    const wasDrag = gesture.moved;
    gesture = null;

    if (wasDrag) {
      root.classList.remove('dragging');
      const box = { width: size * settings.scale, height: size * settings.scale };
      const vp = viewport();
      const snapped = resolveSnap({
        x: position.x,
        y: position.y,
        ...box,
        viewportWidth: vp.width,
        viewportHeight: vp.height,
        margin,
        snap: { enabled: settings.snapEnabled, mode: settings.snapMode, value: settings.snapValue },
        mirrorOnLeft: settings.mirrorOnLeft,
      });
      commitSnap(snapped);
      audio.release();
      onEvent({ type: 'snap', edge: snapped.horizontal, vertical: snapped.vertical, mirrored });
      return;
    }

    // 非拖拽＝点击：弹一下 + 冒泡 + 顺手刷新
    root.classList.add('bounce');
    win.setTimeout(() => root.classList.remove('bounce'), 560);
    showBubble(nextLine());
    audio.release();
    manualRefresh().then((result) => {
      if (result && result.ok === false) showBubble(`刷新没成功：${result.code ?? '未知'}`);
    });
  }

  el.stage.addEventListener('pointerup', endGesture);
  el.stage.addEventListener('pointercancel', endGesture);

  el.stage.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    toggleMenu(true);
  });

  el.menuButton.addEventListener('click', () => toggleMenu());
  el.menu.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'refresh') {
      manualRefresh().then(() => showBubble('我去问了一遍余额'));
    } else if (action === 'sound') {
      settings.soundEnabled = !settings.soundEnabled;
      audio.setEnabled(settings.soundEnabled);
      if (settings.soundEnabled) audio.chime();
    } else if (action === 'snap') {
      settings.snapEnabled = !settings.snapEnabled;
    } else if (action === 'mirror') {
      settings.mirrorOnLeft = !settings.mirrorOnLeft;
      if (!settings.mirrorOnLeft && mirrored) {
        mirrored = false;
        root.classList.remove('mirrored');
      }
    } else if (action === 'hide-menu') {
      settings.hideMenu = !settings.hideMenu;
      if (settings.hideMenu) toggleMenu(false);
    }
    syncMenuWidgets();
    persistSettings();
    onEvent({ type: 'setting', key: action, value: settings[action] });
  });

  el.scale.addEventListener('input', () => {
    settings.scale = Number(el.scale.value);
    applyGeometry();
    resnap();
    persistSettings();
  });
  el.volume.addEventListener('input', () => {
    settings.volume = audio.setVolume(Number(el.volume.value));
    persistSettings();
  });

  /**
   * 视口或盒子尺寸变了之后重算一次位置：先把鲸鱼按回它原先贴着的那两条边，再收敛越界。
   * 只 clamp 不 re-anchor 的话，缩小挂件或放大窗口都会让本来贴边的鲸鱼浮到屏幕中间。
   */
  function resnap() {
    const vp = viewport();
    const box = { width: size * settings.scale, height: size * settings.scale };
    if (settings.snapEnabled) {
      // 按回原边的目标值必须和 resolveSnap 用同一套 margin，否则改一次窗口尺寸就把
      // 「贴边」悄悄改成「贴 margin」，鲸鱼肉眼可见地往里挪。
      const rightX = Math.max(0, vp.width - box.width - margin);
      const bottomY = Math.max(0, vp.height - box.height - margin);
      if (lastEdge.horizontal === EDGES.right) position.x = rightX;
      else if (lastEdge.horizontal === EDGES.left) position.x = Math.min(margin, Math.max(0, vp.width - box.width));
      if (lastEdge.vertical === EDGES.bottom) position.y = bottomY;
      else if (lastEdge.vertical === EDGES.top) position.y = Math.min(margin, Math.max(0, vp.height - box.height));
    }
    commitSnap(resolveSnap({
      x: position.x,
      y: position.y,
      ...box,
      viewportWidth: vp.width,
      viewportHeight: vp.height,
      margin,
      snap: { enabled: settings.snapEnabled, mode: settings.snapMode, value: settings.snapValue },
      mirrorOnLeft: settings.mirrorOnLeft,
    }));
  }
  const onResize = resnap;
  win.addEventListener('resize', onResize);

  const unsubscribe = source.tracker.subscribe((state) => render(state));

  root.dataset.mounted = '1';
  doc.body.appendChild(root);
  placeAtRest();
  syncMenuWidgets();
  source.tracker.start?.();

  return {
    root,
    el,
    getSettings: () => ({ ...settings }),
    setSettings(patch) {
      Object.assign(settings, patch);
      if (patch.volume !== undefined) audio.setVolume(settings.volume);
      if (patch.soundEnabled !== undefined) audio.setEnabled(Boolean(settings.soundEnabled));
      applyGeometry();
      syncMenuWidgets();
      onResize();
      return { ...settings };
    },
    /** 供宿主/E2E 直接推一帧状态，绕开网络。 */
    pushState(state) {
      render({ status: 'ok', stale: false, error: null, ...state });
    },
    bubble: showBubble,
    destroy() {
      destroyed = true;
      if (rafId !== null) win.cancelAnimationFrame(rafId);
      if (bubbleTimer !== null) win.clearTimeout(bubbleTimer);
      if (saveTimer !== null) win.clearTimeout(saveTimer);
      unsubscribe();
      win.removeEventListener('resize', onResize);
      source.tracker.stop?.();
      audio.dispose();
      root.remove();
    },
  };
}
