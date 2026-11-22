// Pick → private copy (cache/imports/<opId>.bin) → authoritative size → 24-byte sniff.
// Privacy: the picker URI and the original name never reach a path or a log.
// displayName is returned for the confirm screen only; never persist it.
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { type Format, type RejectReason, SNIFF_BYTES, tooLarge, validate } from './sniff';

export type { RejectReason };
export type PickedFile = { opId: string; copyUri: string; format: Format; sizeBytes: number; displayName: string };
export type PickResult =
  | { kind: 'ok'; file: PickedFile }
  | { kind: 'cancelled' }
  | { kind: 'rejected'; reason: RejectReason };

const importsDir = () => {
  const dir = new Directory(Paths.cache, 'imports');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
};

// Soft filter: Android providers report .csv as text/csv, text/comma-separated-values or text/plain.
// The sniff decides; spoofed.pdf must stay selectable so it can be rejected visibly.
const TYPES = ['application/pdf', 'text/csv', 'text/comma-separated-values', 'text/plain'];

export async function pickAndCopy(): Promise<PickResult> {
  let picked;
  try {
    // copyToCacheDirectory: the picker copies into its own cache folder before we see the size.
    // ponytail: so a >10 MB file is copied once, then rejected and deleted; nothing is ever sent.
    const res = await DocumentPicker.getDocumentAsync({ type: TYPES, copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.[0]) return { kind: 'cancelled' };
    picked = res.assets[0];
  } catch {
    return { kind: 'rejected', reason: 'copy_failed' }; // error text may contain the path: not surfaced
  }

  // The picker's copy keeps the original name in its path; move it to cache/imports/<opId>.bin at once.
  const opId = Crypto.randomUUID();
  const file = new File(picked.uri);
  const reject = (reason: RejectReason): PickResult => {
    deleteCopy(file.uri);
    return { kind: 'rejected', reason };
  };

  try {
    await file.move(new File(importsDir(), `${opId}.bin`));

    const sizeBytes = file.size;
    if (sizeBytes == null) return reject('copy_failed');
    if (tooLarge(sizeBytes)) return reject('too_large'); // don't even open it

    const handle = file.open();
    let head: Uint8Array;
    try {
      head = await handle.readBytes(Math.min(SNIFF_BYTES, sizeBytes));
    } finally {
      handle.close();
    }

    const format = validate(head, sizeBytes, picked.name);
    if (format !== 'pdf' && format !== 'csv') return reject(format);

    return { kind: 'ok', file: { opId, copyUri: file.uri, format, sizeBytes, displayName: picked.name } };
  } catch {
    return reject('copy_failed');
  }
}

export function deleteCopy(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // best effort; startup sweep catches leftovers
  }
}

// At startup: remove every copy except the one a persisted operation still needs.
// ponytail: only sweeps cache/imports/; a crash between picking and the move leaves the picker's
// own cache copy, which the OS cache eviction handles.
export function sweepOrphans(keepUri?: string) {
  for (const entry of importsDir().list()) {
    if (entry.uri !== keepUri) {
      try {
        entry.delete();
      } catch {
        // ignore
      }
    }
  }
}
