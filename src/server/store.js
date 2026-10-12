// 运行时数据落盘：原子写（先写 .tmp 再 rename），损坏存档退回默认值并把坏文件留档而不是覆盖。
import fs from 'node:fs';
import path from 'node:path';

export const FILENAMES = {
  settings: '.dshw-settings.json',
  ledger: '.dshw-ledger.json',
};

export function createStore({ dataDir, logger = console } = {}) {
  if (!dataDir) throw new TypeError('createStore 需要 dataDir');
  fs.mkdirSync(dataDir, { recursive: true });
  const warned = new Set();

  function fileFor(name) {
    const filename = FILENAMES[name];
    if (!filename) throw new TypeError(`未知的存档名: ${name}`);
    return path.join(dataDir, filename);
  }

  function read(name, fallback) {
    const file = fileFor(name);
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { value: fallback, existed: false };
      throw error;
    }
    try {
      return { value: JSON.parse(raw), existed: true };
    } catch {
      // 解析失败通常是上次断电/磁盘满留下的半截文件：留档、告警一次、用默认值继续跑。
      if (!warned.has(name)) {
        warned.add(name);
        logger.warn?.(`[dshw] ${FILENAMES[name]} 解析失败，已留档并回退默认值`);
      }
      const backup = `${file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(file, backup);
      } catch {
        /* 留档失败不能挡住启动 */
      }
      return { value: fallback, existed: false, corrupt: true };
    }
  }

  function write(name, value) {
    const file = fileFor(name);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return file;
  }

  return { read, write, dataDir, fileFor };
}
