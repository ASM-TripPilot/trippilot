import { render, screen } from '@testing-library/react-native';

import type { Place } from '@/shared/api/index.schemas';

import {
  PlaceExploreScreen,
  type PlaceExploreScreenProps,
} from './PlaceExploreScreen';

/**
 * d04 장소 탐색 — **출시 게이트 ①(버튼 role 전수 census, App Store 2.1)만** 남긴 뷰 단위.
 *
 * 화면 동작은 B안(2026-11-01, README §테스트 전략 판정 4)으로 `PlaceExplorePage.integration.test.tsx` 가
 * 지킨다. 누를 수 있는 것의 완전일치 목록은 README 판정 3 「출시 게이트로 남기는 생김새 검사」 ① 대상이다 —
 * 콜백을 하나도 안 넘겨도 버튼이 구조로 굳어 있어야 하므로(콜백 유무 파생 금지) props 를 손으로 넣어 잰다.
 */

function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category']
): Place {
  return {
    poiId,
    nameKo,
    category,
    lat: 35.1587,
    lng: 129.1604,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', '명소'),
  makePlace('p2', '광안리 해변', '야경'),
  makePlace('p3', '전포 카페거리', '카페'),
  makePlace('p4', '해동용궁사', '명소'),
  makePlace('p5', '자갈치 시장', '맛집'),
];
const IDS = PLACES.map((p) => p.poiId);

/** 카테고리 칩 code(전체 + PoiCategory 10종 선언 순). */
const CATEGORY_CODES = [
  'all',
  'attraction',
  'food',
  'cafe',
  'nightview',
  'nature',
  'shopping',
  'culture',
  'activity',
  'art',
  'bar',
];

/** 필수 8 prop 만 — 새 옵셔널 prop 은 하나도 안 준다(콜백 없이도 버튼이 남는지 본다). */
function renderMinimal(overrides: Partial<PlaceExploreScreenProps> = {}) {
  render(
    <PlaceExploreScreen
      places={PLACES}
      savedPoiIds={['p1']}
      selectedCategory={null}
      searchText=""
      onSelectCategory={jest.fn()}
      onChangeSearchText={jest.fn()}
      onToggleSave={jest.fn()}
      onPressCreateTrip={jest.fn()}
      {...overrides}
    />
  );
}

function buttonIds(): string[] {
  return screen
    .getAllByRole('button')
    .map((node) => String(node.props.testID))
    .sort();
}

const BASE_BUTTONS = [
  'explore-places-back',
  ...CATEGORY_CODES.map((code) => `explore-places-category-${code}`),
  ...IDS.map((id) => `explore-places-card-${id}`),
  ...IDS.map((id) => `explore-places-save-${id}`),
  'explore-places-saved-fab',
  'explore-places-region',
];

describe('출시 게이트 ① · 누를 수 있는 것 전수', () => {
  // 뒤로(1) + 카테고리 칩 11 + 카드 5 + 하트 5 + ♥FAB + ＋FAB + 지역 칩 = 25.
  it('콜백을 안 넘겨도 누를 수 있는 것은 정확히 이 목록이다(카드 5장 기준)', () => {
    renderMinimal();

    expect(buttonIds()).toEqual(
      [...BASE_BUTTONS, 'explore-places-create-fab'].sort()
    );
  });

  // TRIP-1026 — 위저드 출처면 ＋ 하나만 빠진다(♥·칩·카드·하트·지역 칩은 그대로).
  it('hideCreateTrip 이면 ＋ 하나만 빠진 목록이다', () => {
    renderMinimal({ hideCreateTrip: true });

    expect(buttonIds()).toEqual([...BASE_BUTTONS].sort());
  });
});
