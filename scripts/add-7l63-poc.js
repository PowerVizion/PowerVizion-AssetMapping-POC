import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importAssets } from './atco-assets.js';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const { values } = parseArgs({ options: {
    'dry-run': { type: 'boolean' }, apply: { type: 'boolean' },
    assets: { type: 'string' }, db: { type: 'string' }, 'confirm-plan': { type: 'string' },
    'backup-dir': { type: 'string' }, help: { type: 'boolean' }
  } });
  if (values.help) {
    console.log('Default is read-only dry-run. Use --assets PATH --db PATH to override repository defaults.\nFuture writes require --apply --confirm-plan TOKEN from a fresh dry-run. Backups are mandatory.\nSee data/atco/7L63/README.md. Never use ingest:local.');
  } else {
    if (values.apply && values['dry-run']) throw Error('--apply and --dry-run are mutually exclusive');
    const result = await importAssets({ csvPath: values.assets || path.join(root, 'data/atco/7L63/assets.csv'),
      databasePath: values.db || path.join(root, 'data/poc.sqlite'), apply: values.apply,
      confirmPlan: values['confirm-plan'], backupDirectory: values['backup-dir'],
      onBackup: backupPath => console.error(`Pre-import backup: ${backupPath}`) });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, backupPath: error.backupPath, committed: false }));
  process.exitCode = 1;
}
