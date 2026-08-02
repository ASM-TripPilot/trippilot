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
 * 않는다(01b Seed Q7 ⓑ). 그리고 **새 prop 을 하나도 안 넘긴 렌더가 TRIP-221 default 화면
 * 그대로**여야 한다(AC-G7).
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
});

describe('PlaceExploreScreen — results 무회귀 (AC-8 · AC-G7)', () => {
  it('새 prop 을 하나도 안 넘기면 TRIP-221 default 화면 그대로다', () => {
    renderAsFrozenHelper();

    // ① 카드는 그대로 5장이고, ② 상태 안내·배너는 하나도 안 나온다.
    expect(cardTestIds()).toHaveLength(5);
    expect(visibleNotices()).toEqual([]);
    expect(screen.queryByTestId('explore-places-saveerror')).toBeNull();

    // ③ 누를 수 있는 것의 개수가 15 그대로다(뒤로 1 + 칩 8 + 하트 5 + CTA 1).
    //    동결 테스트가 이 목록을 **완전일치**로 비교하므로, 새 컨트롤이 default 렌더에
    //    하나라도 새면 거기서 즉시 red 다. 이 단언은 그 사고를 이 파일에서 먼저 잡는다.
    expect(screen.getAllByRole('button')).toHaveLength(15);
  });
});

describe('PlaceExploreScreen — 상태와 무관하게 CTA 를 유지한다 (01b Seed Q10 · BR-U1-09)', () => {
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
    '$name 안내와 담은 개수 CTA 가 함께 보인다',
    ({ state, noticeId }) => {
      renderState(state);

      // 짝을 같은 it 에 둔다 — 안내가 실제로 그려진 화면에서 CTA 가 남아야 의미가 있다.
      // 안내만 보고 CTA 를 안 보면 "둘이 같이 설 수 있는가"를 아무도 안 잰다.
      expect(screen.getByTestId(noticeId)).toBeOnTheScreen();

      // BR-U1-09 는 "담은 곳 ≥ 1 이면 탐색 계열 **모든 화면** 하단에 CTA" 다. 담은 개수는
      // 목록 조회 실패와 무관하므로 조회가 실패해도 사라지면 안 된다(01b Seed Q10 ⓐ).
      const cta = screen.getByTestId('explore-places-createtrip');
      expect(within(cta).getByText('2')).toBeOnTheScreen();
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
