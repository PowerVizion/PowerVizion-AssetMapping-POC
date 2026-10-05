import path from 'node:path';
import { parseArgs } from 'node:util';
import { combineManifests, scanApproved, writeReport } from './atco-manifests.js';

try {
  const { values } = parseArgs({ options: { 'raw-root': { type: 'string' }, 'approved-root': { type: 'string' },
    manifest: { type: 'string', multiple: true }, out: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) console.log('Read-only source/QC scan. --raw-root PATH --approved-root PATH --manifest PATH (repeatable) --out NEW_JSON_PATH.\nDefaults to the two original 7L63 manifests. Output is stdout unless --out is supplied; files are never overwritten.');
  else {
    const rawRoot = values['raw-root'] || 'E:/ATCO_POC_STRUCTURE_EXPORTS/7L63';
    const approvedRoot = values['approved-root'] || 'E:/ATCO_POC_STRUCTURE_EXPORTS/7L63_DEMO_APPROVED';
    const combined = combineManifests({ rawRoot, manifestPaths: values.manifest || ['POC_Image_Manifest.csv', 'POC_Image_Manifest_A019_C002_1103NP.csv'].map(name => path.join(rawRoot, name)) });
    const report = { ...combined, qc: scanApproved({ approvedRoot, combined }) };
    if (values.out) writeReport(values.out, report, [rawRoot, approvedRoot]);
    console.log(JSON.stringify(values.out ? { output: path.resolve(values.out), report: report.report, qc: report.qc } : report, null, 2));
    if (combined.report.invalidRows.length || combined.report.conflicts.length) process.exitCode = 1;
  }
} catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
