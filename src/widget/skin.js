// 挂件自带样式与造型。
//
// 形象默认取本目录的 whale-girl.png（本项目自带的原创立绘）。
// 形象图只有这一张：立绘取不到时 whale.js 会把形象层直接藏掉，只留余额卡片，不另设备用图。
//
// 图片 URL 走 import.meta.url 解析：浏览器里 skin.js 挂在 /widget/skin.js 或 /dsh-whale/widget/skin.js，
// 于是同一行代码在两种宿主下分别指向 /widget/… 与 /dsh-whale/widget/…，不需要打包器也不需要传路径。
export const WIDGET_CSS_ID = 'dshw-style';

export const DEFAULT_SIZE = 128; // 逻辑尺寸（像素），scale 再乘一遍

export const CHARACTER_URL = new URL('./whale-girl.png', import.meta.url).href;

export const FIGURE_HTML = `
  <img class="dshw-body" src="${CHARACTER_URL}" alt="鲸鱼娘" draggable="false">`;

export const CSS = `
.dshw-root {
  position: fixed;
  z-index: 2147483000;
  width: ${DEFAULT_SIZE}px;
  height: ${DEFAULT_SIZE}px;
  transform-origin: bottom left;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.3;
  -webkit-tap-highlight-color: transparent;
}
.dshw-root * { box-sizing: border-box; }
.dshw-stage {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: grab;
  transition: transform .28s cubic-bezier(.34,1.56,.64,1);
}
.dshw-root.dragging .dshw-stage { cursor: grabbing; transition: none; }

/* 按压时底部锚点不动：只在立绘那一层做挤压，看起来才像被捏了一下 */
.dshw-figure {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 96px;
  transform-origin: bottom center;
  transition: transform .16s ease-out;
}
.dshw-root.pressed .dshw-figure { transform: scale(1.08, .88); }
.dshw-root.bounce .dshw-figure { animation: dshw-bounce .52s cubic-bezier(.3,1.6,.5,1); }
@keyframes dshw-bounce {
  0% { transform: scale(1.1,.86); }
  45% { transform: scale(.94,1.1) translateY(-6px); }
  75% { transform: scale(1.02,.98); }
  100% { transform: scale(1,1); }
}
.dshw-body {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  object-position: bottom center;
  pointer-events: none;
  filter: drop-shadow(0 5px 8px rgba(0,0,0,.26));
}
.dshw-body[hidden] { display: none; } /* 作者样式里的 display:block 会盖掉 [hidden] 的 UA 规则，得显式写 */
.dshw-float { width: 100%; height: 100%; animation: dshw-float 3.4s ease-in-out infinite; }
@keyframes dshw-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }

.dshw-card {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100px;
  width: max-content;
  max-width: 100%;
  margin: 0 auto;
  padding: 4px 8px;
  border-radius: 12px;
  background: rgba(18, 34, 58, .92);
  color: #eaf4ff;
  text-align: center;
  box-shadow: 0 4px 14px rgba(0,0,0,.25);
  white-space: nowrap;
}
.dshw-balance { font-variant-numeric: tabular-nums; font-size: 15px; font-weight: 600; letter-spacing: .2px; }
.dshw-spend { font-size: 11px; opacity: .82; font-variant-numeric: tabular-nums; }
.dshw-bonus { font-size: 11px; opacity: .72; font-variant-numeric: tabular-nums; }
.dshw-bonus[hidden] { display: none; }
/* 卡片是 nowrap 的，但「查过哪些来源」这类诊断文案会很长，不换行就会把卡片撑出视口。 */
.dshw-flag { font-size: 10px; display: none; white-space: normal; max-width: 220px; margin: 0 auto; line-height: 1.35; }
.dshw-root.stale .dshw-flag { display: block; color: #ffd479; }
.dshw-root.error .dshw-flag, .dshw-root.unconfigured .dshw-flag { display: block; color: #ff9b9b; }
.dshw-root.stale .dshw-card { background: rgba(52, 46, 22, .92); }
.dshw-root.error .dshw-card, .dshw-root.unconfigured .dshw-card { background: rgba(58, 26, 30, .92); }
/* 取不到数时整个人也压暗去色，余光扫一眼就知道状态不对，不用读文字 */
.dshw-root.stale .dshw-body { filter: drop-shadow(0 5px 8px rgba(0,0,0,.26)) saturate(.72) brightness(.96); }
.dshw-root.error .dshw-body, .dshw-root.unconfigured .dshw-body {
  filter: drop-shadow(0 5px 8px rgba(0,0,0,.26)) grayscale(.6) sepia(.22) hue-rotate(-18deg) saturate(1.3);
  opacity: .9;
}

.dshw-menu-button {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: rgba(18,34,58,.85);
  color: #eaf4ff;
  font-size: 12px;
  line-height: 22px;
  text-align: center;
  cursor: pointer;
  padding: 0;
}
.dshw-root.menu-hidden .dshw-menu-button { display: none; }

.dshw-menu {
  position: absolute;
  right: 0;
  bottom: 96px;
  width: 208px;
  padding: 8px;
  border-radius: 12px;
  background: rgba(18,34,58,.96);
  color: #eaf4ff;
  box-shadow: 0 8px 24px rgba(0,0,0,.3);
  font-size: 12px;
}
.dshw-menu[hidden] { display: none; }
.dshw-root.menu-below .dshw-menu { bottom: auto; top: 100%; }
.dshw-menu h2 { margin: 0 0 6px; font-size: 12px; font-weight: 600; opacity: .85; }
.dshw-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 4px 0; }
.dshw-row label { flex: 1 1 auto; }
.dshw-menu input[type="range"] { width: 88px; }
.dshw-menu button {
  font: inherit;
  color: inherit;
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.18);
  border-radius: 8px;
  padding: 3px 7px;
  cursor: pointer;
}
.dshw-menu button:hover { background: rgba(255,255,255,.2); }
.dshw-version { margin-top: 6px; font-size: 10px; opacity: .55; text-align: right; }

/* 贴左吸附：只翻立绘，卡片/菜单/按钮都是她的兄弟节点，跟着翻会把文字反过来 */
.dshw-root.mirrored .dshw-body { transform: scaleX(-1); transform-origin: 50% 100%; }
.dshw-root.at-left .dshw-menu { right: auto; left: 0; }

.dshw-bubble {
  position: absolute;
  left: 50%;
  bottom: 148px;
  transform: translateX(-50%);
  max-width: 220px;
  padding: 6px 10px;
  border-radius: 12px;
  border-bottom-left-radius: 4px;
  background: #fff;
  color: #16283d;
  font-size: 12px;
  box-shadow: 0 6px 18px rgba(0,0,0,.22);
  white-space: normal;
}
.dshw-bubble[hidden] { display: none; }

@media (prefers-reduced-motion: reduce) {
  .dshw-float { animation: none; }
  .dshw-stage, .dshw-figure { transition: none; }
}
`;

export function ensureStyle(doc = document) {
  if (doc.getElementById(WIDGET_CSS_ID)) return;
  const style = doc.createElement('style');
  style.id = WIDGET_CSS_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}
