import type { ConfigContext, ExpoConfig } from 'expo/config';

const ID = 'dev.klotsman.Subscope';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Subscope', // drives ios/Subscope.xcworkspace + scheme in CI
  slug: 'subscope',
  ios: {
    ...config.ios,
    bundleIdentifier: ID,
    infoPlist: {
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      NSLocalNetworkUsageDescription: 'Connect to the local test API', // only needed for iPhone over LAN
    },
  },
  android: {
    ...config.android,
    package: ID,
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
    ],
  },
  plugins: [
    ...(config.plugins ?? []).filter((p) => p !== 'expo-build-properties'),
    // release builds need cleartext to reach the http:// mock; debug already allows it
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
  ],
});
