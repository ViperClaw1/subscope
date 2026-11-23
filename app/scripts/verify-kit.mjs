// Proves mobile-engineer-kit/ is byte-identical to the supplied kit.
// Reference: per-file sha256 of the files extracted from the supplied zip on 2026-11-19. The zip's own hash is not used:
// it depends on how the archive was packed, the contents do not.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mobile-engineer-kit');
const expected = {
  '.gitignore': '43e669583ee2807df78c0c43b5c5ed1ce50edd648eef9609a8239707ab6f22c6',
  'README.md': '2a1b33267b3e7e0c26613e8fe8a61dac32d1d73b469c459e8a028bc0ad076f18',
  'fixtures/spoofed.pdf': '1564b3a4037eba8b456ace6875a05cf945bc7168db9d7c1aaa206947ced7b50b',
  'fixtures/statement.csv': '2d2eb2233378820aeeecfc3a5d54d1ecb5a0e48eaa1e672478acaa3822890c7c',
  'fixtures/statement.pdf': '07c3788a4bf96387eb67efb48efdfc1ab1dfa6aa05e34ba0555536d3c2279677',
  'make-oversize.mjs': '914b0d7d211b801968c3b01cb5c1338bca91f2dd45c1fb55e70f42c5ae1a9952',
  'mock-server.mjs': 'c3c54fd97ed63e8c179501081a9ef8cb0a2a1de2f554e9b5a426898ac2592b7b',
  'mock-server.test.mjs': 'f30e6333b401dfaf788d8a24a408c352966a534a0c28f1bb1934ef6c4ceed31c',
  'package.json': 'c60f315b2dfaecb48fe23dfc0df6597f57985e21d06e0ab19b30caf21429a80f',
};

let bad = 0;
for (const [file, hash] of Object.entries(expected)) {
  const actual = createHash('sha256').update(readFileSync(join(kit, file))).digest('hex');
  if (actual !== hash) { console.error(`MISMATCH ${file}: ${actual}`); bad++; }
}
if (bad) process.exit(1);
console.log(`kit OK (${Object.keys(expected).length} files)`);
