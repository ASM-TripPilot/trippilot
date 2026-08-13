/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-302 · h24 시각조정 시트(슬라이스3 · AC-T6·AC-T8) **소스 층 편입 앵커**.
 *
 * 무엇을 보장하나:
 *  - 신규 시트 `SlotTimeSheet.tsx` 가 **정본 경로에 실재**하고(구현 전 RED),
 *  - 그 파일이 기존 **동결 소스 가드의 디렉토리 재귀 사정거리 안에** 들어온다(Seed D7 자동 편입):
 *      · `itineraryTimeStructure.test.ts` G2 — `features/itinerary/ui` 재귀 → 새 시트의 소요시간 표기 0건
 *      · `itineraryMustVisitStructure.test.ts` C34 — `features/itinerary` 재귀 → 새 시트의 raw hex 0건
 *  - 새 시트 소스가 **소요시간 표기·raw hex 0건**(정당 파일은 clean, AC-T6),
 *  - **화면 순수성**(AC-T8) — `ItineraryEditScreen.tsx` 는 시트·스토어를 모르고(gorhom·store 미참조),
 *    시트는 gorhom 을 쓰며, 화면은 새 prop `onEditSlotTime` 만 배선한다.
 *
 * **detector 를 복제·재발명하지 않는다** — 위 두 동결 가드가 이미 갖고 있다. 이 파일은 (a) 편입
 * 앵커(경로 실재 + 재귀 도달)와 (b) 새 파일 한정 clean 재스캔·화면 순수성만 둔다. detector 는
 * 동결 가드의 것을 **그대로 복사**해 자가검사(E1)로 조합을 재확인한다.
 *
 * **전제 — 모든 스캔은 주석을 걷어낸 소스를 본다**(`stripComments`, 동결 가드들과 같은 규칙).
 * **가짜 통과 방지 규약**: 모든 "없어야 한다"는 같은 it 안의 "있어야 한다"와 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md 「장치 판정 규칙」) ──────────────────────
 * **A. 영구 규칙 — 유지.** E1(detector 자가검사)·E3(새 파일 clean)은 잠그는 것이 INV-3/토큰
 *  규칙이라 슬라이스가 늘어도 갱신 불요(모집단 재귀 자동 편입).
 * **B. 이행 체크포인트 — 한시적.** E2·E4 의 경로·심볼 단언은 이번 슬라이스 계약 스냅숏이라 정당한
 *  리네임에 red 를 낸다. **B 카운터 = 0.** 정당 작업이 이 절 때문에 red 낸 것이 2회 누적되면
 *  즉시 경로 실재 앵커만 남기고 나머지를 뗀다.
 */

const ROOT = path.resolve('src');

const UI_DIR_REL = 'features/itinerary/ui';
const FEATURE_DIR_REL = 'features/itinerary';

const SHEET_REL = 'features/itinerary/ui/SlotTimeSheet.tsx';
const SCREEN_REL = 'features/itinerary/ui/ItineraryEditScreen.tsx';

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
 * 없으면 빈 배열(방어) — 구현 전에는 새 시트가 아직 없다. */
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
  it('주석 속 소요시간·hex 는 걷히고, 코드의 시각칩·URL·bare 분 셀은 살아남되 안 걸린다', () => {
    // ★ 조합 검증 — 전처리와 탐지기가 서로를 지우는지 실제 문자열로 본다(문제로그 2026-07-31).
    const sample = [
      '// INV-3 · 소요시간(30분) 표기 금지 · raw hex(#ff385c) 금지 — 수호 주석.',
      "const chip = '10:15';",
      "const minuteCell = '30';",
      "const thumb = 'https://cdn.example.com/p.jpg';",
      "const cls = 'bg-primary text-primary-text rounded-card';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 안 걷으면 수호 주석 자체가 아래 스캔을 통과 불가로 만든다.
    expect(stripped).not.toContain('소요');
    expect(stripped).not.toContain('30분');
    expect(stripped.toLowerCase()).not.toContain('#ff385c');

    // ② ★ 코드의 시각칩·bare 분 셀은 살아남고 탐지기에 **안 걸린다** — 시트는 시각을 그리므로
    //    이게 걸리면 정당한 시트가 red 가 된다(02a ★2).
    expect(stripped).toContain("const chip = '10:15';");
    expect(stripped).toContain("const minuteCell = '30';");
    expect(DURATION_TEXT.test(stripped)).toBe(false);
    expect(
      TOKENIZED_HEX.filter((h) => stripped.toLowerCase().includes(h))
    ).toEqual([]);

    // ③ 순진한 `//.*` 제거는 URL 을 `'https:` 로 잘라 뒤 단언을 공짜로 통과시킨다 — 콜론 예외로 산다.
    expect(stripped).toContain(
      "const thumb = 'https://cdn.example.com/p.jpg';"
    );
    expect(/https?:\/\//.test(stripped)).toBe(true);

    // ④ 짝 — bare 분 셀은 미검출이지만 "30분"(분 셀을 잘못 그린 것)은 검출된다(★2 함정 증명).
    expect(DURATION_TEXT.test('30')).toBe(false);
    expect(DURATION_TEXT.test('30분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
  });
});

describe('🔴 E2 · AC-T6 편입 앵커 — 신규 시트가 두 동결 가드의 재귀 사정거리 안에 실재한다', () => {
  it('SlotTimeSheet.tsx 가 정본 경로에 있고, features/itinerary(/ui) 재귀 모집단에 잡힌다', () => {
    // 경로 실재(구현 전 RED).
    expect(existsPair(SHEET_REL)).toEqual({ file: SHEET_REL, exists: true });

    // 새 시트가 itineraryTimeStructure G2(ui 재귀)·itineraryMustVisitStructure C34(feature 재귀)
    // 의 스캔 모집단에 실제로 들어온다 → 그 동결 가드가 이 파일의 소요시간·raw hex 를 강제한다.
    expect(scan(UI_DIR_REL).map((s) => s.file)).toContain(SHEET_REL);
    expect(scan(FEATURE_DIR_REL).map((s) => s.file)).toContain(SHEET_REL);
  });
});

describe('🔴 E3 · AC-T6 — 새 시트 소스가 소요시간·raw hex 0건이다', () => {
  it('SlotTimeSheet.tsx 가 clean 하고(긍정 앵커: 모집단 실재), 소요시간·토큰화 색이 0건이다', () => {
    // 긍정 앵커 — 새 시트가 실제 스캔 모집단에 있다(없으면 아래 부정 단언이 공허하게 통과).
    expect(scan(UI_DIR_REL).map((s) => s.file)).toContain(SHEET_REL);

    const source = readOne(SHEET_REL);
    expect(DURATION_TEXT.test(source)).toBe(false);
    expect(
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex))
    ).toEqual([]);
  });
});

describe('🔴 E4 · AC-T8 — 화면 순수성: 화면은 시트·스토어를 모르고 시트가 gorhom 을 쥔다', () => {
  it('화면은 gorhom·store 미참조·새 prop 배선, 시트는 gorhom 참조', () => {
    const screenSrc = readOne(SCREEN_REL);
    const sheetSrc = readOne(SHEET_REL);

    // 긍정 앵커 — 화면이 새 진입 prop 을 배선하고(RED now: 미배선), 시트가 gorhom 을 쓴다(RED now: 파일 부재).
    expect(screenSrc).toContain('onEditSlotTime');
    expect(sheetSrc).toContain('@gorhom/bottom-sheet');

    // 부정 — 화면은 순수 유지: 시트 라이브러리도 편집 스토어도 화면이 직접 물지 않는다(페이지 몫).
    expect(screenSrc).not.toContain('@gorhom/bottom-sheet');
    expect(screenSrc).not.toContain('useItineraryEditStore');
  });
});
