// The only place console is allowed (eslint no-console). Callers pass an event name plus
// whitelisted fields; anything else is dropped, so names, URIs, bytes and results cannot leak.
const SAFE = ['phase', 'status', 'revision', 'httpStatus', 'notice', 'ignoredStatus', 'ignoredRevision'] as const;
type SafeKey = (typeof SAFE)[number];
export type LogFields = Partial<Record<SafeKey, string | number | null | undefined>>;
export type Log = (event: string, fields?: LogFields) => void;

export function redact(fields: Record<string, unknown> = {}): LogFields {
  const out: LogFields = {};
  for (const k of SAFE) {
    const v = fields[k];
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  return out;
}

export const devLog: Log = (event, fields) => {
  if (__DEV__) console.log(`[import] ${event}`, redact(fields));
};
