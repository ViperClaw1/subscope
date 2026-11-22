import type { Format } from '../files/sniff';
import type { ImportOp, JobView } from './types';

export type Res = { status: number; body: JobView | null };

/** Every method throws on a network failure (no HTTP status received). */
export interface Transport {
  upload(req: { idemKey: string; copyUri: string; format: Format }): Promise<Res>;
  getByKey(idemKey: string): Promise<Res>;
  getJob(jobId: string): Promise<Res>;
  deleteJob(jobId: string, deleteKey: string): Promise<Res>;
}

export interface Storage {
  load(): Promise<ImportOp | null>;
  save(op: ImportOp | null): Promise<void>;
}
