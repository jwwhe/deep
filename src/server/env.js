// 极简 .env 读取：只填「进程环境里还没有」的键，真实环境变量永远优先。
// 不支持行内注释与变量插值——这两点是各类 dotenv 实现互相打架的地方，
// 宁可让写 .env 的人踩一个明确的坑，也不要密码里的 # 被静默截断。
import fs from 'node:fs';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function parseDotEnv(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = LINE.exec(line);
    if (!match) throw new SyntaxError(`.env 第 ${i + 1} 行无法解析：${raw}`);
    out[match[1]] = unquote(match[2].trim());
  }
  return out;
}

function unquote(value) {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length > 1 && value.at(-1) === quote) {
    return value.slice(1, -1);
  }
  return value;
}

/** @returns {{ applied: string[], skipped: string[], file: string|null }} */
export function applyDotEnv(env = process.env, file = '.env') {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { applied: [], skipped: [], file: null };
    throw error;
  }
  const parsed = parseDotEnv(text);
  const applied = [];
  const skipped = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) skipped.push(key);
    else {
      env[key] = value;
      applied.push(key);
    }
  }
  return { applied, skipped, file };
}
