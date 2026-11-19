import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

async function developmentHttps() {
  const dir=resolve(homedir(),'.office-addin-dev-certs');
  try {
    const [key,cert,ca]=await Promise.all(['localhost.key','localhost.crt','ca.crt'].map(file=>readFile(resolve(dir,file))));
    return {key,cert,ca};
  } catch {
    throw new Error('尚未建立 localhost HTTPS 憑證。請先執行 npm run certs:install，完成 Windows 信任提示後再啟動。');
  }
}

export default defineConfig(async ({command})=>({
  base:'./',
  server:{
    https:command==='serve' && process.env.ADDIN_TEST_HTTP!=='1' ? await developmentHttps() : undefined,
    host:'localhost',port:3443,strictPort:true,
    headers:{'Cache-Control':'no-store'},
  },
  build:{rollupOptions:{input:{taskpane:resolve(import.meta.dirname,'taskpane.html'),auth:resolve(import.meta.dirname,'auth.html')}},target:'es2022'},
}));
