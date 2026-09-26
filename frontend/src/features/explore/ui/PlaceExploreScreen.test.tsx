import { Image } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Place } from '@/shared/api/generated/schemas';

import {
  PlaceExploreScreen,
  type PlaceExploreScreenProps,
} from './PlaceExploreScreen';

/**
 * AC-1 · AC-2 · AC-3 · AC-4 · AC-5 · AC-6 · AC-G1 · AC-G2 · AC-V1(01b Seed) —
 * d04 장소 탐색 default 의 **프레젠테이션 화면**.
 *
 * 무엇을 보장하나: `PlaceExploreScreen` 은 네트워크·라우팅·로컬 상태 없이 검색바(우측 필터
 * 버튼) · 카테고리 칩 8개 · 정렬 칩 1개("요즘 담긴 순" 활성 — TRIP-989 로 표시전용 2개 제거) · 2열 카드 그리드 · 우하단 FAB
 * 2단(♥ 담은장소 · ＋ 여행만들기)을 그린다(TRIP-708 로 CtaBar → FAB 로 교체). 받은 순서를
 * 그대로 그리고(정렬·검색은 페이지가 끝내서 넘긴다), 담김 여부는 `savedPoiIds` 하나에서만
 * 파생하며, **계약에 판정 재료가 없는 컨트롤은 그리지 않는다**(01b Seed §2). BottomTabBar·
 * 카테고리 시트는 화면이 아니라 페이지가 그린다(화면 순수성 — `PlaceExplorePage.*.integration`).
 * 소스 층(INV-3 조건부 렌더 · 토큰 · 층 경계)은 `src/__tests__/placeExploreStructure.test.ts`
 * 가 맡는다 — 이 파일은 렌더 결과만 본다.
 *
 * ★ 카드 안 단언은 예외 없이 `within(card)` 로 스코프한다. 카테고리 칩 라벨('카페'·'명소'·
 *   '맛집')이 카드 부제와 **같은 문자열**이라, 전역 `getByText('카페')` 는 다중 매칭으로
 *   throw 한다(실측: Found multiple elements).
 * ★ `toHaveTextContent(문자열)` 은 **완전 일치**다(RNTL 13.3.3 `matches.js` 기본 `exact=true`).
 *   CTA 처럼 숫자 배지와 문구가 한 서브트리에 있는 곳은 정규식이나 `getByText` 로 나눠 잰다.
 */

/** openapi `Place` 의 required 필드를 전부 채운다 — 픽스처를 상상해서 만들지 않는다. */
function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category'],
  region: string | null,
  savedCount: number,
  imageUrl: string | null = null
): Place {
  return {
    poiId,
    nameKo,
    category,
    lat: 35.1587,
    lng: 129.1604,
    region,
    openingHours: null,
    imageUrl,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

/**
 * 5장(홀수) — 마지막 행이 1장으로 남는 것까지 2열 단언에 넣기 위해서다.
 * 배열 순서는 savedCount 순서와 **다르다**: 화면이 다시 정렬하면 it 1 이 red 를 낸다.
 * p3 은 `region: null`(계약상 nullable), p2 만 `imageUrl` 이 있다.
 */
const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', '명소', '사하구', 12),
  makePlace(
    'p2',
    '광안리 해변',
    '야경',
    '수영구',
    30,
    'https://cdn.example.com/gwangalli.jpg'
  ),
  makePlace('p3', '전포 카페거리', '카페', null, 7),
  makePlace('p4', '해동용궁사', '명소', '기장군', 3),
  makePlace('p5', '자갈치 시장', '맛집', '중구', 21),
];

const SAVED = ['p1', 'p5'];

/** 카테고리 칩 — 라벨은 계약 enum 그대로, code 는 셀렉터용 latin 이다(`regions.ts` 규칙:
 * "한글을 쓰면 셀렉터가 취약해진다"). 순서는 "전체" + `PoiCategory` 선언 순. */
const CATEGORY_CHIPS: { code: string; label: string }[] = [
  { code: 'all', label: '전체' },
  { code: 'attraction', label: '명소' },
  { code: 'food', label: '맛집' },
  { code: 'cafe', label: '카페' },
  { code: 'nightview', label: '야경' },
  { code: 'nature', label: '자연' },
  { code: 'shopping', label: '쇼핑' },
  { code: 'culture', label: '문화' },
];

/** 콜백 4개는 별도로 들고 반환한다 — props 객체로 묶으면 `.mock` 타입이 사라진다. */
function renderScreen(overrides: Partial<PlaceExploreScreenProps> = {}) {
  const handlers = {
    onSelectCategory: jest.fn(),
    onChangeSearchText: jest.fn(),
    onToggleSave: jest.fn(),
    onPressCreateTrip: jest.fn(),
  };
  render(
    <PlaceExploreScreen
      places={PLACES}
      savedPoiIds={SAVED}
      selectedCategory={null}
      searchText=""
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

/** `^explore-places-card-` 를 하이픈까지 적는다 — `^explore-places-c` 로 줄이면 카테고리 칩
 * 8개가 카드로 딸려 온다. */
function cardTestIds(): string[] {
  return screen
    .getAllByTestId(/^explore-places-card-/)
    .map((node) => String(node.props.testID));
}

/**
 * 행마다 카드가 몇 장인지 — 2열 그리드의 **유일한 렌더 관측 수단**이다.
 * `FlatList numColumns` 는 호스트 props 에 남지 않는다(실측: 호스트는 RCTScrollView 이고
 * `props.numColumns` 는 undefined). 관측 가능한 신호는 RN 이 `numColumns>1` 일 때만 만드는
 * **행 래퍼의 `flexDirection:'row'`** 뿐이다.
 * `typeof node.type === 'string'` 로 호스트 요소만 남긴다 — 합성 요소까지 세면 같은 행이
 * 두 번, 카드가 두 배로 잡힌다(실측: 2장인 행이 4로 보였다).
 * 카드 안쪽의 가로 배치(0장짜리 행)는 걸러낸다.
 */
function cardsPerRow(): number[] {
  const grid = screen.getByTestId('explore-places-grid');
  return grid
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.props?.style != null &&
        JSON.stringify(node.props.style).includes('"flexDirection":"row"')
    )
    .map(
      (row) =>
        row.findAll(
          (node) =>
            typeof node.type === 'string' &&
            typeof node.props?.testID === 'string' &&
            node.props.testID.startsWith('explore-places-card-')
        ).length
    )
    .filter((count) => count > 0);
}

describe('PlaceExploreScreen — 카드 내용 (AC-1)', () => {
  it('받은 순서 그대로 그리고, 이름과 "{카테고리} · {지역}" 부제를 표기한다', () => {
    renderScreen();

    // 리터럴로 적는다 — 이 순서가 savedCount 순서와 다르다는 것이 게이트①에서 보여야 한다.
    expect(cardTestIds()).toEqual([
      'explore-places-card-p1',
      'explore-places-card-p2',
      'explore-places-card-p3',
      'explore-places-card-p4',
      'explore-places-card-p5',
    ]);

    const p1 = screen.getByTestId('explore-places-card-p1');
    expect(within(p1).getByText('감천문화마을')).toBeOnTheScreen();
    expect(within(p1).getByText('명소 · 사하구')).toBeOnTheScreen();

    const p5 = screen.getByTestId('explore-places-card-p5');
    expect(within(p5).getByText('자갈치 시장')).toBeOnTheScreen();
    expect(within(p5).getByText('맛집 · 중구')).toBeOnTheScreen();
  });

  it('region 이 null 이면 부제가 카테고리만 남는다', () => {
    renderScreen();

    const p3 = screen.getByTestId('explore-places-card-p3');
    expect(within(p3).getByText('전포 카페거리')).toBeOnTheScreen();
    // 구분점이 남으면('카페 · ') 이 완전 일치가 red 다. `within` 이 없으면 카테고리 칩의
    // '카페' 와 다중 매칭으로 throw 한다.
    expect(within(p3).getByText('카페')).toBeOnTheScreen();
  });

  it('카드가 한 행에 2장씩 놓인다 — 마지막 행만 1장이다', () => {
    renderScreen();

    expect(cardTestIds()).toHaveLength(5);
    expect(cardsPerRow()).toEqual([2, 2, 1]);
  });

  it('imageUrl 이 온 카드만 그 URL 로 사진을 그린다 (INV-1)', () => {
    renderScreen();

    const withPhoto = screen.getByTestId('explore-places-card-p2');
    // 계약이 준 값 그대로여야 한다 — CDN 경로 조합·외부 도메인 발명은 INV-1 위반이다
    // (소스 층은 placeExploreStructure 가 `https?://` 0건으로 막는다).
    expect(within(withPhoto).UNSAFE_getByType(Image).props.source).toEqual({
      uri: 'https://cdn.example.com/gwangalli.jpg',
    });

    // 부정 짝 — imageUrl 이 null 이면(계약상 **정상값**, 시드가 전부 NULL 이라 이게 기본
    // 경로다) 자리만 두고 이미지는 그리지 않는다.
    const noPhoto = screen.getByTestId('explore-places-card-p1');
    expect(within(noPhoto).UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });
});

describe('PlaceExploreScreen — 담김 표기 (AC-2)', () => {
  it('담긴 카드에만 "담음" 배지와 채워진 하트가 있다', () => {
    renderScreen();

    SAVED.forEach((poiId) => {
      const card = screen.getByTestId(`explore-places-card-${poiId}`);
      expect(within(card).getByText('담음')).toBeOnTheScreen();
      // 하트의 **모양**(채움 vs 외곽선)은 SVG path 라 렌더로 못 잰다. 상태는
      // accessibilityState.selected 로 잰다(RNTL `toBeSelected` = aria-selected ??
      // accessibilityState.selected ?? false). path 대조는 [검증] 스크린샷 몫이다.
      expect(screen.getByTestId(`explore-places-save-${poiId}`)).toBeSelected();
    });

    // 부정 짝 — 같은 it 안에 둔다. 배지를 모든 카드에 그리는 구현을 잡는다.
    ['p2', 'p3', 'p4'].forEach((poiId) => {
      const card = screen.getByTestId(`explore-places-card-${poiId}`);
      expect(within(card).queryAllByText('담음')).toHaveLength(0);
      expect(
        screen.getByTestId(`explore-places-save-${poiId}`)
      ).not.toBeSelected();
    });
  });
});

describe('PlaceExploreScreen — 카테고리 칩 (AC-3)', () => {
  it('"전체" + 계약 enum 7종 = 8개가 나열되고, 선택된 칩만 활성이다', () => {
    renderScreen({ selectedCategory: '맛집' });

    expect(
      screen
        .getAllByTestId(/^explore-places-category-/)
        .map((node) => String(node.props.testID))
    ).toEqual(
      CATEGORY_CHIPS.map(({ code }) => `explore-places-category-${code}`)
    );

    CATEGORY_CHIPS.forEach(({ code, label }) => {
      const chip = screen.getByTestId(`explore-places-category-${code}`);
      expect(within(chip).getByText(label)).toBeOnTheScreen();
      // Figma 는 6종이지만 계약 enum 이 정본이다(F-4). 활성은 정확히 하나다.
      if (code === 'food') {
        expect(chip).toBeSelected();
      } else {
        expect(chip).not.toBeSelected();
      }
    });
  });

  it('칩을 누르면 그 카테고리로, "전체"를 누르면 null 로 올린다', () => {
    const handlers = renderScreen({ selectedCategory: '맛집' });

    fireEvent.press(screen.getByTestId('explore-places-category-cafe'));
    fireEvent.press(screen.getByTestId('explore-places-category-all'));

    // 재조회는 페이지 몫이다 — 화면은 "무엇이 눌렸는지"만 올린다.
    expect(handlers.onSelectCategory.mock.calls).toEqual([['카페'], [null]]);
  });
});

describe('PlaceExploreScreen — 정렬 칩은 "요즘 담긴 순" 하나 (TRIP-989 B · D15 · u1 F-2)', () => {
  it('"지금 뜨는 순"·"가까운 순" 칩은 그리지 않고, "요즘 담긴 순" 활성 칩과 필터 버튼은 남는다', () => {
    renderScreen();

    // 남는 것 — 활성(연핑크) 칩 하나와 검색바 필터 버튼. "없음" 단언이 빈 화면으로 통과하지 않게 먼저 본다.
    const saved = screen.getByTestId('explore-places-sort-saved');
    expect(within(saved).getByText('요즘 담긴 순')).toBeOnTheScreen();
    expect(String(saved.props.className)).toContain('primary-pale');
    expect(screen.getByTestId('explore-places-filter')).toBeOnTheScreen();

    // 숨기는 것 — 계약에 판정 재료가 없어(뜨는 순 = 담긴 순과 같은 순서, 가까운 순 = 좌표 파라미터 없음)
    // 눌러도 아무 일이 없던 두 칩. 정본 u1 F-2 는 이미 "미노출"이다.
    expect(screen.queryByTestId('explore-places-sort-trending')).toBeNull();
    expect(screen.queryByTestId('explore-places-sort-nearby')).toBeNull();
    expect(screen.queryAllByText('지금 뜨는 순')).toHaveLength(0);
    expect(screen.queryAllByText('가까운 순')).toHaveLength(0);
  });
});

describe('PlaceExploreScreen — 누를 수 있는 것 17개 (AC-1 · AC-2 · AC-3 · 01b Seed §2)', () => {
  it('뒤로 · 칩 8개 · 하트 5개 · FAB 2개 · 필터 = 17개다 (CTA 제거·FAB/필터 추가·정렬칩 비-Pressable)', () => {
    // 이 렌더는 onPressSavedPlaces·onPressFilter 를 **안 넘긴다** — 그래도 두 FAB·필터가 떠야
    // 한다(Figma 는 상시 노출, 콜백은 옵셔널·무동작 허용). "콜백 없으면 안 그리는" 구현이면
    // 여기서 개수가 어긋나 red.
    renderScreen();

    // 이 한 단언이 Seed §2 원칙 전체의 심판이다 — CtaBar 제거(-1)·우하단 FAB 2단(+2)·검색바
    // 필터 버튼(+1)·정렬 칩 3개(비-Pressable=0)로 현 15 → **17**(현 15 에서 델타로 직접 세어
    // 확정). 완전일치 목록이라 FAB 하나라도 빠지면(뮤테이션) 어긋나 red 다.
    // BottomTabBar 는 화면이 아니라 페이지가 그리므로(3-a) 여기 개수에 안 든다.
    // 정직한 한계: `getAllByRole('button')` 은 accessibilityRole 이 **명시된** 요소만 잡는다
    // — 카드 루트는 role 미부여 bare Pressable 이라 카드 자체는 안 세어진다(TRIP-456).
    expect(
      screen
        .getAllByRole('button')
        .map((node) => String(node.props.testID))
        .sort()
    ).toEqual(
      [
        'explore-places-back',
        ...CATEGORY_CHIPS.map(({ code }) => `explore-places-category-${code}`),
        ...PLACES.map(({ poiId }) => `explore-places-save-${poiId}`),
        'explore-places-saved-fab',
        'explore-places-create-fab',
        'explore-places-filter',
      ].sort()
    );
  });
});

describe('PlaceExploreScreen — 담기 토글 (AC-4 · AC-5)', () => {
  it('하트를 누르면 담김 여부와 무관하게 그 장소를 그대로 올린다', () => {
    const handlers = renderScreen();

    fireEvent.press(screen.getByTestId('explore-places-save-p2')); // 미담김
    fireEvent.press(screen.getByTestId('explore-places-save-p1')); // 담김

    // 토글 판정(담기냐 해제냐)은 페이지가 한다 — 화면이 다시 판정하면 진실이 두 곳에 생긴다.
    // `Place` **객체 통째로** 올린다: `save(place)` 가 낙관 삽입에 그 값을 쓰기 때문이다
    // (poiId 만 올리면 페이지가 나머지를 지어내야 한다 — INV-1).
    expect(handlers.onToggleSave.mock.calls).toEqual([
      [PLACES[1]],
      [PLACES[0]],
    ]);
  });
});

describe('PlaceExploreScreen — 우하단 FAB 2단 (AC-1 · 01b Seed 3-a)', () => {
  it('♥ FAB 를 누르면 onPressSavedPlaces, ＋ FAB 를 누르면 onPressCreateTrip 을 올린다', () => {
    const onPressSavedPlaces = jest.fn();
    const onPressCreateTrip = jest.fn();
    renderScreen({ onPressSavedPlaces, onPressCreateTrip });

    // ♥(위) = 담은 장소 d02 로, ＋(아래) = 여행 만들기(기존 콜백 재사용).
    fireEvent.press(screen.getByTestId('explore-places-saved-fab'));
    expect(onPressSavedPlaces).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('explore-places-create-fab'));
    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
  });

  it('담은 곳이 0이어도 두 FAB 는 그대로 있고, 옛 CtaBar 는 사라졌다', () => {
    renderScreen({ savedPoiIds: [] });

    // CtaBar 는 savedPoiIds>0 조건이었으나 FAB 는 담은 수와 무관하게 상시 노출(Figma).
    expect(screen.getByTestId('explore-places-saved-fab')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-places-create-fab')).toBeOnTheScreen();
    // 회귀 잠금 — CTA 가 다시 살아나면 이 부재 단언이 red.
    expect(screen.queryByTestId('explore-places-createtrip')).toBeNull();

    // 긍정 짝 — 렌더가 통째로 실패해서 "없음"이 초록이 된 게 아니다.
    expect(cardTestIds()).toHaveLength(5);
  });
});

describe('PlaceExploreScreen — 검색 필터 버튼 (AC-2 · 01b Seed 3-a)', () => {
  it('검색바 우측 필터 버튼을 누르면 onPressFilter 를 올린다 (시트 열림은 페이지·6-b)', () => {
    const onPressFilter = jest.fn();
    renderScreen({ onPressFilter });

    // 필터 버튼은 콜백만 올린다 — 카테고리 시트의 실제 열림·딤은 페이지 소유이고 6-b 다.
    fireEvent.press(screen.getByTestId('explore-places-filter'));
    expect(onPressFilter).toHaveBeenCalledTimes(1);
  });
});

describe('PlaceExploreScreen — 카드 타이포 14/12 (AC-5)', () => {
  it('카드 이름은 text-[14px], 부제는 text-[12px] 다 (13.5/11.5 에서 상향)', () => {
    renderScreen();

    // NativeWind className 은 style 로는 안 바뀌어도 렌더 트리에 props.className 문자열로
    // 남는다(실측 확인 · TimelineScreen.placeholder 선례). 카드 타이포는 순수 시각 변경이지만
    // 이 문자열 매처로 red 를 낼 수 있다 — 픽셀 렌더는 [검증] 스크린샷 몫이다. 카드는 이제
    // entities/place/ui/PlaceGridCard 소유라 그 파일의 className 이 여기로 관측된다.
    const card = screen.getByTestId('explore-places-card-p1');
    expect(
      String(within(card).getByText('감천문화마을').props.className)
    ).toContain('text-[14px]');
    expect(
      String(within(card).getByText('명소 · 사하구').props.className)
    ).toContain('text-[12px]');
  });
});

describe('PlaceExploreScreen — 검색바 (AC-8 입력 경로)', () => {
  it('placeholder 와 현재 검색어를 보여 주고, 입력을 그대로 올린다', () => {
    const handlers = renderScreen({ searchText: '광안' });

    const input = screen.getByPlaceholderText('장소 · 명소 · 맛집 검색');
    expect(String(input.props.testID)).toBe('explore-places-search');
    expect(input).toHaveDisplayValue('광안');

    fireEvent.changeText(input, '자갈');
    // 거르기는 페이지 몫이다(`visiblePlaces`) — 화면은 입력만 올린다.
    expect(handlers.onChangeSearchText.mock.calls).toEqual([['자갈']]);
  });
});

describe('PlaceExploreScreen — 소요 시간 금지 (AC-G2 · INV-3)', () => {
  it('화면 어디에도 분·시간·소요 문자열이 없다', () => {
    renderScreen();

    // `getAllByText` 는 무매칭 시 throw 라 "없음"을 잴 수 없다 — query 접두사를 쓴다.
    expect(screen.queryAllByText(/분|시간|소요/)).toHaveLength(0);

    // 가짜통과 방지 짝 — 렌더가 통째로 실패해 화면이 비어도 "0건"이 초록이 되는 것을 막는다.
    expect(screen.getByTestId('explore-places-root')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('explore-places-card-p4')).getByText(
        '명소 · 기장군'
      )
    ).toBeOnTheScreen();
  });
});
