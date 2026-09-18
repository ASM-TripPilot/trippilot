/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-302 신설 → **TRIP-805 재앵커**. h24 시각조정 시트 소스 층 편입 앵커 + h24 편집 화면 순수성.
 *
 * TRIP-805 로 시트가 `features/itinerary/ui/SlotTimeSheet.tsx` 에서 공용 위젯
 * `widgets/time-sheet/ui/TimeSheet.tsx`(쌍둥이 SlotTimeSheet·ManualTimeSheet 통일)로 나갔다.
 * 시트가 features/itinerary 재귀 밖으로 가면서 옛 편입 대상(itineraryTimeStructure G2·
 * itineraryMustVisitStructure C34)의 사정거리를 벗어났고, INV-3 은 이제 `planbManualStructure.test.ts`
 * G3(widgets/time-sheet 재편입)이 잠근다 — "코드 이동 추적" 재조준(02a ★6, 개념 [[선재 가드 재조준]]).
 *
 * 무엇을 보장하나:
 *  - 공용 시트 `TimeSheet.tsx` 가 **정본 위젯 경로에 실재**하고(구현 전 RED),
 *  - 그 파일이 `widgets/time-sheet` 재귀 사정거리(=planbManualStructure G3)에 편입되며,
 *  - 새 시트 소스가 **소요시간 표기·raw hex 0건**(정당 파일은 clean),
 *  - **화면 순수성** — `ItineraryEditScreen.tsx` 는 시트·스토어를 모르고(gorhom·store 미참조),
 *    시트는 gorhom 을 쓰며, 화면은 진입 prop `onEditSlotTime` 만 배선한다(이 화면은 이동하지 않는다).
 *
 * **detector 를 복제·재발명하지 않는다** — 편입 앵커 + 새 파일 한정 clean 재스캔 + 화면 순수성만 둔다.
 * detector 는 동결 가드의 것을 그대로 복사해 자가검사(E1)로 조합을 재확인한다.
 *
 * **전제 — 모든 스캔은 주석을 걷어낸 소스를 본다**(`stripComments`, 동결 가드들과 같은 규칙).
 * **가짜 통과 방지 규약**: 모든 "없어야 한다"는 같은 it 안의 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

// TRIP-805 재앵커 — 시트는 widget 으로, 화면은 features/itinerary 에 그대로.
const WIDGET_TIME_UI_DIR_REL = 'widgets/time-sheet/ui';
const SHEET_REL = 'widgets/time-sheet/ui/TimeSheet.tsx';
const SCREEN_REL = 'features/itinerary/ui/ItineraryEditScreen.tsx';

/** 소요시간 **표기** 탐지기 — 화면에 나갈 문자열 형태. `HH:mm`(09:30)은 숫자 뒤가 `:` 라 안 걸린다. */
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

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 먼저 막는다(리포 규약). */
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
    //    이게 걸리면 정당한 시트가 red 가 된다(02a ★3).
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

    // ④ 짝 — bare 분 셀은 미검출이지만 "30분"(분 셀을 잘못 그린 것)은 검출된다(★3 함정 증명).
    expect(DURATION_TEXT.test('30')).toBe(false);
    expect(DURATION_TEXT.test('30분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
  });
});

describe('🔴 E2 · 편입 앵커 — 공용 시트가 widgets/time-sheet 재귀 사정거리에 실재한다', () => {
  it('TimeSheet.tsx 가 정본 위젯 경로에 있고, widgets/time-sheet/ui 재귀 모집단에 잡힌다', () => {
    // 경로 실재(구현 전 RED).
    expect(existsPair(SHEET_REL)).toEqual({ file: SHEET_REL, exists: true });

    // 새 시트가 planbManualStructure G3(widgets/time-sheet 재귀)의 스캔 모집단에 실제로 들어온다 →
    // 그 gap-filler 가드가 이 파일의 소요시간 표기를 강제한다.
    expect(scan(WIDGET_TIME_UI_DIR_REL).map((s) => s.file)).toContain(
      SHEET_REL
    );
  });
});

describe('🔴 E3 · INV-3 — 새 시트 소스가 소요시간·raw hex 0건이다', () => {
  it('TimeSheet.tsx 가 clean 하고(긍정 앵커: 모집단 실재), 소요시간·토큰화 색이 0건이다', () => {
    // 긍정 앵커 — 새 시트가 실제 스캔 모집단에 있다(없으면 아래 부정 단언이 공허하게 통과).
    expect(scan(WIDGET_TIME_UI_DIR_REL).map((s) => s.file)).toContain(
      SHEET_REL
    );

    const source = readOne(SHEET_REL);
    expect(DURATION_TEXT.test(source)).toBe(false);
    expect(
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex))
    ).toEqual([]);
  });
});

describe('🔴 E4 · 화면 순수성: 화면은 시트·스토어를 모르고 시트가 gorhom 을 쥔다', () => {
  it('화면은 gorhom·store 미참조·진입 prop 배선, 시트는 gorhom 참조', () => {
    const screenSrc = readOne(SCREEN_REL);
    const sheetSrc = readOne(SHEET_REL);

    // 긍정 앵커 — 화면이 진입 prop 을 배선하고, 시트가 gorhom 을 쓴다(RED now: 위젯 파일 부재).
    expect(screenSrc).toContain('onEditSlotTime');
    expect(sheetSrc).toContain('@gorhom/bottom-sheet');

    // 부정 — 화면은 순수 유지: 시트 라이브러리도 편집 스토어도 화면이 직접 물지 않는다(페이지 몫).
    expect(screenSrc).not.toContain('@gorhom/bottom-sheet');
    expect(screenSrc).not.toContain('useItineraryEditStore');
  });
});
