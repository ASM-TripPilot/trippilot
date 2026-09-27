import type { ReactTestInstance } from 'react-test-renderer';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Place } from '@/shared/api/generated/schemas';

import type { PlaceListState } from '../model/placeListState';
import {
  PlaceExploreScreen,
  type PlaceExploreScreenProps,
} from './PlaceExploreScreen';

/**
 * TRIP-1023 칸 B #026 · d04 장소 탐색 지역 칩(결정5 · Seed Q4·Q5·Q6) — 프레젠테이션 계약.
 *
 * 무엇을 보장하나: 지금 어느 지역을 보는지 모르고 바꿀 곳도 없던 d04 에 **상시** 지역 칩
 * (`explore-places-region`)을 둔다. 라벨은 `regionNames` prop(페이지가 라우트 `region` 을 배열로 편 것)
 * 에서 나오고(없음 = "전국" · 한 곳 = 그 이름 · 여러 곳 = "{첫 지역} 외 N곳"), 누르면 빈 상태의
 * "다른 지역 보기"와 **같은 콜백**(`onPressChangeRegion`)을 올린다 — 목적지(피커 places)는 페이지가
 * 정한다(`PlaceExplorePage.integration` 의 1023-B describe).
 *
 * ★ 라벨은 칩 서브트리 안에서 `getByText(문자열)` 로 잰다 — **완전일치**다(RNTL 13 기본 exact).
 *   그래서 라벨 Text 노드에는 라벨 문자열만 담는다(▾ 같은 글리프는 별 요소). 카드 부제("명소 · 강릉시")
 *   와 같은 지명이 화면에 또 있을 수 있어 전역 `getByText` 는 쓰지 않는다.
 * ★ 칩 자리(Q4 = 카테고리 칩 줄 **바로 아래** 한 줄)는 호스트 트리 순서와 "가장 가까운 스크롤 조상"
 *   으로 잰다. 카테고리 칩 가로 스크롤 안에 칩을 끼워 넣는 안(Q4 대안 c)은 가장 가까운 스크롤이
 *   그 가로 스크롤이 되어 red 다.
 */

function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category'],
  region: string | null
): Place {
  return {
    poiId,
    nameKo,
    category,
    lat: 37.7519,
    lng: 128.8761,
    region,
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 1,
    dataStatus: 'ACTIVE',
  };
}

const PLACES: Place[] = [
  makePlace('p1', '경포해변', '자연', '강릉시'),
  makePlace('p2', '안목 커피거리', '카페', '강릉시'),
];

function renderScreen(overrides: Partial<PlaceExploreScreenProps> = {}) {
  const handlers = {
    onSelectCategory: jest.fn(),
    onChangeSearchText: jest.fn(),
    onToggleSave: jest.fn(),
    onPressCreateTrip: jest.fn(),
    onPressChangeRegion: jest.fn(),
    onPressSavedPlaces: jest.fn(),
    onPressFilter: jest.fn(),
    onBack: jest.fn(),
  };
  render(
    <PlaceExploreScreen
      places={PLACES}
      savedPoiIds={[]}
      selectedCategory={null}
      searchText=""
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

function regionChip(): ReactTestInstance {
  return screen.getByTestId('explore-places-region');
}

/** 호스트 요소만, 트리(전위) 순서대로 testID 를 뽑는다 — 합성 요소까지 세면 같은 testID 가 두 번 잡힌다. */
function hostTestIdsInOrder(): string[] {
  return screen
    .getByTestId('explore-places-root')
    .findAll(
      (node) =>
        typeof node.type === 'string' && typeof node.props?.testID === 'string'
    )
    .map((node) => String(node.props.testID));
}

/** 가장 가까운 호스트 스크롤 조상(RN ScrollView/FlatList 의 호스트는 `RCTScrollView`). */
function nearestScrollAncestor(
  node: ReactTestInstance
): ReactTestInstance | null {
  let current = node.parent;
  while (current !== null) {
    if (String(current.type) === 'RCTScrollView') return current;
    current = current.parent;
  }
  return null;
}

describe('🔴 1023-B #026 · 지역 칩 라벨 (AC-B5 · AC-B6 · AC-B10)', () => {
  it('regionNames 를 안 넘기면(탐색 탭·홈 진입 = 지역 없음) 칩이 "전국" 이다', () => {
    renderScreen();

    expect(within(regionChip()).getByText('전국')).toBeOnTheScreen();
  });

  it('한 곳이면 그 이름이 라벨이고 "전국" 은 없다', () => {
    renderScreen({ regionNames: ['강릉시'] });

    // 긍정 앵커를 먼저 — 칩이 실제로 그려졌고 라벨이 지역 이름이다.
    expect(within(regionChip()).getByText('강릉시')).toBeOnTheScreen();
    expect(within(regionChip()).queryByText('전국')).toBeNull();
  });

  it('여러 곳이면 "{첫 지역} 외 N곳" 이다 (Seed Q5 — 칩 한 줄 폭을 지킨다)', () => {
    renderScreen({ regionNames: ['부산광역시', '경주시'] });

    expect(
      within(regionChip()).getByText('부산광역시 외 1곳')
    ).toBeOnTheScreen();
    // 전부 나열(대안)로 가면 둘째 지역 이름이 칩에 나온다.
    expect(within(regionChip()).queryByText(/경주시/)).toBeNull();
  });
});

describe('🔴 1023-B #026 · 칩을 누르면 지역 바꾸기 콜백 하나만 오른다 (AC-B7 · Seed Q6)', () => {
  it('누르면 onPressChangeRegion 이 1회, 다른 콜백은 0회다', () => {
    const handlers = renderScreen({ regionNames: ['강릉시'] });

    // 칩은 버튼이다 — "누를 수 없는 표면"(#095 와 같은 결함)이면 안 된다.
    expect(regionChip()).toHaveProp('accessibilityRole', 'button');

    fireEvent.press(regionChip());

    expect(handlers.onPressChangeRegion).toHaveBeenCalledTimes(1);
    expect(handlers.onPressCreateTrip).not.toHaveBeenCalled();
    expect(handlers.onPressSavedPlaces).not.toHaveBeenCalled();
    expect(handlers.onPressFilter).not.toHaveBeenCalled();
    expect(handlers.onSelectCategory).not.toHaveBeenCalled();
    expect(handlers.onBack).not.toHaveBeenCalled();
  });
});

describe('🔴 1023-B #026 · 칩은 목록 얼굴과 무관하게 상시 보인다 (AC-B8)', () => {
  const FACES: { name: string; state: PlaceListState; anchorId: string }[] = [
    {
      name: 'loading',
      state: { kind: 'loading' },
      anchorId: 'explore-places-loading',
    },
    {
      name: 'empty',
      state: { kind: 'empty' },
      anchorId: 'explore-places-empty',
    },
    {
      name: 'filter-zero',
      state: { kind: 'filter-zero', blame: 'search' },
      anchorId: 'explore-places-filterzero',
    },
    {
      name: 'error',
      state: { kind: 'error' },
      anchorId: 'explore-places-error',
    },
  ];

  it.each(FACES)('$name 얼굴에서도 칩이 있다', ({ state, anchorId }) => {
    // 안내 얼굴은 목록이 비어야 그려진다(ListEmptyComponent). error 는 헤더 안에 그려진다.
    renderScreen({
      places: [],
      state,
      searchText: '없는장소',
      regionNames: ['강릉시'],
    });

    // 앵커 — 그 얼굴이 실제로 그려진 화면이다.
    expect(screen.getByTestId(anchorId)).toBeOnTheScreen();
    expect(within(regionChip()).getByText('강릉시')).toBeOnTheScreen();
  });

  it('다지역 부분 실패(degraded) 배너가 떠도 칩이 있다 (5-b 참고-1, 오케 보강)', () => {
    // 준비 — degraded 는 다지역일 때만 켜진다. "외 N곳" 라벨이 보이는 유일한 경로와 겹친다.
    renderScreen({
      state: { kind: 'results' },
      degraded: true,
      regionNames: ['강릉시', '속초시'],
    });

    // 앵커 — 부분 실패 배너가 실제로 그려졌다.
    expect(
      screen.getByTestId('explore-places-partialfailure')
    ).toBeOnTheScreen();
    expect(within(regionChip()).getByText('강릉시 외 1곳')).toBeOnTheScreen();
  });

  it('results 얼굴(카드가 있는 화면)에서도 칩이 있다', () => {
    renderScreen({ state: { kind: 'results' }, regionNames: ['강릉시'] });

    expect(screen.getByTestId('explore-places-card-p1')).toBeOnTheScreen();
    expect(within(regionChip()).getByText('강릉시')).toBeOnTheScreen();
  });
});

describe('🔴 1023-B #026 · 칩 자리 = 카테고리 칩 줄 바로 아래 한 줄 (Seed Q4)', () => {
  it('트리 순서가 카테고리 칩(마지막 "문화") → 지역 칩 → 첫 카드다', () => {
    renderScreen({ regionNames: ['강릉시'] });

    const order = hostTestIdsInOrder();
    const lastCategory = order.indexOf('explore-places-category-culture');
    const chip = order.indexOf('explore-places-region');
    const firstCard = order.indexOf('explore-places-card-p1');

    // 앵커 — 카테고리 칩이 트리에 있다(없으면 -1 이라 아래 부등식이 공짜로 참이 될 수 있다).
    //   chip > lastCategory ≥ 0 이고 firstCard > chip 이라 셋 다 실재해야만 통과한다.
    expect(lastCategory).toBeGreaterThanOrEqual(0);
    expect(chip).toBeGreaterThan(lastCategory);
    expect(firstCard).toBeGreaterThan(chip);
  });

  it('error 얼굴에서도 칩이 에러 안내보다 위다 — 안내가 컨트롤을 밀지 않는다', () => {
    renderScreen({ places: [], state: { kind: 'error' } });

    const order = hostTestIdsInOrder();
    const chip = order.indexOf('explore-places-region');
    const errorNotice = order.indexOf('explore-places-error');

    expect(chip).toBeGreaterThanOrEqual(0);
    expect(errorNotice).toBeGreaterThan(chip);
  });

  it('칩은 카테고리 가로 스크롤 안이 아니라 목록 헤더에 바로 놓인다 (Q4 대안 c 아님)', () => {
    renderScreen({ regionNames: ['강릉시'] });

    // 대조 앵커 — 카테고리 칩의 가장 가까운 스크롤은 목록(grid)이 **아닌** 가로 스크롤이다.
    //   이 앵커가 있어야 "스크롤 조상 = grid" 판정이 식별력을 갖는다.
    const categoryScroll = nearestScrollAncestor(
      screen.getByTestId('explore-places-category-all')
    );
    expect(categoryScroll).not.toBeNull();
    expect(categoryScroll?.props.testID).not.toBe('explore-places-grid');

    // 단언 — 지역 칩의 가장 가까운 스크롤은 목록 자체다.
    expect(nearestScrollAncestor(regionChip())?.props.testID).toBe(
      'explore-places-grid'
    );
  });
});
