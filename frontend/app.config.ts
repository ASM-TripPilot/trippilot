import type { ExpoConfig } from 'expo/config';
import { withEntitlementsPlist } from 'expo/config-plugins';

// 소셜/지도 SDK 키는 사용자 프로비저닝 시 주입한다(스캐폴드는 placeholder).
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

// TRIP-1070 — 사진 앨범 권한 문구(expo-image-picker·expo-media-library 공용).
const PHOTOS_PERMISSION =
  'TripPilot가 방문한 곳의 사진을 기록에 보여 주기 위해 사진 보관함에 접근합니다.';

const config: ExpoConfig = {
  name: 'TripPilot',
  slug: 'trippilot',
  version: '1.0.0',
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
    // TRIP-1161 — 라우트 루트를 루트 app/ 로 고정한다. Expo CLI 는 src/app 이 **있으면 무조건** 그것을 라우트 루트로
    // 고른다(@expo/cli getRouterDirectory) — src/app 은 이제 FSD app 층이라 이 옵션이 없으면 그 층 파일(테스트 포함)이
    // 화면으로 등록된다. 번들 시점(babel caller routerRoot)에만 쓰이는 값이라 네이티브 재빌드는 필요 없다.
    ['expo-router', { sitemap: false, root: './app' }],
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
    // TRIP-1070 — 사진 첨부는 앨범 읽기. 두 플러그인이 같은 Info.plist 키(NSPhotoLibraryUsageDescription)를
    // 쓰므로 문구를 같게 둔다(다르면 나중 것이 이긴다). 카메라·마이크·Android 사진 위치는 끈다.
    [
      'expo-image-picker',
      {
        photosPermission: PHOTOS_PERMISSION,
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    // TRIP-1071 공유 카드 앨범 저장(추가 전용) + TRIP-1070 앨범 읽기 — 한 플러그인에 둘 다 둔다.
    // granularPermissions ['photo'] 는 READ_MEDIA_VIDEO·AUDIO 선언만 뺀다. READ_MEDIA_VISUAL_USER_SELECTED·
    // READ/WRITE_EXTERNAL_STORAGE 는 패키지가 옵션과 무관하게 선언한다(Android 출시 시 Play 사진 권한 신고 확인).
    [
      'expo-media-library',
      {
        photosPermission: PHOTOS_PERMISSION,
        savePhotosPermission:
          'TripPilot가 여행 공유 카드를 사진 앨범에 저장하기 위해 사진 추가 권한을 사용합니다.',
        granularPermissions: ['photo'],
        isAccessMediaLocationEnabled: false,
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
    // 애플 로그인 entitlement(com.apple.developer.applesignin)를 prebuild 가 넣는다(TRIP-932).
    // ios.usesAppleSignIn 은 같은 일을 하므로 중복 선언하지 않는다.
    'expo-apple-authentication',
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
  owner: 'trippilottravel',
  extra: {
    eas: {
      projectId: '9d33458c-a731-4278-8e0a-45ccdae5b66b',
    },
  },
};

// 푸시 entitlement(aps-environment)를 뺀다 — 서버 푸시가 꺼져 있고 번들 ID 에 Push 권한이 아직 없어
// 프로비저닝 프로파일이 Xcode 서명에서 거부된다(TRIP-935 심사 빌드). expo-notifications 는 prebuild 가
// 설치만 돼 있어도 자동으로 붙여서 plugins 에서 빼도 소용없다 — 결과에서 지운다.
// 푸시를 켤 때는 ASC 에서 번들 ID 의 Push 권한을 먼저 켜고 이 래핑을 걷는다.
export default withEntitlementsPlist(config, (mod) => {
  delete mod.modResults['aps-environment'];
  return mod;
});
