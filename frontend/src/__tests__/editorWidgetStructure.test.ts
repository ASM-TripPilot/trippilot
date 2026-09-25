/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-921 · 편집 뷰 widgets 승격 소스 층 가드(AC-10·AC-11·AC-13).
 *
 * h12 편집 뷰(`EditorView`)가 `pages/itinerary-edit` 에서 `widgets/map-sheet-shell/ui` 로 올라가
 * **h12 편집(`ItineraryEditPage`)과 직접 짜기(`ManualPlanPage`)가 같은 뷰를 소비**한다. 지금까지
 * pages 끼리 서로 import 할 수 없어 `ManualPlanPage` 가 셸을 따로 조립했다(편집기 두 벌).
 *
 * 무엇을 보장하나:
 *  - S1 이동 — 위젯 뷰가 있고, 옛 pages 뷰와 features `SlotDropZone`(위젯이 못 무는 층)이 **없다**
 *    (삭제도 계약). 비테스트 소스 어디에도 옛 경로 참조가 남지 않는다.
 *  - S2 소비 — 두 페이지가 위젯 뷰를 문다. `ManualPlanPage` 는 셸(`MapSheetShell`·`SheetHeader`)을
 *    더는 직접 조립하지 않는다 = "같은 편집 뷰" 의 잠금.
 *  - S3 순수성 — 위젯 뷰는 features·편집 스토어·시트 라이브러리·라우터·raw hex 를 모르고, 드래그
 *    리스트와 시각칩 콜백을 쥔다. pages 층 전수 스캔(`pagesLayerStructure` G-3)이 보던 축(zustand·
 *    타이머·URL 리터럴·duration 식별자)은 뷰가 pages 를 떠나며 빠지므로 여기서 이 파일에 대해 넘겨받는다.
 *
 * 편입으로 자동 커버되는 것(여기서 복제하지 않는다): `mapSheetShellStructure` G2(INV-3 소요시간 표기)·
 * G3(상위층·형제 위젯·`@/features/` 금지)는 `widgets/map-sheet-shell` **재귀**(테스트 제외)라 새 뷰·
 * 드롭존·lib 파일이 자동으로 들어간다. `widgetsStructure` F 는 `ui/*.tsx` 모집단 + useState 예외 개수.
 *
 * 전제 — 모든 스캔은 주석을 걷은 소스를 본다(S0 이 전처리×탐지기 조합을 실제 문자열로 확인).
 * 규약 — "없어야 한다"는 같은 it 안 "있어야 한다"(긍정 짝)와 함께 둔다(빈 모집단 공허 통과 방지).
 */

const ROOT = path.resolve('src');

const WIDGET_VIEW_REL = 'widgets/map-sheet-shell/ui/EditorView.tsx';
const WIDGET_VIEW_IMPORT = "'@/widgets/map-sheet-shell/ui/EditorView'";
const OLD_VIEW_REL = 'pages/itinerary-edit/ui/EditorView.tsx';
const OLD_DROPZONE_REL = 'features/itinerary/ui/SlotDropZone.tsx';
const EDIT_PAGE_REL = 'pages/itinerary-edit/ui/ItineraryEditPage.tsx';
const MANUAL_PAGE_REL = 'pages/itinerary-manual/ui/ManualPlanPage.tsx';

/** 옛 경로 참조(import·jest.mock·문자열) — 비테스트 소스 전역 0. */
const RETIRED_REFS = [
  'pages/itinerary-edit/ui/EditorView',
  'features/itinerary/ui/SlotDropZone',
];

/** 토큰으로 이미 존재하는 색 — raw hex 로 적으면 토큰 우회(동결 가드들과 같은 목록). */
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

/** 위젯 뷰가 몰라야 하는 것 — 이름 · 탐지기. */
const VIEW_FORBIDDEN: { name: string; hit: (s: string) => boolean }[] = [
  { name: '@/features/', hit: (s) => s.includes('@/features/') },
  {
    name: 'useItineraryEditStore',
    hit: (s) => s.includes('useItineraryEditStore'),
  },
  {
    name: '@gorhom/bottom-sheet',
    hit: (s) => s.includes('@gorhom/bottom-sheet'),
  },
  { name: 'expo-router', hit: (s) => s.includes('expo-router') },
  // ↓ pages G-3 에서 빠지는 축(뷰가 pages 를 떠나며 그 전수 스캔 밖이 된다).
  { name: 'zustand', hit: (s) => s.includes('zustand') },
  { name: 'setTimeout', hit: (s) => s.includes('setTimeout') },
  { name: 'setInterval', hit: (s) => s.includes('setInterval') },
  { name: 'URL 리터럴', hit: (s) => /https?:\/\//.test(s) },
  { name: 'duration 식별자', hit: (s) => /\bduration\b/i.test(s) },
];

/** 위젯 뷰가 쥐어야 하는 것(긍정 짝). */
const VIEW_REQUIRED = [
  'react-native-draggable-flatlist',
  'onPressTimeChip',
  'onDragBegin',
  'onDragEnd',
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
      return [full];
    })
    .sort();
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 먼저 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function allSources(): { file: string; source: string }[] {
  return listSourceFiles(ROOT).map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

describe('S0 · 탐지기 자가검사 — 전처리와 탐지기가 서로를 지우지 않는다', () => {
  it('주석 속 금칙어는 걷히고, 코드의 import 경로·URL·타이머·duration 은 살아남아 잡힌다', () => {
    const sample = [
      '/** 옛 pages/itinerary-edit/ui/EditorView 에서 옮겼다. setTimeout 금지, #ff385c 금지. */',
      "// import { SlotDropZone } from '@/features/itinerary/ui/SlotDropZone';",
      "import { EditorView } from '@/widgets/map-sheet-shell/ui/EditorView';",
      "const doc = 'https://figma.com/x';",
      'setTimeout(() => {}, 0);',
      'const duration = 3;',
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 안 걷으면 수호 주석이 부정 단언을 거짓 red 로 만든다.
    expect(stripped).not.toContain('pages/itinerary-edit/ui/EditorView');
    expect(stripped).not.toContain('features/itinerary/ui/SlotDropZone');
    expect(stripped.toLowerCase()).not.toContain('#ff385c');

    // ② 코드는 살아남고 탐지기가 잡는다(콜론 뒤 `//` 는 주석이 아니다 — URL 보존).
    expect(stripped).toContain(WIDGET_VIEW_IMPORT);
    const hits = VIEW_FORBIDDEN.filter((rule) => rule.hit(stripped)).map(
      (rule) => rule.name
    );
    expect(hits).toEqual(
      expect.arrayContaining(['setTimeout', 'URL 리터럴', 'duration 식별자'])
    );
  });
});

describe('🔴 S1 · AC-10 — 편집 뷰는 widgets 에 있고 옛 두 파일은 없다', () => {
  it('위젯 뷰 실재 (긍정) + 옛 pages 뷰·features 드롭존 부재 + 비테스트 소스 옛 경로 0 (부정)', () => {
    const sources = allSources();

    // 긍정 짝 — 위젯 뷰가 실재하고 어떤 소스가 그 경로를 문다.
    expect(exists(WIDGET_VIEW_REL)).toBe(true);
    expect(
      sources.some(({ source }) => source.includes(WIDGET_VIEW_IMPORT))
    ).toBe(true);

    // 부정 — 삭제도 계약(위젯은 features 를 못 물어 드롭존도 슬라이스 안으로 와야 한다).
    expect(exists(OLD_VIEW_REL)).toBe(false);
    expect(exists(OLD_DROPZONE_REL)).toBe(false);
    const offenders = sources.flatMap(({ file, source }) =>
      RETIRED_REFS.filter((ref) => source.includes(ref)).map(
        (ref) => `${file}: ${ref}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 S2 · AC-10 — 두 페이지가 같은 위젯 뷰를 소비하고, 직접 짜기는 셸을 따로 조립하지 않는다', () => {
  it('두 페이지 소스가 위젯 뷰를 import·렌더 (긍정) + ManualPlanPage 에 MapSheetShell·SheetHeader 0 (부정)', () => {
    const editPage = readOne(EDIT_PAGE_REL);
    const manualPage = readOne(MANUAL_PAGE_REL);

    [
      { rel: EDIT_PAGE_REL, source: editPage },
      { rel: MANUAL_PAGE_REL, source: manualPage },
    ].forEach(({ rel, source }) =>
      expect({
        rel,
        importsWidgetView: source.includes(WIDGET_VIEW_IMPORT),
        rendersEditorView: source.includes('<EditorView'),
      }).toEqual({ rel, importsWidgetView: true, rendersEditorView: true })
    );

    // 부정 — 셸 조립은 뷰 몫. 직접 짜기가 셸을 또 조립하면 "편집기 두 벌" 로 되돌아간 것이다.
    expect(/\bMapSheetShell\b/.test(manualPage)).toBe(false);
    expect(/\bSheetHeader\b/.test(manualPage)).toBe(false);
  });
});

describe('🔴 S3 · AC-11·AC-13 — 위젯 뷰는 순수하고 드래그 리스트를 쥔다', () => {
  it('드래그 리스트·시각칩·드래그 콜백 참조 (긍정) + features·스토어·시트·라우터·raw hex·zustand·타이머·URL·duration 0 (부정)', () => {
    const view = readOne(WIDGET_VIEW_REL);

    // 긍정 짝 — 파일이 실재하고(빈 문자열 공허 통과 차단) 드래그 실배선을 쥔다.
    expect(VIEW_REQUIRED.filter((needle) => !view.includes(needle))).toEqual(
      []
    );

    // 부정 — 몰라야 할 것.
    const offenders = [
      ...VIEW_FORBIDDEN.filter((rule) => rule.hit(view)).map(
        (rule) => rule.name
      ),
      ...TOKENIZED_HEX.filter((hex) => view.toLowerCase().includes(hex)),
    ];
    expect(offenders).toEqual([]);
  });
});
