// Reviewer-only panel. Loaded via a build-time-dead require in the screen, so a release
// bundle built without EXPO_PUBLIC_DIAGNOSTICS=1 contains none of this (CI greps for it).
import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';

import { getBaseUrl, setBaseUrl } from '../config';
import type { ImportOp } from '../core/types';

const MODES = ['happy', 'lost_ack', 'stale_status', 'delete_failure'] as const;

type MockState = { mode: string; stats: Record<string, number> };

export function DiagnosticsPanel({ op }: { op: ImportOp | null }) {
  const [url, setUrl] = useState(getBaseUrl());
  const [state, setState] = useState<MockState | null>(null);
  const [error, setError] = useState('');

  async function call(method: 'GET' | 'POST', path: string, body?: object) {
    setError('');
    try {
      const r = await fetch(`${getBaseUrl()}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const s = await fetch(`${getBaseUrl()}/__test/state`);
      setState((await s.json()) as MockState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    }
  }

  return (
    <View style={styles.panel} accessibilityLabel="Diagnostics">
      <Text style={styles.title}>Diagnostics</Text>

      <Text>Base URL</Text>
      <TextInput
        value={url}
        onChangeText={setUrl}
        onEndEditing={() => setBaseUrl(url)}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={styles.input}
        accessibilityLabel="Mock base URL"
      />

      <View style={styles.row}>
        {MODES.map((mode) => (
          <View key={mode} style={styles.cell}>
            <Button title={mode} onPress={() => void call('POST', '/__test/scenario', { mode })} />
          </View>
        ))}
      </View>
      <View style={styles.row}>
        <View style={styles.cell}>
          <Button title="Mock state" onPress={() => void call('GET', '/health')} />
        </View>
        <View style={styles.cell}>
          <Button title="Reset mock" onPress={() => void call('POST', '/__test/reset')} />
        </View>
      </View>

      {error ? <Text accessibilityLiveRegion="polite">Error: {error}</Text> : null}
      {state ? (
        <Text selectable>
          mode {state.mode} · {Object.entries(state.stats).map(([k, v]) => `${k}=${v}`).join(' · ')}
        </Text>
      ) : null}

      <Text selectable>
        local: {op ? `${op.phase} · ${op.status ?? '—'} r${op.revision}` : 'no import'}
        {op?.ignored ? ` · ignored ${op.ignored.status} r${op.ignored.revision}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 8, marginTop: 24, padding: 12, borderWidth: 1, borderColor: '#999', borderRadius: 8 },
  title: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 6, padding: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexGrow: 1 },
});
