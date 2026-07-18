import type { ExpoConfig } from 'expo/config';

// 실 EAS projectId·소셜/지도 SDK 키는 사용자 프로비저닝 시 주입한다(스캐폴드는 placeholder).
// 소셜(카카오/네이버)·지도 SDK config plugin 은 실 네이티브 키가 필요하므로 auth·map 유닛에서 배선한다.
const config: ExpoConfig = {
  name: 'TripPilot',
  slug: 'trippilot',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'trippilot',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.trippilot.app',
  },
  android: {
    package: 'com.trippilot.app',
    edgeToEdgeEnabled: true,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'TripPilot가 주변 여행지와 동선을 추천하기 위해 위치를 사용합니다.',
      },
    ],
    'expo-notifications',
    [
      '@sentry/react-native/expo',
      {
        organization: 'trippilot',
        project: 'trippilot-frontend',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: '00000000-0000-0000-0000-000000000000',
    },
  },
};

export default config;
