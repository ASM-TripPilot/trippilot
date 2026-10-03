import { Image } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Place } from '@/shared/api/generated/schemas';

import type { PlaceListState } from '@/features/explore/model/placeListState';
import type { PlaceSaveNotice } from '@/features/save-place/model/placeSaveGuard';
import {
  PlaceExploreScreen,
  type PlaceExploreScreenProps,
} from './PlaceExploreScreen';

/**
 * AC-1 · AC-2 · AC-3 · AC-4 · AC-5 · AC-6 · AC-G1 · AC-G2 · AC-V1(01b Seed) —
 * d04 장소 탐색 default 의 **프레젠테이션 화면**.
 *
 * 무엇을 보장하나: `PlaceExploreScreen` 은 네트워크·라우팅·로컬 상태 없이 검색바(우측 필터
 * 버튼) · 카테고리 칩 8개 · 2열 카드 그리드(정렬 줄은 TRIP-1019 #025 로 제거) · 우하단 FAB
 * 2단(♥ 담은장소 · ＋ 여행만들기)을 그린다(TRIP-708 로 CtaBar → FAB 로 교체). 받은 순서를
 * 그대로 그리고(정렬·검색은 페이지가 끝내서 넘긴다), 담김 여부는 `savedPoiIds` 하나에서만
 * 파생하며, **계약에 판정 재료가 없는 컨트롤은 그리지 않는다**(01b Seed §2). BottomTabBar·
 * 카테고리 시트는 화면이 아니라 페이지가 그린다(화면 순수성 — `PlaceExplorePage.*.integration`).
 * 소스 층(INV-3 조건부 렌더 · 토큰 · 층 경계)을 보던 `placeExploreStructure`
 * 는 TRIP-1145 로 지웠다 — 이 파일은 렌더 결과만 본다.
 *
 * 한 파일로 합친 기록(TRIP-1147): 옛 `PlaceExploreScreen.states.test.tsx`(다섯 얼굴·실패 배너·대기
 * 하트) · `.region.test.tsx`(지역 칩, TRIP-1023 칸 B) · `.cardtap.test.tsx`(카드 press 버블링, TRIP-456)
 * 를 각자의 바깥 describe 로 옮겼다. 픽스처·렌더 헬퍼는 관점마다 값이 달라(예: "누를 수 있는 것
 * 23개"는 카드 5장 픽스처를 전제로 센 값) 그 describe 안에 두고 이름을 갈랐다. 소요시간 글자 0건
 * 테스트(INV-3) 둘은 README 판정 4 하위 규칙(시간·거리 재료가 없는 화면)으로 지웠다.
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
    // (소스 층 `https?://` 0건 스캔 placeExploreStructure 는 TRIP-1145 로 지웠다).
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

describe('🔴 TRIP-1019 #025 · 정렬 줄은 그리지 않는다 (결정 7 · u1 F-2 · TRIP-989 D15 후속)', () => {
  it('"요즘 담긴 순" 칩과 "정렬" 라벨이 모두 없고, 검색바 필터 버튼·카테고리 칩은 남는다', () => {
    renderScreen();

    // 남는 것 먼저(긍정 앵커) — 화면이 통째로 안 그려져도 아래 "없음" 단언이 초록이 되는 것을 막는다.
    // 필터 버튼(카테고리 시트)은 정렬과 다른 기능이라 그대로다.
    expect(screen.getByTestId('explore-places-root')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-places-filter')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-places-category-all')).toBeOnTheScreen();

    // 없애는 것 — 선택지가 하나뿐인 칩은 고를 게 없어 "누를 수 있어 보이는 가짜"가 된다(결정 7).
    // 칩만 지우고 "정렬" 라벨만 덩그러니 남는 반쪽 구현도 여기서 red 다.
    expect(screen.queryByTestId('explore-places-sort-saved')).toBeNull();
    expect(screen.queryAllByText('요즘 담긴 순')).toHaveLength(0);
    expect(screen.queryAllByText('정렬')).toHaveLength(0);

    // TRIP-989 에서 이미 숨긴 두 칩도 되살아나지 않는다(무회귀).
    expect(screen.queryByTestId('explore-places-sort-trending')).toBeNull();
    expect(screen.queryByTestId('explore-places-sort-nearby')).toBeNull();
    expect(screen.queryAllByText('지금 뜨는 순')).toHaveLength(0);
    expect(screen.queryAllByText('가까운 순')).toHaveLength(0);
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

// TRIP-1103 AC-1 — FAB 묶음 루트 View 에는 testID 가 없다. FAB 에서 조상으로 올라가 처음 만나는
// `absolute` 노드가 묶음 루트다(02a ★1). className 은 공백으로 쪼갠 토큰 배열로 완전일치 비교한다.
function fabBundleRoot(fabTestId: string) {
  let node = screen.getByTestId(fabTestId).parent;
  while (node) {
    const tokens = String(node.props.className ?? '').split(/\s+/);
    if (tokens.includes('absolute')) return node;
    node = node.parent;
  }
  throw new Error(`${fabTestId} 위에 absolute 조상이 없다`);
}

describe('TRIP-1103 AC-1 · d04 FAB 묶음 바닥 오프셋 84 (Figma d04 fabCollapsed 바닥 84)', () => {
  it('♥·＋ FAB 묶음 루트가 bottom-[84px] 이고 bottom-[100px] 은 없다', () => {
    renderScreen();

    const root = fabBundleRoot('explore-places-create-fab');
    // 앵커 — ♥ FAB 도 같은 묶음 루트에 닿는다(엉뚱한 absolute 노드가 아니다).
    expect(fabBundleRoot('explore-places-saved-fab')).toBe(root);
    const tokens = String(root.props.className ?? '').split(/\s+/);
    expect(tokens).toContain('bottom-[84px]');
    expect(tokens).not.toContain('bottom-[100px]');
  });
});

// ── 다섯 얼굴 · 담기 실패 배너 · 대기 하트 (옛 `PlaceExploreScreen.states.test.tsx`) ───────────────
// AC-4~AC-13 · AC-G7(01b Seed Q3·Q5·Q7·Q8·Q9·Q10) + TRIP-708 새 default 렌더(누를 수 있는 것 23개 —
// TRIP-1020 카드 버튼화·TRIP-1023 지역 칩 반영) + TRIP-1019 #027(조건 모두 해제) + TRIP-1026(＋ 숨김).
// `state` 판별 유니온 하나로 화면이 얼굴을 그리고(판정은 페이지 몫), 0건을 만든 조건을 문구에
// 지목하며, 담기 실패가 화면에 드러나고(INV-4), 응답 대기 중인 하트는 눌리지 않는다.
// ★ 안내의 제목·부제는 각각 `getByText(완전문자열)` 로 나눠 잰다(`toHaveTextContent` 문자열은 완전 일치).
// ★ NativeWind `className` 은 jest 에서 `style` 로 안 바뀐다 — 스켈레톤 2열×2행은 행 testID 로 잰다.
describe('다섯 얼굴 · 실패 배너 · 대기 하트', () => {
  /** 위 `PLACES` 와 같되 p2 에도 사진이 없다(옛 파일 값 그대로). */
  const STATE_PLACES: Place[] = [
    makePlace('p1', '감천문화마을', '명소', '사하구', 12),
    makePlace('p2', '광안리 해변', '야경', '수영구', 30),
    makePlace('p3', '전포 카페거리', '카페', null, 7),
    makePlace('p4', '해동용궁사', '명소', '기장군', 3),
    makePlace('p5', '자갈치 시장', '맛집', '중구', 21),
  ];

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

  /** 위 본 파일의 렌더 헬퍼(`renderScreen`)와 **완전히 같은 8개 prop** 만 넘긴다 — 새 prop 은 하나도 안 준다.
   * AC-G7("37케이스 무회귀")의 재현 장치라 이 목록을 늘리면 안 된다. */
  function renderAsFrozenHelper() {
    render(
      <PlaceExploreScreen
        places={STATE_PLACES}
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
  function renderWired(overrides: Partial<PlaceExploreScreenProps> = {}) {
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
        places={STATE_PLACES}
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
    return renderWired({ places: [], state, ...overrides });
  }

  function cardTestIdsOrNone(): string[] {
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
      expect(cardTestIdsOrNone()).toEqual([]);
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

      const clearAll = screen.getByTestId(
        'explore-places-filterzero-clear-all'
      );
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
      expect(filterZeroButtonIds()).toEqual([
        'explore-places-filterzero-clear',
      ]);
      expect(
        screen.queryByTestId('explore-places-filterzero-clear-all')
      ).toBeNull();
      expect(screen.queryAllByText('조건 모두 해제')).toHaveLength(0);
    });

    it('카테고리만 걸려 0건이면 "조건 모두 해제" 는 없다', () => {
      renderState(
        { kind: 'filter-zero', blame: 'category' },
        {
          searchText: '',
          selectedCategory: '카페',
          onClearAllFilters: jest.fn(),
        }
      );

      expect(filterZeroButtonIds()).toEqual([
        'explore-places-filterzero-clear',
      ]);
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

      expect(filterZeroButtonIds()).toEqual([
        'explore-places-filterzero-clear',
      ]);
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
      expect(cardTestIdsOrNone()).toEqual([]);
      expect(visibleNotices()).toEqual(['explore-places-error']);
    });

    // 실기 스모크가 잡은 결함(2026-08-05) — 안내가 `FlatList` 밖·위에 있으면 검색바·카테고리
    // 칩을 통째로 아래로 민다. testID 존재만 보는 단언은 두 배치 모두 통과하므로 여기서 잠근다.
    it('에러 안내가 검색·필터 컨트롤을 아래로 밀지 않는다 — 목록 헤더 안에 그려진다', () => {
      renderState({ kind: 'error' });

      const grid = screen.getByTestId('explore-places-grid');
      expect(
        within(grid).getByTestId('explore-places-error')
      ).toBeOnTheScreen();
    });
  });

  describe('PlaceExploreScreen — 새 default 렌더 · 누를 수 있는 것 23개 (AC-1 · AC-2 · AC-3 · TRIP-1020 AC-B4 · TRIP-1023 AC-B5)', () => {
    it('새 콜백을 하나도 안 넘겨도 FAB 2개·필터·지역 칩이 뜨고, 누를 수 있는 것은 정확히 23개다', () => {
      renderAsFrozenHelper();

      // ① 카드는 그대로 5장이고, ② 상태 안내·배너는 하나도 안 나온다.
      expect(cardTestIdsOrNone()).toHaveLength(5);
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
    const STATES: { name: string; state: PlaceListState; noticeId: string }[] =
      [
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
        expect(
          screen.getByTestId('explore-places-saved-fab')
        ).toBeOnTheScreen();
        expect(
          screen.getByTestId('explore-places-create-fab')
        ).toBeOnTheScreen();
      }
    );
  });

  // ── TRIP-1026 · 위저드에서 들어온 d04 는 ＋ FAB 를 그리지 않는다 (결정 1 = 숨김) ─────────────
  // 숨김 입력은 **새 옵셔널 prop `hideCreateTrip`** 이다. "onPressCreateTrip 미지정 = 숨김"으로 얹지
  // 않는다 — 형제 d05(`DestinationDetailScreen`)는 미지정을 "그리되 no-op"으로 잠가 두었다(AC-5).
  // 미지정(= false) 경로는 위 두 describe(23개·상태 무관 ＋ 상시)가 그대로 지킨다.
  describe('🔴 1026 · hideCreateTrip 이면 ＋ FAB 만 빠진다 (AC-1 · AC-5)', () => {
    it('누를 수 있는 것은 23개에서 ＋ 하나만 빠진 22개다 — ♥·필터·칩·카드·하트·지역 칩은 그대로', () => {
      renderWired({ hideCreateTrip: true });

      // 앵커 — 목록 얼굴이 실제로 그려졌다(카드 5장).
      expect(cardTestIdsOrNone()).toHaveLength(5);

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
        expect(
          screen.getByTestId('explore-places-saved-fab')
        ).toBeOnTheScreen();
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
      const handlers = renderWired({ saveError: notice });

      const banner = screen.getByTestId('explore-places-saveerror');
      expect(within(banner).getByText(notice.message)).toBeOnTheScreen();

      if (actionTestId === null) {
        // 다시 눌러도 결과가 같은 실패에 재시도 버튼을 달면 no-op 컨트롤이 된다
        // (01b Seed 관통 원칙).
        expect(
          screen.queryByTestId('explore-places-saveerror-retry')
        ).toBeNull();
        expect(
          screen.queryByTestId('explore-places-saveerror-login')
        ).toBeNull();
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
      expect(cardTestIdsOrNone()).toHaveLength(5);
    });
  });

  describe('PlaceExploreScreen — 응답 대기 중인 하트 (AC-13 · 01b Seed Q7 ⓑ)', () => {
    it('대기 중인 하트는 눌리지 않고, 나머지 하트는 그대로 동작한다', () => {
      const handlers = renderWired({ pendingPoiIds: ['p2'] });

      const pending = screen.getByTestId('explore-places-save-p2');
      const idle = screen.getByTestId('explore-places-save-p1');
      expect(pending).toBeDisabled();
      expect(idle).not.toBeDisabled();

      fireEvent.press(pending);
      fireEvent.press(idle);

      // 응답 전 두 번째 누름이 사라지는 자리를 아예 없앤다 — 증상만 알리는 대신 원인을 지운다
      // (TRIP-221 03b W-2 이관분).
      expect(handlers.onToggleSave.mock.calls).toEqual([[STATE_PLACES[0]]]);
    });
  });
});

// ── 지역 칩 (옛 `PlaceExploreScreen.region.test.tsx`, TRIP-1023 칸 B #026 · 결정5 · Seed Q4·Q5·Q6) ───
// 상시 지역 칩(`explore-places-region`)의 라벨은 `regionNames` prop(페이지가 라우트 `region` 을 배열로
// 편 것)에서 나오고(없음 "전국" · 한 곳 그 이름 · 여러 곳 "{첫 지역} 외 N곳"), 누르면 빈 상태의 "다른
// 지역 보기"와 같은 콜백(`onPressChangeRegion`)을 올린다.
// ★ 라벨은 칩 서브트리 안에서 `getByText(문자열)`(완전일치)로 잰다 — 카드 부제에 같은 지명이 또 있다.
// ★ 칩 자리(카테고리 칩 줄 바로 아래)는 호스트 트리 순서와 "가장 가까운 스크롤 조상"으로 잰다.
describe('지역 칩', () => {
  function makeRegionPlace(
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

  const REGION_PLACES: Place[] = [
    makeRegionPlace('p1', '경포해변', '자연', '강릉시'),
    makeRegionPlace('p2', '안목 커피거리', '카페', '강릉시'),
  ];

  function renderRegionScreen(
    overrides: Partial<PlaceExploreScreenProps> = {}
  ) {
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
        places={REGION_PLACES}
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
          typeof node.type === 'string' &&
          typeof node.props?.testID === 'string'
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
      renderRegionScreen();

      expect(within(regionChip()).getByText('전국')).toBeOnTheScreen();
    });

    it('한 곳이면 그 이름이 라벨이고 "전국" 은 없다', () => {
      renderRegionScreen({ regionNames: ['강릉시'] });

      // 긍정 앵커를 먼저 — 칩이 실제로 그려졌고 라벨이 지역 이름이다.
      expect(within(regionChip()).getByText('강릉시')).toBeOnTheScreen();
      expect(within(regionChip()).queryByText('전국')).toBeNull();
    });

    it('여러 곳이면 "{첫 지역} 외 N곳" 이다 (Seed Q5 — 칩 한 줄 폭을 지킨다)', () => {
      renderRegionScreen({ regionNames: ['부산광역시', '경주시'] });

      expect(
        within(regionChip()).getByText('부산광역시 외 1곳')
      ).toBeOnTheScreen();
      // 전부 나열(대안)로 가면 둘째 지역 이름이 칩에 나온다.
      expect(within(regionChip()).queryByText(/경주시/)).toBeNull();
    });
  });

  describe('🔴 1023-B #026 · 칩을 누르면 지역 바꾸기 콜백 하나만 오른다 (AC-B7 · Seed Q6)', () => {
    it('누르면 onPressChangeRegion 이 1회, 다른 콜백은 0회다', () => {
      const handlers = renderRegionScreen({ regionNames: ['강릉시'] });

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
      renderRegionScreen({
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
      renderRegionScreen({
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
      renderRegionScreen({
        state: { kind: 'results' },
        regionNames: ['강릉시'],
      });

      expect(screen.getByTestId('explore-places-card-p1')).toBeOnTheScreen();
      expect(within(regionChip()).getByText('강릉시')).toBeOnTheScreen();
    });
  });

  describe('🔴 1023-B #026 · 칩 자리 = 카테고리 칩 줄 바로 아래 한 줄 (Seed Q4)', () => {
    it('트리 순서가 카테고리 칩(마지막 "문화") → 지역 칩 → 첫 카드다', () => {
      renderRegionScreen({ regionNames: ['강릉시'] });

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
      renderRegionScreen({ places: [], state: { kind: 'error' } });

      const order = hostTestIdsInOrder();
      const chip = order.indexOf('explore-places-region');
      const errorNotice = order.indexOf('explore-places-error');

      expect(chip).toBeGreaterThanOrEqual(0);
      expect(errorNotice).toBeGreaterThan(chip);
    });

    it('칩은 카테고리 가로 스크롤 안이 아니라 목록 헤더에 바로 놓인다 (Q4 대안 c 아님)', () => {
      renderRegionScreen({ regionNames: ['강릉시'] });

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
});

// ── 카드 press 버블링 (옛 `PlaceExploreScreen.cardtap.test.tsx`, TRIP-456 AC-3) ─────────────────────
// 카드를 `Pressable` 로 만들되 하트 press 가 카드로 새지 않는다. RNTL 에서 자식 Pressable 이 활성이면
// 부모로 안 새고, `disabled` 면 부모로 **샌다** — d04 하트는 `disabled={pending}` 이라 카드 onPress 를
// `!pending` 으로 가드해 그 누수를 막는다(C3 이 그 가드의 심판).
describe('카드 press 버블링', () => {
  function makeCardtapPlace(poiId: string, nameKo: string): Place {
    return {
      poiId,
      nameKo,
      category: '문화',
      lat: 35.1,
      lng: 129.1,
      region: '부산',
      openingHours: null,
      imageUrl: null,
      tags: [],
      savedCount: 5,
      dataStatus: 'ACTIVE',
    };
  }

  const CARDTAP_PLACES: Place[] = [
    makeCardtapPlace('p1', '감천문화마을'),
    makeCardtapPlace('p2', '광안리'),
  ];

  function renderCardtapScreen(overrides?: {
    onPressCard?: (place: Place) => void;
    onToggleSave?: (place: Place) => void;
    pendingPoiIds?: string[];
  }) {
    render(
      <PlaceExploreScreen
        places={CARDTAP_PLACES}
        savedPoiIds={[]}
        selectedCategory={null}
        searchText=""
        onSelectCategory={() => {}}
        onChangeSearchText={() => {}}
        onToggleSave={overrides?.onToggleSave ?? (() => {})}
        onPressCreateTrip={() => {}}
        pendingPoiIds={overrides?.pendingPoiIds}
        onPressCard={overrides?.onPressCard}
      />
    );
  }

  describe('AC-3 · d04 카드 press 버블링', () => {
    it('C1 카드 본문을 누르면 onPressCard(place)가 그 카드의 place로 불린다 (하드코딩 아님)', () => {
      // 준비 — 카드 2장, onPressCard 스파이.
      const onPressCard = jest.fn();
      const onToggleSave = jest.fn();
      renderCardtapScreen({ onPressCard, onToggleSave });

      // 실행 — 첫 카드 본문(카드 루트 testID)을 누른다.
      fireEvent.press(screen.getByTestId('explore-places-card-p1'));
      // 단언 — 그 카드의 place가 올라간다. 하트 콜백은 안 불린다.
      expect(onPressCard).toHaveBeenCalledTimes(1);
      expect(onPressCard.mock.calls[0][0].poiId).toBe('p1');
      expect(onToggleSave).not.toHaveBeenCalled();

      // 둘째 카드도 각자 poiId — poiId를 하드코딩하면 여기서 갈린다.
      fireEvent.press(screen.getByTestId('explore-places-card-p2'));
      expect(onPressCard).toHaveBeenCalledTimes(2);
      expect(onPressCard.mock.calls[1][0].poiId).toBe('p2');
    });

    it('C2 활성 하트를 누르면 onToggleSave만 불리고 onPressCard로 안 샌다 (Probe A)', () => {
      // 준비 — pending 아님(하트 활성).
      const onPressCard = jest.fn();
      const onToggleSave = jest.fn();
      renderCardtapScreen({ onPressCard, onToggleSave });

      // 실행 — 하트를 누른다.
      fireEvent.press(screen.getByTestId('explore-places-save-p1'));

      // 단언 — 하트만 반응, 카드로 안 샌다(활성 자식은 press를 잡는다).
      expect(onToggleSave).toHaveBeenCalledTimes(1);
      expect(onToggleSave.mock.calls[0][0].poiId).toBe('p1');
      expect(onPressCard).not.toHaveBeenCalled();
    });

    it('C3 대기(disabled) 하트를 누르면 push·toggle 둘 다 0이다 (Probe C 누수 차단)', () => {
      // 준비 — p1을 pending으로: 하트가 disabled가 된다.
      const onPressCard = jest.fn();
      const onToggleSave = jest.fn();
      renderCardtapScreen({ onPressCard, onToggleSave, pendingPoiIds: ['p1'] });

      // 실행 — 대기 중 하트를 누른다. RNTL에선 disabled 자식 press가 부모(카드)로 샌다 —
      // 카드 onPress가 `!pending` 가드가 없으면 여기서 d06으로 튕긴다.
      fireEvent.press(screen.getByTestId('explore-places-save-p1'));

      // 단언 — 하트도(disabled) 카드도(가드) 반응하지 않는다.
      expect(onToggleSave).not.toHaveBeenCalled();
      expect(onPressCard).not.toHaveBeenCalled();
    });
  });
});
