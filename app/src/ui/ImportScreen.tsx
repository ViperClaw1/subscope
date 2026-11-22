import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import { ActivityIndicator, AppState, Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Notice } from '../core/importCore';
import { formatMinor, monthlyTotalMinor } from '../core/money';
import type { ImportOp } from '../core/types';
import { deleteCopy, pickAndCopy, type PickedFile, type RejectReason, sweepOrphans } from '../files/importFile';
import { importCore } from '../instance';

// Constant-folded at build time: with diagnostics off, the require (and the module) is dropped.
// The condition must be written here literally: Metro does not fold through an imported constant.
const DiagnosticsPanel: ComponentType<{ op: ImportOp | null }> | null =
  __DEV__ || process.env.EXPO_PUBLIC_DIAGNOSTICS === '1'
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../diagnostics/DiagnosticsPanel').DiagnosticsPanel
  : null;

const REJECT_TEXT: Record<RejectReason, string> = {
  too_large: 'This file is larger than 10 MB.',
  unsupported: 'Only PDF or CSV bank statements are supported.',
  extension_mismatch: "This file's contents don't match its extension.",
  copy_failed: "Couldn't read this file. Try again.",
};

export function ImportScreen() {
  const { op, notice } = useSyncExternalStore(importCore.subscribe, importCore.getSnapshot);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [rejected, setRejected] = useState<RejectReason | null>(null);

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
    setRejected(null);
    const res = await pickAndCopy();
    if (res.kind === 'ok') setPicked(res.file);
    if (res.kind === 'rejected') setRejected(res.reason);
  }

  function cancel() {
    if (picked) deleteCopy(picked.copyUri);
    setPicked(null);
  }

  async function upload() {
    if (!picked) return;
    const { displayName: _name, ...file } = picked; // the name stays on the confirm screen only
    setPicked(null);
    await importCore.start(file);
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      {picked ? (
        <Confirm file={picked} onUpload={() => void upload()} onCancel={cancel} />
      ) : (
        <>
          <OpState op={op} notice={notice} />
          {rejected ? (
            <Text style={styles.error} accessibilityRole="alert">
              {REJECT_TEXT[rejected]}
            </Text>
          ) : null}
          {importCore.canStart() ? (
            <Button title={op ? 'Import another statement' : 'Choose statement'} onPress={() => void choose()} />
          ) : null}
        </>
      )}
      {DiagnosticsPanel ? <DiagnosticsPanel op={op} /> : null}
    </ScrollView>
  );
}

function Confirm({ file, onUpload, onCancel }: { file: PickedFile; onUpload: () => void; onCancel: () => void }) {
  return (
    <View style={styles.box}>
      <Text style={styles.h1}>Upload this statement?</Text>
      <Text>{file.displayName}</Text>
      <Text style={styles.muted}>
        {file.format.toUpperCase()} · {formatSize(file.sizeBytes)}
      </Text>
      <Text style={styles.muted}>It will be sent to the server to find recurring payments.</Text>
      <Button title="Upload" onPress={onUpload} />
      <Button title="Cancel" onPress={onCancel} />
    </View>
  );
}

function OpState({ op, notice }: { op: ImportOp | null; notice: Notice | null }) {
  const [details, setDetails] = useState(false);

  if (!op) {
    return (
      <View style={styles.box}>
        <Text style={styles.h1}>Find your subscriptions</Text>
        <Text style={styles.muted}>Choose a PDF or CSV bank statement up to 10 MB.</Text>
      </View>
    );
  }

  const offline = notice === 'network' ? (
    <Text style={styles.error} accessibilityRole="alert">
      {"Can't reach the server. Your import is saved; check again when you're online."}
    </Text>
  ) : null;

  switch (op.phase) {
    case 'uploading':
      return <Busy title="Uploading…" />;

    case 'unknown':
      return (
        <View style={styles.box}>
          <Text style={styles.h1}>Upload not confirmed</Text>
          {notice === 'unknown_outcome' ? (
            <>
              <Text>{"The server has no record of this upload yet. Retrying is safe: it can't create a duplicate."}</Text>
              <Button title="Retry upload" onPress={() => void importCore.retry()} />
            </>
          ) : notice === 'network' ? (
            <>
              {offline}
              <Button title="Check again" onPress={() => void importCore.retry()} />
            </>
          ) : (
            <Busy title="Checking whether the upload arrived…" />
          )}
        </View>
      );

    case 'failed':
      return (
        <View style={styles.box}>
          <Text style={styles.h1}>The server couldn&apos;t accept this file</Text>
          <Text style={styles.muted}>Error {op.httpStatus}. Try a different statement.</Text>
        </View>
      );

    case 'tracking':
      if (op.status !== 'ready' || !op.result) {
        return (
          <View style={styles.box}>
            <Busy title={op.status === 'processing' ? 'Analysing your statement…' : 'Waiting in the queue…'} />
            {offline}
            <Button title="Refresh status" onPress={() => void importCore.refresh()} />
          </View>
        );
      }
      return (
        <View style={styles.box}>
          <Text style={styles.h1}>Recurring payments found</Text>
          <Text style={styles.total} accessibilityLabel={`${formatMinor(monthlyTotalMinor(op.result.items))} ${op.result.currency} per month`}>
            {formatMinor(monthlyTotalMinor(op.result.items))} {op.result.currency} / month
          </Text>
          <Text style={styles.muted}>{op.result.items.length} subscriptions</Text>
          {offline}
          <Button title={details ? 'Hide details' : 'Details'} onPress={() => setDetails(!details)} />
          {details
            ? op.result.items.map((i) => (
                <View key={i.id} style={styles.item}>
                  <Text style={styles.merchant}>{i.merchant}</Text>
                  <Text>
                    {formatMinor(i.amountMinor)} {op.result!.currency} · {i.cadence}
                  </Text>
                  <Text style={styles.muted}>Last seen {i.lastSeen}</Text>
                </View>
              ))
            : null}
          <Button title="Refresh status" onPress={() => void importCore.refresh()} />
          <Button title="Delete my data from the server" color="#b00020" onPress={() => void importCore.requestDelete()} />
        </View>
      );

    case 'deleteRequested':
      if (notice === 'delete_unconfirmed') {
        return (
          <View style={styles.box}>
            <Text style={styles.h1}>Deletion not confirmed</Text>
            <Text>Your data may still be on the server.</Text>
            <Button title="Retry deletion" onPress={() => void importCore.retryDelete()} />
          </View>
        );
      }
      return (
        <View style={styles.box}>
          <Busy title={op.status === 'deleting' ? 'Deleting…' : 'Requesting deletion…'} />
          {offline}
          <Button title="Refresh status" onPress={() => void importCore.refresh()} />
        </View>
      );

    case 'deleted':
      return (
        <View style={styles.box}>
          <Text style={styles.h1}>Data deleted from the server</Text>
          <Text style={styles.muted}>The statement and its results are gone.</Text>
        </View>
      );
  }
}

function Busy({ title }: { title: string }) {
  return (
    <View style={styles.busy} accessible accessibilityLiveRegion="polite" accessibilityLabel={title}>
      <ActivityIndicator />
      <Text style={styles.h2}>{title}</Text>
    </View>
  );
}

const formatSize = (b: number) => (b < 1024 * 1024 ? `${Math.ceil(b / 1024)} KB` : `${formatMinor(Math.round((b / (1024 * 1024)) * 100))} MB`);

const styles = StyleSheet.create({
  root: { flexGrow: 1, gap: 16, padding: 16, justifyContent: 'center' },
  box: { gap: 10 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  h1: { fontSize: 22, fontWeight: '600' },
  h2: { fontSize: 18, flexShrink: 1 },
  total: { fontSize: 32, fontWeight: '700' },
  muted: { opacity: 0.7 },
  error: { color: '#b00020' },
  item: { paddingVertical: 6, gap: 2 },
  merchant: { fontWeight: '600' },
});
