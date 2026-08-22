/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-397 · BR-U4-41 — **걸음 수 비기록·비표시 전역 가드**.
 *
 * 실제 경로는 앱을 켜 둔 구간만 기록하되, **걸음 수(보수)는 기록하지도 표시하지도 않는다**.
 * 앱 소스 어디에도 걸음 수 계열 심볼이 없어야 한다.
 *
 * 탐지기는 **걸음-세기 합성어만** 본다 — 바 `step`(위저드 `step1`·`stepper`)이나 한 글자 `보`는
 * 정당한 코드에 흔해 오탐이라, `pedometer`·`stepCount`·`step-count`·`걸음 수`·`만보`·`보수계`만 잡는다.
 *
 * 전제: 주석 제거 후 스캔(수호 주석의 금칙어가 부정 단언을 red 로 만들지 않게).
 */

const ROOT = path.resolve('src');
const SCAN_DIRS = ['features', 'shared', 'pages', 'app'];

/** 걸음-세기 합성어만. `stepper`·`step1`·`보통`은 안 걸린다. */
const STEP_COUNT = /pedometer|step[-_ ]?count|걸음\s*수|만보|보수계/i;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'generated') return [];
        return listSourceFiles(full);
      }
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function readOne(full: string): string {
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

describe('G1 · 탐지기 자가검사', () => {
  it('걸음-세기 합성어는 잡고, 정당한 step·보 는 통과한다', () => {
    // 잡아야 하는 것
    expect(STEP_COUNT.test('pedometer')).toBe(true);
    expect(STEP_COUNT.test('const stepCount = 0;')).toBe(true);
    expect(STEP_COUNT.test('step_count')).toBe(true);
    expect(STEP_COUNT.test('오늘 걸음 수')).toBe(true);
    expect(STEP_COUNT.test('만보계')).toBe(true);
    expect(STEP_COUNT.test('보수계')).toBe(true);

    // 오탐이면 안 되는 것 — 위저드 step·stepper·일반어
    expect(STEP_COUNT.test('TripNewStep1Page')).toBe(false);
    expect(STEP_COUNT.test('const stepper = 1;')).toBe(false);
    expect(STEP_COUNT.test('step2.tsx')).toBe(false);
    expect(STEP_COUNT.test('보통 · 보기')).toBe(false);
  });
});

describe('G2 · BR-U4-41 — 앱 소스 전역에 걸음 수 심볼이 0건이다', () => {
  it('features·shared·pages·app 전수(주석 제외)에 걸음-세기 심볼이 없다', () => {
    const sources = SCAN_DIRS.flatMap((dir) =>
      listSourceFiles(path.join(ROOT, dir)).map((full) => ({
        file: relOf(full),
        source: readOne(full),
      }))
    );

    // 긍정 앵커 — 모집단이 비어 있지 않다(공허 통과 방지).
    expect(sources.length).toBeGreaterThan(50);

    const offenders = sources
      .filter(({ source }) => STEP_COUNT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
