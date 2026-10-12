// JSON 字段路径取值：支持 a.b[0].c，供「接口 + 字段路径」式的自定义厂商配置使用。
const TOKEN_RE = /[^.[\]]+|\[(\d+)\]/g;

export function tokenizePath(path) {
  if (typeof path !== 'string' || path.trim() === '') throw new TypeError(`非法字段路径: ${JSON.stringify(path)}`);
  const tokens = [];
  for (const match of path.matchAll(TOKEN_RE)) {
    if (match[1] !== undefined) {
      tokens.push(Number(match[1]));
    } else {
      const t = match[0].replace(/^\./, '');
      if (t === '') throw new TypeError(`非法字段路径: ${path}`);
      tokens.push(t);
    }
  }
  if (tokens.length === 0) throw new TypeError(`非法字段路径: ${path}`);
  return tokens;
}

export function getPath(source, path) {
  let cursor = source;
  for (const token of tokenizePath(path)) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof token === 'number') {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[token];
    } else {
      if (typeof cursor !== 'object') return undefined;
      cursor = cursor[token];
    }
  }
  return cursor;
}

/**
 * 按 spec 从原始响应里取出余额字段。取不到返回 { ok:false, reason } 而不抛异常：
 * 上游改字段是常态，调用方要把它当业务错误处理。单位缩放交给 toMicroUnits，这里不碰数值。
 */
export function extractValue(source, spec) {
  if (!spec || typeof spec.path !== 'string') {
    return { ok: false, reason: 'missing-path' };
  }
  const raw = getPath(source, spec.path);
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, reason: 'not-found', path: spec.path };
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return { ok: false, reason: 'unsupported-type', type: typeof raw };
  }
  const currencyRef = spec.currencyPath ?? null;
  const currency = currencyRef ? getPath(source, currencyRef) : spec.currency;
  return { ok: true, value: raw, currency: typeof currency === 'string' ? currency : undefined };
}
