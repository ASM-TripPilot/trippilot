/**
 * @jest-environment node
 */
// TRIP-809 · AC-1·5·6·7·9 — 소비처가 entities/itinerary-slot 로 전환됐고 옛 자리 로컬 정의가
// 재수출 shim 으로 바뀌었음을 소스 스캔으로 잠근다. 806·807·808 동형.
//
// ⚠️ 회귀(보이는 testID·글자 바이트 보존)의 1차 그물은 **무수정 소비처 테스트**다(02a ★1) — 이 스캔은
//    "전환됐다 + 이사했다"의 보조 그물이다. 긍정(=entities import)은 소비처·shim 에 강제하고,
//    부정(=로컬 정의 제거)은 지문이 확실한 곳만(과하게 특정하면 implementer 설계를 박제 = 게이밍).
//    완전한 orphan 제거는 `structure --check`(qa 명령 점검, AC-11)가 겸한다.
//
// 이 티켓의 실질은 "카드 신설"이 아니라 **바이트 보존 이사 + 옛 자리 shim** 이다 — 이관 후 옛 자리는
// 한 줄 재수출 shim 이 되므로 부정 지문은 `export function <함수>`/`export interface <타입>`(로컬 정의)
// 소멸이다. 재수출(`export {..} from`)로 바뀌면 이 정규식이 안 걸려 "정말 이사했다"의 증거가 된다.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    throw new Error(`소비처 파일이 없다: ${rel}`);
  }
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사', () => {
  it('주석 속 import·정의는 걷히고 코드·URL 은 살아남는다', () => {
    const sample = [
      "// import { PoiSlotCard } from '@/entities/itinerary-slot/ui/PoiSlotCard';",
      "import { SlotPhotoPlaceholder } from '@/entities/itinerary-slot/ui/SlotPhotoPlaceholder';",
      '// export function resolveCategoryPlaceholder() {}',
      'export function buildSlotKey() {}',
      "const u = 'https://x/a//b';",
    ].join('\n');
    const s = stripComments(sample);
    // 주석 줄 import·정의는 걷히고, 코드 줄만 남는다.
    expect(s).not.toContain('PoiSlotCard');
    expect(s).not.toContain('export function resolveCategoryPlaceholder');
    expect(s).toContain('@/entities/itinerary-slot/ui/SlotPhotoPlaceholder');
    expect(s).toContain('export function buildSlotKey');
    expect(/https?:\/\//.test(s)).toBe(true);
  });
});

/**
 * 전환 표 — [파일, 긍정(전부 포함해야 함), 부정(포함하면 안 됨)?].
 * 긍정: entities/itinerary-slot 를 참조한다(전환·이사의 직접 증거). 부정: 로컬 중복의 확실한 지문
 * (제거돼야 함 — 이관은 재수출 shim 이라 `export function X`/`export interface X` 로컬 정의가 사라진다).
 */
type Row = { file: string; must: string[]; mustNot?: string[]; why: string };

const ROWS: Row[] = [
  {
    file: 'features/itinerary/ui/TimelineScreen.tsx',
    must: ['@/entities/itinerary-slot/ui'],
    why: 'h25 카드가 PoiSlotCard·SlotPhotoPlaceholder 를 entities 에서 소비(import 재작성). 렌더 잠금은 TimelineScreen.{test,card,map,placeholder}.test 무수정 green',
  },
  {
    file: 'features/planb/ui/ReplanDraftScreen.tsx',
    must: ['@/entities/itinerary-slot/ui'],
    why: 'i13 진열대가 ReplanSlotRow 를 entities 에서 소비(import 재작성). 렌더 잠금은 ReplanDraftScreen.test 무수정 green',
  },
  // TRIP-810 재조준 — 순수 shim 5(categoryPlaceholder·slotKey·SlotPhotoPlaceholder·PoiSlotCard·
  // ReplanSlotRow)는 이번 사이클에 **파일째 삭제**된다. 소비처 전환 표(긍정+부정 소스 스캔)에서 빼고
  // 아래 「삭제된 순수 shim 은 되살아나지 않는다」describe 로 이관한다 — 행을 그냥 지우면 shim 이
  // 되살아나도 red 가 안 나므로(02a ★5), 파일 부재를 명시 단언한다. TimelineScreen·ReplanDraftScreen 은
  // 살아있는 소비처(계속 entities 소비)라 여기 잔존.
  {
    file: 'features/itinerary/ui/ItineraryGlyphs.tsx',
    // TRIP-810 재조준 — Category 8종 재수출 shim 을 제거하면(부분 shim, 나머지 19 글리프는 잔존)
    // ItineraryGlyphs 는 entities/ui/SlotGlyphs 를 더는 참조하지 않는다. 재수출이 되살아나면 red.
    // 긍정은 비-Category 로컬 글리프(파일 온전·거트 방지). ★ ConceptPickerScreen(범위 밖 prod)은
    // 이 재수출을 물고 있어(02a ★1) implementer 가 entities/ui/SlotGlyphs 로 재조준해야 tsc green.
    must: ['export function BackChevronGlyph'],
    mustNot: ["from '@/entities/itinerary-slot/ui/SlotGlyphs'"],
    why: '카테고리 글리프 8종 재수출 shim 제거(옛 자리엔 19 로컬 글리프만 잔존) · 02a ★1·★6',
  },
];

/**
 * TRIP-810 — 이관 후 순수 shim 5는 파일째 삭제된다. 이 describe 가 "삭제됐고 되살아나지 않는다"를
 * 잠근다(ROWS 에서 뺀 5행의 이관처, 02a ★5). shim 이 되돌아오면 existsSync 가 true 가 되어 red.
 */
const DELETED_PURE_SHIMS = [
  'features/itinerary/model/categoryPlaceholder.ts',
  'features/itinerary/model/slotKey.ts',
  'features/itinerary/ui/SlotPhotoPlaceholder.tsx',
  'features/itinerary/ui/PoiSlotCard.tsx',
  'features/planb/ui/ReplanSlotRow.tsx',
];

describe('🔴 소비처가 entities/itinerary-slot 를 소비한다(긍정) + 확실한 중복 지문 제거(부정)', () => {
  it.each(ROWS)('$file — $why', ({ file, must, mustNot }: Row) => {
    const source = read(file);

    // 긍정 — 전환·이사의 직접 증거(전부 존재).
    for (const marker of must) {
      expect(source).toContain(marker);
    }

    // 부정 — 지문이 확실한 로컬 정의만(재수출 shim 으로 바뀌면 사라진다).
    for (const marker of mustNot ?? []) {
      expect(source).not.toContain(marker);
    }
  });
});

describe('🔴 삭제된 순수 shim 은 되살아나지 않는다 (파일 부재)', () => {
  it.each(DELETED_PURE_SHIMS)(
    '%s 는 삭제됐다(재수출 shim 부활 금지)',
    (rel) => {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
    }
  );
});
