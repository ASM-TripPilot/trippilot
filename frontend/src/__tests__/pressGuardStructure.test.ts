/**
 * @jest-environment node
 */
// TRIP-1013 AC-S — 연타 관통 공용 가드(`@/shared/press/pressGuard`)는 관찰된 5쌍의 배선 페이지에만
// 걸린다(01b 결정 1). `CtaBar`(소비처 6곳 공유)·features 화면·다른 페이지로 새면 결정 1 위반이다.
// 새 관찰이 나와 가드를 붙이면 EXPECTED 에 그 파일을 더한다(목록 완전일치라 조용히 넓어지지 않는다).
//
// 리포 확립 규약: "없어야 한다"(부정)는 "있어야 한다"(긍정 짝)와 같은 it 안에 둔다.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');
const GUARD_FILE = path.join(ROOT, 'shared/press/pressGuard.ts');

/** 가드를 import 해도 되는 배선 페이지 — 5쌍의 송신·수신 콜백이 사는 곳(src 기준 상대경로). */
const EXPECTED = [
  'pages/destination-detail/ui/DestinationDetailPage.tsx', // #012 송신
  'pages/itinerary-mustvisit/ui/MustVisitListPage.tsx', // #042 수신
  'pages/itinerary-mustvisit/ui/MustVisitTimePage.tsx', // #042 송신
  'pages/itinerary-plan/ui/ItineraryPlanPage.tsx', // #057 송신·수신
  'pages/onboarding-pref1/ui/PrefStep1Page.tsx', // #004 송신
  'pages/onboarding-pref2/ui/PrefStep2Page.tsx', // #004 수신
  'pages/stay-search/ui/StaySearchPage.tsx', // #012 수신
  'pages/trip-new-step2/ui/TripNewStep2Page.tsx', // #038 송신·수신
];

/**
 * 스캔 전처리 — 주석을 걷어낸다(설명 주석 속 import 문구가 소비처로 잡히지 않게). 줄 주석에서
 * 바로 앞 글자가 `:` 이면 주석으로 보지 않는다(`'https://…'` 보존 — 리포 관례).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** `from '…'`·`require('…')` 로 가드 모듈을 가리키는 곳. 배럴(`@/shared/press`)도 잡는다. */
const GUARD_IMPORT =
  /(?:from\s*|require\(\s*)['"]@\/shared\/press(?:\/[\w-]+)?['"]/;

/** src 아래 테스트가 아닌 .ts/.tsx 전부(상대경로, 정렬). */
function listProductionFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listProductionFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [path.relative(ROOT, full).split(path.sep).join('/')];
  });
}

describe('G0 · 탐지기 자가검사 — 주석 걷기와 import 탐지를 함께 태운다', () => {
  it('여러 줄 import·require 는 잡고, 주석 속 문구·비슷한 경로는 안 잡는다', () => {
    const multiline = [
      'import {',
      '  guardPress,',
      "} from '@/shared/press/pressGuard';",
    ].join('\n');
    const commented = [
      "// from '@/shared/press/pressGuard' 를 쓰면 안 된다",
      "/* import { guardPress } from '@/shared/press/pressGuard'; */",
      "const url = 'https://example.com'; // 끝",
    ].join('\n');

    expect(GUARD_IMPORT.test(stripComments(multiline))).toBe(true);
    expect(
      GUARD_IMPORT.test(stripComments("require('@/shared/press/pressGuard')"))
    ).toBe(true);
    expect(GUARD_IMPORT.test(stripComments("from '@/shared/press'"))).toBe(
      true
    );
    expect(GUARD_IMPORT.test(stripComments(commented))).toBe(false);
    expect(stripComments(commented)).toContain('https://example.com');
    expect(GUARD_IMPORT.test("from '@/shared/pressure/x'")).toBe(false);
  });
});

describe('AC-S · 가드를 import 하는 프로덕션 파일은 관찰된 5쌍의 배선 페이지뿐이다', () => {
  it('가드 모듈은 shared/press 에 있고, 소비처 목록이 EXPECTED 와 정확히 같다', () => {
    // 긍정 — 가드 모듈 자체가 shared/ui 가 아닌 shared/press 에 있다(shared/ui 는 className 가드 대상).
    expect(fs.existsSync(GUARD_FILE)).toBe(true);

    const files = listProductionFiles(ROOT);
    // 모집단 앵커 — 스캔이 실제로 src 를 훑었다(빈 목록이면 아래 완전일치가 의미 없다).
    expect(files).toEqual(expect.arrayContaining(EXPECTED));
    expect(files).toContain('widgets/map-sheet-shell/ui/CtaBar.tsx');

    const importers = files
      .filter((file) => !file.startsWith('shared/press/'))
      .filter((file) =>
        GUARD_IMPORT.test(
          stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'))
        )
      )
      .sort();

    // 완전일치 — 빠진 페이지(배선 누락)도, 넘친 파일(CtaBar·features 화면 등)도 red.
    expect(importers).toEqual([...EXPECTED].sort());
  });
});
