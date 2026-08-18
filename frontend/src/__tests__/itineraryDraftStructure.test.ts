/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * h11 초안(TRIP-297) **소스 층 가드**. 렌더로 못 보는 것만 본다 — 보이는 것은 화면·배선
 * 테스트가 맡는다.
 *
 * 무엇을 보장하나:
 *  - 라우트는 얇다(AC-V2) — 조회·변이·마크업은 `pages` 층 몫이다.
 *  - 이 칸의 새 파일이 **기존 두 전수 스캔의 사정거리 안에** 들어왔다(아래 「자동 편입」).
 *  - 폴링에 **자체 타이머를 쓰지 않는다**(AC-9 · 01b) — `refetchInterval` 하나로 끝낸다.
 *  - 지도를 **배럴로** 가져오고 날짜 전환 시 `key` 로 remount 한다(AC-13 · 01b D3).
 *
 * ── 이 칸이 **자동으로 받는** 심판 (여기서 복제하지 않는다) ──────────────────
 *  - `itineraryMustVisitStructure.test.ts` C34·C35 — 모집단이 `features/itinerary`
 *    **디렉토리 재귀**라 `DraftScreen.tsx` 를 놓는 순간 raw hex 11종 0건(AC-V1) ·
 *    `trip-wizard-` 접두 0건(G-U3-4)을 자동으로 강제받는다.
 *  - `pagesLayerStructure.test.ts` G-3 — `src/pages` **층 재귀**라
 *    `pages/itinerary-draft/` 를 만드는 순간 `duration`·`zustand`·`https://`·
 *    `setTimeout`/`setInterval`·raw hex 다섯 가지가 0건이어야 한다(AC-V3).
 *  같은 검사를 여기 복제하면 판정이 두 벌이 되어 규칙이 바뀔 때 두 곳을 고쳐야 한다. 대신
 *  아래 G3 이 "새 파일이 그 경로에 실재한다"만 잰다 — 모집단이 디렉토리 재귀라 **경로 실재가
 *  곧 편입**이고, 이게 없으면 위 두 가드가 빈 디렉토리에서 공허하게 통과한다.
 *
 * ⚠️ **`duration` 식별자 스캔은 일부러 만들지 않는다.** 문제로그 `2026-08-08 INV-3 수호 주석이
 * duration 탐지기 함정이 된다` — 구현자가 `// INV-3 · duration 표시 금지` 라고 적는 순간 그
 * 주석이 탐지기에 걸려 **어떤 구현으로도 통과 불가능한 심판**이 된다. INV-3 의 의무는
 * *"displayed"* 이므로 이 칸은 렌더 결과 텍스트(`DraftScreen.test.tsx` C7)로 재고, `pages` 층
 * 소스는 위 G-3 이 이미 `stripComments` 를 갖춘 채 잠그고 있다.
 *
 * ⚠️ **`startAt`·`endAt` 소스 스캔도 만들지 않는다.** `frontend-components.md` §6 이
 * `itineraryDraftTimeStructure.test.ts` 를 예고했지만, **고정 블록 예외 때문에 소스에 `startAt`
 * 이 등장하는 것 자체가 정당하다**(AC-3 을 구현하는 순간 red 가 된다). 이 계약은 렌더 결과
 * 단언(C2·C4)으로 선다.
 *
 * **전제 — 모든 it 은 주석을 걷어낸 소스를 스캔한다**(`stripComments`, 파일마다 각자 갖는 것이
 * 리포 관례). 걷어내지 않으면 "라우트는 얇다 — `useQuery` 는 pages 층 몫" 같은 **주석 자체가**
 * 부정 단언을 red 로 만든다.
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md 「장치 판정 규칙」) ──────────────────────
 * **A. 영구 규칙 — 유지한다.** G2(라우트 두께)·G4(타이머 금지)는 층 규칙이라 슬라이스가 늘어도
 * 갱신이 필요 없다.
 * **B. 이행 체크포인트 — 한시적.** G3·G5 의 심볼·경로 단언은 이번 칸의 계약 스냅숏이라 정당한
 * 리네임에 red 를 낸다. **B 카운터 = 0.** 정당한 작업이 이 절 때문에 red 를 낸 것이 2회
 * 누적되면 즉시 경로 존재 단언만 남기고 나머지를 뗀다.
 */

const ROOT = path.resolve('src');

const ROUTE_REL = 'app/trips/[tripId]/itinerary/draft.tsx';
const BARREL_REL = 'pages/itinerary-draft/index.ts';
const PAGE_REL = 'pages/itinerary-draft/ui/DraftPage.tsx';
const SCREEN_REL = 'features/itinerary/ui/DraftScreen.tsx';
const MODEL_REL = 'features/itinerary/model/draftView.ts';
/** TRIP-298 — h35 후보 0건 화면. 이름은 `frontend-components.md` §4 가 지정한 것이다. */
const ZERO_SCREEN_REL = 'features/itinerary/ui/ZeroCandidateScreen.tsx';
/** 화면 층 전수 — "판정은 model 한 곳"(§2·§6)의 모집단이다. */
const UI_DIR_REL = 'features/itinerary/ui';

/** 타이머 금지 스캔의 모집단 두 디렉토리. `pages` 쪽은 전역 가드와 겹치지만
 * `features/itinerary` 는 **어느 가드도 타이머를 보지 않는다** — 폴링 카운터를 model 에 두면서
 * `setInterval` 을 쓰는 것이 이 칸에서 가장 있을 법한 우회다(01b 폴링 수치의 급소). */
const TIMER_SCAN_DIRS = ['features/itinerary', 'pages/itinerary-draft'];

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
 * 없으면 빈 배열(방어) — 구현 전에는 두 디렉토리 중 하나가 아직 없다. */
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

function scanSources(): { file: string; source: string }[] {
  return TIMER_SCAN_DIRS.flatMap((rel) =>
    listSourceFiles(path.join(ROOT, rel))
  ).map((full) => ({
    file: path.relative(ROOT, full).split(path.sep).join('/'),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

/** 없는 파일은 빈 문자열 — ENOENT 예외로 죽으면 "무엇이 없는가"가 diff 에 안 남는다. 빈 문자열이
 * 부정 단언을 공짜로 통과시키는 것은 같은 it 안의 긍정 짝이 먼저 막는다(리포 확립 규약). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: fs.existsSync(path.join(ROOT, rel)) };
}

describe('G1 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 금칙어는 걷히고, 코드의 훅·타이머·URL·배럴·지도 key 는 살아남는다', () => {
    // ★ 조합 검증 — 전처리와 탐지기가 서로를 지우는지 본다. 각 요소가 개별로 옳아도 조합이
    //   무너지면 아래 "위반 0건"이 아무것도 안 보면서 통과한다(문제로그 2026-07-31).
    const sample = [
      '/** 라우트는 얇다 — useQuery·useMutation 는 pages 층 몫이다. */',
      '// setInterval 로 폴링하지 않는다 — refetchInterval 하나다.',
      "import { DraftPage } from '@/pages/itinerary-draft';",
      'const q = useQuery({ queryKey });',
      'const t = setInterval(poll, 2000);',
      "const u = 'https://cdn.example.com/a.png';",
      '<KakaoMapView',
      '  key={selectedDate}',
      '  center={center}',
      '/>',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석은 걷힌다. 표본의 `setInterval` 2개(주석 1 + 코드 1) 중 **정확히 1개**만 남고,
    //    주석에만 있던 `useMutation` 은 흔적이 없다.
    expect(stripped.split('setInterval').length - 1).toBe(1);
    expect(/\buseMutation\b/.test(stripped)).toBe(false);

    // ② 코드의 탐지 대상은 전부 살아남는다. 순진한 `//.*` 제거는 URL 을 `'https:` 로 잘라
    //    뒤따르는 단언을 공짜로 통과시킨다.
    expect(/\buseQuery\b/.test(stripped)).toBe(true);
    expect(stripped).toContain("const u = 'https://cdn.example.com/a.png';");
    expect(stripped).toContain('@/pages/itinerary-draft');

    // ③ 지도 remount 탐지기 — 여러 줄로 포맷된 JSX 에서 매칭되고, `key` 가 없으면 안 잡힌다.
    //    React `key` 는 props 로 안 실려 렌더 트리에서 볼 수 없다 — 소스로만 잴 수 있다.
    expect(/<KakaoMapView[^>]*\bkey=/.test(stripped)).toBe(true);
    expect(/<KakaoMapView[^>]*\bkey=/.test('<KakaoMapView center={c} />')).toBe(
      false
    );
  });
});

describe('G2 · AC-V2 — 라우트는 얇다 (frontend-components.md §0)', () => {
  it('h11 라우트가 실재하고 pages 배럴만 가리키며 조회·변이·마크업을 하지 않는다', () => {
    // 긍정(짝) — 파일이 실재한다. `typedRoutes: true` 라 목적지 파일이 없으면 다른 화면에서
    // 이리로 오는 `router.push` 가 타입 단계에서 막힌다.
    expect(existsPair(ROUTE_REL)).toEqual({ file: ROUTE_REL, exists: true });

    const source = readOne(ROUTE_REL);
    // 긍정 — 배럴 경유로 pages 층을 참조한다(딥 임포트 금지 · `trips/new/step1.tsx` 선례).
    expect(source).toContain('@/pages/itinerary-draft');

    // 부정 — 조회·변이가 여기 있으면 `pages` 층 전역 가드의 사정거리 밖으로 샌다.
    expect(source).not.toMatch(/\buseQuery\b|\buseMutation\b/);
    expect(source).not.toContain('FlatList');
    expect(source).not.toContain('KakaoMapView');
  });
});

describe('G3 · 편입 앵커 — 새 파일이 기존 두 전수 스캔의 사정거리 안에 있다', () => {
  it('화면·배선·배럴·모델·h35 화면이 그 경로에 실재하고 배럴이 DraftPage 를 재수출한다', () => {
    // 이 네 줄이 AC-V1·AC-V3 를 **공허하지 않게** 만든다. 모집단이 디렉토리 재귀라
    // (`features/itinerary` · `src/pages`) 경로에 실재하는 것이 곧 편입이다 —
    // 파일을 다른 곳에 두면 두 전역 가드는 아무것도 안 보면서 초록으로 남는다.
    // TRIP-298 이 `ZERO_SCREEN_REL` 을 더한다(AC-V2): 이 줄이 없으면 h35 화면이 raw hex
    // 11종 0건 스캔 밖에 놓여도 아무도 모른다.
    [SCREEN_REL, PAGE_REL, BARREL_REL, MODEL_REL, ZERO_SCREEN_REL].forEach(
      (rel) => expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    // 배럴이 `export {}` 빈 스텁이 아니라 실제로 심볼을 재수출한다(fsdStructure AC-2 규약).
    expect(readOne(BARREL_REL)).toContain('DraftPage');
  });
});

describe('🔴 G4 · AC-9 — 폴링에 자체 타이머를 쓰지 않는다 (01b 폴링 수치)', () => {
  it('두 디렉토리에 타이머가 0건이고, 배선이 refetchInterval 로 센다', () => {
    const sources = scanSources();

    // 긍정 짝 — 모집단이 채워졌고 배선이 실제로 `refetchInterval` 위에 서 있다. 없으면 아래
    // "위반 0건"이 빈 디렉토리에서도 공허하게 통과한다.
    const pageSource = sources.find(({ file }) => file === PAGE_REL);
    expect(pageSource).toBeDefined();
    // ★ 이것이 01b 가 말한 "우회가 아니라 **구조적 회피**"의 실체다. `dataUpdateCount` 는
    //   `useQuery` 반환값에 **없고** `query.state` 에만 있으므로(node_modules 실측), 구현자가
    //   그걸 못 찾으면 자체 카운터 state + `setInterval` 로 가게 된다 — 아래 부정 단언이 그 길을 막는다.
    expect(pageSource?.source).toContain('refetchInterval');

    const timerOffenders = sources.flatMap(({ file, source }) =>
      ['setTimeout', 'setInterval']
        .filter((needle) => source.includes(needle))
        .map((needle) => `${file}: ${needle}`)
    );
    expect(timerOffenders).toEqual([]);
  });
});

describe('G5 · AC-13 — 지도는 배럴로 가져오고 날짜마다 remount 한다 (01b D3)', () => {
  it('DraftScreen 이 @/shared/map 배럴을 쓰고 KakaoMapView 에 key 가 붙어 있다', () => {
    const screenSource = readOne(SCREEN_REL);

    // 긍정(짝) — 읽은 것이 정말 그 화면이다.
    expect(screenSource).toMatch(/export function DraftScreen\b/);

    // ① **배럴 경유**여야 한다. 화면 테스트가 `jest.mock('@/shared/map', …)` 로 지도를 관찰
    //    마커로 바꾸는데, 딥 임포트(`@/shared/map/KakaoMapView`)면 그 목이 안 붙는다 — 실물이
    //    렌더되어 JS 키 없는 jest 환경에서 `map-failure` 로 떨어지고, 테스트는 red 인데
    //    **이유가 AC 와 무관해** 구현자가 엉뚱한 곳을 고친다.
    expect(screenSource).toContain("from '@/shared/map'");
    expect(screenSource).not.toContain('@/shared/map/KakaoMapView');

    // ② `key` 로 remount — `KakaoMapView` 는 마운트 시 `center` 로 HTML 을 **한 번만** 조립하고
    //    이후 갱신하지 않는다(그 컴포넌트의 동결 계약). key 가 없으면 날짜를 바꿔도 지도가
    //    그대로다. React key 는 props 에 안 실려 렌더 트리에서 볼 수 없어 소스로만 잴 수 있다.
    //    ⚠️ 한계: 이 단언은 "key 를 적었다"까지고 값이 옳은지는 [검증]의 화면 대조 몫이다.
    expect(screenSource).toMatch(/<KakaoMapView[^>]*\bkey=/);
  });
});

describe('🔴 G6 · TRIP-298 AC-V1 + TRIP-304 — 폴백 판정은 model 한 곳에 산다 (§2·§6)', () => {
  it('판정이 model 에 있고 배선이 그것을 부르며, 화면 층에는 판정 어휘가 0건이다', () => {
    /**
     * ★ 조합 자가검사 먼저 — 전처리(`stripComments`)와 탐지기를 **함께** 태운다. 구현자가
     * "candidatesSummary 판정은 model 몫" 이라고 **주석**을 다는 순간 그 주석 자체가 위반으로
     * 잡히면 **어떤 구현으로도 통과할 수 없는 심판**이 된다(문제로그 2026-08-08 `duration`
     * 수호 주석과 같은 사고 · 02a ★7).
     */
    const sample = [
      '// candidatesSummary 판정은 model 이 한다 — 화면은 다시 보지 않는다.',
      'const demoted = isCandidatesDemoted(data.candidatesSummary);',
    ].join('\n');
    const stripped = stripComments(sample);
    // 표본의 `candidatesSummary` 2개(주석 1 + 코드 1) 중 **정확히 1개**만 남는다.
    expect(stripped.split('candidatesSummary').length - 1).toBe(1);
    expect(stripped).toContain('isCandidatesDemoted(');

    // 긍정 짝 — 판정이 실재하고 배선이 그것을 부른다. 없으면 아래 "0건"이 공허하다.
    const model = readOne(MODEL_REL);
    expect(model).toMatch(/export function isCandidatesDemoted\b/);
    // TRIP-304 — 삼분 판정 순수 함수도 model 에 산다. `demoted` 는 이 함수가 흡수했다.
    expect(model).toMatch(/export function resolveFallbackNotice\b/);
    // 01b D3 의 정규화(`trim().toUpperCase()`)가 model 안에 있다 — 화면이 아니라 여기다.
    expect(model).toContain('toUpperCase');
    // 배선은 이제 삼분 판정 함수 하나를 부른다(demoted 는 그 안에서 재사용됨, 01b 결정 2).
    expect(readOne(PAGE_REL)).toContain('resolveFallbackNotice');

    const uiFiles = listSourceFiles(path.join(ROOT, UI_DIR_REL));
    // 긍정 짝 — 모집단이 비어 있지 않다(빈 디렉토리에서 부정 단언이 공짜로 통과하는 것 방지).
    expect(uiFiles.length).toBeGreaterThan(0);

    /**
     * 부정 — 화면 층은 요약을 보지도, 어휘를 알지도 못한다. 화면은 `demoted: boolean` 과
     * `shortfallCategories: string[]` **만** 받는다(props 만 받는 층 규약). 판정이 두 층에
     * 흩어지면 같은 규칙이 서로 다르게 진화한다.
     *
     * 졸업 조건: 이 절은 파일 머리말 분류의 **B(이행 체크포인트)** 다 — 심볼 스냅숏이라 정당한
     * 리네임에 red 를 낸다. 기존 B 카운터 규칙(2회 누적 시 제거)을 그대로 승계한다.
     */
    const offenders = uiFiles
      .map((full) => ({
        file: path.relative(ROOT, full).split(path.sep).join('/'),
        source: stripComments(fs.readFileSync(full, 'utf8')),
      }))
      .flatMap(({ file, source }) =>
        // TRIP-304 확장 — 신규 폴백 신호 어휘(`solveMode`·`isFallback`·enum 값)도 화면 층에
        // 0건이어야 한다. 화면은 판정 결과(`fallbackNotice`)만 받고 그 원천 어휘는 모른다(brief 원칙).
        [
          'candidatesSummary',
          "'OK'",
          "'HIGH'",
          "'LOW'",
          "'NO_CANDIDATES'",
          'solveMode',
          'isFallback',
          "'MINIMAL'",
          "'DETERMINISTIC'",
        ]
          .filter((needle) => source.includes(needle))
          .map((needle) => `${file}: ${needle}`)
      );
    expect(offenders).toEqual([]);
  });
});
