// Pick → private copy (cache/imports/<opId>.bin) → authoritative size → 24-byte sniff.
// Privacy: the picker URI and the original name never reach a path or a log.
// displayName is returned for the confirm screen only; never persist it.
import { errorCodes, isErrorWithCode, keepLocalCopy, pick, types } from '@react-native-documents/picker';
import * as Crypto from 'expo-crypto';
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

export async function pickAndCopy(): Promise<PickResult> {
  let picked;
  try {
    // Soft filter: Android providers report .csv as text/csv, text/comma-separated-values or text/plain.
    // The sniff decides; spoofed.pdf must stay selectable so it can be rejected visibly.
    [picked] = await pick({ type: [types.pdf, types.csv, types.plainText] });
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return { kind: 'cancelled' };
    return { kind: 'rejected', reason: 'copy_failed' };
  }

  // Reject before copying when metadata already says too large. size may be null → check the copy.
  if (picked.size != null && tooLarge(picked.size)) return { kind: 'rejected', reason: 'too_large' };

  const opId = Crypto.randomUUID();
  const [copy] = await keepLocalCopy({
    files: [{ uri: picked.uri, fileName: `${opId}.bin` }],
    destination: 'cachesDirectory',
  });
  // copyError text can contain the source path: deliberately not surfaced or logged.
  if (copy.status !== 'success') return { kind: 'rejected', reason: 'copy_failed' };

  // keepLocalCopy writes to cache/<random-uuid>/<opId>.bin; move into our own folder and drop its temp dir.
  const file = new File(copy.localUri);
  const pickerTmpDir = file.parentDirectory;
  const reject = (reason: RejectReason): PickResult => {
    deleteCopy(file.uri);
    return { kind: 'rejected', reason };
  };

  try {
    await file.move(new File(importsDir(), `${opId}.bin`));
    pickerTmpDir.delete();

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

    return { kind: 'ok', file: { opId, copyUri: file.uri, format, sizeBytes, displayName: picked.name ?? '' } };
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
// ponytail: only sweeps cache/imports/; a crash between keepLocalCopy and move leaves a
// cache/<uuid>/ dir, which the OS cache eviction handles.
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
