import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
  type PlaceCardVM,
} from './ExploreLandingScreen';

/**
 * TRIP-703 — d01 탐색 랜딩 default 정합(프레젠테이션). 동작 계약(press·testID)은 대부분
 * 불변이고, 이 사이클이 바꾸는 표면만 잠근다:
 *  - AC-1 장소 레인 제목 "가볼 곳" → "장소" (testID `explore-lane-place-*` 불변)
 *  - AC-3 검색창 알약 → radius 12 · 높이 58 (className 변경)
 *  - AC-4 FAB 세로 2단(♥ 유지 + ＋ 신규)
 *  - AC-5(화면 절반) ＋ press → `onPressCreateTrip` 콜백(라우팅은 라우트 몫)
 *  - AC-6 여행자 일정 레인 제거
 *
 * 무엇을 보장하나: 화면은 props-only 순수 컴포넌트다(`placeExploreStructure` 재귀 스캔이
 * 훅·라우터·`@/features/stay` 를 0건 강제). 그래서 목 없이
 * `render(<ExploreLandingScreen {...props} />)` 로 표면을 직접 잰다(cardPress·placePhoto 선례).
 * 라우터 실배선(`/trips/new/step1`)·검색바 그림자·FAB 픽셀 위치는 이 층 사정거리 밖이다
 * (각각 `tabsExploreRoute.test.tsx` 라우트 테스트 · 6-b 육안).
 *
 * *(개념)* NativeWind `className` 은 jest 렌더 트리에 **평문 문자열 prop** 으로 남는다
 * (`toHaveStyle` 은 style 이 undefined 라 못 쓴다) — `props.className` 을 공백으로 쪼갠 토큰
 * 배열에 `toContain` 한다(원소 완전일치, `TimelineScreen.placeholder.test.tsx` 선례).
 * `getByText(문자열)` 은 기본이 **완전일치**라 "장소" 가 "가볼 만한 장소 둘러보기" 에 안 걸린다.
 * Arrange(props) → Act(render/press) → Assert(트리·콜백).
 */

/** className 토큰 배열(공백 분리) — 원소 완전일치로 검색바 라운드/높이를 잰다. */
function classTokens(node: { props: { className?: unknown } }): string[] {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

const PLACE_CARD: PlaceCardVM = {
  poiId: 'p1',
  name: '감천문화마을',
  region: '사하구',
  imageUrl: null,
};

function baseProps(
  overrides: Partial<ExploreLandingScreenProps> = {}
): ExploreLandingScreenProps {
  return {
    heading: {
      title: '무엇을 둘러볼까요?',
      subtitle: '숙소·장소를 둘러보고 담아요',
    },
    onPressSearch: () => {},
    onPressPlaces: () => {},
    placeLane: {
      error: false,
      cards: [PLACE_CARD],
      onRetry: () => {},
      onPressCard: () => {},
    },
    stayLane: {
      error: false,
      cards: [],
      onRetry: () => {},
      onSeeAll: () => {},
    },
    savedMenu: {
      open: false,
      savedCount: 0,
      onToggle: () => {},
      onPressSavedPlaces: () => {},
      onPressSavedStays: () => {},
    },
    ...overrides,
  };
}

/** savedMenu 만 갈아끼운 baseProps — AC-5 두 갈래에서 onToggle 관측용. */
function withSavedMenuToggle(
  onToggle: jest.Mock
): ExploreLandingScreenProps['savedMenu'] {
  return {
    open: false,
    savedCount: 0,
    onToggle,
    onPressSavedPlaces: () => {},
    onPressSavedStays: () => {},
  };
}

describe('AC-1 · 장소 레인 제목 "가볼 곳" → "장소"', () => {
  it('레인 헤더가 "장소" 이고 "가볼 곳" 은 어디에도 없다(testID 규약 유지)', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    const lane = screen.getByTestId('explore-lane-place');
    expect(within(lane).getByText('장소')).toBeOnTheScreen();
    expect(screen.queryByText('가볼 곳')).toBeNull();
    // 레인·"모두 보기" CTA testID 는 불변(계약 보존).
    expect(screen.getByTestId('explore-lane-place-cta')).toBeOnTheScreen();
  });
});

describe('AC-3 · 검색창 알약 → radius 12 · 높이 58', () => {
  it('rounded-input·h-[58px] 이고, 알약(rounded-pill)·h-[52px] 는 사라진다', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    const tokens = classTokens(screen.getByTestId('explore-landing-search'));
    // radius 12 = 검색바 input 토큰(tailwind.config `input:'12px'`, 브리프 토큰 스냅).
    expect(tokens).toContain('rounded-input');
    expect(tokens).toContain('h-[58px]');
    // 옛 알약·높이 흔적은 사라진다.
    expect(tokens).not.toContain('rounded-pill');
    expect(tokens).not.toContain('h-[52px]');
  });
});

describe('AC-4 · FAB 세로 2단(♥ 유지 + ＋ 신규)', () => {
  it('저장 하트(explore-saved-menu-toggle)와 여행 만들기(explore-create-trip-fab) 두 FAB 이 있다', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    expect(screen.getByTestId('explore-saved-menu-toggle')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-create-trip-fab')).toBeOnTheScreen();
  });
});

describe('AC-5(화면 절반) · ＋ press → onPressCreateTrip · ♥ press → onToggle', () => {
  it('＋ 를 누르면 onPressCreateTrip 이 오고, 저장 토글은 안 온다', () => {
    const onPressCreateTrip = jest.fn();
    const onToggle = jest.fn();
    render(
      <ExploreLandingScreen
        {...baseProps({ savedMenu: withSavedMenuToggle(onToggle) })}
        onPressCreateTrip={onPressCreateTrip}
      />
    );

    fireEvent.press(screen.getByTestId('explore-create-trip-fab'));

    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('♥ 를 누르면 saved-menu onToggle 이 오고, ＋ 콜백은 안 온다(FAB 분리)', () => {
    const onPressCreateTrip = jest.fn();
    const onToggle = jest.fn();
    render(
      <ExploreLandingScreen
        {...baseProps({ savedMenu: withSavedMenuToggle(onToggle) })}
        onPressCreateTrip={onPressCreateTrip}
      />
    );

    fireEvent.press(screen.getByTestId('explore-saved-menu-toggle'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPressCreateTrip).not.toHaveBeenCalled();
  });

  it('onPressCreateTrip 미지정이어도 ＋ press 가 throw 하지 않는다(옵셔널 가드)', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    expect(() =>
      fireEvent.press(screen.getByTestId('explore-create-trip-fab'))
    ).not.toThrow();
  });
});

describe('AC-6 · 여행자 일정 레인 제거', () => {
  it('여행자 일정 레인 testID·"여행자 일정" 제목·"준비 중" 자리가 모두 없다', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    expect(screen.queryByTestId('explore-lane-itin')).toBeNull();
    expect(screen.queryByText('여행자 일정')).toBeNull();
    expect(screen.queryByText(/준비\s*중/)).toBeNull();
  });
});
