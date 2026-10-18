/* Shared evidence recorder.
 * Writes:
 *   tests/results/before/<group>/report.json  (machine-readable)
 *   tests/results/before/<group>/report.md    (markdown table for humans)
 * Every record follows the schema requested by the audit brief:
 *   how it was done, the request, the response, and whether it was refused.
 */
import fs from 'node:fs';
import path from 'node:path';

/* Phase selection: pristine `before/` evidence must never be overwritten by an
 * accidental bare run (it happened once — recreate that bug and the honest
 * pre-fix proof is gone). Writing `before/` therefore requires an explicit
 * RESULTS_PHASE=before; an unset variable records to the regenerable `after/`
 * bucket. Both the report recorder and the collector (servers.mjs) use this. */
export function phaseName() {
  const p = String(process.env.RESULTS_PHASE || '').toLowerCase();
  return p === 'before' ? 'before' : 'after';
}

export function makeRecorder({ group, tags = {}, runsDir = null, collectDirName = phaseName() } = {}) {
  // (see phaseName() above for the policy)
  const dir = path.resolve(`tests/results/${collectDirName}/${group}`);
  fs.mkdirSync(dir, { recursive: true });
  const records = [];
  const artifacts = [];

  /** Save a proof artifact (text or object) into the group's results dir. */
  function saveArtifact(name, content, ext = 'txt') {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name.endsWith(`.${ext}`) ? name : `${name}.${ext}`);
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    artifacts.push(path.relative('tests', file));
    return path.relative('tests', file);
  }

  /** Record one attack test result. refused=true means the app refused/failed the attack. */
  function record(r) {
    const row = {
      id: r.id, title: r.title,
      applied: r.applied ?? true,         // false => N/A with proof-why
      how: r.how,                          // exactly how it was executed at runtime
      request: r.request ?? '',            // the literal request / URL / script
      response: r.response ?? '',          // the literal response / observed behavior
      refused: r.refused ?? false,         // was the attack refused when it should have been?
      note: r.note ?? '',
      proof: r.proof ?? [],
      ...tags,
    };
    records.push(row);
    return row;
  }

  function flush() {
    fs.mkdirSync(dir, { recursive: true });
    const json = { generatedAt: new Date().toISOString(), group, records, artifacts };
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(json, null, 2));
    const lines = [
      `# ${group.toUpperCase()} — ${collectDirName} results`,
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '| ID | Attack | Applied | How it ran | Request | Response | Refused? |',
      '|----|--------|---------|------------|---------|----------|----------|',
    ];
    for (const r of records) {
      const cell = (s) => String(s ?? '').replace(/\n/g, ' ⏎ ').replace(/\|/g, '\\|').slice(0, 500);
      lines.push(`| ${r.id} | ${cell(r.title)} | ${r.applied ? '✅' : '—'} | ${cell(r.how)} | ${cell(r.request)} | ${cell(r.response)} | ${r.refused ? 'YES' : 'no'} |`);
    }
    lines.push('', '## Full details', '');
    for (const r of records) {
      lines.push(`### ${r.id} — ${r.title}`, `Applied: ${r.applied}`, `Refused: ${r.refused}`, '', `How: ${r.how}`, '', `Request: ${r.request}`, '', `Response: ${r.response}`, '', `Note: ${r.note}`, '', `Proof: ${(r.proof || []).join(', ')}`, '');
    }
    lines.push('## Artifacts', '', ...(artifacts.length ? artifacts.map((a) => `- ${a}`) : ['- (none)']), '');
    fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n'));
    return path.relative('tests', path.join(dir, 'report.md'));
  }

  return { record, flush, saveArtifact, dir };
}
