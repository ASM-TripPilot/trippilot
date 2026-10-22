/**
 * @jest-environment node
 */

/**
 * TRIP-936 · 출시 빌드 설정 계약. 전부 "빌드는 성공하는데 결과물이 틀린" 조용한 실패라
 * 실기·심사 전에는 아무도 못 본다 — 그래서 설정값과 Expo 가 해석한 Info.plist 를 굳힌다.
 *
 * Info.plist 는 `expo config --type introspect` 결과로 본다. introspect 는 플러그인이 넣고
 * 빼는 키만 믿을 수 있다(기본 템플릿 값은 실제 prebuild 와 다르다). 디바이스 패밀리·privacy
 * manifest 는 introspect 에 안 나오므로(withXcodeProject 단계) 설정값까지만 굳힌다.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { IOSConfig } from 'expo/config-plugins';

import config from '../../app.config';
import tailwindConfig from '../../tailwind.config.js';

const ROOT = path.resolve(__dirname, '../..');

type PluginEntry = string | [string, Record<string, unknown>?];

/** 튜플(`[이름, 옵션]`)로 등록된 플러그인의 옵션. 문자열 단독 등록이면 undefined. plugins 를 안 주면 import 한 설정. */
function optionsOf(
  name: string,
  plugins: PluginEntry[] = (config.plugins ?? []) as PluginEntry[]
): Record<string, unknown> | undefined {
  const entry = plugins.find(
    (item): item is [string, Record<string, unknown>?] =>
      Array.isArray(item) && item[0] === name
  );
  return entry?.[1];
}

function unknownKeys(
  options: Record<string, unknown> | undefined,
  allowed: readonly string[]
): string[] {
  return Object.keys(options ?? {}).filter((key) => !allowed.includes(key));
}

/** 중첩 객체까지 모든 키 이름을 모은다. */
function collectKeysDeep(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...collectKeysDeep(child),
  ]);
}

/** PNG 청크 이름을 순서대로. 청크 = 길이(4) + 이름(4) + 데이터 + CRC(4). */
function pngChunkNames(bytes: Buffer): string[] {
  const names: string[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const name = bytes.toString('ascii', offset + 4, offset + 8);
    names.push(name);
    if (name === 'IEND') break;
    offset += 12 + length;
  }
  return names;
}

// 설치된 패키지 d.ts 의 옵션 키(버전이 바뀌면 다시 뽑는다). 오타 키는 플러그인이 조용히 무시한다.
const LOCATION_ALLOWED = [
  'locationAlwaysAndWhenInUsePermission',
  'locationAlwaysPermission',
  'locationWhenInUsePermission',
  'isIosBackgroundLocationEnabled',
  'isAndroidBackgroundLocationEnabled',
  'isAndroidForegroundServiceEnabled',
] as const;
const SECURE_STORE_ALLOWED = [
  'faceIDPermission',
  'configureAndroidBackup',
] as const;
// expo-media-library 18.2 plugin/build/withMediaLibrary.d.ts 의 옵션 키(TRIP-1071).
const MEDIA_LIBRARY_ALLOWED = [
  'photosPermission',
  'savePhotosPermission',
  'isAccessMediaLocationEnabled',
  'preventAutomaticLimitedAccessAlert',
  'granularPermissions',
] as const;
// expo-font 18 plugin/build/withFonts.d.ts 의 옵션 키(TRIP-1361).
const FONT_ALLOWED = ['fonts', 'android', 'ios'] as const;
const SPLASH_ALLOWED = [
  'backgroundColor',
  'imageWidth',
  'enableFullScreenImage_legacy',
  'image',
  'resizeMode',
  'dark',
  'android',
  'ios',
] as const;

const WHEN_IN_USE_COPY =
  'TripPilot이 주변 여행지와 동선을 추천하기 위해 위치를 사용합니다.';
const SAVE_PHOTOS_COPY =
  'TripPilot이 여행 공유 카드를 사진 앨범에 저장하기 위해 사진 추가 권한을 사용합니다.';

let infoPlist: Record<string, unknown> = {};
let introspectedExtra: Record<string, unknown> = {};

beforeAll(() => {
  const stdout = execFileSync(
    path.join(ROOT, 'node_modules', '.bin', 'expo'),
    ['config', '--type', 'introspect', '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CI: '1',
        EXPO_OFFLINE: '1',
        EXPO_NO_TELEMETRY: '1',
      },
    }
  );
  const introspected = JSON.parse(stdout);
  infoPlist = introspected._internal.modResults.ios.infoPlist;
  introspectedExtra = introspected.extra ?? {};
}, 60_000);

describe('AC-1 앱 아이콘', () => {
  it('앱 아이콘은 assets/ 안의 1024×1024 PNG이고 알파 채널·투명색이 없다', () => {
    const icon = config.icon;
    expect(typeof icon).toBe('string');
    // ios.icon 이 있으면 iOS 는 그 파일을 쓴다 — 여기서 검사하는 파일이 실제 아이콘이어야 한다.
    expect(config.ios?.icon).toBeUndefined();

    const relative = path.relative(ROOT, path.resolve(ROOT, String(icon)));
    expect(relative).toMatch(/^assets\/[^/]+\.png$/);
    // 커밋되지 않는 파일이면 EAS 빌드에 아이콘이 없다(1 = 무시되지 않음).
    expect(
      spawnSync('git', ['check-ignore', '-q', relative], { cwd: ROOT }).status
    ).toBe(1);

    const bytes = fs.readFileSync(path.join(ROOT, relative));

    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
    expect(bytes.readUInt32BE(16)).toBe(1024);
    expect(bytes.readUInt32BE(20)).toBe(1024);
    // 색 유형 2 = RGB(알파 없음). RGBA 는 6. RGB 라도 tRNS 청크가 있으면 투명색이 생긴다.
    expect(bytes[25]).toBe(2);
    expect(pngChunkNames(bytes)).not.toContain('tRNS');
  });
});

describe('B-AC2 네이티브 스플래시', () => {
  it('네이티브 스플래시는 expo-splash-screen 튜플로 흰 배경만 쓰고 이미지를 넣지 않는다', () => {
    const options = optionsOf('expo-splash-screen');

    // 문자열 단독 등록이면 플러그인이 레거시 config.splash 경로로 빠진다.
    expect(options).toBeDefined();
    expect(String(options?.backgroundColor).toLowerCase()).toBe('#ffffff');
    expect(collectKeysDeep(options)).not.toContain('image');
    expect(unknownKeys(options, SPLASH_ALLOWED)).toEqual([]);
  });
});

describe('AC-3 안 쓰는 권한 문구 제거', () => {
  it('해석된 Info.plist에 "항상 허용" 위치 문구와 Face ID 문구가 없고, 사용 중 위치 문구는 한국어 그대로다', () => {
    const keys = Object.keys(infoPlist);

    expect(infoPlist.NSLocationWhenInUseUsageDescription).toBe(
      WHEN_IN_USE_COPY
    );
    expect(keys).not.toContain('NSLocationAlwaysUsageDescription');
    expect(keys).not.toContain('NSLocationAlwaysAndWhenInUseUsageDescription');
    expect(keys).not.toContain('NSFaceIDUsageDescription');
  });

  it('expo-location·expo-secure-store 옵션은 패키지가 아는 키만 쓰고, 지울 문구는 불리언 false로 준다', () => {
    const location = optionsOf('expo-location');
    const secureStore = optionsOf('expo-secure-store');

    // 플러그인은 값이 === false 일 때만 키를 지운다. 문자열 'false'·생략은 영문 기본 문구가 된다.
    expect(unknownKeys(location, LOCATION_ALLOWED)).toEqual([]);
    expect(location?.locationAlwaysPermission).toBe(false);
    expect(location?.locationAlwaysAndWhenInUsePermission).toBe(false);

    expect(secureStore).toBeDefined();
    expect(secureStore?.faceIDPermission).toBe(false);
    expect(unknownKeys(secureStore, SECURE_STORE_ALLOWED)).toEqual([]);
  });
});

describe('TRIP-1071 AC-16 · 공유 카드 앨범 저장 권한 문구', () => {
  it('해석된 Info.plist에 사진 "추가" 문구가 한국어로 있다', () => {
    // 읽기 문구는 TRIP-1070(사진 첨부)이 쓴다 — 그쪽 AC-14 가 한국어·두 플러그인 동일을 못박는다.
    expect(infoPlist.NSPhotoLibraryAddUsageDescription).toBe(SAVE_PHOTOS_COPY);
  });

  it('expo-media-library 옵션은 패키지가 아는 키만 쓰고, 저장 문구는 한국어 추가 문구다', () => {
    const mediaLibrary = optionsOf('expo-media-library');

    expect(mediaLibrary).toBeDefined();
    expect(mediaLibrary?.savePhotosPermission).toBe(SAVE_PHOTOS_COPY);
    expect(unknownKeys(mediaLibrary, MEDIA_LIBRARY_ALLOWED)).toEqual([]);
  });
});

describe('AC-4 암호화 신고 · iPhone 전용', () => {
  it('해석된 Info.plist가 암호화 수출 신고 면제(ITSAppUsesNonExemptEncryption=false)를 선언한다', () => {
    expect(infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it('iPad를 끄면 Expo가 계산한 디바이스 패밀리가 iPhone만([1])이다', () => {
    // 키가 없어도 [1] 이 나오므로 명시적 false 를 따로 단언한다.
    expect(config.ios?.supportsTablet).toBe(false);
    expect(IOSConfig.DeviceFamily.getDeviceFamilies(config)).toEqual([1]);
  });
});

describe('AC-5 privacy manifest', () => {
  it('privacy manifest가 required-reason API 4범주를 정해진 사유 코드로 선언하고 추적하지 않는다고 적는다', () => {
    const manifest = config.ios?.privacyManifests;
    const entries = manifest?.NSPrivacyAccessedAPITypes ?? [];

    expect(manifest?.NSPrivacyTracking).toBe(false);
    // 같은 범주를 두 항목으로 쪼개면 아래 맵 변환이 앞 항목을 덮는다 — 개수로 막는다.
    expect(entries.length).toBe(4);
    for (const entry of entries) {
      expect(entry.NSPrivacyAccessedAPITypeReasons.length).toBe(
        new Set(entry.NSPrivacyAccessedAPITypeReasons).size
      );
    }
    expect(
      Object.fromEntries(
        entries.map((entry) => [
          entry.NSPrivacyAccessedAPIType,
          new Set(entry.NSPrivacyAccessedAPITypeReasons),
        ])
      )
    ).toEqual({
      NSPrivacyAccessedAPICategoryUserDefaults: new Set(['CA92.1']),
      NSPrivacyAccessedAPICategoryFileTimestamp: new Set([
        'C617.1',
        '0A2A.1',
        '3B52.1',
      ]),
      NSPrivacyAccessedAPICategorySystemBootTime: new Set(['35F9.1']),
      NSPrivacyAccessedAPICategoryDiskSpace: new Set(['E174.1', '85F4.1']),
    });
  });
});

describe('TRIP-1370 Sentry 운영 켬', () => {
  it('production 은 Sentry 자동 업로드를 켜고(소스맵·dSYM), preview 는 문자열 "true"로 끈 채이며, Sentry 플러그인 등록은 그대로다', () => {
    const eas = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8')
    ) as {
      build: Record<
        string,
        { env?: Record<string, unknown>; autoIncrement?: unknown }
      >;
    };
    const { production, preview } = eas.build;

    // 운영은 업로드를 켠다(키 자체가 없어야 한다) — 값은 EAS env 의 SENTRY_AUTH_TOKEN 에서 온다(사용자가 등록).
    // TRIP-935 가 업로드를 끈 것은 심사 빌드 서명 문제 우회였다. 이 키가 다시 production 에 들어오면 운영 크래시가
    // 소스맵·심볼 없이 쌓인다 — 빌드는 성공하고 에러도 없어서 조용히 틀린다.
    expect(production.env).not.toHaveProperty('SENTRY_DISABLE_AUTO_UPLOAD');
    // preview 는 그대로 끈다. Sentry Xcode 스크립트가 문자열 `true` 로 비교한다 — 불리언 true 는 안 된다.
    expect(preview.env?.SENTRY_DISABLE_AUTO_UPLOAD).toBe('true');
    expect(production.autoIncrement).toBe(true);
    // 운영 빌드는 API 주소 env 가 비면 부팅 중 throw 한다(shared/api, TRIP-936) — 빌드 프로파일이 https 주소를 박아 둬야 한다.
    // (어느 환경 주소인지는 출시 결정 12 소관이라 값은 못 박지 않는다.)
    expect(String(production.env?.EXPO_PUBLIC_API_BASE_URL)).toMatch(
      /^https:\/\/[^/]+$/
    );
    // 조직·프로젝트 이름은 업로드 토큰의 조직과 같아야 한다(사용자 확인 2026-10-13: Sentry 조직 ajou-s0,
    // 프로젝트 react-native). 어긋나면 운영 iOS 빌드의 업로드가 "조직 없음/권한 없음"으로 실패한다.
    expect(optionsOf('@sentry/react-native/expo')).toEqual({
      organization: 'ajou-s0',
      project: 'react-native',
    });
  });

  // DSN 이 없으면 initSentry 가 아무 에러 없이 no-op 이라 "미설정"이 조용하다 — 키 이름이라도 리포에 박아 둔다.
  // 값은 절대 커밋하지 않는다(32-hex 전수 스캔 socialSdkSecrets A-3 이 DSN 형태도 잡는다).
  it('DSN 키 이름이 .env.example 에 값 없이 있고, initSentry 가 같은 이름을 읽는다', () => {
    const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(example).toMatch(/^EXPO_PUBLIC_SENTRY_DSN=$/m);

    const init = fs.readFileSync(
      path.join(ROOT, 'src/app/entrypoint/initSentry.ts'),
      'utf8'
    );
    expect(init).toContain('process.env.EXPO_PUBLIC_SENTRY_DSN');
  });
});

describe('TRIP-935 AC-2 · expo-router 사이트맵 끔', () => {
  it('expo-router 를 { sitemap: false } 튜플로 등록한다', () => {
    const options = optionsOf('expo-router');

    // 문자열 단독 등록이면 옵션이 없어 _sitemap 이 기본값(켜짐)으로 붙는다.
    expect(options).toBeDefined();
    expect(options?.sitemap).toBe(false);
    // 라우트 폴더를 루트 app/ 으로 못 박는 옵션(TRIP-1161) — 빠지면 Expo 가 src/app(FSD app 층)을 라우트 루트로 골라
    // 번들이 깨지거나 화면이 줄어드는데 tsc·lint·다른 jest 는 못 잡는다.
    expect(options?.root).toBe('./app');
  });

  it('Expo 가 해석한 설정의 extra.router.sitemap 이 false 다(런타임이 읽는 값)', () => {
    // expo-router 는 실행 중 Constants.expoConfig.extra.router.sitemap !== false 이면 _sitemap 을 붙인다.
    const router = introspectedExtra.router as
      Record<string, unknown> | undefined;

    expect(router).toBeDefined();
    expect(router?.sitemap).toBe(false);
  });
});

// TRIP-1070 AC-14 — 사진 앨범 권한 문구. 두 플러그인이 같은 Info.plist 키(NSPhotoLibraryUsageDescription)를
// 쓰므로 문구가 다르면 나중 플러그인이 이긴다 — 같은 문자열이어야 어느 쪽이 이겨도 같다.
// 옵션 키는 설치된 패키지 d.ts 실측(plugin/build/withImagePicker.d.ts · withMediaLibrary.d.ts).
const IMAGE_PICKER_ALLOWED = [
  'photosPermission',
  'cameraPermission',
  'microphonePermission',
] as const;
const HANGUL = /[가-힣]/;

describe('🔴 TRIP-1070 AC-14 · 사진 앨범 권한 문구', () => {
  it('expo-image-picker·expo-media-library 가 같은 한국어 사진 문구를 쓰고, 안 쓰는 문구는 불리언 false 로 지운다', () => {
    const picker = optionsOf('expo-image-picker');
    const library = optionsOf('expo-media-library');

    // 두 플러그인이 튜플로 등록됐고 아는 키만 쓴다(오타 키는 조용히 무시된다).
    expect(picker).toBeDefined();
    expect(library).toBeDefined();
    expect(unknownKeys(picker, IMAGE_PICKER_ALLOWED)).toEqual([]);
    expect(unknownKeys(library, MEDIA_LIBRARY_ALLOWED)).toEqual([]);

    // 사진 문구 — 한국어, 두 곳 같은 문자열.
    const copy = picker?.photosPermission;
    expect(typeof copy).toBe('string');
    expect(HANGUL.test(String(copy))).toBe(true);
    expect(library?.photosPermission).toBe(copy);

    // 카메라·마이크는 쓰지 않는다(F3) · Android 사진 위치 권한도 켜지 않는다(F2).
    // 사진 저장 문구는 TRIP-1071(공유 카드 앨범 저장)이 쓴다 — 그쪽 AC-16 이 못박는다.
    expect(picker?.cameraPermission).toBe(false);
    expect(picker?.microphonePermission).toBe(false);
    expect(library?.isAccessMediaLocationEnabled).toBe(false);
  });

  it('해석된 Info.plist 의 사진 문구가 그 한국어 문구이고, 카메라·마이크 문구 키는 없다', () => {
    const copy = optionsOf('expo-image-picker')?.photosPermission;
    const keys = Object.keys(infoPlist);

    expect(infoPlist.NSPhotoLibraryUsageDescription).toBe(copy);
    expect(HANGUL.test(String(infoPlist.NSPhotoLibraryUsageDescription))).toBe(
      true
    );
    expect(keys).not.toContain('NSCameraUsageDescription');
    expect(keys).not.toContain('NSMicrophoneUsageDescription');
  });
});

// TRIP-1431 — QA Q-091(권한 문구 조사 "TripPilot가") · Q-161('선택한 사진만'에서 앱을 켤 때마다 뜨는 iOS 창).
describe('iOS 권한 문구 조사 · 사진 제한 접근 자동 알림', () => {
  // 권한 문구를 받는 플러그인 옵션 키. 위치 자동화 ON 설정에 네 문구(사용 중 위치·항상 위치·사진 읽기·사진 추가)가
  // 전부 들어 있다 — OFF(출시 기본)는 항상 위치 문구를 false 로 지워 Info.plist 에 없다.
  const PERMISSION_COPY_KEYS: Record<string, readonly string[]> = {
    'expo-location': [
      'locationWhenInUsePermission',
      'locationAlwaysPermission',
      'locationAlwaysAndWhenInUsePermission',
    ],
    'expo-image-picker': ['photosPermission'],
    'expo-media-library': ['photosPermission', 'savePhotosPermission'],
  };

  /** 위치 자동화 ON 으로 app.config.ts 를 새로 읽는다(모듈 캐시 우회). env 는 원래 값으로 되돌린다. */
  function loadPluginsWithAutomation(): PluginEntry[] {
    const previous = process.env.TRIPPILOT_LOCATION_AUTOMATION;
    process.env.TRIPPILOT_LOCATION_AUTOMATION = '1';
    let plugins: PluginEntry[] = [];
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const loaded = require('../../app.config').default as {
          plugins?: PluginEntry[];
        };
        plugins = loaded.plugins ?? [];
      });
    } finally {
      if (previous === undefined) {
        delete process.env.TRIPPILOT_LOCATION_AUTOMATION;
      } else {
        process.env.TRIPPILOT_LOCATION_AUTOMATION = previous;
      }
    }
    return plugins;
  }

  it('위치·사진 읽기·사진 추가 권한 문구가 전부 "TripPilot이 "로 시작한다(위치 자동화 ON 설정까지)', () => {
    const plugins = loadPluginsWithAutomation();
    const copies: Record<string, string> = {};
    for (const [plugin, keys] of Object.entries(PERMISSION_COPY_KEYS)) {
      const options = optionsOf(plugin, plugins) ?? {};
      for (const key of keys) {
        const copy = options[key];
        if (typeof copy === 'string') copies[`${plugin}.${key}`] = copy;
      }
    }

    // 도달 앵커 — 여섯 자리 모두에서 문자열 문구를 실제로 읽었다.
    expect(Object.keys(copies).sort()).toEqual(
      [
        'expo-location.locationWhenInUsePermission',
        'expo-location.locationAlwaysPermission',
        'expo-location.locationAlwaysAndWhenInUsePermission',
        'expo-image-picker.photosPermission',
        'expo-media-library.photosPermission',
        'expo-media-library.savePhotosPermission',
      ].sort()
    );
    // 본체 — 조사가 틀린 문구가 하나도 없다(틀린 자리가 목록으로 보인다).
    expect(
      Object.entries(copies).filter(
        ([, copy]) => !copy.startsWith('TripPilot이 ')
      )
    ).toEqual([]);
  });

  it("해석된 Info.plist 가 '선택한 사진만' 자동 알림을 끈다(PHPhotoLibraryPreventAutomaticLimitedAccessAlert = true)", () => {
    expect(infoPlist.PHPhotoLibraryPreventAutomaticLimitedAccessAlert).toBe(
      true
    );
  });
});

/**
 * TRIP-210 · config plugin 등록 계약(옛 `socialSdkConfigPlugin.test`, TRIP-1350 에서 합침) — 카카오·네이버 SDK 의
 * 네이티브 빌드 설정 2줄에 심판을 세운다.
 *
 * *(개념)* **config plugin**: Expo 가 앱을 빌드할 때 iOS/Android 네이티브 설정 파일(Info.plist·AppDelegate 등)을
 * 자동으로 고쳐주는 장치다. 카카오·네이버 로그인은 "로그인 창에 다녀온 뒤 앱으로 되돌아오는 통로(URL scheme)"를
 * 네이티브에 등록해야 동작하는데, 그 등록을 `app.config.ts` 의 plugins 항목이 한다. **여기가 틀리면 로그인 창은
 * 뜨는데 앱으로 못 돌아온다.**
 *
 * 왜 이 심판이 필요한가(code-critic 뮤테이션 C): 옵션 이름을 오타 내고 카카오·네이버 값을 서로 바꿔도 **jest·tsc·
 * eslint 가 전부 통과했다.** Expo 의 `plugins` 배열 타입이 `[string, any]` 라 TypeScript 가 옵션 키를 검사하지 않는다.
 * 이 결함은 실기에서만 드러나는데 실기는 콘솔 등록이 갖춰져야 돌아간다 — 지금은 아무도 못 본다.
 *
 * 키 값을 **모듈 최상단에서 env 로 읽으므로**, 표식 env 를 먼저 심고 `jest.isolateModules` 로 새로 로드해야 주입한
 * 값이 반영된다(위에서 import 한 `config` 는 로드 시점 env 를 그대로 갖고 있다).
 */
const KAKAO_PLUGIN = '@react-native-seoul/kakao-login';
const NAVER_PLUGIN = '@react-native-seoul/naver-login';

/**
 * 표식 값을 **서로 다르게** 둔다 — 값 교차(카카오 자리에 네이버 값이 들어가는 배선 실수)는 두 값이 달라야만
 * 관측된다. 같은 값이면 교차해도 단언이 통과한다.
 */
const KAKAO_KEY_MARKER = 'kakao-native-app-key-marker';
const NAVER_SCHEME_MARKER = 'naver-url-scheme-marker';

/**
 * 각 플러그인이 **실제로 받는** props. 패키지 타입 정의 실측이다
 * (kakao `plugins/index.d.ts` → `kakaoAppKey`·`overrideKakaoSDKVersion?` / naver `plugin/build/index.d.ts` → `urlScheme`).
 * 이름이 이 목록과 다르면 플러그인이 그 값을 **조용히 무시**하고 `undefined` 로 빌드한다.
 */
const KAKAO_ALLOWED_PROPS = ['kakaoAppKey', 'overrideKakaoSDKVersion'] as const;
const NAVER_ALLOWED_PROPS = ['urlScheme'] as const;

const SOCIAL_ENV_KEYS = [
  'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY',
  'EXPO_PUBLIC_NAVER_URL_SCHEME',
] as const;

describe('config plugin 등록 — 카카오·네이버 SDK 가 옵션과 함께 plugins 에 있다 (TRIP-210)', () => {
  const originalEnv: Record<string, string | undefined> = {};
  for (const key of SOCIAL_ENV_KEYS) {
    originalEnv[key] = process.env[key];
  }

  afterEach(() => {
    for (const key of SOCIAL_ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  /** 표식 env 를 심고 app.config.ts 를 새로 로드한다(모듈 캐시 우회). */
  function loadPlugins(): PluginEntry[] {
    process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY = KAKAO_KEY_MARKER;
    process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = NAVER_SCHEME_MARKER;

    let plugins: PluginEntry[] = [];
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require('../../app.config').default as {
        plugins?: PluginEntry[];
      };
      plugins = loaded.plugins ?? [];
    });
    return plugins;
  }

  it('카카오·네이버 플러그인이 각각 튜플 형태로 등록돼 있고, 옵션 키가 패키지가 받는 이름과 일치한다', () => {
    const plugins = loadPlugins();

    // 도달 앵커 — plugins 배열을 실제로 읽었다.
    expect(plugins.length).toBeGreaterThan(0);

    const kakaoOptions = optionsOf(KAKAO_PLUGIN, plugins);
    const naverOptions = optionsOf(NAVER_PLUGIN, plugins);

    // 긍정 — 둘 다 **옵션과 함께** 등록돼 있다. 문자열 단독으로 등록하면 옵션이 undefined 라 플러그인이 키 없이 돌아간다.
    expect(kakaoOptions).toBeDefined();
    expect(naverOptions).toBeDefined();

    // 본체 — 옵션 키 이름. 오타(`appKey`·`scheme`)는 tsc 가 못 잡으므로 여기서 잡는다.
    expect(Object.keys(kakaoOptions ?? {})).toContain('kakaoAppKey');
    expect(Object.keys(naverOptions ?? {})).toContain('urlScheme');

    // 본체 — 패키지가 모르는 키가 섞이지 않았다(오타는 "모르는 키"로 나타난다).
    expect(unknownKeys(kakaoOptions, KAKAO_ALLOWED_PROPS)).toEqual([]);
    expect(unknownKeys(naverOptions, NAVER_ALLOWED_PROPS)).toEqual([]);
  });

  it('각 옵션 값이 자기 provider 의 env 에서 오고, 카카오·네이버 값이 서로 뒤바뀌지 않았다', () => {
    const plugins = loadPlugins();
    const kakaoOptions = optionsOf(KAKAO_PLUGIN, plugins) ?? {};
    const naverOptions = optionsOf(NAVER_PLUGIN, plugins) ?? {};

    // 본체(값 출처) — 주입한 표식이 그대로 나오면 그 env 를 읽었다는 뜻이다. 리터럴을 박아 넣었거나 다른 변수를
    // 읽으면 표식과 달라져 즉시 red 다.
    expect(kakaoOptions.kakaoAppKey).toBe(KAKAO_KEY_MARKER);
    expect(naverOptions.urlScheme).toBe(NAVER_SCHEME_MARKER);

    // 본체(교차 배선) — 카카오 자리에 네이버 값이, 네이버 자리에 카카오 값이 들어가는 실수를 잡는다.
    expect(Object.values(kakaoOptions)).not.toContain(NAVER_SCHEME_MARKER);
    expect(Object.values(naverOptions)).not.toContain(KAKAO_KEY_MARKER);
  });
});

/**
 * TRIP-932 AC-17 (Q5) — 애플 로그인 entitlement 경로.
 *
 * *(개념)* **entitlement**: 앱 서명에 박히는 권한 목록이다. `com.apple.developer.applesignin` 이 없으면 애플 로그인
 * 창 자체가 뜨지 않는다. `expo-apple-authentication` 플러그인이 prebuild 때 이 항목을 넣는다. 설치만 해도 레거시
 * 자동 적용이 될 가능성이 있지만 암묵적이라, plugins 에 **명시**했는지를 여기서 잠근다. 같은 일을 하는
 * `ios.usesAppleSignIn` 은 중복이라 쓰지 않는다. 실제 entitlements 파일은 prebuild 뒤 실측(6-b/명령 검증) 몫이다.
 */
describe('config plugin 등록 — 애플 로그인 (TRIP-932 AC-17)', () => {
  it('plugins 에 expo-apple-authentication 이 있고, ios.usesAppleSignIn 중복 선언은 없으며, scheme 은 trippilot 그대로다', () => {
    const plugins = (config.plugins ?? []) as PluginEntry[];

    // 도달 앵커
    expect(plugins.length).toBeGreaterThan(0);

    // 본체 — 문자열 단독이든 튜플 머리든 이름으로 등록돼 있다.
    const names = plugins.map((item) => (Array.isArray(item) ? item[0] : item));
    expect(names).toContain('expo-apple-authentication');

    // Q5 — 같은 entitlement 를 두 경로로 선언하지 않는다.
    expect(config.ios?.usesAppleSignIn).not.toBe(true);

    // 티켓 "건드리지 않는 것" — 딥링크 scheme 불변.
    expect(config.scheme).toBe('trippilot');
  });
});

/** TTF/OTF 'name' 테이블의 nameID 6(PostScript 이름). iOS 는 RN fontFamily 를 이 내부 이름으로 찾는다. */
function postScriptName(file: string): string {
  const b = fs.readFileSync(file);
  const numTables = b.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    if (b.toString('ascii', rec, rec + 4) !== 'name') continue;
    const table = b.readUInt32BE(rec + 8);
    const count = b.readUInt16BE(table + 2);
    const strings = table + b.readUInt16BE(table + 4);
    for (let n = 0; n < count; n += 1) {
      const r = table + 6 + n * 12;
      if (b.readUInt16BE(r + 6) !== 6) continue;
      const platform = b.readUInt16BE(r);
      const len = b.readUInt16BE(r + 8);
      const at = strings + b.readUInt16BE(r + 10);
      const raw = b.subarray(at, at + len);
      return platform === 3
        ? Buffer.from(raw).swap16().toString('utf16le')
        : raw.toString('latin1');
    }
  }
  return '';
}

describe('TRIP-1361 · 폰트 네이티브 임베드 — 폰트명 계약', () => {
  const fontFiles = (): string[] => {
    const options = optionsOf('expo-font');
    return ((options?.fonts as string[] | undefined) ?? []).map((f) =>
      path.resolve(ROOT, f)
    );
  };

  it('expo-font 플러그인이 폰트 4개를 옵션 키 오타 없이 등록하고, 파일이 실재하며, Info.plist UIAppFonts 에 들어간다', () => {
    const options = optionsOf('expo-font');

    expect(options).toBeDefined();
    expect(unknownKeys(options, FONT_ALLOWED)).toEqual([]);
    const files = fontFiles();
    expect(files.map((f) => path.basename(f)).sort()).toEqual([
      'Inter_700Bold.ttf',
      'NotoSansKR_400Regular.ttf',
      'NotoSansKR_500Medium.ttf',
      'NotoSansKR_700Bold.ttf',
    ]);
    files.forEach((f) => expect(fs.existsSync(f)).toBe(true));
    expect(infoPlist.UIAppFonts).toEqual(
      expect.arrayContaining(files.map((f) => path.basename(f)))
    );
  });

  it('tailwind fontFamily 토큰 = 임베드 파일명 = 폰트 내부 PostScript 이름이 글자 단위로 같다 (iOS 는 내부 이름, Android 는 파일명으로 찾는다)', () => {
    const tokens = Object.values(
      (tailwindConfig.theme?.extend?.fontFamily ?? {}) as Record<
        string,
        string[]
      >
    )
      .flat()
      .sort();
    const files = fontFiles();

    expect(tokens.length).toBeGreaterThan(0);
    expect(files.map((f) => path.basename(f, '.ttf')).sort()).toEqual(tokens);
    files.forEach((f) =>
      expect(postScriptName(f)).toBe(path.basename(f, '.ttf'))
    );
  });
});
