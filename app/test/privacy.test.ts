import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ImportCore } from '../src/core/importCore';
import { validate } from '../src/files/sniff';
import { redact } from '../src/log';
import { FIXTURES, memoryStorage, newImport, nodeTransport, startMock, waitFor } from './helpers';

let mock: Awaited<ReturnType<typeof startMock>>;
beforeEach(async () => {
  mock = await startMock();
});
afterEach(() => mock.close());

describe('rejected files never reach the server', () => {
  it('spoofed.pdf, oversize.csv, CRLF and BOM CSVs fail validate(); statement.csv passes and is the only POST', async () => {
    const head = (b: Uint8Array) => b.subarray(0, 24);
    const csv = new Uint8Array(readFileSync(join(FIXTURES, 'statement.csv')));
    const crlf = new TextEncoder().encode('date,description,amount\r\n2026-09-01,x,-1\r\n');
    const bom = new TextEncoder().encode('﻿date,description,amount\n');
    const spoofed = new Uint8Array(readFileSync(join(FIXTURES, 'spoofed.pdf')));

    const candidates = [
      { name: 'spoofed.pdf', head: head(spoofed), size: spoofed.length, expect: 'unsupported' },
      { name: 'oversize.csv', head: head(csv), size: 10 * 1024 * 1024 + 27, expect: 'too_large' },
      { name: 'crlf.csv', head: head(crlf), size: crlf.length, expect: 'unsupported' },
      { name: 'bom.csv', head: head(bom), size: bom.length, expect: 'unsupported' },
      { name: 'statement.pdf.csv', head: head(new Uint8Array(readFileSync(join(FIXTURES, 'statement.pdf')))), size: 33882, expect: 'extension_mismatch' },
    ];

    const { t } = nodeTransport(mock.base);
    const core = new ImportCore({ storage: memoryStorage().s, transport: t, uuid: randomUUID, deleteCopy: (p) => rmSync(p, { force: true }) });
    const before = await mock.stats();

    for (const c of candidates) {
      const verdict = validate(c.head, c.size, c.name);
      expect(verdict, c.name).toBe(c.expect);
      if (verdict === 'pdf' || verdict === 'csv') await core.start(newImport(mock.dir, 'statement.csv', verdict));
    }
    expect((await mock.stats()).createRequests).toBe(before.createRequests);

    expect(validate(head(csv), csv.length, 'statement.csv')).toBe('csv');
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    expect((await mock.stats()).createRequests).toBe(before.createRequests + 1);
  });
});

describe('redaction', () => {
  it('a full happy flow + delete logs no file name, merchant, amount, URI, key or bytes', async () => {
    const lines: string[] = [];
    const storage = memoryStorage();
    const core = new ImportCore({
      storage: storage.s,
      transport: nodeTransport(mock.base).t,
      uuid: randomUUID,
      deleteCopy: (p) => rmSync(p, { force: true }),
      log: (event, fields) => lines.push(JSON.stringify([event, fields])),
    });

    const file = newImport(mock.dir, 'statement.csv', 'csv');
    await core.start(file);
    await waitFor(() => core.getSnapshot().op?.status === 'ready');
    const { idemKey, jobId } = storage.peek()!;
    await core.requestDelete();
    await waitFor(() => core.getSnapshot().op?.phase === 'deleted');
    const deleteKey = storage.peek()!.deleteKey!;

    const out = lines.join('\n');
    expect(lines.length).toBeGreaterThan(3); // it did log
    expect(out).toContain('"status":"ready"');
    for (const secret of ['statement', 'StreamBeam', 'BrightGrid', '1999', '13200', file.copyUri, file.opId, idemKey, deleteKey, jobId!, 'date,description']) {
      expect(out, secret).not.toContain(secret);
    }
  });

  it('redact() drops every non-whitelisted field', () => {
    expect(redact({ phase: 'tracking', copyUri: '/x/statement.csv', displayName: 'Мой отчёт.pdf', result: { items: [] }, revision: 3 })).toEqual({
      phase: 'tracking',
      revision: 3,
    });
  });
});
