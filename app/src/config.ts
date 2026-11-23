// Base URL: EXPO_PUBLIC_MOCK_URL at build time, overridable at runtime from diagnostics.
// ponytail: override lives in memory only.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Dev on iOS: the mock on the PC that serves the JS bundle (Expo Go / dev client on the LAN). Android uses adb reverse. */
function devHostUrl(): string | null {
  if (!__DEV__ || Platform.OS !== 'ios') return null;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host && /^\d+\.\d+\.\d+\.\d+$/.test(host) ? `http://${host}:8787` : null; // tunnel hostnames don't reach the mock
}

let baseUrl = process.env.EXPO_PUBLIC_MOCK_URL ?? devHostUrl() ?? 'http://127.0.0.1:8787';

export const getBaseUrl = () => baseUrl;
export const setBaseUrl = (url: string) => {
  baseUrl = url.trim().replace(/\/+$/, '');
};
