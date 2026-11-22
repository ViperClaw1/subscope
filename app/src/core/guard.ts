import type { ImportOp, JobView } from './types';

/**
 * Revision guard. Returns op unchanged (same reference) when nothing should change.
 *  - responses for another job are dropped
 *  - `deleted` is terminal (the op then is the tombstone {jobId, revision: 5})
 *  - after a delete request only `deleting` / `deleted` may apply
 *  - otherwise only a strictly newer revision applies
 * Strictly older or wrong-phase responses are recorded in `ignored` for diagnostics;
 * an equal revision is just a repeat and is not recorded.
 */
export function applyView(op: ImportOp, v: JobView): ImportOp {
  if (op.jobId && v.jobId !== op.jobId) return op;
  if (op.phase === 'deleted') return op;

  const ignore = (): ImportOp => ({ ...op, ignored: { status: v.status, revision: v.revision } });
  if (op.phase === 'deleteRequested' && v.status !== 'deleting' && v.status !== 'deleted') {
    return v.revision < op.revision ? ignore() : op;
  }
  if (v.revision < op.revision) return ignore();
  if (v.revision === op.revision) return op;

  const next: ImportOp = { ...op, jobId: v.jobId, status: v.status, revision: v.revision };
  if (v.status === 'ready' && v.items) next.result = { currency: v.currency ?? '', items: v.items };
  if (v.status === 'deleted') {
    next.phase = 'deleted';
    delete next.result;
  }
  return next;
}
