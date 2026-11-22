// Base URL: EXPO_PUBLIC_MOCK_URL at build time, overridable at runtime from diagnostics
// (e.g. a LAN host for a physical iPhone). ponytail: override lives in memory only.
let baseUrl = process.env.EXPO_PUBLIC_MOCK_URL ?? 'http://127.0.0.1:8787';

export const getBaseUrl = () => baseUrl;
export const setBaseUrl = (url: string) => {
  baseUrl = url.trim().replace(/\/+$/, '');
};
