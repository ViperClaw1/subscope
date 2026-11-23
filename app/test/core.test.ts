import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyView } from '../src/core/guard';
import type { Transport } from '../src/core/ports';
import type { ImportOp } from '../src/core/types';
import { formatMinor, monthlyTotalMinor } from '../src/core/money';
import { makeCore, memoryStorage, newImport, nodeTransport, startMock, waitFor } from './helpers';

let mock: Awaited<ReturnType<typeof startMock>>;
beforeEach(async () => {
  mock = await startMock();
});
afterEach(() => mock.close());

const isReady = (core: ReturnType<typeof makeCore>) => () => core.getSnapshot().op?.status === 'ready';

describe('upload', () => {
  it('persists the key before POST, sends that key, reaches ready, drops the copy', async () => {
    const storage = memoryStorage();
    const { t, calls } = nodeTransport(mock.base);
    const order: string[] = [];
    const spied: Transport = { ...t, upload: (r) => (order.push('upload'), t.upload(r)) };
    const s = { ...storage.s, save: (op: ImportOp | null) => (order.push('save'), storage.s.save(op)) };
    const core = makeCore(s, spied);
    const file = newImport(mock.dir, 'statement.csv', 'csv');

    await core.start(file);
    await waitFor(isReady(core));

    expect(order.slice(0, 2)).toEqual(['save', 'upload']);
    expect(storage.log[0]).toMatchObject({ phase: 'uploading', idemKey: calls[0].headers!['Idempotency-Key'] });
    expect(calls[0].headers!['X-File-Name']).toBe('import.csv');
    expect(storage.peek()).toMatchObject({ phase: 'tracking', status: 'ready', revision: 3 });
    expect(storage.peek()!.copyUri).toBeUndefined();
    expect(existsSync(file.copyUri)).toBe(false);
    expect(await mock.stats()).toMatchObject({ createRequests: 1, newJobs: 1 });
  });

  it('lost_ack in-session: recovers by key, no second job', async () => {
    await mock.scenario('lost_ack');
    const core = makeCore(memoryStorage().s, nodeTransport(mock.base).t);
    await core.start(newImport(mock.dir, 'statement.pdf', 'pdf'));
    await waitFor(isReady(core));
    expect(await mock.stats()).toMatchObject({ createRequests: 1, newJobs: 1, duplicateHits: 0 });
  });

  it('lost_ack + kill + relaunch: resume never re-POSTs, reaches ready', async () => {
    await mock.scenario('lost_ack');
    const storage = memoryStorage();
    const a = nodeTransport(mock.base).t;
    // process "dies" while the POST is in flight: request reaches the server, the promise never settles
    const dying: Transport = { ...a, upload: (r) => a.upload(r).then(() => new Promise(() => {}), () => new Promise(() => {})) };
    void makeCore(storage.s, dying).start(newImport(mock.dir, 'statement.pdf', 'pdf'));
    await waitFor(() => storage.peek()?.phase === 'uploading');
    await waitFor(() => false, 300).catch(() => {}); // let the POST land

    const b = nodeTransport(mock.base);
    const core = makeCore(storage.s, b.t);
    await core.resume();
    await waitFor(isReady(core));

    expect(b.calls.some((c) => c.method === 'upload')).toBe(false);
    expect(await mock.stats()).toMatchObject({ createRequests: 1, newJobs: 1 });
  });

  it('by-key 404 → unknown_outcome; Retry re-POSTs with the same key and copy', async () => {
    const storage = memoryStorage();
    const { t, calls } = nodeTransport(mock.base);
    let fail = true; // first POST never reaches the server
    const flaky: Transport = { ...t, upload: (r) => (fail ? ((fail = false), Promise.reject(new Error('offline'))) : t.upload(r)) };
    const core = makeCore(storage.s, flaky);
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    expect(core.getSnapshot()).toMatchObject({ notice: 'unknown_outcome', op: { phase: 'unknown' } });

    const key = storage.peek()!.idemKey;
    await core.retry();
    await waitFor(isReady(core));
    expect(calls.find((c) => c.method === 'upload')!.headers!['Idempotency-Key']).toBe(key);
    expect(await mock.stats()).toMatchObject({ createRequests: 1, newJobs: 1 });
  });

  it('415 from the server → failed, copy removed', async () => {
    const core = makeCore(memoryStorage().s, nodeTransport(mock.base).t);
    const file = newImport(mock.dir, 'spoofed.pdf', 'pdf'); // bypasses the client sniff on purpose
    await core.start(file);
    expect(core.getSnapshot().op).toMatchObject({ phase: 'failed', httpStatus: 415 });
    expect(existsSync(file.copyUri)).toBe(false);
  });
});

describe('stale_status', () => {
  it('in-session: two refreshes keep ready/3 and record ignored processing/2', async () => {
    const core = makeCore(memoryStorage().s, nodeTransport(mock.base).t);
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    await waitFor(isReady(core));
    await mock.scenario('stale_status');
    await core.refresh(); // ready/3
    await core.refresh(); // processing/2
    expect(core.getSnapshot().op).toMatchObject({ status: 'ready', revision: 3, ignored: { status: 'processing', revision: 2 } });
  });

  it('after relaunch: persisted revision still rejects processing/2', async () => {
    const storage = memoryStorage();
    const a = makeCore(storage.s, nodeTransport(mock.base).t);
    await a.start(newImport(mock.dir, 'statement.csv', 'csv'));
    await waitFor(isReady(a));
    a.stopPolling();
    await mock.scenario('stale_status');
    await a.refresh(); // GET #1 → ready/3

    const b = makeCore(storage.s, nodeTransport(mock.base).t);
    await b.resume(); // GET #2 → processing/2
    expect(b.getSnapshot().op).toMatchObject({ status: 'ready', revision: 3, ignored: { status: 'processing', revision: 2 } });
    expect(b.getSnapshot().op!.result!.items).toHaveLength(2);
  });
});

describe('delete', () => {
  it('delete_failure: 503 stays unconfirmed; retry with the same key → deleted/5 tombstone', async () => {
    const storage = memoryStorage();
    const { t, calls } = nodeTransport(mock.base);
    const core = makeCore(storage.s, t);
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    await waitFor(isReady(core));

    await mock.scenario('delete_failure');
    await core.requestDelete();
    expect(core.getSnapshot()).toMatchObject({ notice: 'delete_unconfirmed', op: { phase: 'deleteRequested', status: 'ready' } });

    await mock.scenario('happy');
    await core.retryDelete();
    expect(core.getSnapshot().op!.status).toBe('deleting'); // 202 is not "deleted"
    await waitFor(() => core.getSnapshot().op?.phase === 'deleted');

    const keys = calls.filter((c) => c.method === 'deleteJob').map((c) => c.headers!['Idempotency-Key']);
    expect(new Set(keys).size).toBe(1);
    expect(storage.peek()).toMatchObject({ phase: 'deleted', status: 'deleted', revision: 5 });
    expect(storage.peek()!.result).toBeUndefined();
    expect(await mock.stats()).toMatchObject({ deleteRequests: 2 });
  });

  it('a late ready/3 arriving after deletion changes nothing', async () => {
    const { t } = nodeTransport(mock.base);
    let release!: () => void;
    let hold = false;
    const slow: Transport = {
      ...t,
      getJob: async (id) => {
        const res = await t.getJob(id);
        if (hold) await new Promise<void>((r) => (release = r));
        return res;
      },
    };
    const core = makeCore(memoryStorage().s, slow);
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    await waitFor(isReady(core));

    hold = true;
    const late = core.refresh(); // ready/3, held back
    await waitFor(() => release !== undefined);
    hold = false;
    await core.requestDelete();
    await waitFor(() => core.getSnapshot().op?.phase === 'deleted');
    release();
    await late;
    expect(core.getSnapshot().op).toMatchObject({ phase: 'deleted', revision: 5 });
  });
});

describe('relaunch during delete', () => {
  async function readyCore(storage: ReturnType<typeof memoryStorage>) {
    const core = makeCore(storage.s, nodeTransport(mock.base).t);
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    await waitFor(isReady(core));
    return core;
  }

  it('DELETE never landed (503) → relaunch offers "Retry delete", not "deleted"', async () => {
    const storage = memoryStorage();
    await mock.scenario('delete_failure');
    await (await readyCore(storage)).requestDelete();

    const b = makeCore(storage.s, nodeTransport(mock.base).t);
    await b.resume();
    expect(b.getSnapshot()).toMatchObject({ notice: 'delete_unconfirmed', op: { phase: 'deleteRequested' } });
  });

  it('relaunch offline during a failed delete → "Refresh status" later offers "Retry delete"', async () => {
    const storage = memoryStorage();
    await mock.scenario('delete_failure');
    await (await readyCore(storage)).requestDelete();
    await mock.scenario('happy');

    const { t } = nodeTransport(mock.base);
    let down = true;
    const flaky: Transport = { ...t, getJob: (id) => (down ? Promise.reject(new Error('offline')) : t.getJob(id)) };
    const b = makeCore(storage.s, flaky);
    await b.resume();
    expect(b.getSnapshot().notice).toBe('network');

    down = false;
    await b.refresh(); // server still says ready: the DELETE never landed
    expect(b.getSnapshot()).toMatchObject({ notice: 'delete_unconfirmed', op: { phase: 'deleteRequested' } });

    const key = storage.peek()!.deleteKey;
    await b.retryDelete();
    await waitFor(() => b.getSnapshot().op?.phase === 'deleted');
    expect(storage.peek()!.deleteKey).toBe(key);
  });

  it('job gone on the server (404) → gone, not "deleted", both on relaunch and on "Retry delete"', async () => {
    for (const via of ['resume', 'retry'] as const) {
      const storage = memoryStorage();
      await mock.scenario('delete_failure');
      const a = await readyCore(storage);
      await a.requestDelete();
      await fetch(`${mock.base}/__test/reset`, { method: 'POST' });

      const b = via === 'resume' ? makeCore(storage.s, nodeTransport(mock.base).t) : a;
      await (via === 'resume' ? b.resume() : b.retryDelete());
      expect(b.getSnapshot()).toMatchObject({ notice: null, op: { phase: 'gone' } });
      expect(storage.peek()).toMatchObject({ phase: 'gone' });
      expect(storage.peek()!.status).not.toBe('deleted');
      expect(storage.peek()!.result).toBeUndefined();
    }
  });

  it('DELETE landed (202) → relaunch polls to deleted/5', async () => {
    const storage = memoryStorage();
    const a = await readyCore(storage);
    await a.requestDelete();
    a.stopPolling();

    const b = makeCore(storage.s, nodeTransport(mock.base).t);
    await b.resume();
    await waitFor(() => b.getSnapshot().op?.phase === 'deleted');
    expect(b.getSnapshot().op!.revision).toBe(5);
  });
});

describe('network failures', () => {
  const offline = (t: Transport): Transport => {
    const fail = () => Promise.reject(new Error('offline'));
    return { upload: fail, getByKey: fail, getJob: fail, deleteJob: fail, ...{ _t: t } } as Transport;
  };

  it('relaunch while offline → "Check again"; retry() then looks up by key, never POSTs', async () => {
    const storage = memoryStorage();
    await storage.s.save({ opId: 'o1', idemKey: 'key-never-sent', copyUri: '/nope', format: 'csv', sizeBytes: 1, phase: 'uploading', revision: 0 });
    const net = nodeTransport(mock.base);
    const a = makeCore(storage.s, offline(net.t));
    await a.resume();
    expect(a.getSnapshot()).toMatchObject({ notice: 'network', op: { phase: 'unknown' } });

    const b = makeCore(storage.s, net.t);
    await b.resume();
    expect(b.getSnapshot().notice).toBe('unknown_outcome'); // server: 404 for that key
    expect(net.calls.map((c) => c.method)).toEqual(['getByKey']);
  });

  it('refresh while offline → network notice; next successful refresh clears it', async () => {
    const { t } = nodeTransport(mock.base);
    let down = false;
    const toggled: Transport = { ...t, getJob: (id) => (down ? Promise.reject(new Error('offline')) : t.getJob(id)) };
    const core = makeCore(memoryStorage().s, toggled);
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    await waitFor(isReady(core));
    down = true;
    await core.refresh();
    expect(core.getSnapshot().notice).toBe('network');
    down = false;
    await core.refresh();
    expect(core.getSnapshot().notice).toBeNull();
  });

  it('DELETE without a response → delete_unconfirmed, key kept for the retry', async () => {
    const storage = memoryStorage();
    const { t } = nodeTransport(mock.base);
    const noDelete: Transport = { ...t, deleteJob: () => Promise.reject(new Error('offline')) };
    const core = makeCore(storage.s, noDelete);
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    await waitFor(isReady(core));
    await core.requestDelete();
    expect(core.getSnapshot()).toMatchObject({ notice: 'delete_unconfirmed', op: { phase: 'deleteRequested' } });
    expect(storage.peek()!.deleteKey).toBeTruthy();
  });

  it('start() refuses while an upload is unresolved', async () => {
    const core = makeCore(memoryStorage().s, offline(nodeTransport(mock.base).t));
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    expect(core.canStart()).toBe(false);
    await expect(core.start(newImport(mock.dir, 'statement.csv', 'csv'))).rejects.toThrow();
  });
});

describe('replaced operation', () => {
  it("a response for the previous import never touches the new one", async () => {
    const { t } = nodeTransport(mock.base);
    let release!: () => void;
    let hold = false;
    const slow: Transport = {
      ...t,
      getJob: async (id) => {
        const res = await t.getJob(id);
        if (hold) await new Promise<void>((r) => (release = r));
        return res;
      },
    };
    const core = makeCore(memoryStorage().s, slow);
    await core.start(newImport(mock.dir, 'statement.csv', 'csv'));
    await waitFor(isReady(core));
    const firstJob = core.getSnapshot().op!.jobId;

    hold = true;
    const late = core.refresh(); // response for job 1, held back
    await waitFor(() => release !== undefined);
    hold = false;
    await core.start(newImport(mock.dir, 'statement.pdf', 'pdf')); // new op, job 2
    release();
    await late;

    const op = core.getSnapshot().op!;
    expect(op.jobId).not.toBe(firstJob);
    expect(op.ignored).toBeUndefined();
    await waitFor(isReady(core));
  });
});

describe('guard', () => {
  it('after a delete request, an older non-delete status is recorded as ignored', () => {
    const pending: ImportOp = { opId: 'o', idemKey: 'k', format: 'csv', sizeBytes: 1, phase: 'deleteRequested', jobId: 'job-demo-001', status: 'deleting', revision: 4 };
    expect(applyView(pending, { jobId: 'job-demo-001', status: 'ready', revision: 3 })).toMatchObject({ status: 'deleting', ignored: { status: 'ready', revision: 3 } });
  });
});

describe('guard', () => {
  const ready: ImportOp = { opId: 'o', idemKey: 'k', format: 'csv', sizeBytes: 1, phase: 'tracking', jobId: 'job-demo-001', status: 'ready', revision: 3 };

  it('a duplicate POST queued/1 after ready does not roll back', () => {
    expect(applyView(ready, { jobId: 'job-demo-001', status: 'queued', revision: 1 })).toMatchObject({ status: 'ready', revision: 3 });
  });
  it('drops responses for another job and repeats of the same revision', () => {
    expect(applyView(ready, { jobId: 'job-demo-002', status: 'deleted', revision: 5 })).toBe(ready);
    expect(applyView(ready, { jobId: 'job-demo-001', status: 'ready', revision: 3 })).toBe(ready);
  });
  it('deleted is terminal', () => {
    const gone = { ...ready, phase: 'deleted' as const, status: 'deleted' as const, revision: 5 };
    expect(applyView(gone, { jobId: 'job-demo-001', status: 'deleting', revision: 6 })).toBe(gone);
  });
  it('gone (delete got 404) is terminal: a late ready/3 is dropped', () => {
    const gone = { ...ready, phase: 'gone' as const, status: 'deleting' as const, revision: 2 };
    expect(applyView(gone, { jobId: 'job-demo-001', status: 'ready', revision: 3 })).toBe(gone);
  });
});

describe('money', () => {
  it('formats integer minor units', () => {
    expect(formatMinor(1999 + 13200)).toBe('151.99');
    expect(formatMinor(5)).toBe('0.05');
    expect(formatMinor(-100)).toBe('-1.00');
  });
  it('sums monthly items only', () => {
    const item = (amountMinor: number, cadence: string) => ({ id: 'x', merchant: 'm', amountMinor, cadence, lastSeen: '2026-10-01' });
    expect(monthlyTotalMinor([item(1999, 'monthly'), item(13200, 'monthly'), item(500, 'yearly')])).toBe(15199);
  });
});
