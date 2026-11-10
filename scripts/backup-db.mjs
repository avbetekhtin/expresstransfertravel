import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'data', 'platform.sqlite');
const backupDir = path.join(root, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
if (!fs.existsSync(source)) throw new Error('database_not_found');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `platform-${stamp}.sqlite`);
const sourceDb = new DatabaseSync(source); sourceDb.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`); sourceDb.close();
const check = new DatabaseSync(target); const integrity = check.prepare('PRAGMA integrity_check').get().integrity_check; check.close();
if (integrity !== 'ok') { fs.rmSync(target); throw new Error(`backup_integrity_${integrity}`); }
console.log(JSON.stringify({ backup: path.relative(root, target), integrity }));
