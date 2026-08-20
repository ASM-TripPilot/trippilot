/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-395 · BR-U4-34 · PBT-U4-F1 — 여행 중 일정의 **소스 층 시각-무추정 가드**.
 *
 * 무엇을 보장하나:
 *  - `features/execution/**` 소스 어디에도 **슬롯 시각을 건드리는 산술이 없다**. 진행 중 화면의
 *    시각은 계획값(서버 검증값)만 통과해야 하고, 지연을 반영한 도착 시각 재추정을 하지도·저장
 *    하지도 않는다(BR-U4-34 · DEC-U4-9). 렌더 테스트로는 "안 만든 시각"의 부재를 못 본다 —
 *    소스 층이 유일한 심판이다.
 *  - 금지 대상: (i) 날짜 라이브러리 산술(`addMinutes` 류) (ii) `new Date`·`Date.now`·`.getTime()`·
 *    `.getHours()`·`.getMinutes()` (iii) `dayjs`/`date-fns`/`moment`/`luxon` import
 *    (iv) 슬롯 시각 식별자(`startAt`·`endAt`) 옆에 붙은 산술 연산자(`+ - * /`).
 *
 * **왜 바 산술(`+`)을 통째로 금하지 않나**: `slots.length + 1` 같은 정당한 산술까지 red가 된다.
 * 잡아야 하는 것은 "슬롯 시각을 재추정하는 산술"이라, 탐지기는 `startAt`/`endAt` 식별자에
 * **인접한** 연산자만 본다. 문자열 슬라이스(`startAt.slice(0,5)`)나 대입(`startAt: slot.startAt`)은
 * 산술이 아니라 통과한다.
 *
 * **전제 — 주석을 걷어낸 소스를 스캔한다**(`stripComments`, 리포 관례). 걷지 않으면 이 파일의
 * "재추정 금지 · new Date 안 씀" 같은 수호 주석 자체가 부정 단언을 red로 만든다. 줄 주석 규칙은
 * 바로 앞 글자가 `:` 이면 주석으로 보지 않는다 — `'https://…'`의 슬래시 오인을 막는 동결 가드
 * 공통 규칙.
 *
 * **가짜 통과 방지 규약(리포 관례)**: "없어야 한다" 단언은 같은 it 안에서 "있어야 한다" 앵커와
 * 짝을 이룬다 — 빈 디렉토리에서 공허하게 통과하지 않게.
 */

const ROOT = path.resolve('src');
const EXEC_DIR_REL = 'features/execution';
const MODEL_FILES = [
  'features/execution/model/liveState.ts',
  'features/execution/model/slotProgress.ts',
  'features/execution/model/liveViewStore.ts',
  'features/execution/model/useLiveItinerary.ts',
];

/** 날짜 라이브러리 산술 함수 — 시각을 옮기는(재추정하는) 표준 이름들. */
const TIME_LIB =
  /\b(addMinutes|subMinutes|addHours|subHours|addSeconds|subSeconds|addDays|subDays|differenceIn[A-Za-z]+)\b/;
/** 원시 Date 구성·시각 추출 — 이걸로 슬롯 시각을 파싱·연산하면 재추정 경로가 열린다. */
const DATE_CTOR =
  /\bnew Date\b|\bDate\.now\b|\bDate\.parse\b|\.getTime\(\)|\.getHours\(\)|\.getMinutes\(\)/;
/** 날짜 라이브러리 import 자체. */
const DATE_LIB_IMPORT = /from ['"](dayjs|date-fns|moment|luxon)['"]/;
/** 슬롯 시각 식별자에 인접한 산술 연산자. 슬라이스(`.`)·대입(`:`)은 걸리지 않는다. */
const SLOT_TIME_ARITH =
  /\b(startAt|endAt)\s*[+\-*/]|[+\-*/]\s*(startAt|endAt)\b/;

const ALL_DETECTORS = [TIME_LIB, DATE_CTOR, DATE_LIB_IMPORT, SLOT_TIME_ARITH];
const hitsAny = (source: string): boolean =>
  ALL_DETECTORS.some((re) => re.test(source));

/** 블록 주석 먼저 → 줄 주석(콜론 예외). 순서를 바꾸면 한 줄 안 코드가 소실된다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 테스트·글리프 파일은 제외(동결 가드 공통). 디렉토리 없으면 빈 배열(방어 — 구현 전 red 유도). */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      if (/Glyphs\.tsx$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

describe('G1 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 금칙어는 걷히고, 실제 시각 산술은 탐지되며, 정당한 코드는 통과한다', () => {
    // ★ 조합 검증 — 전처리와 탐지기가 서로를 지우는지 실제 문자열로 본다(리포 관례).
    const sample = [
      '// 재추정 금지 — new Date·addMinutes 안 쓴다.',
      "const key = day.date + '#' + slot.poiId;",
      'const shown = slot.startAt.slice(0, 5);',
      'const count = slots.length + 1;',
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 안 걷으면 수호 주석이 스캔을 통과 불가능하게 만든다.
    expect(hitsAny(stripped)).toBe(false);

    // ② 정당한 코드는 살아남고 걸리지 않는다: 문자열 결합·슬라이스·비-시각 산술.
    expect(stripped).toContain("day.date + '#'");
    expect(stripped).toContain('slot.startAt.slice(0, 5)');
    expect(stripped).toContain('slots.length + 1');

    // ③ 짝 — 탐지기가 진짜 시각 산술은 잡는다(우회 불가 증명).
    expect(TIME_LIB.test('addMinutes(slot.startAt, 30)')).toBe(true);
    expect(DATE_CTOR.test('new Date(slot.startAt)')).toBe(true);
    expect(DATE_LIB_IMPORT.test("import dayjs from 'dayjs';")).toBe(true);
    expect(SLOT_TIME_ARITH.test('const t = slot.startAt + delay;')).toBe(true);
    expect(SLOT_TIME_ARITH.test('const t = base + endAt;')).toBe(true);
  });
});

describe('G2 · BR-U4-34 — features/execution/** 소스에 슬롯 시각 산술이 0건이다', () => {
  it('실행 층 전수(주석 제외)에 시각 재추정 산술이 없다', () => {
    const sources = listSourceFiles(path.join(ROOT, EXEC_DIR_REL)).map(
      (full) => ({ file: relOf(full), source: readOne(relOf(full)) })
    );

    // 긍정 앵커 — 모집단이 비어 있지 않고, 이 칸의 model 파일이 그 안에 있다. 없으면 아래
    // "0건"이 빈 디렉토리에서 공허하게 통과한다(구현 전에는 여기서 red).
    expect(sources.length).toBeGreaterThan(0);
    const scanned = sources.map((entry) => entry.file);
    for (const rel of MODEL_FILES) {
      expect(scanned).toContain(rel);
    }

    // 부정 — 시각 산술 0건.
    const offenders = sources
      .filter(({ source }) => hitsAny(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
