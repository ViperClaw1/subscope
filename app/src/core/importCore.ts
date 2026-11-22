import { applyView } from './guard';
import type { Storage, Transport } from './ports';
import type { ImportOp, JobView } from './types';

/** Transient, not persisted: what the UI should offer right now. */
export type Notice =
  | 'unknown_outcome' // by-key 404 after a lost POST response → "Retry" (same key, same copy)
  | 'network' // couldn't reach the server → "Check again"
  | 'delete_unconfirmed'; // DELETE failed or unknown → "Retry delete" (same deleteKey)

export type Snapshot = { op: ImportOp | null; notice: Notice | null };

export type NewImport = { opId: string; copyUri: string; format: ImportOp['format']; sizeBytes: number };

type Deps = {
  storage: Storage;
  transport: Transport;
  uuid: () => string;
  deleteCopy: (uri: string) => void;
  sleep?: (ms: number) => Promise<void>;
};

const POLL_START_MS = 400;
const POLL_MAX_MS = 2000;

export class ImportCore {
  private snap: Snapshot = { op: null, notice: null };
  private listeners = new Set<() => void>();
  private saving: Promise<void> = Promise.resolve();
  private pollToken = 0;
  private sleep: (ms: number) => Promise<void>;

  constructor(private d: Deps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ---------- state ----------
  getSnapshot = () => this.snap;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  private setNotice(notice: Notice | null) {
    this.snap = { ...this.snap, notice };
    this.listeners.forEach((l) => l());
  }

  /** Updates memory, then persists. Saves are chained so they land in order. Throws if the save fails. */
  private async commit(op: ImportOp | null, notice: Notice | null = this.snap.notice) {
    this.snap = { op, notice };
    this.listeners.forEach((l) => l());
    this.saving = this.saving.catch(() => {}).then(() => this.d.storage.save(op));
    await this.saving;
  }

  /** The op, if it is still the one a response was requested for. Late answers for a replaced op are dropped. */
  private current(opId: string) {
    const op = this.snap.op;
    return op && op.opId === opId ? op : null;
  }

  private async apply(opId: string, view: JobView) {
    const op = this.current(opId);
    if (!op) return;
    const next = applyView(op, view);
    const notice = this.snap.notice === 'network' ? null : this.snap.notice;
    if (next !== op || notice !== this.snap.notice) await this.commit(next, notice);
  }

  private dropCopy(op: ImportOp): ImportOp {
    if (op.copyUri) this.d.deleteCopy(op.copyUri);
    const { copyUri: _drop, ...rest } = op;
    return rest;
  }

  // ---------- upload ----------
  canStart() {
    const p = this.snap.op?.phase;
    return p !== 'uploading' && p !== 'unknown' && p !== 'deleteRequested';
  }

  async start(file: NewImport) {
    if (!this.canStart()) throw new Error('an import is already in progress');
    this.stopPolling();
    const op: ImportOp = {
      opId: file.opId,
      idemKey: this.d.uuid(),
      copyUri: file.copyUri,
      format: file.format,
      sizeBytes: file.sizeBytes,
      phase: 'uploading',
      revision: 0,
    };
    await this.commit(op, null); // the key is on disk before any byte is sent
    await this.upload(op.opId);
  }

  private async upload(opId: string) {
    const op = this.current(opId);
    if (!op?.copyUri) return;
    let res;
    try {
      res = await this.d.transport.upload({ idemKey: op.idemKey, copyUri: op.copyUri, format: op.format });
    } catch {
      return this.recoverByKey(opId);
    }
    const now = this.current(opId);
    if (!now) return;
    if (res.status === 202 && res.body) return this.confirmJob(opId, res.body);
    // 415/413: our sniff disagreed with the server (a bug). 409/400: should be unreachable.
    await this.commit({ ...this.dropCopy(now), phase: 'failed', httpStatus: res.status }, null);
  }

  /** First confirmation of the job (POST 202 or by-key 200). Only moves forward from uploading/unknown. */
  private async confirmJob(opId: string, view: JobView) {
    const op = this.current(opId);
    if (!op) return;
    if (op.phase !== 'uploading' && op.phase !== 'unknown') return this.apply(opId, view); // e.g. late duplicate queued/1
    const tracking: ImportOp = { ...this.dropCopy(op), phase: 'tracking', jobId: view.jobId };
    await this.commit(applyView(tracking, view), null);
    this.startPolling();
  }

  private async recoverByKey(opId: string) {
    let op = this.current(opId);
    if (!op) return;
    if (op.phase === 'uploading') {
      op = { ...op, phase: 'unknown' };
      await this.commit(op);
    }
    let res;
    try {
      res = await this.d.transport.getByKey(op.idemKey);
    } catch {
      if (this.current(opId)) this.setNotice('network');
      return;
    }
    if (!this.current(opId)) return;
    if (res.status === 200 && res.body) return this.confirmJob(opId, res.body);
    this.setNotice(res.status === 404 ? 'unknown_outcome' : 'network');
  }

  /** "Retry" after unknown_outcome re-POSTs with the same key and copy; otherwise "Check again" asks by-key. */
  async retry() {
    const op = this.snap.op;
    if (!op || op.phase !== 'unknown') return;
    if (this.snap.notice === 'unknown_outcome' && op.copyUri) {
      await this.commit({ ...op, phase: 'uploading' }, null);
      return this.upload(op.opId);
    }
    this.setNotice(null);
    return this.recoverByKey(op.opId);
  }

  // ---------- relaunch ----------
  /** Never re-POSTs on its own: an interrupted upload is only ever looked up by key. */
  async resume() {
    const op = await this.d.storage.load();
    this.snap = { op, notice: null };
    this.listeners.forEach((l) => l());
    if (!op) return;
    switch (op.phase) {
      case 'uploading':
      case 'unknown':
        return this.recoverByKey(op.opId);
      case 'tracking':
        await this.refresh();
        return this.startPolling();
      case 'deleteRequested':
        return this.checkDelete(op.opId);
    }
  }

  /** Where does a requested delete stand? Used on relaunch and by "Refresh status". */
  private async checkDelete(opId: string) {
    const view = await this.fetchJob(opId);
    if (!view || !this.current(opId)) return;
    if (view.status === 'deleting') return this.startPolling();
    if (view.status !== 'deleted') this.setNotice('delete_unconfirmed'); // DELETE never landed
  }

  // ---------- status ----------
  private async fetchJob(opId: string): Promise<JobView | null> {
    const op = this.current(opId);
    if (!op?.jobId) return null;
    let res;
    try {
      res = await this.d.transport.getJob(op.jobId);
    } catch {
      if (this.current(opId)) this.setNotice('network');
      return null;
    }
    if (res.status !== 200 || !res.body) return null;
    await this.apply(opId, res.body);
    return res.body;
  }

  /** "Refresh status" button and AppState → active. Works after polling stopped at ready. */
  async refresh() {
    const op = this.snap.op;
    if (op?.phase === 'tracking') await this.fetchJob(op.opId);
    if (op?.phase === 'deleteRequested') await this.checkDelete(op.opId);
  }

  private needsPolling(op: ImportOp | null) {
    if (!op) return false;
    if (op.phase === 'tracking') return op.status !== 'ready';
    return op.phase === 'deleteRequested' && op.status === 'deleting';
  }

  startPolling() {
    const token = ++this.pollToken;
    void this.pollLoop(token);
  }

  stopPolling() {
    this.pollToken++;
  }

  private async pollLoop(token: number) {
    let delay = POLL_START_MS;
    while (token === this.pollToken && this.needsPolling(this.snap.op)) {
      await this.sleep(delay);
      const op = this.snap.op;
      if (token !== this.pollToken || !op || !this.needsPolling(op)) return;
      await this.fetchJob(op.opId);
      delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.5));
    }
  }

  // ---------- delete ----------
  async requestDelete() {
    const op = this.snap.op;
    if (!op || op.phase !== 'tracking' || !op.jobId) return;
    this.stopPolling();
    await this.commit({ ...op, phase: 'deleteRequested', deleteKey: this.d.uuid() }, null); // key on disk first
    return this.sendDelete(op.opId);
  }

  /** Same deleteKey every time for this job. */
  async retryDelete() {
    const op = this.snap.op;
    if (op?.phase === 'deleteRequested') return this.sendDelete(op.opId);
  }

  private async sendDelete(opId: string) {
    const op = this.current(opId);
    if (!op?.jobId || !op.deleteKey) return;
    this.setNotice(null);
    let res;
    try {
      res = await this.d.transport.deleteJob(op.jobId, op.deleteKey);
    } catch {
      if (this.current(opId)) this.setNotice('delete_unconfirmed');
      return;
    }
    if (!this.current(opId)) return;
    if (res.status !== 202 || !res.body) return this.setNotice('delete_unconfirmed'); // e.g. 503
    await this.apply(opId, res.body); // deleting/4 — never shown as "deleted"
    this.startPolling();
  }
}
