// Fails CI if the hand-in docs are missing or the README lacks a required section.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const errors = [];

for (const f of ['README.md', 'RELEASE_NOTE.md', 'SELF_REVIEW.md']) {
  if (!existsSync(join(root, f))) errors.push(`missing ${f}`);
}

if (existsSync(join(root, 'README.md'))) {
  const readme = readFileSync(join(root, 'README.md'), 'utf8').toLowerCase();
  const sections = { 'clean checkout': /clean checkout/, mock: /mock/, tests: /tests?/, 'iOS result': /ios: (проверено|не проверено|verified|not verified)/, 'Android result': /android: (проверено|не проверено|verified|not verified)/ };
  for (const [name, re] of Object.entries(sections)) if (!re.test(readme)) errors.push(`README lacks: ${name}`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('docs OK');
