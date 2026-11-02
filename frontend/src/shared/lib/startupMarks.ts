/**
 * TRIP-1717 · 콜드스타트 시작 마크 — 점마다 시각을 모았다가 파일로 내려(flush 때마다 덮어쓰기, TRIP-1719), 호스트 스크립트(scripts/startup-bench.cjs)가 구간을 계산한다.
 *
 * 켜짐은 빌드 때 굽는 env `EXPO_PUBLIC_STARTUP_MARKS=1` 하나뿐이다(`__DEV__` 로는 안 켠다 — Release 빌드에서 재야 하므로).
 * 꺼져 있으면 두 함수 모두 즉시 반환한다: 기록·파일·console·네트워크 0, `expo-file-system` 도 읽지 않는다.
 * 앱은 원자료만 남기고 구간 정의·무효 판정은 스크립트가 갖는다(정의를 바꿔도 앱을 다시 안 빌드하려고).
 */

export type StartupMarkDetail = Record<
  string,
  string | number | boolean | null
>;

type StartupMark = {
  perfNow: number;
  epoch: number;
  detail?: StartupMarkDetail;
};

// (개념) 모듈 상수 — 파일이 처음 읽힐 때 한 번 정해진다. 문자열 '1' 일 때만 켜진다('true'·'0'·빈 값은 꺼짐).
const ENABLED = process.env.EXPO_PUBLIC_STARTUP_MARKS === '1';

const marks: Record<string, StartupMark> = {};

// RN 이 네이티브 부팅 시각을 getter 클래스로 노출한다 — JSON.stringify 하면 `{}` 라 필드를 하나씩 골라 적는다.
const TIMING_KEYS = [
  'startTime',
  'endTime',
  'initializeRuntimeStart',
  'initializeRuntimeEnd',
  'executeJavaScriptBundleEntryPointStart',
  'executeJavaScriptBundleEntryPointEnd',
] as const;

/** 같은 이름은 첫 기록만 남긴다(effect 재실행·rAF 중복이 값을 덮지 않게). */
export function mark(name: string, detail?: StartupMarkDetail): void {
  if (!ENABLED || name in marks) return;
  marks[name] = {
    perfNow: performance.now(),
    epoch: Date.now(),
    ...(detail ? { detail } : {}),
  };
}

/** 지금까지 모은 마크를 문서 폴더 `startup-marks.json` 에 쓴다 — 부를 때마다 덮어쓴다(첫 프레임 뒤 홈 데이터 점이 늦게 와도 담기게, TRIP-1719). */
export function flushMarks(): void {
  if (!ENABLED) return;
  // 지연 require — expo-file-system 평가 비용이 첫 마크(P1) 앞 JS 평가 구간에 안 들어가게 한다.
  type ExpoFs = typeof import('expo-file-system');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs: ExpoFs = require('expo-file-system');
  const { File, Paths } = fs;
  const timing = (
    performance as unknown as {
      rnStartupTiming?: Partial<Record<(typeof TIMING_KEYS)[number], number>>;
    }
  )?.rnStartupTiming;
  const rnStartupTiming = timing
    ? Object.fromEntries(TIMING_KEYS.map((key) => [key, timing[key] ?? null]))
    : null;
  const file = new File(Paths.document, 'startup-marks.json');
  if (!file.exists) file.create(); // create() 는 이미 있으면 던진다.
  file.write(
    JSON.stringify({
      buildKind: __DEV__ ? 'dev' : 'release',
      marks,
      rnStartupTiming,
    })
  );
}
