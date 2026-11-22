import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockServer } from '../../mobile-engineer-kit/mock-server.mjs';
import { ImportCore, type NewImport } from '../src/core/importCore';
import type { Res, Storage, Transport } from '../src/core/ports';
import type { ImportOp } from '../src/core/types';

export const FIXTURES = join(__dirname, '../../mobile-engineer-kit/fixtures');

/** Fresh mock per test: port 0 + temp state file, so the CLI mock on 8787 is never touched. */
export async function startMock() {
  const dir = mkdtempSync(join(tmpdir(), 'subscope-'));
  const server = createMockServer({ statePath: join(dir, 'state.json') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    dir,
    scenario: (mode: string) =>
      fetch(`${base}/__test/scenario`, { method: 'POST', body: JSON.stringify({ mode }) }).then((r) => r.json()),
    stats: async () =>
      ((await (await fetch(`${base}/__test/state`)).json()) as { stats: Record<string, number> }).stats,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const parse = async (r: Response): Promise<Res> => {
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) };
  } catch {
    return { status: r.status, body: null };
  }
};

/** Node twin of src/transport/rn.ts (copyUri is a plain path here). Records every call. */
export function nodeTransport(base: string) {
  const calls: { method: keyof Transport; headers?: Record<string, string> }[] = [];
  const t: Transport = {
    async upload({ idemKey, copyUri, format }) {
      const headers = { 'Content-Type': 'application/octet-stream', 'Idempotency-Key': idemKey, 'X-File-Name': `import.${format}` };
      calls.push({ method: 'upload', headers });
      return parse(await fetch(`${base}/imports`, { method: 'POST', headers, body: readFileSync(copyUri) }));
    },
    async getByKey(key) {
      calls.push({ method: 'getByKey' });
      return parse(await fetch(`${base}/imports/by-key/${encodeURIComponent(key)}`));
    },
    async getJob(jobId) {
      calls.push({ method: 'getJob' });
      return parse(await fetch(`${base}/imports/${jobId}`));
    },
    async deleteJob(jobId, key) {
      calls.push({ method: 'deleteJob', headers: { 'Idempotency-Key': key } });
      return parse(await fetch(`${base}/imports/${jobId}`, { method: 'DELETE', headers: { 'Idempotency-Key': key } }));
    },
  };
  return { t, calls };
}

export function memoryStorage() {
  let value: ImportOp | null = null;
  const log: ImportOp[] = [];
  const s: Storage = {
    load: async () => structuredClone(value),
    save: async (op) => {
      value = structuredClone(op);
      if (op) log.push(structuredClone(op));
    },
  };
  return { s, log, peek: () => value };
}

export const makeCore = (storage: Storage, transport: Transport) =>
  new ImportCore({ storage, transport, uuid: randomUUID, deleteCopy: (p) => rmSync(p, { force: true }) });

/** Copies a fixture into the test's temp dir, so deleting "the copy" never touches the kit. */
export function newImport(dir: string, fixture: string, format: 'pdf' | 'csv'): NewImport {
  const opId = randomUUID();
  const copyUri = join(dir, `${opId}.bin`);
  copyFileSync(join(FIXTURES, fixture), copyUri);
  return { opId, copyUri, format, sizeBytes: readFileSync(copyUri).length };
}

export async function waitFor(cond: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
