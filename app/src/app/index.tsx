import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BASE_URL } from '../config';
import { formatMinor, monthlyTotalMinor } from '../core/money';
import { deleteCopy, pickAndCopy, type PickedFile, type RejectReason, sweepOrphans } from '../files/importFile';
import { importCore } from '../instance';

// ponytail: interim screen to exercise steps 2–4 on a device; the real UI comes in step 6
const REJECT_TEXT: Record<RejectReason, string> = {
  too_large: 'File is larger than 10 MB.',
  unsupported: 'Only PDF or CSV statements are supported.',
  extension_mismatch: "The file's contents don't match its extension.",
  copy_failed: "Couldn't read the file. Try again.",
};

const NOTICE_TEXT = {
  unknown_outcome: "Upload outcome unknown. The server has no record of it — you can retry safely.",
  network: "Can't reach the server.",
  delete_unconfirmed: 'Deletion not confirmed.',
} as const;

export default function Index() {
  const { op, notice } = useSyncExternalStore(importCore.subscribe, importCore.getSnapshot);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void (async () => {
      await importCore.resume();
      sweepOrphans(importCore.getSnapshot().op?.copyUri); // keep only the copy a pending upload still needs
    })();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void importCore.refresh();
        importCore.startPolling();
      } else {
        importCore.stopPolling();
      }
    });
    return () => sub.remove();
  }, []);

  async function choose() {
    if (picked) deleteCopy(picked.copyUri);
    setPicked(null);
    const res = await pickAndCopy();
    if (res.kind === 'ok') setPicked(res.file);
    setMessage(res.kind === 'rejected' ? REJECT_TEXT[res.reason] : '');
  }

  function cancel() {
    if (picked) deleteCopy(picked.copyUri);
    setPicked(null);
  }

  async function upload() {
    if (!picked) return;
    const { displayName: _name, ...file } = picked; // the name stays on this screen only
    setPicked(null);
    await importCore.start(file);
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text>{BASE_URL}</Text>

      {picked ? (
        <View style={styles.box}>
          <Text>{picked.displayName}</Text>
          <Text>
            {picked.format.toUpperCase()} · {picked.sizeBytes} bytes
          </Text>
          <Button title="Upload" onPress={() => void upload()} />
          <Button title="Cancel" onPress={cancel} />
        </View>
      ) : (
        <Button title="Choose statement" disabled={!importCore.canStart()} onPress={() => void choose()} />
      )}
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}

      {op ? (
        <View style={styles.box}>
          <Text accessibilityLiveRegion="polite">{statusLine(op.phase, op.status)}</Text>
          {notice ? <Text accessibilityLiveRegion="polite">{NOTICE_TEXT[notice]}</Text> : null}

          {op.status === 'ready' && op.result && op.phase === 'tracking' ? (
            <View style={styles.box}>
              <Text>
                {formatMinor(monthlyTotalMinor(op.result.items))} {op.result.currency} / month
              </Text>
              {op.result.items.map((i) => (
                <Text key={i.id}>
                  {i.merchant}: {formatMinor(i.amountMinor)} {op.result!.currency}, {i.cadence}, last seen {i.lastSeen}
                </Text>
              ))}
            </View>
          ) : null}

          {op.phase === 'unknown' && notice ? (
            <Button title={notice === 'unknown_outcome' ? 'Retry upload' : 'Check again'} onPress={() => void importCore.retry()} />
          ) : null}
          {op.phase === 'tracking' || op.phase === 'deleteRequested' ? (
            <Button title="Refresh status" onPress={() => void importCore.refresh()} />
          ) : null}
          {op.phase === 'tracking' && op.status === 'ready' ? (
            <Button title="Delete from server" onPress={() => void importCore.requestDelete()} />
          ) : null}
          {op.phase === 'deleteRequested' && notice === 'delete_unconfirmed' ? (
            <Button title="Retry delete" onPress={() => void importCore.retryDelete()} />
          ) : null}

          {op.ignored ? (
            <Text style={styles.diag}>
              ignored: {op.ignored.status} r{op.ignored.revision} (current r{op.revision})
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function statusLine(phase: string, status?: string) {
  switch (phase) {
    case 'uploading':
      return 'Uploading…';
    case 'unknown':
      return 'Checking whether the upload arrived…';
    case 'failed':
      return 'The server rejected this file.';
    case 'deleted':
      return 'Data deleted from the server.';
    case 'deleteRequested':
      return status === 'deleting' ? 'Deleting…' : 'Deletion requested…';
    default:
      return status === 'ready' ? 'Ready' : status === 'processing' ? 'Processing…' : 'Queued…';
  }
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, gap: 12, padding: 16, justifyContent: 'center' },
  box: { gap: 8 },
  diag: { opacity: 0.6 },
});
