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
  {
    file: 'features/itinerary/model/categoryPlaceholder.ts',
    must: ['@/entities/itinerary-slot/lib'],
    mustNot: [
      'export function resolveCategoryPlaceholder',
      'export interface CategoryPlaceholder',
    ],
    why: 'resolveCategoryPlaceholder·CategoryPlaceholder 를 entities/lib 로 바이트 이사(옛 자리 재수출 shim)',
  },
  {
    file: 'features/itinerary/model/slotKey.ts',
    must: ['@/entities/itinerary-slot/lib'],
    mustNot: [
      'export function buildSlotKey',
      'export function parseSlotKey',
      'export function buildSlotKeys',
    ],
    why: 'slotKey 파일째 entities/lib 로 바이트 이사(전 export, 28 importer 는 shim 으로 무수정). 옛 자리 재수출 shim',
  },
  {
    file: 'features/itinerary/ui/SlotPhotoPlaceholder.tsx',
    must: ['@/entities/itinerary-slot/ui'],
    mustNot: ['export function SlotPhotoPlaceholder'],
    why: 'SlotPhotoPlaceholder 를 entities/ui 로 바이트 이사(옛 자리 재수출 shim). TimelineScreen 이 재작성된 경로로 소비',
  },
  {
    file: 'features/itinerary/ui/PoiSlotCard.tsx',
    must: ['@/entities/itinerary-slot/ui'],
    mustNot: ['export function PoiSlotCard'],
    why: 'PoiSlotCard 를 entities/ui 로 바이트 이사(옛 자리 재수출 shim)',
  },
  {
    file: 'features/planb/ui/ReplanSlotRow.tsx',
    must: ['@/entities/itinerary-slot/ui', '@/entities/itinerary-slot/model'],
    mustNot: ['export function ReplanSlotRow', 'export interface ReplanSlotVM'],
    why: 'ReplanSlotRow 를 entities/ui 로 바이트 이사(VM 타입은 model 로) — 옛 자리는 컴포넌트+타입 재수출 shim. preview.tsx 가 이 shim 으로 ReplanSlotVM 타입을 계속 받아 src/app 무변경(6-b SKIP · 02a ★10)',
  },
  {
    file: 'features/itinerary/ui/ItineraryGlyphs.tsx',
    must: ['@/entities/itinerary-slot/ui/SlotGlyphs'],
    mustNot: [
      'export function CategoryPinGlyph',
      'export function CategoryForkKnifeGlyph',
      'export function CategoryCupGlyph',
      'export function CategoryNightGlyph',
      'export function CategoryTreeGlyph',
      'export function CategoryShoppingBagGlyph',
      'export function CategoryBuildingGlyph',
      'export function CategoryImageGlyph',
    ],
    why: '카테고리 글리프 8종을 entities/ui/SlotGlyphs 로 이사 + 옛 자리 8종 재수출 shim(나머지 19 글리프 잔존). ConceptPickerScreen(범위 밖)이 옛 경로로 계속 소비 · 02a ★6',
  },
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
