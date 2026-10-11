/**
 * @jest-environment node
 */

/**
 * TRIP-1337 · U10 빌드 플래그 게이트 (BR-U10-07 · NFR 델타 3 · MOBILE-U10-08).
 *
 * 플래그 원천은 빌드 환경 변수 `TRIPPILOT_LOCATION_AUTOMATION` 하나(EXPO_PUBLIC_* 아님).
 * OFF(기본) = TRIP-936 이후 출시 빌드와 같은 권한 표면, ON = always 문구·백그라운드 모드·Android 3권한·extra.
 *
 * 3동작 뼈대: 준비=env 설정 → 실행=app.config 평가(+ expo introspect) → 단언=플러그인 옵션·Info.plist·권한·extra.
 * ⚠️ 실제 prebuild 산출물(Info.plist·AndroidManifest) 비교는 6-b #1 — introspect 는 플러그인이 넣는 키만 믿을 수 있다.
 */
import { execFileSync } from 'child_process';
import path from 'path';

import type { ExpoConfig } from 'expo/config';

const ROOT = path.resolve(__dirname, '../..');
const FLAG = 'TRIPPILOT_LOCATION_AUTOMATION';

type PluginEntry = string | [string, Record<string, unknown>?];

function loadConfig(flag: string | undefined): ExpoConfig {
  const prev = process.env.TRIPPILOT_LOCATION_AUTOMATION;
  if (flag === undefined) delete process.env.TRIPPILOT_LOCATION_AUTOMATION;
  else process.env.TRIPPILOT_LOCATION_AUTOMATION = flag;
  let config: ExpoConfig | undefined;
  jest.isolateModules(() => {
    config = require('../../app.config').default as ExpoConfig;
  });
  if (prev === undefined) delete process.env.TRIPPILOT_LOCATION_AUTOMATION;
  else process.env.TRIPPILOT_LOCATION_AUTOMATION = prev;
  return config as ExpoConfig;
}

function locationOptions(config: ExpoConfig): Record<string, unknown> {
  const entry = ((config.plugins ?? []) as PluginEntry[]).find(
    (p): p is [string, Record<string, unknown>?] =>
      Array.isArray(p) && p[0] === 'expo-location'
  );
  return entry?.[1] ?? {};
}

function introspect(flag: string | undefined) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: '1',
    EXPO_OFFLINE: '1',
    EXPO_NO_TELEMETRY: '1',
  };
  if (flag === undefined) delete env[FLAG];
  else env[FLAG] = flag;
  const out = execFileSync(
    path.join(ROOT, 'node_modules', '.bin', 'expo'),
    ['config', '--type', 'introspect', '--json'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }
  );
  const parsed = JSON.parse(out);
  return {
    infoPlist: parsed._internal.modResults.ios.infoPlist as Record<
      string,
      unknown
    >,
    extra: (parsed.extra ?? {}) as Record<string, unknown>,
    androidPermissions: (parsed.android?.permissions ?? []) as string[],
  };
}

const BG_ANDROID = [
  'ACCESS_BACKGROUND_LOCATION',
  'FOREGROUND_SERVICE',
  'FOREGROUND_SERVICE_LOCATION',
];

describe('플래그 OFF(기본) — TRIP-936 이후와 같은 표면', () => {
  it('OFF1 expo-location 옵션은 always 계열 false, 백그라운드 옵션 없음', () => {
    for (const flag of [undefined, '', '0', 'true']) {
      const opts = locationOptions(loadConfig(flag));
      expect(opts.locationAlwaysPermission).toBe(false);
      expect(opts.locationAlwaysAndWhenInUsePermission).toBe(false);
      expect(opts.isIosBackgroundLocationEnabled).toBeUndefined();
      expect(opts.isAndroidBackgroundLocationEnabled).toBeUndefined();
      expect(opts.isAndroidForegroundServiceEnabled).toBeUndefined();
    }
  });

  it('OFF2 Android 권한·extra.locationAutomation 을 더하지 않는다', () => {
    const config = loadConfig(undefined);
    expect(config.android?.permissions).toBeUndefined();
    expect(
      (config.extra as Record<string, unknown>).locationAutomation
    ).toBeUndefined();
  });

  it('OFF3 해석된 Info.plist 에 UIBackgroundModes location·always 문구가 없다', () => {
    const { infoPlist, extra } = introspect(undefined);
    // TRIP-936 이후 출시 빌드에는 UIBackgroundModes 자체가 없다(expo-task-manager 자동 플러그인의 'fetch' 도 지운다).
    expect(infoPlist.UIBackgroundModes).toBeUndefined();
    expect(Object.keys(infoPlist)).not.toContain(
      'NSLocationAlwaysAndWhenInUseUsageDescription'
    );
    expect(extra.locationAutomation).toBeUndefined();
  }, 60_000);
});

describe('플래그 ON(=1) — 네이티브 권한 표면과 JS 동작을 함께 켠다', () => {
  it('ON1 expo-location: always 한국어 문구 + 백그라운드 3옵션 true', () => {
    const opts = locationOptions(loadConfig('1'));
    expect(typeof opts.locationAlwaysAndWhenInUsePermission).toBe('string');
    expect(String(opts.locationAlwaysAndWhenInUsePermission)).toMatch(
      /TripPilot/
    );
    expect(opts.isIosBackgroundLocationEnabled).toBe(true);
    expect(opts.isAndroidBackgroundLocationEnabled).toBe(true);
    expect(opts.isAndroidForegroundServiceEnabled).toBe(true);
  });

  it('ON2 Android 3권한 · extra.locationAutomation=true', () => {
    const config = loadConfig('1');
    for (const p of BG_ANDROID)
      expect(config.android?.permissions).toContain(p);
    expect((config.extra as Record<string, unknown>).locationAutomation).toBe(
      true
    );
  });

  it('ON3 해석된 Info.plist 에 UIBackgroundModes location · always 문구가 있다', () => {
    const { infoPlist, extra } = introspect('1');
    expect(infoPlist.UIBackgroundModes).toEqual(['location']);
    expect(
      String(infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription)
    ).toMatch(/TripPilot/);
    expect(extra.locationAutomation).toBe(true);
  }, 60_000);

  it('ON4 always 문구에 소요시간·속도·걸음 수 표현이 없다(INV-3)', () => {
    const opts = locationOptions(loadConfig('1'));
    expect(String(opts.locationAlwaysAndWhenInUsePermission)).not.toMatch(
      /소요|이동 시간|속도|걸음|체류/
    );
  });
});
