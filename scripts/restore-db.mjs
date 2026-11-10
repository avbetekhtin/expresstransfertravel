import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] || '');
const target = path.join(root, 'data', 'platform.sqlite');
if (!source || !fs.existsSync(source)) throw new Error('backup_not_found');
const check = new DatabaseSync(source); const integrity = check.prepare('PRAGMA integrity_check').get().integrity_check; check.close();
if (integrity !== 'ok') throw new Error(`backup_integrity_${integrity}`);
fs.copyFileSync(source, target); console.log(JSON.stringify({ restored: path.relative(root, target), integrity }));
