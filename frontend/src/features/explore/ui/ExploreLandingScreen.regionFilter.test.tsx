import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
} from './ExploreLandingScreen';

/**
 * TRIP-1105 — d01 탐색 랜딩(순수 화면)의 새 옵셔널 prop `regionFilter` 계약.
 *
 * 무엇을 보장하나:
 *  - `regionFilter` 가 없으면 지금 d01 그대로다(칩 없음 · 검색 placeholder · 레인 제목 `숙소`/`장소`).
 *  - 있으면 검색바(`explore-landing-search`) **안에** 지역 칩, 칩 **안에** ✕ 가 있다. placeholder 대신
 *    칩과 오른쪽 `›` 가 보이고, 레인 제목이 `{지역} 숙소`·`{지역} 장소` 가 된다(Figma 4767:2957).
 *  - ✕ 는 해제 콜백만, 칩 밖 검색바는 검색 진입 콜백만 부른다(중첩 Pressable — 02a ★8).
 *  - ✕ 는 보이는 크기가 작아도 손가락 44 를 받는다(hitSlop ≥ 12 · 버튼 역할).
 *  - QA #7 — 숙소 카드와 장소 카드 폭이 같은 160 이다(필터 유무 상관없이). 로딩 스켈레톤도 160.
 *
 * (개념) jest 는 NativeWind className 을 style 로 바꾸지 않고 문자열 prop 으로 남긴다 — 그래서 폭은
 * 픽셀이 아니라 className 토큰(`w-[160px]`)으로 잰다. 스켈레톤은 인라인 style 이라 `toHaveStyle`
 * (부분집합 비교)로 본다.
 *
 * 3동작 뼈대: 준비(props) → 실행(렌더·press) → 단언(testID·텍스트·콜백·토큰).
 */

const STAY_CARD = {
  key: 'NAVER:s1',
  name: '해운대 그랜드 호텔',
  region: '해운대',
  priceText: '145,000원~',
};
const PLACE_CARD = {
  poiId: 'p1',
  name: '감천문화마을',
  region: '사하구',
  imageUrl: null,
};

function props(
  over: Partial<ExploreLandingScreenProps> = {}
): ExploreLandingScreenProps {
  return {
    heading: {
      title: '무엇을 둘러볼까요?',
      subtitle: '숙소·장소를 둘러보고 담아요',
    },
    onPressSearch: jest.fn(),
    stayLane: {
      error: false,
      cards: [STAY_CARD],
      onRetry: jest.fn(),
      onSeeAll: jest.fn(),
    },
    placeLane: {
      error: false,
      cards: [PLACE_CARD],
      onRetry: jest.fn(),
      onPressCard: jest.fn(),
    },
    savedMenu: {
      open: false,
      savedCount: 0,
      onToggle: jest.fn(),
      onPressSavedPlaces: jest.fn(),
      onPressSavedStays: jest.fn(),
    },
    ...over,
  };
}

/** 루트 className 토큰 목록. */
function tokensOf(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? '')
    .trim()
    .split(/\s+/);
}

/** hitSlop(숫자 또는 네 변 객체)의 가장 좁은 변. 없으면 0. */
function minHitSlop(hitSlop: unknown): number {
  if (typeof hitSlop === 'number') return hitSlop;
  if (hitSlop && typeof hitSlop === 'object') {
    const h = hitSlop as Record<string, number | undefined>;
    return Math.min(h.top ?? 0, h.bottom ?? 0, h.left ?? 0, h.right ?? 0);
  }
  return 0;
}

describe('RF1 · 필터 없음 — 지금 d01 그대로 (무회귀 앵커)', () => {
  it('칩이 없고, 검색 placeholder 와 레인 제목 "숙소"·"장소" 가 보인다', () => {
    render(<ExploreLandingScreen {...props()} />);

    expect(screen.queryByTestId('explore-region-chip') === null).toBe(true);
    expect(screen.getByText('도시 · 장소 · 숙소 검색')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('explore-lane-stay')).getByText('숙소')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('explore-lane-place')).getByText('장소')
    ).toBeOnTheScreen();
  });
});

describe('🔴 RF2 · 필터 있음 — 검색바 안 칩 · 칩 안 ✕ · 지역 레인 제목', () => {
  it('칩에 지역 이름, ✕ 는 칩 안, placeholder 대신 › 가 있고, 레인 제목에 지역이 붙는다', () => {
    render(
      <ExploreLandingScreen
        {...props({
          regionFilter: { label: '부산광역시', onClear: jest.fn() },
        })}
      />
    );

    const search = screen.getByTestId('explore-landing-search');
    const chip = within(search).getByTestId('explore-region-chip');
    expect(within(chip).getByText('부산광역시')).toBeOnTheScreen();
    expect(
      within(chip).getByTestId('explore-region-chip-clear')
    ).toBeOnTheScreen();
    expect(within(search).getByText('›')).toBeOnTheScreen();
    expect(screen.queryByText('도시 · 장소 · 숙소 검색') === null).toBe(true);

    expect(screen.getByText('부산광역시 숙소')).toBeOnTheScreen();
    expect(screen.getByText('부산광역시 장소')).toBeOnTheScreen();
  });
});

describe('🔴 RF3 · ✕ 는 해제만, 칩 밖 검색바는 검색 진입만', () => {
  it('✕ press → onClear 1 · onPressSearch 0, 검색바 press → onPressSearch 1 · onClear 0', () => {
    const onClear = jest.fn();
    const onPressSearch = jest.fn();
    render(
      <ExploreLandingScreen
        {...props({
          onPressSearch,
          regionFilter: { label: '부산광역시', onClear },
        })}
      />
    );

    fireEvent.press(screen.getByTestId('explore-region-chip-clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onPressSearch).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('explore-landing-search'));
    expect(onPressSearch).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 RF4 · ✕ 접근성 — 버튼 역할 · 히트 44 (시각 20 + hitSlop 12)', () => {
  it('accessibilityRole 이 button 이고 hitSlop 네 변이 모두 12 이상이다', () => {
    render(
      <ExploreLandingScreen
        {...props({
          regionFilter: { label: '부산광역시', onClear: jest.fn() },
        })}
      />
    );

    const clear = screen.getByTestId('explore-region-chip-clear');
    expect(clear.props.accessibilityRole).toBe('button');
    expect(minHitSlop(clear.props.hitSlop) >= 12).toBe(true);
  });
});

describe('🔴 RF5 · QA #7 — 숙소 카드와 장소 카드가 같은 폭 160', () => {
  it.each([
    ['필터 없음', undefined],
    ['필터 있음', { label: '부산광역시', onClear: () => {} }],
  ] as const)(
    '%s — 두 카드 루트가 모두 w-[160px] 이고 w-[200px] 은 없다',
    (_, regionFilter) => {
      render(<ExploreLandingScreen {...props({ regionFilter })} />);

      const stay = tokensOf(`explore-stay-card-${STAY_CARD.key}`);
      const place = tokensOf(`explore-place-card-${PLACE_CARD.poiId}`);
      expect(stay).toContain('w-[160px]');
      expect(stay).not.toContain('w-[200px]');
      expect(place).toContain('w-[160px]');
    }
  );
});

describe('🔴 RF6 · 로딩 스켈레톤도 카드와 같은 폭 160 (Q1)', () => {
  it('숙소·장소 스켈레톤 첫 칸의 폭이 둘 다 160 이다', () => {
    render(<ExploreLandingScreen {...props({ isLoading: true })} />);

    expect(screen.getByTestId('explore-landing-skeleton-stay-0')).toHaveStyle({
      width: 160,
    });
    expect(screen.getByTestId('explore-landing-skeleton-place-0')).toHaveStyle({
      width: 160,
    });
  });
});
