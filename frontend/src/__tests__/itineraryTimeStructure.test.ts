/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-299 · h25 완성 일정(AC7 · INV-3) **소스 층 가드**. 렌더로 못 보는 것만 본다 — 보이는
 * 것은 `TimelineScreen.test.tsx` 가 맡는다.
 *
 * 무엇을 보장하나:
 *  - `features/itinerary/ui` 소스 어디에도 **소요시간 표기가 없다**(AC7 · INV-3). 렌더 스캔이
 *    못 보는 `accessibilityLabel="이동 30분"` 같은 **prop 문자열**을 여기서 잡는다(02a ★5).
 *  - 이 칸의 새 파일이 **기존 두 전수 스캔의 사정거리 안에** 들어왔다(아래 「자동 편입」).
 *  - 라우트는 얇다(AC-V) — 조회·마크업은 `pages` 층 몫이다.
 *
 * ── 이 칸이 **자동으로 받는** 심판 (여기서 복제하지 않는다) ──────────────────
 *  - `itineraryMustVisitStructure.test.ts` — 모집단이 `features/itinerary` **디렉토리 재귀**라
 *    `TimelineScreen.tsx` 를 놓는 순간 raw hex 0건·`trip-wizard-` 0건을 자동으로 강제받는다.
 *  - `pagesLayerStructure.test.ts` — `src/pages` **층 재귀**라 `pages/itinerary-plan/` 를 만드는
 *    순간 `duration`·`zustand`·`https://`·`setTimeout`/`setInterval`·raw hex 0건을 강제받는다.
 *  같은 검사를 여기 복제하지 않는다 — 대신 G3 이 "새 파일이 그 경로에 실재한다"만 잰다(모집단이
 *  디렉토리 재귀라 경로 실재가 곧 편입이다).
 *
 * ⚠️ **`duration` 식별자 스캔은 만들지 않는다.** 문제로그 `2026-08-08 INV-3 수호 주석이 duration
 * 탐지기 함정이 된다` — 그건 `pages` 층은 위 전역 가드가 stripComments 로 이미 잠갔고, 화면 층은
 * 아래 G2 가 **소요시간 표기 정규식**(식별자가 아니라 표시 문자열)을 stripComments 후 훑는다.
 *
 * ⚠️ **`startAt`·`endAt` 소스 스캔도 만들지 않는다.** h25 는 완성이라 **모든 슬롯이 검증 시각을
 * 그린다**(BR-U3-07) — 소스에 `startAt` 이 등장하는 것 자체가 정당하다. 이 계약은 렌더 결과 단언
 * (`TimelineScreen.test.tsx` C3)으로 선다.
 *
 * **전제 — 모든 it 은 주석을 걷어낸 소스를 스캔한다**(`stripComments`, 파일마다 각자 갖는 것이
 * 리포 관례). 걷어내지 않으면 "// INV-3 · 소요시간 금지" 같은 **주석 자체가** 부정 단언을 red 로
 * 만든다.
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md 「장치 판정 규칙」) ──────────────────────
 * **A. 영구 규칙 — 유지한다.** G1(탐지기 자가검사)·G2(INV-3 소요시간 표기 금지)는 잠그는 것이
 * INV-3 라 슬라이스·화면이 늘어도 갱신이 필요 없다(모집단이 디렉토리 재귀라 자동 편입). 실측상
 * 기존 5개 프로덕션 화면 전부 이미 만족한다(02a §5-C) — 남의 빚을 떠안지 않는다.
 * **B. 이행 체크포인트 — 한시적.** G3·G4 의 경로·심볼 단언은 이번 칸의 계약 스냅숏이라 정당한
 * 리네임에 red 를 낸다. **B 카운터 = 0.** 정당한 작업이 이 절 때문에 red 를 낸 것이 2회
 * 누적되면 즉시 경로 존재 단언만 남기고 나머지를 뗀다.
 */

const ROOT = path.resolve('src');

const UI_DIR_REL = 'features/itinerary/ui';
const SCREEN_REL = 'features/itinerary/ui/TimelineScreen.tsx';
const PAGE_REL = 'pages/itinerary-plan/ui/ItineraryPlanPage.tsx';
const BARREL_REL = 'pages/itinerary-plan/index.ts';
const MODEL_REL = 'features/itinerary/model/planState.ts';
const ROUTE_REL = 'app/trips/[tripId]/itinerary/index.tsx';

/** 소요시간 **표기** 탐지기 — 식별자가 아니라 화면에 나갈 문자열 형태다(twin C7 과 같은 것).
 * `HH:mm`(예 09:30)은 숫자 뒤가 `:` 이라 걸리지 않는다(02a §5-C·D 실측). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/**
 * (TRIP-300) 확정 배선이 **캐시 데이터를 버리는** 원시를 쓰는지 잡는 탐지기(02a ★3).
 * `resetQueries`/`removeQueries`/`.clear(` 은 `data` 까지 버려 목록이 잠깐 사라진다(2026-08-10
 * 실측 사고). 성공은 `setQueryData`, 409 정합은 `invalidateQueries`(무효화만, 데이터 보존)여야 한다.
 *
 * ⚠️ **왜 소스 가드인가**: mock 재조회는 **즉시** 반환하므로 데이터가 빈 순간(전이)이 렌더 테스트
 * 눈에 안 보인다 — 행동 테스트로는 이 오용을 못 잡는다. 소스 층이 유일한 심판이다.
 */
const RESET_FAMILY = /\bresetQueries\b|\bremoveQueries\b|\.clear\(/;

/** 확정 배선이 착지하는 두 자리(페이지 · 순수/훅 모델). 어느 쪽에 배선하든 사정거리 안이다. */
const CONFIRM_WIRING_DIRS = [
  'pages/itinerary-plan',
  'features/itinerary/model',
];

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다).
 * 줄 주석 규칙에서 **바로 앞 글자가 `:` 이면 주석으로 보지 않는다** — `'https://…'` 의 슬래시를
 * 주석 시작으로 오인하지 않기 위한 것이다(동결 가드들과 같은 규칙).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 생성물·테스트 파일과 글리프 모듈은 대상이 아니다(동결 가드들과 같은 제외 규칙). 디렉토리가
 * 없으면 빈 배열(방어). */
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

/** 없는 파일은 빈 문자열 — ENOENT 예외로 죽으면 "무엇이 없는가"가 diff 에 안 남는다. 빈 문자열이
 * 부정 단언을 공짜로 통과시키는 것은 같은 it 안의 긍정 짝이 먼저 막는다(리포 확립 규약). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: fs.existsSync(path.join(ROOT, rel)) };
}

describe('G1 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 소요시간은 걷히고, 코드의 시각·URL 은 살아남되 시각은 탐지되지 않는다', () => {
    // ★ 조합 검증 — 전처리와 탐지기가 서로를 지우는지 본다(문제로그 2026-08-08 · 2026-07-31).
    const sample = [
      '// INV-3 · 소요시간 표시 금지 — 30분 같은 표기 안 함.',
      "const time = '09:30';",
      "const u = 'https://cdn.example.com/a.png';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 걷지 않으면 그 수호 주석이 G2 를 통과 불가능한 심판으로 만든다.
    expect(stripped).not.toContain('소요');
    expect(stripped).not.toContain('30분');

    // ② ★ 코드의 시각은 살아남고, 탐지기에 **걸리지 않는다** — h25 는 시각을 그리므로 이게
    //    걸리면 INV-3 심판이 정당한 화면을 red 로 만든다(02a ★1 과 양립해야 한다).
    expect(stripped).toContain("const time = '09:30';");
    expect(DURATION_TEXT.test(stripped)).toBe(false);

    // ③ 순진한 `//.*` 제거는 URL 을 `'https:` 로 잘라 뒤 단언을 공짜로 통과시킨다 — 콜론 예외로 산다.
    expect(stripped).toContain("const u = 'https://cdn.example.com/a.png';");
    expect(/https?:\/\//.test(stripped)).toBe(true);

    // ④ 짝 — 탐지기가 진짜 소요시간 표기는 잡는다(이 심판이 우회 불가임을 증명).
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
  });
});

describe('G2 · AC7 — features/itinerary/ui 소스에 소요시간 표기가 0건이다 (INV-3)', () => {
  it('화면 층 전수(주석 제외)에 분·시간·소요 표기가 없다', () => {
    const sources = listSourceFiles(path.join(ROOT, UI_DIR_REL)).map(
      (full) => ({
        file: relOf(full),
        source: readOne(relOf(full)),
      })
    );

    // 긍정 앵커 — 모집단이 비어 있지 않고, 이 칸의 새 화면이 그 안에 있다. 없으면 아래 "0건"이
    // 빈 디렉토리에서 공허하게 통과한다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((entry) => entry.file)).toContain(SCREEN_REL);

    // 부정 — 소요시간 표기가 0건이다. `accessibilityLabel="이동 30분"` 같은 prop 문자열도 잡힌다
    // (렌더 스캔은 자식 텍스트만 봐서 이걸 놓친다 · 02a ★5).
    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('G3 · 편입 앵커 — 새 파일이 기존 두 전수 스캔의 사정거리 안에 있다 (선제 green)', () => {
  it('화면·배선·모델·배럴이 그 경로에 실재하고 배럴이 ItineraryPlanPage 를 재수출한다', () => {
    // 이 네 줄이 raw hex(features 재귀)·pages 층 스캔을 **공허하지 않게** 만든다 — 모집단이
    // 디렉토리 재귀라 경로에 실재하는 것이 곧 편입이다. 파일을 다른 곳에 두면 두 전역 가드는
    // 아무것도 안 보면서 초록으로 남는다.
    [SCREEN_REL, PAGE_REL, MODEL_REL, BARREL_REL].forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    // 배럴이 `export {}` 빈 스텁이 아니라 실제로 심볼을 재수출한다(fsdStructure AC-2 규약).
    expect(readOne(BARREL_REL)).toContain('ItineraryPlanPage');
  });
});

describe('🔴 G4 · AC-V — 라우트는 얇다 (frontend-components.md §0)', () => {
  it('itinerary 라우트가 실재하고 pages 배럴만 가리키며 조회·마크업을 하지 않는다', () => {
    // 긍정(짝) — 파일이 실재한다. `typedRoutes: true` 라 목적지 파일이 없으면 다른 화면의
    // `router.push` 가 타입 단계에서 막힌다.
    expect(existsPair(ROUTE_REL)).toEqual({ file: ROUTE_REL, exists: true });

    const source = readOne(ROUTE_REL);
    // 긍정 — 배럴 경유로 pages 층을 참조한다(딥 임포트 금지 · `draft.tsx` 선례).
    expect(source).toContain('@/pages/itinerary-plan');

    // 부정 — 조회·변이·마크업이 여기 있으면 `pages` 층 전역 가드의 사정거리 밖으로 샌다.
    expect(source).not.toMatch(/\buseQuery\b|\buseMutation\b/);
    expect(source).not.toContain('FlatList');
    expect(source).not.toContain('KakaoMapView');
  });
});

describe('G5 · TRIP-300 확정 배선이 캐시 데이터를 버리지 않는다 (INV-4 · 02a ★3)', () => {
  it('G5-1 자가검사 — 주석 속 resetQueries 는 걷히고, 코드의 오용만 탐지된다', () => {
    // ★ 조합 검증 — 전처리(stripComments)와 탐지기가 서로를 지우는지 실제 문자열로 본다(02a §5-C).
    const sample = [
      '// 성공은 setQueryData, 409 는 invalidateQueries — resetQueries 는 쓰지 않는다.',
      'queryClient.setQueryData(key, data);',
      'void queryClient.invalidateQueries({ queryKey: key });',
      'queryClient.resetQueries({ queryKey: key });', // ← 코드의 위반
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 걷지 않으면 "resetQueries 는 쓰지 않는다"는 수호 주석 자체가
    //    아래 가드를 통과 불가능하게 만든다(거짓 RED).
    expect(
      stripComments('// resetQueries removeQueries .clear() 언급뿐')
    ).not.toMatch(RESET_FAMILY);

    // ② ★ 코드의 오용은 살아남아 탐지된다 — 순진한 제거가 코드를 지우면 심판이 공허해진다.
    expect(stripped).toContain('resetQueries');
    expect(RESET_FAMILY.test(stripped)).toBe(true);

    // ③ 올바른 원시(setQueryData·invalidateQueries)는 걸리지 않는다 — 정상 배선을 red 로 만들지 않는다.
    expect(stripped).toContain('setQueryData');
    expect(stripped).toContain('invalidateQueries');
    expect(RESET_FAMILY.test('queryClient.setQueryData(k, d);')).toBe(false);
    expect(
      RESET_FAMILY.test('queryClient.invalidateQueries({ queryKey });')
    ).toBe(false);
  });

  it('G5-2 — 확정 배선이 사정거리 안에 착지하고, reset-family 는 0건이다', () => {
    const sources = CONFIRM_WIRING_DIRS.flatMap((dir) =>
      listSourceFiles(path.join(ROOT, dir)).map((full) => ({
        file: relOf(full),
        source: readOne(relOf(full)),
      }))
    );
    const combined = sources.map(({ source }) => source).join('\n');

    // 긍정 앵커 — 확정 mutation 배선이 이 두 자리 중 하나에 실재한다(RED now: 아직 미배선).
    // 없으면 아래 "위반 0"이 확정 로직이 딴 데 있는데도 공허하게 통과한다.
    expect(combined).toContain('usePostTripsTripIdItineraryConfirm');

    // 부정 — 캐시 데이터를 버리는 원시가 0건이다. 성공=setQueryData, 409=invalidateQueries 여야 한다.
    const offenders = sources
      .filter(({ source }) => RESET_FAMILY.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
