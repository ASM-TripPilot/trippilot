import type { ExpoConfig } from 'expo/config';
import { withInfoPlist } from 'expo/config-plugins';

// 소셜/지도 SDK 키는 사용자 프로비저닝 시 주입한다(스캐폴드는 placeholder).
// 소셜(카카오/네이버)·지도 SDK config plugin 은 실 네이티브 키가 필요하므로 auth·map 유닛에서 배선한다.

// TRIP-210 — 카카오 네이티브 앱 키·네이버 urlScheme. 값은 env 에서만 읽는다(리터럴 커밋 금지 ·
// AC-7). 미설정 시 빈 문자열 — config plugin 은 그대로 통과시키고, 실 로그인 시도는
// makeAuthorize.ts 가 같은 env 부재로 SDK 경로에 들어가지 않아 걸러진다(INV-4).
const kakaoNativeAppKey = process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY ?? '';
const naverUrlScheme = process.env.EXPO_PUBLIC_NAVER_URL_SCHEME ?? '';

// TRIP-862 — 네이버 지도 SDK Client ID(NCP Maps 앱 등록). 로그인용 EXPO_PUBLIC_NAVER_CLIENT_ID
// 와는 다른 키다. 리터럴 커밋 금지 — env 에서만 읽는다(socialSdkSecrets A-3). 미설정 시 빈
// 문자열이면 config plugin 은 그대로 통과하고, 지도 렌더 실패는 shared/map 의 map-failure
// 표면으로 드러난다(INV-4, S1 계승).
const naverMapClientId = process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID ?? '';

// TRIP-1337 · U10 위치 자동화 빌드 플래그(BR-U10-07 · NFR 델타 3). 원천은 이 env 하나 — EXPO_PUBLIC_* 로 두지 않고
// JS 노출은 extra.locationAutomation 한 곳으로 모아 "네이티브 권한 표면과 JS 동작이 같은 값"이 되게 한다.
// OFF(기본) = TRIP-936 이후 출시 빌드와 같은 표면(always 문구 없음·백그라운드 모드 없음). ON 은 네이티브 재빌드 필수(OTA 불가).
// ⚠️ privacy manifest(PreciseLocation · AppFunctionality)는 ON/OFF 같은 값을 쓴다(STORE-U10-05) — ON 빌드 제출 전
// App Store Connect App Privacy 답변과 대조한다(둘 중 하나를 바꾸면 다른 쪽도).
const locationAutomation = process.env.TRIPPILOT_LOCATION_AUTOMATION === '1';
const LOCATION_ALWAYS_PERMISSION =
  'TripPilot이 여행 날짜 동안 앱을 닫아도 일정 장소 도착·방문 완료와 이동 경로를 자동으로 기록하기 위해 위치를 사용합니다.';

// TRIP-1070 — 사진 앨범 권한 문구(expo-image-picker·expo-media-library 공용).
const PHOTOS_PERMISSION =
  'TripPilot이 방문한 곳의 사진을 기록에 보여 주기 위해 사진 보관함에 접근합니다.';

const config: ExpoConfig = {
  name: 'TripPilot',
  slug: 'trippilot',
  version: '1.0.1',
  orientation: 'portrait',
  // Figma AppIcon/Final 기준 최종 아이콘(1024 불투명 RGB — App Store 는 알파 채널을 거부한다).
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
    // TRIP-936 — required-reason API 선언(ITMS-91053). 수집 데이터 유형(NSPrivacyCollectedDataTypes)은 코드에서
    // 추정한 값이다 — App Store Connect 의 App Privacy 답변과 항목이 같아야 하므로 둘 중 하나를 바꾸면 다른 쪽도 맞춘다.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [
        ...[
          'EmailAddress', // 소셜 로그인 계정 이메일
          'Name', // 닉네임
          'UserID', // 계정 식별자
          'DeviceID', // 설치 ID · 푸시 토큰
          'PreciseLocation', // 주변 추천 · 방문 기록(동의 시) 좌표
          'OtherUserContent', // 일정 · 메모 · 저장한 장소
        ].map((type) => ({
          NSPrivacyCollectedDataType: `NSPrivacyCollectedDataType${type}`,
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: [
            'NSPrivacyCollectedDataTypePurposeAppFunctionality',
          ],
        })),
        ...['CrashData', 'PerformanceData', 'OtherDiagnosticData'].map(
          (type) => ({
            // Sentry. sendDefaultPii 는 꺼 뒀지만 ASC App Privacy 설문이 진단을 "사용자에게 연결됨"으로 답해 둬서 같게 둔다.
            NSPrivacyCollectedDataType: `NSPrivacyCollectedDataType${type}`,
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAnalytics',
            ],
          })
        ),
      ],
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
    ...(locationAutomation
      ? {
          permissions: [
            'ACCESS_BACKGROUND_LOCATION',
            'FOREGROUND_SERVICE',
            'FOREGROUND_SERVICE_LOCATION',
          ],
        }
      : {}),
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
          'TripPilot이 주변 여행지와 동선을 추천하기 위해 위치를 사용합니다.',
        ...(locationAutomation
          ? {
              locationAlwaysPermission: LOCATION_ALWAYS_PERMISSION,
              locationAlwaysAndWhenInUsePermission: LOCATION_ALWAYS_PERMISSION,
              isIosBackgroundLocationEnabled: true,
              isAndroidBackgroundLocationEnabled: true,
              isAndroidForegroundServiceEnabled: true,
            }
          : {
              locationAlwaysPermission: false,
              locationAlwaysAndWhenInUsePermission: false,
            }),
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
          'TripPilot이 여행 공유 카드를 사진 앨범에 저장하기 위해 사진 추가 권한을 사용합니다.',
        granularPermissions: ['photo'],
        isAccessMediaLocationEnabled: false,
        // TRIP-1431 — '선택한 사진만'이면 iOS 가 앱 실행마다 "Select More Photos…" 창을 자동으로 띄운다. 끈다.
        preventAutomaticLimitedAccessAlert: true,
      },
    ],
    // TRIP-1361 — 폰트를 JS 런타임 로드(useFonts)가 아니라 네이티브 번들에 임베드한다(Info.plist UIAppFonts · Android assets).
    // 첫 렌더부터 폰트가 있어 "폰트 전 null 렌더" 게이트가 필요 없다. 네이티브 설정이라 재빌드 필요(OTA 불가).
    // ⚠️ 폰트명 = 파일명 = 내부 PostScript 이름 = tailwind.config.js fontFamily 토큰 — iOS 는 내부 이름으로, Android 는
    // 파일명으로 찾는다(assets/fonts/README.md, releaseBuildConfig.test 가 잠근다). Noto 는 한글 2,350자 서브셋이다.
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/Inter_700Bold.ttf',
          './assets/fonts/NotoSansKR_400Regular.ttf',
          './assets/fonts/NotoSansKR_500Medium.ttf',
          './assets/fonts/NotoSansKR_700Bold.ttf',
        ],
      },
    ],
    // 튜플로 줘야 한다 — 문자열 단독이면 레거시 config.splash 경로로 빠진다.
    ['expo-splash-screen', { backgroundColor: '#ffffff' }],
    'expo-notifications',
    [
      '@sentry/react-native/expo',
      {
        organization: 'ajou-s0',
        project: 'react-native',
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
    // TRIP-1364 — React Compiler(참조 안정화). 켜기 전에 렌더 중 비순수 읽기를 정리했다(#1114).
    reactCompiler: true,
  },
  owner: 'trippilottravel',
  extra: {
    eas: {
      projectId: '9d33458c-a731-4278-8e0a-45ccdae5b66b',
    },
    ...(locationAutomation ? { locationAutomation: true } : {}),
  },
};

// TRIP-1337 — expo-task-manager 는 설치만 돼 있어도 prebuild 가 레거시 자동 플러그인으로 붙여 UIBackgroundModes 에
// 'fetch' 를 넣는다(우리는 백그라운드 fetch 를 쓰지 않는다). 플래그 OFF 빌드의 권한 표면을 TRIP-936 과 같게 두려고
// 결과에서 지운다 — ON 빌드는 expo-location 플러그인이 넣는 'location' 만 남는다.
const withoutBackgroundFetch = (input: ExpoConfig): ExpoConfig =>
  withInfoPlist(input, (mod) => {
    const modes = mod.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      const kept = modes.filter((m) => m !== 'fetch');
      if (kept.length > 0) mod.modResults.UIBackgroundModes = kept;
      else delete mod.modResults.UIBackgroundModes;
    }
    return mod;
  });

// 푸시 entitlement(aps-environment)는 expo-notifications 플러그인이 넣는 그대로 둔다 — 1.0 은 번들 ID 에
// Push 권한이 없어 지웠고(TRIP-935), 1.0.1 에서 권한을 켜고 되살렸다. 다시 지우면 알림만 조용히 안 온다.
export default withoutBackgroundFetch(config);
