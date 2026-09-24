/**
 * @jest-environment node
 */
// TRIP-806 · AC-M4~M8 — 소비처가 entities/place 로 전환됐고 로컬 중복 구현이 사라졌음을 소스 스캔으로 잠근다.
//
// ⚠️ 회귀(보이는 testID·글자 바이트 보존)의 1차 그물은 **무수정 소비처 테스트**다(02a ★8) — 이 스캔은
//    "전환됐다"의 보조 그물이다. 그래서 **긍정(=entities import)은 전 소비처에 강제**하고, 부정(=로컬 정의
//    제거)은 지문이 확실한 곳만(과하게 특정하면 implementer 설계를 박제해 게이밍이 된다, 02a §7). 완전한
//    orphan 제거는 `structure-index --check`(qa 명령 점검, AC-M8)가 겸한다.
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
  it('주석 속 import 는 걷히고 코드 import·URL 은 살아남는다', () => {
    const sample = [
      "// import { PlaceRailCard } from '@/entities/place/ui/PlaceRailCard';",
      "import { PlaceGridCard } from '@/entities/place/ui/PlaceGridCard';",
      "const u = 'https://x/a//b';",
    ].join('\n');
    const s = stripComments(sample);
    // 주석 줄 import 는 걷히고, 코드 줄만 남는다.
    expect(s).not.toContain('PlaceRailCard');
    expect(s).toContain('@/entities/place/ui/PlaceGridCard');
    expect(/https?:\/\//.test(s)).toBe(true);
  });
});

/**
 * 소비처 전환 표 — [파일, 긍정(포함해야 함), 부정(포함하면 안 됨)?].
 * 긍정: entities/place 를 참조한다(전환의 직접 증거). 부정: 로컬 중복의 확실한 지문(제거돼야 함).
 */
type Row = { file: string; must: string; mustNot?: string[]; why: string };

const ROWS: Row[] = [
  {
    file: 'features/explore/ui/ExploreLandingScreen.tsx',
    must: '@/entities/place',
    mustNot: ['export interface PlaceCardVM', 'function PlaceCard('],
    why: 'd01 레인 카드 + PlaceCardVM 를 entities 로 이관(★11 — PlaceCardVM export 잔존은 진짜 이동 아님)',
  },
  {
    file: 'features/explore/ui/DestinationDetailScreen.tsx',
    must: '@/entities/place',
    mustNot: ['function PlaceCard('],
    why: 'd05 레인 카드 소비 + PlaceCardVM 를 ./ExploreLandingScreen 이 아니라 entities 에서(★11)',
  },
  {
    file: 'features/explore/ui/PlaceExploreScreen.tsx',
    must: '@/entities/place',
    mustNot: ['function PlaceCard('],
    why: 'd04 그리드 카드 소비(로컬 PlaceCard 제거)',
  },
  // TRIP-807 재조준(★7) — SavedPlaceListScreen 행 제거. d02 의 유일한 @/entities/place import 는
  // PlaceGlyphs(하트)였는데, TRIP-807 이 하트를 shared/ui/HeartGlyphs 로 옮기며 d02 의 entities/place
  // 소비가 0 이 됐다(카드는 로컬 SavedPlaceRow 유지). 이 파일에 남기면 stale red — d02 의 stay 축
  // 전환(StayRowVM→SavedStayCardVM 재수출)은 entitiesStayConsumers 가 잠근다.
  {
    file: 'features/explore/ui/PlaceDetailScreen.tsx',
    must: '@/entities/place',
    why: 'd06 부제 조각 소비',
  },
  // TRIP-798 묶음 C 재조준 — PlaceAddCard 행 제거. h13 이 PlaceRowCard 채택으로 갈아타 이 카드는
  // 런타임 소비처 0(고아)이 됐고 이 사이클에서 git rm 된다(itineraryManualStructure REMOVED_CARD 가
  // 부재를 잠금). 여기 남기면 read() 가 ENOENT 로 죽는다 — h13 의 entities 소비 증거는 이 stale 행이
  // 아니라 PlaceAddPage.integration C2(사진 leaf `itinerary-place-card-photo-*`)가 짐(vacuous 걷기).
  {
    file: 'features/itinerary/ui/SlotCandidateCard.tsx',
    must: '@/entities/place',
    why: 'copick(h14/h15) SlotFillScreen 위임 카드 — 존치(TRIP-793 은 이 래퍼를 안 건드림)',
  },
  {
    // TRIP-793 재조준 — h08 "다른 후보 시트"가 위임 래퍼(features SlotCandidateCard)를 우회하고
    // entities 카드를 **직접** 소비한다(planb 시트 선례 · itinerary opt-in: 사진·이름·태그 켜고
    // rationale·배지·"이동" 끄기). 시트가 아직 없으면 read() 가 throw → red(green 시 git mv 로 생성).
    file: 'features/itinerary/ui/SlotCandidateSheet.tsx',
    must: '@/entities/place',
    why: 'h08 후보 시트가 entities 카드를 직접 소비(위임 래퍼 우회 · planb 시트 동형)',
  },
  {
    file: 'features/planb/ui/SlotCandidateSheet.tsx',
    must: '@/entities/place',
    why: 'i14 후보 카드를 entities 로 위임(★7 — 이 파일은 planb-candidate·bottom-sheet 부재를 무수정 테스트가 별도로 잼)',
  },
  {
    file: 'features/execution/ui/PlaceDetailScreen.tsx',
    must: '@/entities/place',
    why: 'i10 부제 조각 소비',
  },
  {
    file: 'features/itinerary/model/legDistance.ts',
    must: '@/entities/place/lib',
    why: '거리 포맷터 코어를 entities formatDistance 로 흡수(복붙 제거)',
  },
  {
    file: 'features/itinerary/model/radiusUsedLabel.ts',
    must: '@/entities/place/lib',
    why: '거리 포맷터 코어를 entities formatDistance 로 흡수(복붙 제거)',
  },
];

describe('🔴 소비처가 entities/place 를 소비한다(긍정) + 확실한 중복 지문 제거(부정)', () => {
  it.each(ROWS)('$file — $why', ({ file, must, mustNot }) => {
    const source = read(file);

    // 긍정 — 전환의 직접 증거.
    expect(source).toContain(must);

    // 부정 — 지문이 확실한 로컬 중복만.
    for (const marker of mustNot ?? []) {
      expect(source).not.toContain(marker);
    }
  });
});
