/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * h09 생성 중(TRIP-305) **소스층 가드**. 렌더로 못 보는 것만 본다 — 보이는 것은 화면·배선
 * 테스트(`GeneratingScreen.test.tsx`·`GeneratingPage.integration.test.tsx`)가 맡는다.
 *
 * 무엇을 보장하나:
 *  - 라우트는 얇다(G1) — 조회·변이·마크업은 `pages` 층 몫이다.
 *  - 새 파일이 기존 전수 스캔의 사정거리 안에 들어왔다(G2 「편입 앵커」).
 *  - **화면은 재판정을 하지 않는다**(G3 · AC-V) — 생성 POST·라우터·조회·스토어를 화면이 직접
 *    물면 배선과 그림의 경계가 무너진다. 이 부정 단언이 그 회귀를 막는다.
 *
 * ── 이 칸이 **자동으로 받는** 심판 (여기서 복제하지 않는다) ──────────────────
 *  - `itineraryTimeStructure.test.ts` — 모집단이 `features/itinerary/ui` **디렉토리 재귀**라
 *    `GeneratingScreen.tsx` 를 놓는 순간 소요시간 표기(`N분`/`N시간`/`소요`) 0건을 자동 강제받는다(INV-3).
 *  - `itineraryDraftStructure.test.ts` G4 — 타이머 스캔 모집단이 `features/itinerary` 를 포함해
 *    `GeneratingScreen.tsx` 의 `setTimeout`/`setInterval` 0건을 강제한다(비결정형 진행은 RN Animated,
 *    폴링 아님).
 *  - `pagesLayerStructure.test.ts` — `src/pages` 층 재귀라 `pages/itinerary-generating/` 를 만드는 순간
 *    `duration`·`zustand`·`https://`·`setTimeout`/`setInterval`·raw hex 0건을 강제받는다.
 *  - `itineraryMustVisitStructure.test.ts` — `features/itinerary` 재귀라 raw hex·`trip-wizard-` 0건.
 *  같은 검사를 여기 복제하지 않는다 — 대신 G2 가 "새 파일이 그 경로에 실재한다"만 잰다(모집단이
 *  디렉토리 재귀라 경로 실재가 곧 편입이고, 이게 없으면 위 가드들이 빈 디렉토리에서 공허하게 통과한다).
 *
 * **전제 — 모든 it 은 주석을 걷어낸 소스를 스캔한다**(`stripComments`, 파일마다 각자 갖는 것이 리포
 * 관례). 걷어내지 않으면 "화면은 POST 를 안 문다 — 배선 몫" 같은 **주석 자체가** 부정 단언을 red 로
 * 만든다(2026-08-08 `duration` 수호주석 사고 계열).
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은 it 안에서
 * 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md 「장치 판정 규칙」) ──────────────────────
 * **A. 영구 규칙 — 유지한다.** G1(라우트 두께)·G3(화면 순수성)은 층·아키텍처 규칙이라 화면이 커져도
 * 갱신이 필요 없다.
 * **B. 이행 체크포인트 — 한시적.** G2 의 경로 스냅숏은 이번 칸의 계약이라 정당한 리네임에 red 를 낸다.
 * **B 카운터 = 0.** 정당한 작업이 이 절 때문에 red 를 낸 것이 2 회 누적되면 즉시 경로 존재 단언만 남긴다.
 */

const ROOT = path.resolve('src');

const ROUTE_REL = 'app/trips/[tripId]/itinerary/generating.tsx';
const BARREL_REL = 'pages/itinerary-generating/index.ts';
const PAGE_REL = 'pages/itinerary-generating/ui/GeneratingPage.tsx';
const SCREEN_REL = 'features/itinerary/ui/GeneratingScreen.tsx';

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
  it('주석 속 금칙어는 걷히고 코드의 훅·URL 은 살아남는다', () => {
    const sample = [
      '// 화면은 POST 를 안 문다 — usePostTripsTripIdItinerary 는 배선 몫.',
      'const m = usePostTripsTripIdItinerary();',
      "const u = 'https://cdn.example.com/a.png';",
    ].join('\n');

    const stripped = stripComments(sample);

    // 표본의 `usePostTripsTripIdItinerary` 2개(주석 1 + 코드 1) 중 정확히 1개만 남는다.
    expect(stripped.split('usePostTripsTripIdItinerary').length - 1).toBe(1);
    // 코드의 호출·URL 은 살아남는다(순진한 `//.*` 제거는 URL 을 잘라 부정 단언을 공짜로 통과시킨다).
    expect(stripped).toContain('const m = usePostTripsTripIdItinerary();');
    expect(stripped).toContain("const u = 'https://cdn.example.com/a.png';");
  });
});

describe('🔴 G1 · AC-V — 라우트는 얇다', () => {
  it('generating 라우트가 실재하고 pages 배럴만 가리키며 조회·변이·마크업을 하지 않는다', () => {
    // 짝 — 파일이 실재한다. typedRoutes: true 라 목적지 파일이 없으면 h04 의 router.push 가
    // 타입 단계에서 막힌다. **RED now** — 구현자가 만든다.
    expect(existsPair(ROUTE_REL)).toEqual({ file: ROUTE_REL, exists: true });

    const source = readOne(ROUTE_REL);
    // 짝 — 배럴 경유로 pages 층을 참조한다(딥 임포트 금지 · draft.tsx 선례).
    expect(source).toContain('@/pages/itinerary-generating');

    // 부정 — 조회·변이·마크업이 여기 있으면 pages 층 전역 가드의 사정거리 밖으로 샌다.
    expect(source).not.toMatch(/\buseQuery\b|\buseMutation\b/);
    expect(source).not.toContain('FlatList');
    expect(source).not.toContain('KakaoMapView');
  });
});

describe('G2 · 편입 앵커 — 새 파일이 기존 전수 스캔의 사정거리 안에 있다', () => {
  it('페이지·배럴·화면이 그 경로에 실재하고 배럴이 GeneratingPage 를 재수출한다', () => {
    // 이 세 줄이 위 전역 가드들(pages 재귀 · features/itinerary 재귀)을 **공허하지 않게** 만든다 —
    // 파일을 다른 곳에 두면 그 가드들은 아무것도 안 보면서 초록으로 남는다.
    [PAGE_REL, BARREL_REL, SCREEN_REL].forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    // 배럴이 빈 스텁이 아니라 실제 심볼을 재수출한다(fsdStructure 규약).
    expect(readOne(BARREL_REL)).toContain('GeneratingPage');
  });
});

describe('🔴 G3 · AC-V — 화면은 재판정을 하지 않는다 (프레젠테이션 순수성)', () => {
  it('화면이 생성 POST·라우터·조회·스토어를 직접 물지 않고 props 만 받는다', () => {
    const screen = readOne(SCREEN_REL);

    // 짝 — 읽은 것이 정말 그 화면이다(빈 문자열에서 부정 단언이 공짜로 통과하는 것 방지).
    expect(screen).toMatch(/export function GeneratingScreen\b/);

    // 부정 — 화면은 배선의 일을 하지 않는다. 이 어휘가 화면에 등장하면 판정·부작용이 두 층으로
    // 흩어진다(개념: 배선=page · 그림=screen · 판정 단일 출처).
    expect(screen).not.toContain('usePostTripsTripIdItinerary');
    expect(screen).not.toMatch(/\buseQuery\b|\buseMutation\b/);
    expect(screen).not.toContain('expo-router');
    expect(screen).not.toContain('zustand');
  });
});
