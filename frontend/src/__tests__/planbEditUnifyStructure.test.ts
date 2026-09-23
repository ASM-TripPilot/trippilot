/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-753 · i07 일정 편집을 h12 편집기 하나로 합친 뒤의 **소스 층 가드**(AC-1·10·12·13).
 *
 * 무엇을 보장하나:
 *  - U1 라우트 `planb/manual.tsx` 가 `@/pages/itinerary-edit` 의 `ItineraryEditPage` 를 `inTrip` 으로
 *    부르고, 옛 `variant` 축·`@/pages/planb-manual` 을 모른다(AC-1).
 *  - U2 옛 두 슬라이스(`pages/planb-manual`·`widgets/itinerary-edit`)가 디렉토리째 없다 — 삭제도 계약이다.
 *  - U3 비테스트 소스 어디에도 옛 셸·화면·경로·`mergeValidationFlags`(Q7) 참조가 남지 않는다.
 *  - U4 옛 폴백·잠금 표면의 testID 7종이 전역 0, i07 소스 3개에 옛 문구 4종이 0(AC-10).
 *  - U5 프리뷰가 옛 래퍼·픽스처를 버리고 EditorView 를 **파일 경로로** 문다(AC-12, TRIP-610).
 *  - U6 새 재정렬 규칙 파일이 제자리에 있고, 그것과 EditorView 에 소요시간 표기가 없다(AC-13 · INV-3).
 *
 * 전제 — 모든 스캔은 주석을 걷은 소스를 본다(U0 이 전처리×탐지기 조합을 실제 문자열로 확인).
 * 규약 — "없어야 한다"는 같은 it 안 "있어야 한다"(긍정 짝)와 함께 둔다(빈 모집단 공허 통과 방지).
 */

const ROOT = path.resolve('src');

const ROUTE_REL = 'app/trips/[tripId]/planb/manual.tsx';
const EDITOR_REL = 'pages/itinerary-edit/ui/EditorView.tsx';
const PAGE_REL = 'pages/itinerary-edit/ui/ItineraryEditPage.tsx';
const CARD_REL = 'entities/itinerary-slot/ui/SlotStopCard.tsx';
const RULE_REL = 'features/planb/model/reorderKeepingLocked.ts';
const PREVIEW_REL = 'app/_dev/preview.tsx';

/** 소요시간 **표기** 탐지기(리포 동결 가드와 같은 식). `HH:mm` 은 숫자 뒤가 `:` 라 안 걸린다. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 사라진 폴백·잠금 표면의 testID(AC-10). 전역 0 이어야 한다. */
const RETIRED_TEST_IDS = [
  'planb-manual-missing-data',
  'planb-manual-time-input',
  'planb-manual-locked',
  'planb-manual-hint',
  'planb-manual-history',
  'planb-manual-drag',
  'planb-manual-delete',
];

/** 사라진 문구(AC-10). `변경 불가` 는 h 밴드에 정당한 쓰임이 있어 i07 소스로 범위를 좁힌다(02a ★15). */
const RETIRED_COPY = ['이동시간 미상', '변경 불가', '--:--', '방문 완료'];

/** 사라진 심볼·경로(AC-1 · Q7). */
const RETIRED_REFS = [
  'ManualEditShell',
  'ManualEditScreen',
  '@/widgets/itinerary-edit',
  '@/pages/planb-manual',
  'mergeValidationFlags',
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

function allSources(): { file: string; source: string }[] {
  return listSourceFiles(ROOT).map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝(실재)이 먼저 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('U0 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 옛 이름·소요시간은 걷히고, 코드의 --:--·testID·URL·시각칩은 살아남는다', () => {
    const sample = [
      '// ManualEditShell 선례 동형 — 옛 셸 주석.',
      '/* planb-manual-drag 핸들은 지웠다 · 30분 금지 */',
      "const blank = '--:--';",
      "const id = 'planb-manual-missing-data';",
      "const doc = 'https://x.dev/a';",
      "const chip = '09:30–10:30';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 안 걷으면 수호 주석이 거짓 red 를 만든다.
    expect(stripped).not.toContain('ManualEditShell');
    expect(stripped).not.toContain('planb-manual-drag');
    expect(stripped).not.toContain('30분');

    // ② 코드의 금칙 리터럴은 살아남아 탐지된다(우회 불가).
    expect(stripped).toContain("const blank = '--:--';");
    expect(stripped).toContain("'planb-manual-missing-data'");
    expect(stripped).toContain("const doc = 'https://x.dev/a';");

    // ③ 시각칩은 소요시간 탐지기에 안 걸리고, 진짜 소요시간은 걸린다.
    expect(DURATION_TEXT.test(stripped)).toBe(false);
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
  });
});

describe('🔴 U1 · AC-1 — 라우트는 ItineraryEditPage 를 inTrip 으로 부르고 variant 를 모른다', () => {
  it('@/pages/itinerary-edit·ItineraryEditPage·inTrip 있음 (긍정) + variant·@/pages/planb-manual 없음 (부정)', () => {
    expect(exists(ROUTE_REL)).toBe(true);
    const route = readOne(ROUTE_REL);

    expect(route).toContain('@/pages/itinerary-edit');
    expect(route).toContain('ItineraryEditPage');
    expect(route).toContain('inTrip');

    expect(route).not.toContain('variant');
    expect(route).not.toContain('@/pages/planb-manual');
  });
});

describe('🔴 U2 · AC-1 — 옛 두 슬라이스가 디렉토리째 없다', () => {
  it('pages/planb-manual·widgets/itinerary-edit 부재 (부정) + 편집기 뷰·페이지 실재 (긍정 짝)', () => {
    expect(exists(EDITOR_REL)).toBe(true);
    expect(exists(PAGE_REL)).toBe(true);

    expect({
      'pages/planb-manual': exists('pages/planb-manual'),
      'widgets/itinerary-edit': exists('widgets/itinerary-edit'),
    }).toEqual({
      'pages/planb-manual': false,
      'widgets/itinerary-edit': false,
    });
  });
});

describe('🔴 U3 · AC-1 — 비테스트 소스 전체에 옛 셸·화면·경로 참조 0', () => {
  it('옛 참조 5종 0 (부정) + 어떤 소스가 @/pages/itinerary-edit 를 문다 (긍정 짝)', () => {
    const sources = allSources();

    expect(sources.length).toBeGreaterThan(100);
    expect(
      sources.some(({ source }) => source.includes('@/pages/itinerary-edit'))
    ).toBe(true);

    const offenders = sources.flatMap(({ file, source }) =>
      RETIRED_REFS.filter((ref) => source.includes(ref)).map(
        (ref) => `${file}: ${ref}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 U4 · AC-10 — 옛 폴백·잠금 표면의 testID·문구가 없다', () => {
  it('testID 7종 전역 0 + i07 소스 3개에 옛 문구 4종 0 (부정) + 세 파일 실재 (긍정 짝)', () => {
    const sources = allSources();
    const idOffenders = sources.flatMap(({ file, source }) =>
      RETIRED_TEST_IDS.filter((id) => source.includes(id)).map(
        (id) => `${file}: ${id}`
      )
    );
    expect(idOffenders).toEqual([]);

    [EDITOR_REL, PAGE_REL, CARD_REL].forEach((rel) =>
      expect({ rel, exists: exists(rel) }).toEqual({ rel, exists: true })
    );
    const copyOffenders = [EDITOR_REL, PAGE_REL, CARD_REL].flatMap((rel) => {
      const source = readOne(rel);
      return RETIRED_COPY.filter((copy) => source.includes(copy)).map(
        (copy) => `${rel}: ${copy}`
      );
    });
    expect(copyOffenders).toEqual([]);
  });
});

describe('🔴 U5 · AC-12 — 프리뷰는 옛 래퍼를 버리고 EditorView 를 파일 경로로 문다', () => {
  it('ManualEditPreview·MANUAL_EDIT_PREVIEW·manualEditPreviewDays·배럴 import 0 (부정) + 딥 경로 import (긍정)', () => {
    const preview = readOne(PREVIEW_REL);

    expect(preview).toContain("'@/pages/itinerary-edit/ui/EditorView'");

    expect(preview).not.toContain('ManualEditPreview');
    expect(preview).not.toContain('MANUAL_EDIT_PREVIEW');
    expect(preview).not.toContain('manualEditPreviewDays');
    // 배럴은 페이지 → shared/api(네트워크 계층)를 끌고 온다(TRIP-610) — 따옴표까지 완전 문자열로 본다.
    expect(preview).not.toContain("'@/pages/itinerary-edit'");
  });
});

describe('🔴 U6 · AC-13 — 재정렬 규칙은 features/planb/model 에 있고, 편집기·규칙에 소요시간 표기가 없다', () => {
  it('두 파일 실재 (긍정) + 소요시간 0 (부정)', () => {
    [EDITOR_REL, RULE_REL].forEach((rel) =>
      expect({ rel, exists: exists(rel) }).toEqual({ rel, exists: true })
    );

    const offenders = [EDITOR_REL, RULE_REL].filter((rel) =>
      DURATION_TEXT.test(readOne(rel))
    );
    expect(offenders).toEqual([]);
  });
});
