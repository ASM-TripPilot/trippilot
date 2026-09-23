import type { ExpoConfig } from 'expo/config';

// 실 EAS projectId·소셜/지도 SDK 키는 사용자 프로비저닝 시 주입한다(스캐폴드는 placeholder).
// 소셜(카카오/네이버)·지도 SDK config plugin 은 실 네이티브 키가 필요하므로 auth·map 유닛에서 배선한다.

// TRIP-210 — 카카오 네이티브 앱 키·네이버 urlScheme. 값은 env 에서만 읽는다(리터럴 커밋 금지 ·
// AC-7). 미설정 시 빈 문자열 — config plugin 은 그대로 통과시키고, 실 로그인 시도는
// makeAuthorize.ts 가 같은 env 부재로 SDK 경로에 들어가지 않아 걸러진다(INV-4).
const kakaoNativeAppKey = process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY ?? '';
const naverUrlScheme = process.env.EXPO_PUBLIC_NAVER_URL_SCHEME ?? '';

// TRIP-862 — 네이버 지도 SDK Client ID(NCP Maps 앱 등록). 로그인용 EXPO_PUBLIC_NAVER_CLIENT_ID
// 와는 다른 키다. 리터럴 커밋 금지 — env 에서만 읽는다(mapBridgeStructure A-3). 미설정 시 빈
// 문자열이면 config plugin 은 그대로 통과하고, 지도 렌더 실패는 shared/map 의 map-failure
// 표면으로 드러난다(INV-4, S1 계승).
const naverMapClientId = process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID ?? '';

const config: ExpoConfig = {
  name: 'TripPilot',
  slug: 'trippilot',
  version: '0.1.0',
  orientation: 'portrait',
  // TRIP-936 임시 아이콘(1024 불투명 RGB — App Store 는 알파 채널을 거부한다). 사람이 교체.
  icon: './assets/icon.png',
  scheme: 'trippilot',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.trippilot.travel',
    config: {
      usesNonExemptEncryption: false,
    },
    // TRIP-936 — required-reason API 선언(ITMS-91053). 수집 데이터 유형은 사람 판단이라 비워 둔다.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1', '0A2A.1', '3B52.1'],
        },
        {
          NSPrivacyAccessedAPIType:
            'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'],
        },
      ],
    },
  },
  android: {
    package: 'com.trippilot.travel',
    edgeToEdgeEnabled: true,
  },
  plugins: [
    // TRIP-935 R3 — 개발용 라우트 목록(/_sitemap)을 운영 빌드에서 끈다. 네이티브 설정이라 재빌드 필요.
    ['expo-router', { sitemap: false }],
    // 옵션을 false(불리언)로 줘야 플러그인이 영문 기본 권한 문구를 Info.plist 에서 지운다 —
    // 문자열 'false'·생략은 문구가 남는다. Face ID·"항상 허용" 위치는 쓰지 않는다(TRIP-936).
    ['expo-secure-store', { faceIDPermission: false }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'TripPilot가 주변 여행지와 동선을 추천하기 위해 위치를 사용합니다.',
        locationAlwaysPermission: false,
        locationAlwaysAndWhenInUsePermission: false,
      },
    ],
    // 튜플로 줘야 한다 — 문자열 단독이면 레거시 config.splash 경로로 빠진다.
    ['expo-splash-screen', { backgroundColor: '#ffffff' }],
    'expo-notifications',
    [
      '@sentry/react-native/expo',
      {
        organization: 'trippilot',
        project: 'trippilot-frontend',
      },
    ],
    ['@react-native-seoul/kakao-login', { kakaoAppKey: kakaoNativeAppKey }],
    ['@react-native-seoul/naver-login', { urlScheme: naverUrlScheme }],
    [
      'expo-build-properties',
      {
        android: {
          // 네이버 지도 SDK 는 네이버 사설 maven 저장소에서 받는다 — config plugin 이
          // 저장소를 추가하지 않으므로(2026-09-15 실측) 여기서 명시해야 Android 빌드가 SDK 를 찾는다.
          extraMavenRepos: ['https://repository.map.naver.com/archive/maven'],
        },
      },
    ],
    ['@mj-studio/react-native-naver-map', { client_id: naverMapClientId }],
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
