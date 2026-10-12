// 音效用 WebAudio 现场合成：不打包 mp3/wav，也就没有「资源缺失静默降级」这条路。
// 浏览器要求先有用户手势才能出声，所以 AudioContext 推迟到第一次交互再建。

export function createAudio({ window = globalThis, volume = 0.5, enabled = true, logger = () => {} } = {}) {
  let ctx = null;
  let currentVolume = clamp01(volume);
  let on = enabled;

  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0.5;
    return Math.min(1, Math.max(0, n));
  }

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch (error) {
      logger(`AudioContext 创建失败，音效关闭：${error?.message ?? error}`);
      on = false;
      return null;
    }
    return ctx;
  }

  function blip({ freq = 660, duration = 0.09, type = 'sine', slideTo = null } = {}) {
    if (!on) return false;
    const audio = ensureContext();
    if (!audio) return false;
    if (audio.state === 'suspended') audio.resume?.().catch(() => {});
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const at = audio.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), at + duration);
    // 极短淡入淡出，避免爆音
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, currentVolume * 0.35), at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
    return true;
  }

  return {
    press() {
      return blip({ freq: 520, slideTo: 760, duration: 0.08, type: 'triangle' });
    },
    release() {
      return blip({ freq: 880, slideTo: 560, duration: 0.11, type: 'sine' });
    },
    /** 余额变化时的一声「叮」，比按压音更短更亮。 */
    chime() {
      return blip({ freq: 1180, duration: 0.14, type: 'sine', slideTo: 1560 });
    },
    setVolume(value) {
      currentVolume = clamp01(value);
      return currentVolume;
    },
    setEnabled(value) {
      on = Boolean(value);
      return on;
    },
    get enabled() {
      return on;
    },
    get volume() {
      return currentVolume;
    },
    /** 暴露给单测：没有 AudioContext 的环境里必须安静地退化，而不是抛错。 */
    get available() {
      return ctx !== null;
    },
    dispose() {
      ctx?.close?.().catch?.(() => {});
      ctx = null;
    },
  };
}
