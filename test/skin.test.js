// 气泡的几何只有浏览器里才看得出来，但这两条一旦写错会退化成很难查的样子，先用字符串钉住：
// ① 用 left:50% 居中时 shrink-to-fit 只能吃包含块的一半（根盒 128 → 64），一句 14 字会折成窄柱；
// ② 尾巴往下探的像素数由 CSS 与 showBubble 各用一次，两边必须同一个常量。
import test from 'node:test';
import assert from 'node:assert/strict';
import { CSS, BUBBLE_TAIL_PX, BUBBLE_OFFSET_ABOVE_CARD } from '../src/widget/skin.js';

// 同一个选择器可能出现在「共享规则 + 自己的规则」两块里（::before/::after 合写），所以取全部拼接。
const rules = (selector) => {
  const blocks = [...CSS.matchAll(new RegExp(`\\${selector} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
  assert.ok(blocks.length, `CSS 里找不到 ${selector} 规则`);
  return blocks.join('\n');
};

test('气泡吃满根盒宽度，不靠 left:50% 居中', () => {
  const bubble = rules('.dshw-bubble');
  assert.doesNotMatch(bubble, /left:\s*50%/);
  assert.match(bubble, /left:\s*0;/);
  assert.match(bubble, /right:\s*0;/);
  assert.match(bubble, /width:\s*max-content/);
  assert.match(bubble, /margin:\s*0 auto/);
});

test('尾巴两颗泡往下探的距离与 JS 用的常量一致', () => {
  assert.match(rules('.dshw-bubble::after'), new RegExp(`bottom:\\s*-${BUBBLE_TAIL_PX}px`));
  assert.equal(BUBBLE_OFFSET_ABOVE_CARD, BUBBLE_TAIL_PX + 4);
});

test('气泡弹出动画存在，且 reduced-motion 下关掉', () => {
  assert.match(CSS, /\.dshw-bubble\.in \{ animation: dshw-bubble-pop/);
  assert.match(CSS, /@keyframes dshw-bubble-pop/);
  assert.match(CSS.slice(CSS.indexOf('prefers-reduced-motion')), /\.dshw-bubble\.in \{ animation: none/);
});
