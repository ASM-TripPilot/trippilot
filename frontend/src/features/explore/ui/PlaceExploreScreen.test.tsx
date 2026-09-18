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
 * 무엇을 보장하나: `PlaceExploreScreen` 은 props 8개만 받아(네트워크·라우팅·로컬 상태 없음)
 * 검색바 · 카테고리 칩 8개 · 정렬 라벨 1개 · 2열 카드 그리드 · 하단 CTA 를 그린다. 받은 순서를
 * 그대로 그리고(정렬·검색은 페이지가 끝내서 넘긴다), 담김 여부는 `savedPoiIds` 하나에서만
 * 파생하며, **계약에 판정 재료가 없는 컨트롤은 그리지 않는다**(01b Seed §2).
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

describe('PlaceExploreScreen — 그리지 않는 컨트롤 (AC-G1 · 01b Seed §2·Q5·Q8)', () => {
  it('정렬 칩은 "요즘 담긴 순" 하나뿐이고, 나머지 두 축은 어디에도 없다', () => {
    renderScreen();

    const sortChips = screen.getAllByTestId(/^explore-places-sort-/);
    expect(sortChips).toHaveLength(1);
    expect(String(sortChips[0].props.testID)).toBe('explore-places-sort-saved');
    expect(within(sortChips[0]).getByText('요즘 담긴 순')).toBeOnTheScreen();

    // "지금 뜨는 순"은 계약 재료가 `savedCount` 하나뿐이라 "요즘 담긴 순"과 **완전히 같은
    // 순서**가 되고(Seed Q8), "가까운 순"은 좌표 파라미터가 없다(AC-G1). 둘 다 누르면
    // 아무 일도 안 나는 칩이 된다.
    expect(screen.queryAllByText(/지금 뜨는/)).toHaveLength(0);
    expect(screen.queryAllByText(/가까운/)).toHaveLength(0);
  });

  it('누를 수 있는 것은 뒤로 · 칩 8개 · 하트 5개 · CTA 뿐이다', () => {
    renderScreen();

    // 이 한 단언이 Seed §2 원칙 전체의 심판이다 — 검색바 우측 필터 아이콘(Q5 미렌더),
    // 정렬 칩의 Pressable 화(Q8: 선택지가 아니라 라벨), 카드 전체 누름 배선(d06 은 범위 밖)이
    // 전부 여기 걸린다.
    // 정직한 한계: `getAllByRole('button')` 은 accessibilityRole 이 **명시된** 요소만 잡는다
    // (실측 — 맨 Pressable 은 안 잡힌다). 리포 관례상 모든 Pressable 이 role 을 단다.
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
        'explore-places-createtrip',
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

describe('PlaceExploreScreen — 하단 CTA (AC-6 · BR-U1-09 · 01b Seed Q3)', () => {
  it('담은 곳 수를 배지로, 문구를 따로 표기하고 누르면 콜백을 올린다', () => {
    const handlers = renderScreen();

    const cta = screen.getByTestId('explore-places-createtrip');
    // 라이브 d04 는 `[숫자 배지] 담은 장소로 여행 만들기` 로, 숫자가 **별도 노드**다
    // (티켓 AC 의 "{N} 담은 장소로 여행 만들기" 단일 문자열은 라이브와 다르다).
    // 그래서 숫자와 문구를 각각 잰다 — `toHaveTextContent(문자열)` 은 완전 일치라
    // 문구만으로는 통과할 수 없다(정규식으로 부분 확인).
    expect(within(cta).getByText('2')).toBeOnTheScreen();
    expect(cta).toHaveTextContent(/담은 장소로 여행 만들기/);

    fireEvent.press(cta);
    expect(handlers.onPressCreateTrip).toHaveBeenCalledTimes(1);
  });

  it('담은 곳이 0이면 CTA 바 자체를 그리지 않는다', () => {
    renderScreen({ savedPoiIds: [] });

    // BR-U1-09 의 조건절 그대로다(Seed Q3 ⓐ). 비활성 회색 CTA 를 두면 눌러도 아무 일 없는
    // 컨트롤이 되어 Seed §2 원칙 위반이다.
    expect(screen.queryByTestId('explore-places-createtrip')).toBeNull();

    // 긍정 짝 — 렌더가 통째로 실패해서 "없음"이 초록이 된 게 아니다.
    expect(cardTestIds()).toHaveLength(5);
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
