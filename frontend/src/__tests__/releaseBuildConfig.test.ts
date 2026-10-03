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

const ROOT = path.resolve(__dirname, '../..');

type PluginEntry = string | [string, Record<string, unknown>?];

/** 튜플(`[이름, 옵션]`)로 등록된 플러그인의 옵션. 문자열 단독 등록이면 undefined. */
function optionsOf(name: string): Record<string, unknown> | undefined {
  const plugins = (config.plugins ?? []) as PluginEntry[];
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
  'TripPilot가 주변 여행지와 동선을 추천하기 위해 위치를 사용합니다.';
const SAVE_PHOTOS_COPY =
  'TripPilot가 여행 공유 카드를 사진 앨범에 저장하기 위해 사진 추가 권한을 사용합니다.';

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

describe('AC-6 Sentry 자동 업로드 끔', () => {
  it('production·preview 빌드 프로파일이 Sentry 자동 업로드를 문자열 "true"로 끄고, Sentry 플러그인 등록은 그대로다', () => {
    const eas = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8')
    ) as {
      build: Record<
        string,
        { env?: Record<string, unknown>; autoIncrement?: unknown }
      >;
    };
    const { production, preview } = eas.build;

    // Sentry Xcode 스크립트가 문자열 `true` 로 비교한다 — 불리언 true 는 안 된다.
    expect(production.env?.SENTRY_DISABLE_AUTO_UPLOAD).toBe('true');
    expect(preview.env?.SENTRY_DISABLE_AUTO_UPLOAD).toBe('true');
    expect(production.autoIncrement).toBe(true);
    // 운영 빌드는 API 주소 env 가 비면 부팅 중 throw 한다(shared/api, TRIP-936) — 빌드 프로파일이 https 주소를 박아 둬야 한다.
    // (어느 환경 주소인지는 출시 결정 12 소관이라 값은 못 박지 않는다.)
    expect(String(production.env?.EXPO_PUBLIC_API_BASE_URL)).toMatch(
      /^https:\/\/[^/]+$/
    );
    expect(optionsOf('@sentry/react-native/expo')).toEqual({
      organization: 'trippilot',
      project: 'trippilot-frontend',
    });
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
