import fs from 'node:fs';
const origin = new URL(process.env.PUBLIC_ORIGIN || '');
if (origin.protocol !== 'https:' || origin.port || !/^[a-z0-9.-]+$/.test(origin.hostname)) throw Error('PUBLIC_ORIGIN must be an HTTPS domain without a port');
fs.mkdirSync('deploy/generated', {recursive:true});
fs.writeFileSync('deploy/generated/nginx.conf', fs.readFileSync('deploy/nginx.conf.template','utf8').replaceAll('__DOMAIN__',origin.hostname));
console.log('Generated deploy/generated/nginx.conf');
