import type { Format } from '../files/sniff';

export type JobStatus = 'queued' | 'processing' | 'ready' | 'deleting' | 'deleted';

export type Item = { id: string; merchant: string; amountMinor: number; cadence: string; lastSeen: string };

/** What the server returns for POST 202 / GET / by-key / DELETE 202. */
export type JobView = {
  jobId: string;
  status: JobStatus;
  revision: number;
  currency?: string;
  items?: Item[];
};

export type Phase = 'uploading' | 'unknown' | 'tracking' | 'deleteRequested' | 'deleted' | 'failed';

/** Persisted before the POST. displayName is deliberately absent: it never leaves memory. */
export type ImportOp = {
  opId: string; // also the copy's file name: cache/imports/<opId>.bin
  idemKey: string;
  copyUri?: string; // removed once the server confirms the job
  format: Format;
  sizeBytes: number;
  phase: Phase;
  jobId?: string;
  status?: JobStatus;
  revision: number; // 0 until the first server response
  result?: { currency: string; items: Item[] }; // kept so a relaunch can still reject stale responses
  deleteKey?: string; // fresh per job, persisted before DELETE
  ignored?: { status: JobStatus; revision: number }; // last discarded response, for diagnostics
  httpStatus?: number; // why phase === 'failed'
};
