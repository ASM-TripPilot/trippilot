/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * h04 시작 방법(TRIP-303) **소스층 가드**. 렌더로 못 보는 것만 본다 — 보이는 것은 배선·화면
 * 통합 테스트(`ItineraryMethodPage.integration.test.tsx`)가 맡는다.
 *
 * 무엇을 보장하나:
 *  - 라우트는 얇다(G1) — 조회·변이·마크업은 `pages` 층 몫이다.
 *  - 새 파일이 기존 전수 스캔(`pagesLayerStructure`·`itineraryMustVisitStructure`)의 사정거리 안에
 *    들어왔다(G2 「편입 앵커」).
 *  - **생성 선행조건(거점 커버리지·겹침) 게이트는 h04 에 없다**(G3) — 그 판단은 여행 생성 2/2(g02,
 *    `TripNewStep2Page`)가 소유한다. h04 의 배선·화면이 coverage/savedStays 를 다시 읽거나 게이트를
 *    되살리면 판정이 두 곳에 흩어진다. 이 부정 단언이 그 회귀를 막는다.
 *
 * ── 이 칸이 **자동으로 받는** 심판 (여기서 복제하지 않는다) ──────────────────
 *  - `pagesLayerStructure.test.ts` — `src/pages` 층 재귀라 `pages/itinerary-method/` 를 만드는 순간
 *    `duration`(INV-3)·zustand·`https://`·`setTimeout`/`setInterval`·raw hex 다섯 가지가 0 건이어야 한다.
 *  - `itineraryMustVisitStructure`·`itineraryTimeStructure` 등 — 모집단이 `features/itinerary` **디렉토리
 *    재귀**라 `MethodPickerScreen.tsx` 를 놓는 순간 raw hex·`duration` 0 건을 자동으로 강제받는다.
 *  대신 아래 G2 가 "새 파일이 그 경로에 실재한다"만 잰다 — 모집단이 디렉토리 재귀라 **경로 실재가
 *  곧 편입**이고, 이게 없으면 위 가드들이 빈 디렉토리에서 공허하게 통과한다.
 *
 * **전제 — 모든 it 은 주석을 걷어낸 소스를 스캔한다**(`stripComments`, 파일마다 각자 갖는 것이 리포
 * 관례). 걷어내지 않으면 "게이트는 g02 몫 — 화면은 useTripCoverage 를 안 본다" 같은 **주석 자체가**
 * 부정 단언을 red 로 만든다(2026-08-08 `duration` 수호주석 사고 계열).
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은 it 안에서
 * 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md 「장치 판정 규칙」) ──────────────────────
 * **A. 영구 규칙 — 유지한다.** G1(라우트 두께)·G3 부정단언(게이트 h04 부재)은 층·아키텍처 규칙이라
 * 슬라이스가 늘어도 갱신이 필요 없다.
 * **B. 이행 체크포인트 — 한시적.** G2 의 경로 스냅숏은 이번 칸의 계약이라 정당한 리네임에 red 를 낸다.
 * **B 카운터 = 0.** 정당한 작업이 이 절 때문에 red 를 낸 것이 2 회 누적되면 즉시 경로 존재 단언만 남긴다.
 */

const ROOT = path.resolve('src');

const ROUTE_REL = 'app/trips/[tripId]/itinerary/method.tsx';
const BARREL_REL = 'pages/itinerary-method/index.ts';
const PAGE_REL = 'pages/itinerary-method/ui/ItineraryMethodPage.tsx';
const SCREEN_REL = 'features/itinerary/ui/MethodPickerScreen.tsx';

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다).
 * 줄 주석 규칙에서 **바로 앞 글자가 `:` 이면 주석으로 보지 않는다** — `'https://…'` 의 슬래시를 주석
 * 시작으로 오인하지 않기 위한 것이다(동결 가드들과 같은 규칙).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — ENOENT 로 죽으면 "무엇이 없는가"가 diff 에 안 남는다. 빈 문자열이 부정
 * 단언을 공짜로 통과시키는 것은 같은 it 안의 긍정 짝이 먼저 막는다(리포 확립 규약). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: fs.existsSync(path.join(ROOT, rel)) };
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 금칙어는 걷히고 코드의 호출·URL 은 살아남는다', () => {
    const sample = [
      '// 게이트는 g02 몫 — 화면은 useTripCoverage 를 안 본다.',
      'const gate = useTripCoverage(tripId);',
      "const u = 'https://cdn.example.com/a.png';",
    ].join('\n');

    const stripped = stripComments(sample);

    // 표본의 `useTripCoverage` 2개(주석 1 + 코드 1) 중 정확히 1개만 남는다.
    expect(stripped.split('useTripCoverage').length - 1).toBe(1);
    // 코드의 호출·URL 은 살아남는다(순진한 `//.*` 제거는 URL 을 잘라 부정 단언을 공짜로 통과시킨다).
    expect(stripped).toContain('const gate = useTripCoverage(tripId);');
    expect(stripped).toContain("const u = 'https://cdn.example.com/a.png';");
  });
});

describe('🔴 G1 · 라우트는 얇다', () => {
  it('method 라우트가 실재하고 pages 배럴만 가리키며 조회·변이·마크업을 하지 않는다', () => {
    // 짝 — 파일이 실재한다. typedRoutes: true 라 목적지 파일이 없으면 다른 화면에서 이리로 오는
    // router.push 가 타입 단계에서 막힌다.
    expect(existsPair(ROUTE_REL)).toEqual({ file: ROUTE_REL, exists: true });

    const source = readOne(ROUTE_REL);
    // 짝 — 배럴 경유로 pages 층을 참조한다(딥 임포트 금지 · draft.tsx 선례).
    expect(source).toContain('@/pages/itinerary-method');

    // 부정 — 조회·변이·마크업이 여기 있으면 pages 층 전역 가드의 사정거리 밖으로 샌다.
    expect(source).not.toMatch(/\buseQuery\b|\buseMutation\b/);
    expect(source).not.toContain('FlatList');
    expect(source).not.toContain('KakaoMapView');
  });
});

describe('🔴 G2 · 편입 앵커 — 새 파일이 기존 두 전수 스캔의 사정거리 안에 있다', () => {
  it('페이지·배럴·화면이 그 경로에 실재하고 배럴이 ItineraryMethodPage 를 재수출한다', () => {
    // 이 세 줄이 위 두 전역 가드(pages 재귀 · features/itinerary 재귀)를 **공허하지 않게** 만든다 —
    // 파일을 다른 곳에 두면 두 가드는 아무것도 안 보면서 초록으로 남는다.
    [PAGE_REL, BARREL_REL, SCREEN_REL].forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    // 배럴이 빈 스텁이 아니라 실제 심볼을 재수출한다(fsdStructure 규약).
    expect(readOne(BARREL_REL)).toContain('ItineraryMethodPage');
  });
});

describe('🔴 G3 · 생성 선행조건 게이트는 h04 에 없다 (g02 소유)', () => {
  it('배선은 POST 만 물고, 배선·화면 어디에도 coverage/savedStays/게이트 어휘가 0건이다', () => {
    const page = readOne(PAGE_REL);
    const screen = readOne(SCREEN_REL);

    // 짝 — 읽은 것이 정말 그 배선·화면이다(빈 문자열에서 부정 단언이 공짜로 통과하는 것 방지).
    expect(page).toContain('ItineraryMethodPage');
    expect(screen).toMatch(/MethodPickerScreen/);

    // 짝 — 배선은 생성 POST 훅을 문다(방식 선택 → 생성 요청).
    expect(page).toContain('usePostTripsTripIdItinerary');

    // 부정 — 거점 커버리지·겹침 판단은 g02 소유다. h04 배선·화면 어디에도 그 조회·판정이 없다.
    // 되살아나면 판정이 두 곳에 흩어진다(개념: 판정 단일 출처).
    for (const source of [page, screen]) {
      expect(source).not.toContain('useTripCoverage');
      expect(source).not.toContain('useSavedStays');
      expect(source).not.toContain('generationGate');
    }

    // 부정 — 화면은 조회·변이 훅을 직접 물지 않는다(프레젠테이션 순수성). useState 같은 지역 UI 상태는
    // 금지 대상이 아니다.
    expect(screen).not.toMatch(/\buseQuery\b|\buseMutation\b/);
  });
});
