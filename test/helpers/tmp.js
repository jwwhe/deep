// 测试用临时目录：统一前缀，并在进程退出时清掉。
// 之前每个测试文件各自 mkdtemp 却没人删，跑一晚 %TEMP% 下能堆出上千个 dshw-* 目录。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created = [];

export function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dshw-${prefix}-`));
  created.push(dir);
  return dir;
}

// 只删本进程建出来的、且带 dshw- 前缀的目录；被占用就跳过，不让清理本身把测试搞红。
process.on('exit', () => {
  for (const dir of created) {
    if (!path.basename(dir).startsWith('dshw-')) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows 上子进程可能还攥着句柄，留给系统清理 */
    }
  }
});
