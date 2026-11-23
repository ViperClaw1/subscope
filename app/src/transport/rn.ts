// Device transport. upload streams the private copy from disk (the file is never loaded into JS memory).
import { FileSystemSessionType, FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';

import type { Res, Transport } from '../core/ports';
import type { JobView } from '../core/types';

const TIMEOUT_MS = 15_000;

const parse =(status: number, text: string): Res => {
  try {
    return { status, body: JSON.parse(text) as JobView };
  } catch {
    return { status, body: null };
  }
};

export function createRnTransport(base: () => string): Transport {
  const call = async (method: string, path: string, headers?: Record<string, string>) => {
    // RN's Android fetch has no read timeout: a request that never gets an answer would hang the UI forever.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${base()}${path}`, { method, headers, signal: ctl.signal });
      return parse(r.status, await r.text());
    } finally {
      clearTimeout(t);
    }
  };

  return {
    async upload({ idemKey, copyUri, format }) {
      const r = await uploadAsync(`${base()}/imports`, copyUri, {
        httpMethod: 'POST',
        uploadType: FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystemSessionType.FOREGROUND, // fail fast on a dropped connection
        headers: {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': idemKey,
          // Generic name: the real one is personal data, and non-ASCII crashes OkHttp header validation.
          'X-File-Name': `import.${format}`,
        },
      });
      return parse(r.status, r.body);
    },
    getByKey: (key) => call('GET', `/imports/by-key/${encodeURIComponent(key)}`),
    getJob: (jobId) => call('GET', `/imports/${encodeURIComponent(jobId)}`),
    deleteJob: (jobId, key) => call('DELETE', `/imports/${encodeURIComponent(jobId)}`, { 'Idempotency-Key': key }),
  };
}
