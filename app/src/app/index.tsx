import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

// ponytail: step-1 smoke screen (GET /health from device); replaced by the import flow in step 6
const BASE_URL = process.env.EXPO_PUBLIC_MOCK_URL ?? 'http://127.0.0.1:8787';

export default function Index() {
  const [status, setStatus] = useState('not checked');

  async function check() {
    setStatus('checking…');
    try {
      const res = await fetch(`${BASE_URL}/health`);
      setStatus(`HTTP ${res.status}`);
    } catch {
      setStatus('network error');
    }
  }

  return (
    <View style={styles.root}>
      <Text>{BASE_URL}</Text>
      <Text accessibilityLiveRegion="polite">Mock: {status}</Text>
      <Button title="Check /health" onPress={() => void check()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: 12, padding: 16, justifyContent: 'center' },
});
