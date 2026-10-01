import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Place } from '@/shared/api/generated/schemas';

import type { PlaceListState } from '../model/placeListState';
import type { PlaceSaveNotice } from '../model/placeSaveGuard';
import {
  PlaceExploreScreen,
  type PlaceExploreScreenProps,
} from './PlaceExploreScreen';

/**
 * AC-4 · AC-5 · AC-6 · AC-7 · AC-8 · AC-9 · AC-13 · AC-G5 · AC-G7 (01b Seed Q3·Q5·Q7·Q8·Q9·Q10)
 * — d04 의 다섯 얼굴 + 담기 실패 배너 + 응답 대기 하트의 **렌더 계약**.
 *
 * 무엇을 보장하나: `state` 판별 유니온 하나로 화면이 loading·empty·filter-zero·error·results 를
 * 그리고(판정은 페이지가 끝낸다 — 화면은 다시 판정하지 않는다), 0건을 만든 조건을 **문구에
 * 지목**하며(BR-U1-16 취지), 담기 실패가 화면에 드러나고(INV-4), 응답 대기 중인 하트는 눌리지
 * 않는다(01b Seed Q7 ⓑ). 그리고 **TRIP-708 새 default 렌더**(CtaBar 제거 → 우하단 FAB 2단 +
 * 필터 버튼 + 정렬 칩 3개)에서 누를 수 있는 것이 정확히 **17개**(TRIP-1020 카드 버튼화 뒤 22개, TRIP-1023 지역 칩 뒤 23개)여야
 * 하고, FAB 는 상태와 무관하게 상시 뜬다.
 *
 * 왜 파일을 새로 쓰나: `PlaceExploreScreen.test.tsx` 는 게이트① 해시가 동결된 TRIP-221
 * 산출물이라 한 글자도 못 고친다(`StaySearchScreen.test.tsx` → `.states.test.tsx` 선례).
 * 픽스처도 그래서 공용 모듈로 빼지 않고 복사한다.
 *
 * ★ 카드·안내 내부 단언은 예외 없이 `within(...)` 으로 스코프한다 — 카테고리 칩 라벨이 카드
 *   부제와 같은 문자열이라 전역 `getByText` 는 다중 매칭으로 throw 한다(TRIP-221 실측).
 * ★ `toHaveTextContent(문자열)` 은 **완전 일치**다(RNTL 13.3.3 `matches.js` 기본 `exact=true`,
 *   재실측). 안내의 제목·부제는 각각 `getByText(완전문자열)` 로 나눠 잰다.
 * ★ NativeWind `className` 은 jest 에서 `style` 로 바뀌지 않는다(실측: 호스트 props 에 style
 *   키가 아예 없다). 그래서 스켈레톤의 2열×2행은 `flexDirection:'row'` 가 아니라 **행 testID**
 *   로 잰다 — 픽셀 폭·간격은 [검증] 스크린샷 몫이다.
 */

function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category'],
  region: string | null,
  savedCount: number
): Place {
  return {
    poiId,
    nameKo,
    category,
    lat: 35.1587,
    lng: 129.1604,
    region,
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', '명소', '사하구', 12),
  makePlace('p2', '광안리 해변', '야경', '수영구', 30),
  makePlace('p3', '전포 카페거리', '카페', null, 7),
  makePlace('p4', '해동용궁사', '명소', '기장군', 3),
  makePlace('p5', '자갈치 시장', '맛집', '중구', 21),
];

const SAVED = ['p1', 'p5'];

/** 카테고리 칩 code(전체 + PoiCategory 7종 선언 순) — 누를 수 있는 것 완전일치 목록의 재료.
 * `PlaceExploreScreen.tsx`의 `CATEGORY_CODES`/`CATEGORY_CHIPS`와 같은 값이라 8개가 안 바뀐다. */
const CATEGORY_CODES = [
  'all',
  'attraction',
  'food',
  'cafe',
  'nightview',
  'nature',
  'shopping',
  'culture',
];

/** 동결 파일의 렌더 헬퍼와 **완전히 같은 8개 prop** 만 넘긴다 — 새 prop 은 하나도 안 준다.
 * AC-G7("37케이스 무회귀")의 재현 장치라 이 목록을 늘리면 안 된다. */
function renderAsFrozenHelper() {
  render(
    <PlaceExploreScreen
      places={PLACES}
      savedPoiIds={SAVED}
      selectedCategory={null}
      searchText=""
      onSelectCategory={jest.fn()}
      onChangeSearchText={jest.fn()}
      onToggleSave={jest.fn()}
      onPressCreateTrip={jest.fn()}
    />
  );
}

/** 상태 층까지 배선한 렌더 — 페이지가 실제로 넘기는 모양이다. 콜백은 별도로 들고 반환한다
 * (props 객체로 묶으면 `.mock` 타입이 사라진다). */
function renderScreen(overrides: Partial<PlaceExploreScreenProps> = {}) {
  const handlers = {
    onSelectCategory: jest.fn(),
    onChangeSearchText: jest.fn(),
    onToggleSave: jest.fn(),
    onPressCreateTrip: jest.fn(),
    onRetry: jest.fn(),
    onPressChangeRegion: jest.fn(),
    onClearFilter: jest.fn(),
    onPressSaveErrorAction: jest.fn(),
  };
  render(
    <PlaceExploreScreen
      places={PLACES}
      savedPoiIds={SAVED}
      selectedCategory={null}
      searchText=""
      onSelectCategory={handlers.onSelectCategory}
      onChangeSearchText={handlers.onChangeSearchText}
      onToggleSave={handlers.onToggleSave}
      onPressCreateTrip={handlers.onPressCreateTrip}
      onRetry={handlers.onRetry}
      onPressChangeRegion={handlers.onPressChangeRegion}
      onClearFilter={handlers.onClearFilter}
      onPressSaveErrorAction={handlers.onPressSaveErrorAction}
      {...overrides}
    />
  );
  return handlers;
}

/** 상태 얼굴을 그릴 때 페이지가 넘기는 조합 — 목록이 비어 있어야 안내가 그려진다
 * (`FlatList` 의 `ListEmptyComponent` 는 `data=[]` 일 때만 그려진다). */
function renderState(
  state: PlaceListState,
  overrides: Partial<PlaceExploreScreenProps> = {}
) {
  return renderScreen({ places: [], state, ...overrides });
}

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^explore-places-card-/)
    .map((node) => String(node.props.testID));
}

const NOTICE_IDS = [
  'explore-places-loading',
  'explore-places-empty',
  'explore-places-filterzero',
  'explore-places-error',
];

/** 지금 화면에 떠 있는 안내 testID 목록 — "이 얼굴만 나온다"를 한 줄로 잰다.
 * `getByTestId(문자열)` 은 **완전 일치**라(실측) `explore-places-loading-row-0` 같은 접두
 * 겹침에 오탐하지 않는다. */
function visibleNotices(): string[] {
  return NOTICE_IDS.filter((id) => screen.queryByTestId(id) !== null);
}

describe('PlaceExploreScreen — loading (AC-4)', () => {
  it('스켈레톤 4장을 2열 × 2행으로 그리고 라벨을 함께 보여 준다', () => {
    renderState({ kind: 'loading' });

    expect(screen.getByTestId('explore-places-loading')).toBeOnTheScreen();
    expect(screen.getByText('장소를 모으는 중')).toBeOnTheScreen();

    expect(
      screen
        .getAllByTestId(/^explore-places-skeleton-/)
        .map((node) => String(node.props.testID))
    ).toEqual([
      'explore-places-skeleton-0',
      'explore-places-skeleton-1',
      'explore-places-skeleton-2',
      'explore-places-skeleton-3',
    ]);

    // 2열 × 2행의 유일한 렌더 관측 수단 — 행 컨테이너 2개에 2장씩 들어 있는가.
    // 4장을 세로로 쌓은 구현(행 0개)도, 한 행에 4장(행 1개)도 여기서 red 다.
    const rows = screen.getAllByTestId(/^explore-places-loading-row-/);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByTestId(/^explore-places-skeleton-/)
          .map((node) => String(node.props.testID))
      )
    ).toEqual([
      ['explore-places-skeleton-0', 'explore-places-skeleton-1'],
      ['explore-places-skeleton-2', 'explore-places-skeleton-3'],
    ]);
  });

  it('"결과 없음" 계열 안내도 카드도 함께 나오지 않는다', () => {
    renderState({ kind: 'loading' });

    // AC-4 의 부정 절 — 로딩 중에 빈 결과 안내가 스치듯 뜨는 것을 막는다.
    expect(visibleNotices()).toEqual(['explore-places-loading']);
    expect(cardTestIds()).toEqual([]);
    expect(screen.queryAllByText(/결과가 없|0건|없어요/)).toHaveLength(0);
  });
});

describe('PlaceExploreScreen — empty (AC-5 · 01b Seed Q4·Q9)', () => {
  it('담을 장소가 없다는 안내와 다른 지역 보기 진입을 그린다', () => {
    const handlers = renderState({ kind: 'empty' });

    const notice = screen.getByTestId('explore-places-empty');
    expect(within(notice).getByText('담긴 장소가 없어요')).toBeOnTheScreen();
    expect(
      within(notice).getByText('다른 지역을 둘러보고 ♥로 담아 보세요')
    ).toBeOnTheScreen();

    const region = screen.getByTestId('explore-places-empty-region');
    expect(within(region).getByText('다른 지역 보기')).toBeOnTheScreen();

    fireEvent.press(region);
    expect(handlers.onPressChangeRegion).toHaveBeenCalledTimes(1);

    // 다른 얼굴이 겹쳐 나오지 않는다.
    expect(visibleNotices()).toEqual(['explore-places-empty']);
  });
});

describe('PlaceExploreScreen — filter-zero (AC-6 · BR-U1-16 취지 · 01b Seed Q3)', () => {
  it('검색어가 0건을 만들면 그 검색어를 지목하고 검색어만 지우게 한다', () => {
    const handlers = renderState(
      { kind: 'filter-zero', blame: 'search' },
      { searchText: '해운대', selectedCategory: '맛집' }
    );

    const notice = screen.getByTestId('explore-places-filterzero');
    // 그냥 빈 목록만 두면 AC 위반이다 — 무엇이 0건을 만들었는지가 문구에 있어야 한다.
    expect(
      within(notice).getByText('‘해운대’ 때문에 0건이에요')
    ).toBeOnTheScreen();
    expect(
      within(notice).getByText('조건을 해제하면 더 많은 장소를 볼 수 있어요')
    ).toBeOnTheScreen();

    const clear = screen.getByTestId('explore-places-filterzero-clear');
    // 01b Seed Q3 ⓐ — 지목한 하나만 해제한다(점진 해제). 카테고리도 걸려 있지만 지목은
    // 검색어이므로 버튼 라벨도 검색어를 가리켜야 한다.
    expect(within(clear).getByText('검색어 지우기')).toBeOnTheScreen();

    fireEvent.press(clear);
    expect(handlers.onClearFilter).toHaveBeenCalledTimes(1);
  });

  it('카테고리가 0건을 만들면 카테고리명을 지목한다', () => {
    renderState(
      { kind: 'filter-zero', blame: 'category' },
      { searchText: '', selectedCategory: '맛집' }
    );

    const notice = screen.getByTestId('explore-places-filterzero');
    // blame 을 안 보고 항상 검색어를 박는 구현은 여기서 red 다(빈 문자열이 지목된다).
    expect(
      within(notice).getByText('‘맛집’ 때문에 0건이에요')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('explore-places-filterzero-clear')).getByText(
        '‘맛집’ 필터 해제'
      )
    ).toBeOnTheScreen();
  });
});

/** filter-zero 안내 안에서 누를 수 있는 것의 testID(정렬) — "이 얼굴의 버튼은 정확히 이것뿐"을
 * 완전일치로 잰다. 안내 서브트리로 좁혀 FAB·칩·필터 버튼이 섞이지 않게 한다. */
function filterZeroButtonIds(): string[] {
  return within(screen.getByTestId('explore-places-filterzero'))
    .getAllByRole('button')
    .map((node) => String(node.props.testID))
    .sort();
}

// TRIP-1019 #027 — 검색어와 카테고리가 **둘 다** 걸려 0건이면, 지목한 하나만 푸는 기존 버튼 옆에
// 두 조건을 한 번에 푸는 두 번째 버튼(`-clear-all`, "조건 모두 해제", e02 의 link 선례)을 준다.
// 제목은 지금처럼 검색어 하나를 지목한다(01b Q6 ⓐ — 기존 filter-zero 테스트 무변경).
// 판정 재료는 화면이 이미 받는 `searchText`·`selectedCategory` 두 prop 이다(상태 유니온 무변경).
describe('🔴 TRIP-1019 #027 · filter-zero 에서 두 조건 모두 해제 (BR-U1-16 취지 · 01b Q6)', () => {
  it('검색어·카테고리가 둘 다 걸려 있으면 "조건 모두 해제" 가 지목 해제 버튼 옆에 생기고, 누르면 onClearAllFilters 만 오른다', () => {
    const onClearAllFilters = jest.fn();
    const handlers = renderState(
      { kind: 'filter-zero', blame: 'search' },
      { searchText: '경복궁', selectedCategory: '카페', onClearAllFilters }
    );

    const notice = screen.getByTestId('explore-places-filterzero');
    // 제목은 그대로 검색어 하나를 지목한다(Q6 ⓐ).
    expect(
      within(notice).getByText('‘경복궁’ 때문에 0건이에요')
    ).toBeOnTheScreen();

    // 이 얼굴의 버튼은 정확히 두 개 — 지목 해제(기존) + 모두 해제(신규).
    expect(filterZeroButtonIds()).toEqual([
      'explore-places-filterzero-clear',
      'explore-places-filterzero-clear-all',
    ]);
    expect(
      within(screen.getByTestId('explore-places-filterzero-clear')).getByText(
        '검색어 지우기'
      )
    ).toBeOnTheScreen();

    const clearAll = screen.getByTestId('explore-places-filterzero-clear-all');
    const label = within(clearAll).getByText('조건 모두 해제');
    // e02 선례의 두 번째 버튼 위계(link — 테두리 없는 primary 글자). outline 이면 글자가 text-ink 다.
    expect(String(label.props.className).split(/\s+/)).toContain(
      'text-primary'
    );

    fireEvent.press(clearAll);
    // 두 콜백이 섞이면 "하나만 풀기"와 "둘 다 풀기"가 같은 일을 하게 된다.
    expect(onClearAllFilters).toHaveBeenCalledTimes(1);
    expect(handlers.onClearFilter).not.toHaveBeenCalled();
  });

  it('검색어만 걸려 0건이면 풀 것이 하나라 "조건 모두 해제" 는 없다', () => {
    renderState(
      { kind: 'filter-zero', blame: 'search' },
      {
        searchText: '경복궁',
        selectedCategory: null,
        onClearAllFilters: jest.fn(),
      }
    );

    // 긍정 앵커 — 안내와 지목 해제 버튼은 떠 있다(부재 단언이 빈 화면으로 통과하지 않게).
    expect(filterZeroButtonIds()).toEqual(['explore-places-filterzero-clear']);
    expect(
      screen.queryByTestId('explore-places-filterzero-clear-all')
    ).toBeNull();
    expect(screen.queryAllByText('조건 모두 해제')).toHaveLength(0);
  });

  it('카테고리만 걸려 0건이면 "조건 모두 해제" 는 없다', () => {
    renderState(
      { kind: 'filter-zero', blame: 'category' },
      { searchText: '', selectedCategory: '카페', onClearAllFilters: jest.fn() }
    );

    expect(filterZeroButtonIds()).toEqual(['explore-places-filterzero-clear']);
    expect(
      within(screen.getByTestId('explore-places-filterzero-clear')).getByText(
        '‘카페’ 필터 해제'
      )
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('explore-places-filterzero-clear-all')
    ).toBeNull();
  });

  it('검색어가 공백뿐이면 조건이 아니다 — 카테고리 하나만 걸린 것으로 보고 "조건 모두 해제" 를 두지 않는다', () => {
    // 페이지는 `searchText.trim()` 으로 hasQuery 를 판정한다(공백 검색어 = 검색 조건 없음 → blame
    // category). 화면이 trim 없이 `searchText !== ''` 로 보면 여기서 버튼이 하나 더 생겨 red.
    renderState(
      { kind: 'filter-zero', blame: 'category' },
      {
        searchText: '   ',
        selectedCategory: '카페',
        onClearAllFilters: jest.fn(),
      }
    );

    expect(filterZeroButtonIds()).toEqual(['explore-places-filterzero-clear']);
    expect(
      screen.queryByTestId('explore-places-filterzero-clear-all')
    ).toBeNull();
  });
});

describe('PlaceExploreScreen — error (AC-7 · INV-4)', () => {
  it('에러 안내와 재시도를 그리고, 빈 목록으로 위장하지 않는다', () => {
    const handlers = renderState({ kind: 'error' });

    const notice = screen.getByTestId('explore-places-error');
    expect(
      within(notice).getByText('지금 장소 정보를 불러올 수 없어요')
    ).toBeOnTheScreen();
    expect(
      within(notice).getByText('잠시 후 다시 시도해 주세요')
    ).toBeOnTheScreen();

    const retry = screen.getByTestId('explore-places-error-retry');
    expect(within(retry).getByText('다시 시도')).toBeOnTheScreen();

    fireEvent.press(retry);
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);

    // INV-4 의 본체 — 카드가 0장인데 **안내가 실재한다**. 조용히 빈 목록만 두면 사용자는
    // "이 지역에 장소가 없다"고 잘못 배운다.
    expect(cardTestIds()).toEqual([]);
    expect(visibleNotices()).toEqual(['explore-places-error']);
  });

  // 실기 스모크가 잡은 결함(2026-08-05) — 안내가 `FlatList` 밖·위에 있으면 검색바·카테고리
  // 칩을 통째로 아래로 민다. testID 존재만 보는 단언은 두 배치 모두 통과하므로 여기서 잠근다.
  it('에러 안내가 검색·필터 컨트롤을 아래로 밀지 않는다 — 목록 헤더 안에 그려진다', () => {
    renderState({ kind: 'error' });

    const grid = screen.getByTestId('explore-places-grid');
    expect(within(grid).getByTestId('explore-places-error')).toBeOnTheScreen();
  });
});

describe('PlaceExploreScreen — 새 default 렌더 · 누를 수 있는 것 23개 (AC-1 · AC-2 · AC-3 · TRIP-1020 AC-B4 · TRIP-1023 AC-B5)', () => {
  it('새 콜백을 하나도 안 넘겨도 FAB 2개·필터·지역 칩이 뜨고, 누를 수 있는 것은 정확히 23개다', () => {
    renderAsFrozenHelper();

    // ① 카드는 그대로 5장이고, ② 상태 안내·배너는 하나도 안 나온다.
    expect(cardTestIds()).toHaveLength(5);
    expect(visibleNotices()).toEqual([]);
    expect(screen.queryByTestId('explore-places-saveerror')).toBeNull();

    // ③ 누를 수 있는 것 = 뒤로(1) + 칩 8 + 카드 5 + 하트 5 + ♥FAB + ＋FAB + 필터 + 지역 칩 = 23
    //    (TRIP-1020 이전 17 — 카드 루트가 role=button 이 되어 5장이 더해졌다. TRIP-1023 칸 B 가
    //    상시 지역 칩을 더했다 — 이 헬퍼는 regionNames 를 안 넘기므로 칩은 "전국" 으로 뜬다).
    //    renderAsFrozenHelper 는 onPressSavedPlaces·onPressFilter 를 **안 넘긴다** — 그래도
    //    두 FAB·필터가 떠야 한다(콜백 옵셔널·무동작 허용, Figma 상시 노출). 이 완전일치 목록은
    //    FAB 하나라도 빠지면(뮤테이션) 어긋나 red 다 — 현 15 에서 CTA(-1)·FAB(+2)·필터(+1)로
    //    직접 델타를 세어 확정. BottomTabBar 는 페이지가 그려 여기 개수에 안 든다.
    expect(
      screen
        .getAllByRole('button')
        .map((node) => String(node.props.testID))
        .sort()
    ).toEqual(
      [
        'explore-places-back',
        ...CATEGORY_CODES.map((code) => `explore-places-category-${code}`),
        ...['p1', 'p2', 'p3', 'p4', 'p5'].map(
          (id) => `explore-places-card-${id}`
        ),
        ...['p1', 'p2', 'p3', 'p4', 'p5'].map(
          (id) => `explore-places-save-${id}`
        ),
        'explore-places-saved-fab',
        'explore-places-create-fab',
        'explore-places-filter',
        'explore-places-region',
      ].sort()
    );
  });
});

describe('PlaceExploreScreen — 상태와 무관하게 FAB 2단을 유지한다 (01b Seed 3-a)', () => {
  const STATES: { name: string; state: PlaceListState; noticeId: string }[] = [
    {
      name: 'loading',
      state: { kind: 'loading' },
      noticeId: 'explore-places-loading',
    },
    {
      name: 'empty',
      state: { kind: 'empty' },
      noticeId: 'explore-places-empty',
    },
    {
      name: 'error',
      state: { kind: 'error' },
      noticeId: 'explore-places-error',
    },
  ];

  it.each(STATES)(
    '$name 안내와 함께 ♥·＋ FAB 가 남는다',
    ({ state, noticeId }) => {
      renderState(state);

      // 짝을 같은 it 에 둔다 — 안내가 실제로 그려진 화면에서 FAB 가 남아야 의미가 있다.
      expect(screen.getByTestId(noticeId)).toBeOnTheScreen();

      // FAB 를 결과 얼굴 안(state==='results')에만 그리면 로딩·빈·에러에서 사라진다 —
      // 그 회귀를 잡는다. FAB 는 얼굴과 무관하게 항상 우하단에 떠야 한다(CtaBar 와 달리 상시).
      expect(screen.getByTestId('explore-places-saved-fab')).toBeOnTheScreen();
      expect(screen.getByTestId('explore-places-create-fab')).toBeOnTheScreen();
    }
  );
});

// ── TRIP-1026 · 위저드에서 들어온 d04 는 ＋ FAB 를 그리지 않는다 (결정 1 = 숨김) ─────────────
// 숨김 입력은 **새 옵셔널 prop `hideCreateTrip`** 이다. "onPressCreateTrip 미지정 = 숨김"으로 얹지
// 않는다 — 형제 d05(`DestinationDetailScreen`)는 미지정을 "그리되 no-op"으로 잠가 두었다(AC-5).
// 미지정(= false) 경로는 위 두 describe(23개·상태 무관 ＋ 상시)가 그대로 지킨다.
describe('🔴 1026 · hideCreateTrip 이면 ＋ FAB 만 빠진다 (AC-1 · AC-5)', () => {
  it('누를 수 있는 것은 23개에서 ＋ 하나만 빠진 22개다 — ♥·필터·칩·카드·하트·지역 칩은 그대로', () => {
    renderScreen({ hideCreateTrip: true });

    // 앵커 — 목록 얼굴이 실제로 그려졌다(카드 5장).
    expect(cardTestIds()).toHaveLength(5);

    // 완전일치 목록 — ＋ 가 남아도, ♥ 가 딸려 사라져도 어긋난다.
    expect(
      screen
        .getAllByRole('button')
        .map((node) => String(node.props.testID))
        .sort()
    ).toEqual(
      [
        'explore-places-back',
        ...CATEGORY_CODES.map((code) => `explore-places-category-${code}`),
        ...['p1', 'p2', 'p3', 'p4', 'p5'].map(
          (id) => `explore-places-card-${id}`
        ),
        ...['p1', 'p2', 'p3', 'p4', 'p5'].map(
          (id) => `explore-places-save-${id}`
        ),
        'explore-places-saved-fab',
        'explore-places-filter',
        // TRIP-1023 칸 B — 위저드 출처여도 지역 칩은 남는다(Seed Q6 · 상시).
        'explore-places-region',
      ].sort()
    );
  });

  it.each(['loading', 'empty', 'error'] as const)(
    '%s 얼굴에서도 ♥ 는 남고 ＋ 는 없다',
    (kind) => {
      renderState({ kind }, { hideCreateTrip: true });

      // 짝 — 안내가 실제로 그려진 화면이어야 "없다"가 의미를 갖는다.
      expect(screen.getByTestId(`explore-places-${kind}`)).toBeOnTheScreen();
      expect(screen.getByTestId('explore-places-saved-fab')).toBeOnTheScreen();
      expect(screen.queryByTestId('explore-places-create-fab')).toBeNull();
    }
  );
});

describe('PlaceExploreScreen — 담기 실패 배너 (AC-9 · AC-10 · AC-12 · 01b Seed Q5·Q6)', () => {
  const NOTICES: {
    name: string;
    notice: PlaceSaveNotice;
    actionTestId: string | null;
    actionLabel: string | null;
  }[] = [
    {
      name: '미로그인 — 로그인하기로 보낸다',
      notice: {
        message: '로그인하면 마음에 든 장소를 담을 수 있어요',
        action: 'login',
      },
      actionTestId: 'explore-places-saveerror-login',
      actionLabel: '로그인하기',
    },
    {
      name: '네트워크 실패 — 다시 시도를 준다',
      notice: { message: '연결이 불안정해 담지 못했어요', action: 'retry' },
      actionTestId: 'explore-places-saveerror-retry',
      actionLabel: '다시 시도',
    },
    {
      name: '404 — 사유만 알리고 버튼을 두지 않는다',
      notice: { message: '지금은 담을 수 없는 장소예요', action: null },
      actionTestId: null,
      actionLabel: null,
    },
  ];

  it.each(NOTICES)('$name', ({ notice, actionTestId, actionLabel }) => {
    const handlers = renderScreen({ saveError: notice });

    const banner = screen.getByTestId('explore-places-saveerror');
    expect(within(banner).getByText(notice.message)).toBeOnTheScreen();

    if (actionTestId === null) {
      // 다시 눌러도 결과가 같은 실패에 재시도 버튼을 달면 no-op 컨트롤이 된다
      // (01b Seed 관통 원칙).
      expect(screen.queryByTestId('explore-places-saveerror-retry')).toBeNull();
      expect(screen.queryByTestId('explore-places-saveerror-login')).toBeNull();
      return;
    }

    const action = screen.getByTestId(actionTestId);
    expect(within(action).getByText(String(actionLabel))).toBeOnTheScreen();

    fireEvent.press(action);
    expect(handlers.onPressSaveErrorAction).toHaveBeenCalledTimes(1);
  });

  it('실패가 없으면 배너 자리 자체가 없다', () => {
    renderAsFrozenHelper();

    expect(screen.queryByTestId('explore-places-saveerror')).toBeNull();
    // 긍정 짝 — 렌더가 통째로 실패해서 "없음"이 초록이 된 게 아니다.
    expect(cardTestIds()).toHaveLength(5);
  });
});

describe('PlaceExploreScreen — 응답 대기 중인 하트 (AC-13 · 01b Seed Q7 ⓑ)', () => {
  it('대기 중인 하트는 눌리지 않고, 나머지 하트는 그대로 동작한다', () => {
    const handlers = renderScreen({ pendingPoiIds: ['p2'] });

    const pending = screen.getByTestId('explore-places-save-p2');
    const idle = screen.getByTestId('explore-places-save-p1');
    expect(pending).toBeDisabled();
    expect(idle).not.toBeDisabled();

    fireEvent.press(pending);
    fireEvent.press(idle);

    // 응답 전 두 번째 누름이 사라지는 자리를 아예 없앤다 — 증상만 알리는 대신 원인을 지운다
    // (TRIP-221 03b W-2 이관분).
    expect(handlers.onToggleSave.mock.calls).toEqual([[PLACES[0]]]);
  });
});

describe('PlaceExploreScreen — 소요 시간 금지 (AC-G5 · INV-3)', () => {
  const FACES: { name: string; state: PlaceListState; noticeId: string }[] = [
    {
      name: 'loading',
      state: { kind: 'loading' },
      noticeId: 'explore-places-loading',
    },
    {
      name: 'empty',
      state: { kind: 'empty' },
      noticeId: 'explore-places-empty',
    },
    {
      name: 'filter-zero',
      state: { kind: 'filter-zero', blame: 'category' },
      noticeId: 'explore-places-filterzero',
    },
    {
      name: 'error',
      state: { kind: 'error' },
      noticeId: 'explore-places-error',
    },
  ];

  it.each(FACES)(
    '$name 얼굴에 분·시간·소요 문자열이 없다',
    ({ state, noticeId }) => {
      renderState(state, { selectedCategory: '맛집' });

      // `getAllByText` 는 무매칭 시 throw 라 "없음"을 잴 수 없다 — query 접두사를 쓴다.
      expect(screen.queryAllByText(/분|시간|소요/)).toHaveLength(0);

      // 가짜통과 방지 짝 — 렌더가 통째로 실패해 화면이 비어도 "0건"이 초록이 되는 것을 막는다.
      expect(screen.getByTestId(noticeId)).toBeOnTheScreen();
    }
  );
});
