import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// Verify TLS against the generated CA; this does NOT install/trust it in Windows.
const ca=await readFile(resolve(homedir(),'.office-addin-dev-certs','ca.crt'));
const paths=['/taskpane.html','/commands.html','/support.html','/icons/mail-felt-16.png','/icons/mail-felt-32.png','/icons/mail-felt-64.png','/icons/mail-felt-80.png','/icons/mail-felt-128.png'];
for(const path of paths) {
  await new Promise((resolve,reject)=>{
    const request=https.get({hostname:'localhost',port:3443,path,ca,rejectUnauthorized:true},response=>{
      response.resume();
      response.on('end',()=>{
        if(response.statusCode!==200) reject(new Error(`${path}: HTTP ${response.statusCode}`));
        else {console.log(`TLS + HTTP 200 ${path}`);resolve();}
      });
    });
    request.setTimeout(10_000,()=>request.destroy(new Error('HTTPS request timeout')));
    request.on('error',reject);
  });
}
console.log('Server certificate and resources verified against the generated CA. Windows trust still requires npm run certs:verify.');
