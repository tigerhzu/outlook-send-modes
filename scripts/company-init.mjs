import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { emptyState } from '../server/catalog.mjs';

const target = process.argv[2];
if (!target) { console.error('用法：node scripts/company-init.mjs <非公開目錄的 catalog-state.json 路徑>'); process.exitCode = 1; }
else {
  const path = resolve(target); const rel = relative(resolve('dist'), path);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('範本庫不可放在 dist 公開目錄。');
  await mkdir(dirname(path), {recursive:true});
  await writeFile(path, JSON.stringify(emptyState(), null, 2), {encoding:'utf8',flag:'wx',mode:0o600});
  console.log('已建立空白範本庫。既有檔案不會覆寫。');
}
