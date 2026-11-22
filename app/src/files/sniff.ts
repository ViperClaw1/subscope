// Byte-exact port of the mock's format() rule (mobile-engineer-kit/mock-server.mjs):
//   pdf: starts with "%PDF-"
//   csv: first 24 bytes, with \r removed, start with "date,description,amount\n"
// Consequence (deliberate, mirrors the server): CRLF and BOM-prefixed CSVs are rejected.
// Removing 0x0D bytes equals removing '\r' chars: 0x0D never occurs inside a multi-byte UTF-8 sequence.

export const MAX_BYTES = 10 * 1024 * 1024; // server rejects only when size > limit
export const SNIFF_BYTES = 24;

export type Format = 'pdf' | 'csv';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const PDF = ascii('%PDF-');
const CSV = ascii('date,description,amount\n');

const startsWith = (bytes: ArrayLike<number>, prefix: number[]) =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

export function sniff(head: Uint8Array): Format | null {
  if (startsWith(head, PDF)) return 'pdf';
  if (startsWith(head.subarray(0, SNIFF_BYTES).filter((b) => b !== 0x0d), CSV)) return 'csv';
  return null;
}

export const tooLarge = (sizeBytes: number) => sizeBytes > MAX_BYTES;

// Conservative: content decides the format, and the name's extension must agree with it.
export const extensionMatches = (name: string | null, format: Format) =>
  (name ?? '').toLowerCase().endsWith(`.${format}`);
