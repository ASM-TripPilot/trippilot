/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-302 · h24 일정 편집(슬라이스1 · AC8) **소스 층 편입 앵커**.
 *
 * 무엇을 보장하나:
 *  - 슬라이스1의 신규 파일 5종이 **정본 경로에 실재**한다(E2 — 구현 전 RED).
 *  - 그 파일들이 기존 **동결 소스 가드의 디렉토리 재귀 사정거리 안에** 들어온다(E2·E3):
 *      · `itineraryTimeStructure.test.ts` G2 — `features/itinerary/ui` 재귀 → 새 화면의 소요시간 표기 0건 강제
 *      · `itineraryMustVisitStructure.test.ts` C34 — `features/itinerary` 재귀 → 새 화면·스토어의 raw hex 0건 강제
 *      · `pagesLayerStructure.test.ts` G-3 — `src/pages` 재귀 → 새 페이지의 zustand·https·타이머·hex 0건 강제
 *    (브리프 맹점① · 02a ★9 · §5-C 로 재귀 도달을 실제 fs 로 태워 확인했다.)
 *  - 새 화면·스토어·페이지 소스가 **소요시간 표기·raw hex 0건**(E3, 정당 파일은 clean).
 *  - 라우트는 얇고(E4) 배럴이 실제로 재수출한다.
 *
 * **detector를 복제하지 않는다** — 위 세 동결 가드가 detector를 이미 갖고 있다. 이 파일은 (a)
 * 편입 앵커(경로 실재 + 재귀 도달)와 (b) 새 파일 한정 clean 재스캔만 둔다. 같은 것을 여기서 또
 * 만들면 남의 빚을 떠안는다.
 *
 * **전제 — 모든 스캔은 주석을 걷어낸 소스를 본다**(`stripComments`, 동결 가드들과 같은 규칙).
 * **가짜 통과 방지 규약**: 모든 "없어야 한다"는 같은 it 안의 "있어야 한다"와 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md 「장치 판정 규칙」) ──────────────────────
 * **A. 영구 규칙 — 유지.** E1(detector 자가검사)·E3(새 파일 clean)은 잠그는 것이 INV-3/토큰
 *  규칙이라 슬라이스가 늘어도 갱신 불요(모집단 재귀 자동 편입). 실측상 정당 편집 파일은 이미
 *  만족(§5-C).
 * **B. 이행 체크포인트 — 한시적.** E2·E4의 경로·심볼 단언은 이번 슬라이스 계약 스냅숏이라 정당한
 *  리네임에 red 를 낸다. **B 카운터 = 0.** 정당 작업이 이 절 때문에 red 낸 것이 2회 누적되면
 *  즉시 경로 실재 앵커만 남기고 나머지를 뗀다.
 */

const ROOT = path.resolve('src');

const UI_DIR_REL = 'features/itinerary/ui';
const MODEL_DIR_REL = 'features/itinerary/model';
const PAGES_DIR_REL = 'pages';

const SCREEN_REL = 'features/itinerary/ui/ItineraryEditScreen.tsx';
const STORE_REL = 'features/itinerary/model/itineraryEditStore.ts';
const PAGE_REL = 'pages/itinerary-edit/ui/ItineraryEditPage.tsx';
const BARREL_REL = 'pages/itinerary-edit/index.ts';
const ROUTE_REL = 'app/trips/[tripId]/itinerary/edit.tsx';

/** 소요시간 **표기** 탐지기 — 화면에 나갈 문자열 형태다(동결 가드 DURATION_TEXT 와 같은 것).
 * `HH:mm`(09:30)은 숫자 뒤가 `:` 라 안 걸린다. '시각'(U+AC01)은 '시간'(U+AC04)과 달라 안 걸린다. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 토큰으로 이미 존재하는 색 — raw hex 로 적으면 토큰 우회다(동결 가드들과 같은 목록). */
const TOKENIZED_HEX = [
  '#222222',
  '#6a6a6a',
  '#ededed',
  '#dddddd',
  '#ff385c',
  '#ffe4e9',
  '#c13515',
  '#f7f7f7',
  '#3f3f3f',
  '#9aa1ab',
  '#ffffff',
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
 * 없으면 빈 배열(방어) — 구현 전에는 새 디렉토리가 아직 없다. */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'generated' ? [] : listSourceFiles(full);
      }
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      if (/Glyphs\.tsx$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function scan(dirRel: string): { file: string; source: string }[] {
  return listSourceFiles(path.join(ROOT, dirRel)).map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

/** 없는 파일은 빈 문자열 — ENOENT 로 죽으면 "무엇이 없는가"가 diff 에 안 남는다. 빈 문자열이
 * 부정 단언을 공짜로 통과시키는 것은 같은 it 안의 긍정 짝이 먼저 막는다(리포 확립 규약). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: fs.existsSync(path.join(ROOT, rel)) };
}

describe('E1 · detector 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 소요시간·hex 는 걷히고, 코드의 시각칩·URL 은 살아남되 시각은 안 걸린다', () => {
    // ★ 조합 검증 — 전처리와 탐지기가 서로를 지우는지 실제 문자열로 본다(문제로그 2026-07-31).
    const sample = [
      '// INV-3 · 소요시간(30분) 표기 금지 · raw hex(#ff385c) 금지 — 수호 주석.',
      "const chip = '09:30–11:00';",
      "const subtitle = '체크아웃 · 변경·삭제 불가';",
      "const thumb = 'https://cdn.example.com/p.jpg';",
      "const cls = 'bg-primary text-primary-text rounded-card';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 안 걷으면 수호 주석 자체가 아래 스캔을 통과 불가로 만든다.
    expect(stripped).not.toContain('소요');
    expect(stripped).not.toContain('30분');
    expect(stripped.toLowerCase()).not.toContain('#ff385c');

    // ② ★ 코드의 시각칩은 살아남고 탐지기에 **안 걸린다** — 편집 화면은 시각을 그리므로 이게
    //    걸리면 정당한 화면이 red 가 된다.
    expect(stripped).toContain("const chip = '09:30–11:00';");
    expect(DURATION_TEXT.test(stripped)).toBe(false);
    expect(
      TOKENIZED_HEX.filter((h) => stripped.toLowerCase().includes(h))
    ).toEqual([]);

    // ③ 순진한 `//.*` 제거는 URL 을 `'https:` 로 잘라 뒤 단언을 공짜로 통과시킨다 — 콜론 예외로 산다.
    expect(stripped).toContain(
      "const thumb = 'https://cdn.example.com/p.jpg';"
    );
    expect(/https?:\/\//.test(stripped)).toBe(true);

    // ④ 짝 — '시각'(U+AC01)은 '시간'(U+AC04)이 아니라 미검출, 진짜 소요시간은 검출.
    expect(DURATION_TEXT.test('시각 조정')).toBe(false);
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
  });
});

describe('🔴 E2 · AC8 편입 앵커 — 신규 파일 5종이 재귀 사정거리 안에 실재한다', () => {
  it('화면·스토어·페이지·배럴·라우트가 정본 경로에 있고, 재귀 모집단에 잡힌다', () => {
    // 경로 실재(구현 전 전부 RED). typedRoutes 라 라우트 파일이 없으면 다른 화면의 push 도 막힌다.
    [SCREEN_REL, STORE_REL, PAGE_REL, BARREL_REL, ROUTE_REL].forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    // 새 화면이 features/itinerary/ui 재귀에(itineraryTimeStructure G2 사정거리),
    // 새 스토어가 features/itinerary 재귀에(itineraryMustVisitStructure C34 사정거리),
    // 새 페이지가 src/pages 재귀에(pagesLayerStructure G-3 사정거리) 실제로 들어온다.
    expect(scan(UI_DIR_REL).map((s) => s.file)).toContain(SCREEN_REL);
    expect(scan(MODEL_DIR_REL).map((s) => s.file)).toContain(STORE_REL);
    expect(scan(PAGES_DIR_REL).map((s) => s.file)).toContain(PAGE_REL);
  });
});

describe('🔴 E3 · AC8 — 새 화면·스토어·페이지 소스가 소요시간·raw hex 0건이다', () => {
  it('세 파일이 clean 하고(긍정 앵커: 모집단에 실재), 소요시간·토큰화 색이 0건이다', () => {
    const targets = [SCREEN_REL, STORE_REL, PAGE_REL].map((rel) => ({
      file: rel,
      source: readOne(rel),
    }));

    // 긍정 앵커 — 새 화면이 실제 스캔 모집단에 있다(없으면 아래 부정 단언이 공허하게 통과).
    expect(scan(UI_DIR_REL).map((s) => s.file)).toContain(SCREEN_REL);

    const durationOffenders = targets
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(durationOffenders).toEqual([]);

    const hexOffenders = targets.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(hexOffenders).toEqual([]);
  });
});

describe('🔴 E4 · AC8 — 라우트·배럴 두께', () => {
  it('라우트가 pages 배럴만 가리키고 조회·리스트를 직접 만지지 않으며, 배럴이 페이지를 재수출한다', () => {
    // 긍정 짝 — 파일이 실재해야 아래 읽기가 의미를 갖는다.
    expect(existsPair(ROUTE_REL)).toEqual({ file: ROUTE_REL, exists: true });

    const route = readOne(ROUTE_REL);
    // 긍정 — 배럴 경유(딥 임포트 금지, itinerary/index.tsx 선례).
    expect(route).toContain('@/pages/itinerary-edit');
    // 부정 — 조회·변이·리스트가 라우트에 있으면 pages 층 가드 사정거리 밖으로 샌다.
    expect(route).not.toMatch(/\buseQuery\b|\buseMutation\b/);
    expect(route).not.toContain('DraggableFlatList');
    expect(route).not.toContain('FlatList');

    // 배럴이 빈 스텁이 아니라 실제로 심볼을 재수출한다(fsdStructure AC-2 규약).
    expect(readOne(BARREL_REL)).toContain('ItineraryEditPage');
  });
});
