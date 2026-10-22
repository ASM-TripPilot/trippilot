import { StyleSheet } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { coverFor } from '@/test-support/placeCoverFixtures';

import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
  type PlaceCardVM,
  type StayCardVM,
} from './ExploreLandingScreen';
import {
  FAB_STACK_TOP,
  getToastBottoms,
  resetToastBottoms,
} from '@/shared/ui/toastBottom';

/**
 * d01 탐색 랜딩(순수 화면) 단위 테스트 — 옛 `.parity`·`.regionFilter`·`.placeSave`·`.loading`·
 * `.cardPress`·`.placePhoto`·`.placeCardWidth` 7파일을 관점별 describe 로 합쳤다(TRIP-1355, D6).
 * 맨 위 `baseProps` 한 벌이 7파일에 복사돼 있던 props 조립을 대신한다.
 *
 * 무엇을 보장하나: 화면은 props-only 순수 컴포넌트다(그것을 강제하던 `placeExploreStructure`
 * 재귀 스캔은 TRIP-1145 로 지웠다). 그래서 목 없이 `render(<ExploreLandingScreen {...props} />)` 로 표면을
 * 직접 잰다. 라우터 실배선(`/trips/new/step1`)·검색바 그림자·FAB 픽셀 위치는 이 층 사정거리 밖이다
 * (각각 `tabsExploreRoute.test.tsx` 라우트 테스트 · 6-b 육안).
 *
 * *(개념)* NativeWind `className` 은 jest 렌더 트리에 **평문 문자열 prop** 으로 남는다
 * (`toHaveStyle` 은 style 이 undefined 라 못 쓴다) — `props.className` 을 공백으로 쪼갠 토큰
 * 배열에 `toContain` 한다(원소 완전일치). `getByText(문자열)` 은 기본이 **완전일치**라 "장소" 가
 * "가볼 만한 장소 둘러보기" 에 안 걸린다. 부재 단언은 `queryByTestId`(없으면 null), 존재 단언은
 * `getByTestId`(없으면 throw). Arrange(props) → Act(render/press) → Assert(트리·콜백).
 */

type StayLane = NonNullable<ExploreLandingScreenProps['stayLane']>;
type PlaceLane = NonNullable<ExploreLandingScreenProps['placeLane']>;
type SavedMenu = ExploreLandingScreenProps['savedMenu'];

const STAY_CARD: StayCardVM = {
  key: 'NAVER:s1',
  name: '해운대 그랜드 호텔',
  region: '해운대',
  priceText: '145,000원~',
};
const PLACE_CARD: PlaceCardVM = {
  poiId: 'p1',
  name: '감천문화마을',
  region: '사하구',
  imageUrl: null,
};
const PLACE_CARD_B: PlaceCardVM = {
  poiId: 'p2',
  name: '광안리 해변',
  region: '수영구',
  imageUrl: null,
};

function stayLane(over: Partial<StayLane> = {}): StayLane {
  return {
    error: false,
    cards: [],
    onRetry: jest.fn(),
    onSeeAll: jest.fn(),
    ...over,
  };
}
function placeLane(over: Partial<PlaceLane> = {}): PlaceLane {
  return {
    error: false,
    cards: [PLACE_CARD],
    onRetry: jest.fn(),
    onPressCard: jest.fn(),
    ...over,
  };
}
function savedMenu(over: Partial<SavedMenu> = {}): SavedMenu {
  return {
    open: false,
    savedCount: 0,
    onToggle: jest.fn(),
    onPressSavedPlaces: jest.fn(),
    onPressSavedStays: jest.fn(),
    ...over,
  };
}
function baseProps(
  over: Partial<ExploreLandingScreenProps> = {}
): ExploreLandingScreenProps {
  return {
    heading: {
      title: '무엇을 둘러볼까요?',
      subtitle: '숙소·장소를 둘러보고 담아요',
    },
    onPressSearch: jest.fn(),
    onPressPlaces: jest.fn(),
    stayLane: stayLane(),
    placeLane: placeLane(),
    savedMenu: savedMenu(),
    ...over,
  };
}

/** className 토큰 배열(공백 분리) — 원소 완전일치로 라운드/높이/폭을 잰다. */
function classTokens(node: { props: { className?: unknown } }): string[] {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}
function tokensOf(testID: string): string[] {
  return classTokens(screen.getByTestId(testID));
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

// FAB 묶음 루트 View 에는 testID 가 없다. FAB 에서 조상으로 올라가 처음 만나는 `absolute` 노드가
// 묶음 루트다(02a ★1) — 두 FAB 이 같은 노드에 닿는지로 "묶음" 임을 짝 확인한다.
function fabBundleRoot(fabTestId: string) {
  let node = screen.getByTestId(fabTestId).parent;
  while (node) {
    if (classTokens(node).includes('absolute')) return node;
    node = node.parent;
  }
  throw new Error(`${fabTestId} 위에 absolute 조상이 없다`);
}

// ---------------------------------------------------------------------------
// TRIP-703 — d01 default 정합(프레젠테이션)
// ---------------------------------------------------------------------------
describe('TRIP-703 · d01 default 정합', () => {
  it('AC-1 · 레인 헤더가 "장소" 이고 "가볼 곳" 은 어디에도 없다(testID 규약 유지)', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    const lane = screen.getByTestId('explore-lane-place');
    expect(within(lane).getByText('장소')).toBeOnTheScreen();
    expect(screen.queryByText('가볼 곳')).toBeNull();
    // 레인·"모두 보기" CTA testID 는 불변(계약 보존).
    expect(screen.getByTestId('explore-lane-place-cta')).toBeOnTheScreen();
  });

  it('AC-3 · 검색창은 rounded-pill·h-[58px] 이고, radius 12(rounded-input)·h-[52px] 는 없다', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    const tokens = tokensOf('explore-landing-search');
    // 2026-09-20 사용자가 Figma 검색바를 radius 12 → 999(pill)로 되돌림(1672:1188 실측).
    // 높이는 58 유지(radius 만 변경).
    expect(tokens).toContain('rounded-pill');
    expect(tokens).toContain('h-[58px]');
    expect(tokens).not.toContain('rounded-input');
    expect(tokens).not.toContain('h-[52px]');
  });

  it('AC-4 · 저장 하트(explore-saved-menu-toggle)와 여행 만들기(explore-create-trip-fab) 두 FAB 이 있다', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    expect(screen.getByTestId('explore-saved-menu-toggle')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-create-trip-fab')).toBeOnTheScreen();
  });

  it('AC-5 · ＋ 를 누르면 onPressCreateTrip 이 오고, 저장 토글은 안 온다', () => {
    const onPressCreateTrip = jest.fn();
    const onToggle = jest.fn();
    render(
      <ExploreLandingScreen
        {...baseProps({ savedMenu: savedMenu({ onToggle }) })}
        onPressCreateTrip={onPressCreateTrip}
      />
    );

    fireEvent.press(screen.getByTestId('explore-create-trip-fab'));

    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('AC-5 · ♥ 를 누르면 saved-menu onToggle 이 오고, ＋ 콜백은 안 온다(FAB 분리)', () => {
    const onPressCreateTrip = jest.fn();
    const onToggle = jest.fn();
    render(
      <ExploreLandingScreen
        {...baseProps({ savedMenu: savedMenu({ onToggle }) })}
        onPressCreateTrip={onPressCreateTrip}
      />
    );

    fireEvent.press(screen.getByTestId('explore-saved-menu-toggle'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPressCreateTrip).not.toHaveBeenCalled();
  });

  it('AC-5 · onPressCreateTrip 미지정이어도 ＋ press 가 throw 하지 않는다(옵셔널 가드)', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    expect(() =>
      fireEvent.press(screen.getByTestId('explore-create-trip-fab'))
    ).not.toThrow();
  });
});

// TRIP-1019 #024(결정 1) — 닫힌 하트 토글의 음성 라벨이 세는 것은 **담은 장소 수**뿐이다
// (`savedCount` = 라우트의 `savedPoiIds.length`, 저장 숙소는 안 센다). 그래서 "담은 곳 N곳" 은
// 숙소만 저장한 사용자에게 "0곳" 이라는 거짓을 말한다 — 라벨을 "담은 장소 N곳" 으로 좁힌다.
// 라벨은 음성(접근성) 전용이라 Figma 로 판정할 것이 없다(브리프 §5).
// ★ `toHaveAccessibleName(문자열)` 은 **완전일치**다(RNTL 13.3.3 `matches.js` exact 기본 true,
//   node_modules 실검증) — "담은 장소 2곳 더보기" 같은 군더더기도 red.
describe('TRIP-1019 #024 · 닫힌 하트 토글 라벨 "담은 장소 N곳"', () => {
  function renderWithSavedMenu(open: boolean, savedCount: number) {
    render(
      <ExploreLandingScreen
        {...baseProps({ savedMenu: savedMenu({ open, savedCount }) })}
      />
    );
  }

  it('담은 장소 2개면 토글의 접근성 이름이 "담은 장소 2곳" 이고, "담은 곳 N곳" 라벨은 어디에도 없다', () => {
    renderWithSavedMenu(false, 2);

    const toggle = screen.getByTestId('explore-saved-menu-toggle');
    expect(toggle).toHaveAccessibleName('담은 장소 2곳');
    // 긍정 앵커는 바로 위 토글 — 옛 문구가 다른 요소로 새지 않았는지 화면 전체를 본다.
    expect(screen.queryAllByLabelText(/담은 곳 \d+곳/)).toHaveLength(0);
  });

  it('담은 장소 0개(숙소만 저장한 사용자 포함)면 "담은 장소 0곳" 이다 — "담은 곳 0곳" 이 아니다', () => {
    renderWithSavedMenu(false, 0);

    const toggle = screen.getByTestId('explore-saved-menu-toggle');
    expect(toggle).toHaveAccessibleName('담은 장소 0곳');
    expect(screen.queryAllByLabelText('담은 곳 0곳')).toHaveLength(0);
  });

  it('열린 상태 라벨 "담은 곳 메뉴 닫기" 와 미니 FAB "담은 장소 N곳" 은 그대로다 (01b Q5 유지)', () => {
    renderWithSavedMenu(true, 2);

    // 열린 메뉴는 장소·숙소를 둘 다 담으므로 "담은 곳" 이 맞다(Q5) — 바꾸지 않는다.
    expect(
      screen.getByTestId('explore-saved-menu-toggle')
    ).toHaveAccessibleName('담은 곳 메뉴 닫기');
    expect(screen.getByTestId('explore-saved-places-fab')).toHaveAccessibleName(
      '담은 장소 2곳'
    );
    expect(screen.getByTestId('explore-saved-stays-fab')).toHaveAccessibleName(
      '저장한 숙소'
    );
  });
});

describe('TRIP-1103 AC-1 · d01 FAB 묶음 바닥 오프셋 84 (Figma d01 fabCollapsed 바닥 84)', () => {
  it('♥·＋ FAB 묶음 루트가 bottom-[84px] 이고 bottom-[100px] 은 없다', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    const root = fabBundleRoot('explore-create-trip-fab');
    // 앵커 — 하트 토글도 같은 묶음 루트에 닿는다(엉뚱한 absolute 노드가 아니다).
    expect(fabBundleRoot('explore-saved-menu-toggle')).toBe(root);
    expect(classTokens(root)).toContain('bottom-[84px]');
    expect(classTokens(root)).not.toContain('bottom-[100px]');
  });
});

// ---------------------------------------------------------------------------
// TRIP-1105 — 새 옵셔널 prop `regionFilter` 계약
//  - 없으면 지금 d01 그대로(칩 없음 · 검색 placeholder · 레인 제목 `숙소`/`장소`).
//  - 있으면 검색바 **안에** 지역 칩, 칩 **안에** ✕. placeholder 대신 칩과 `›`, 레인 제목이 `{지역} 숙소`·`{지역} 장소`.
//  - ✕ 는 해제 콜백만, 칩 밖 검색바는 검색 진입 콜백만(중첩 Pressable — 02a ★8). ✕ 는 hitSlop ≥ 12.
//  - QA #7 — 숙소 카드와 장소 카드 폭이 같은 160(필터 유무 무관). 로딩 스켈레톤도 160.
// ---------------------------------------------------------------------------
describe('TRIP-1105 · regionFilter', () => {
  const withStay = { stayLane: stayLane({ cards: [STAY_CARD] }) };

  it('RF1 · 필터 없음 — 칩이 없고, 검색 placeholder 와 레인 제목 "숙소"·"장소" 가 보인다(무회귀 앵커)', () => {
    render(<ExploreLandingScreen {...baseProps(withStay)} />);

    expect(screen.queryByTestId('explore-region-chip') === null).toBe(true);
    expect(screen.getByText('도시 검색')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('explore-lane-stay')).getByText('숙소')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('explore-lane-place')).getByText('장소')
    ).toBeOnTheScreen();
  });

  it('RF2 · 필터 있음 — 칩에 지역 이름, ✕ 는 칩 안, placeholder 대신 › 가 있고, 레인 제목에 지역이 붙는다', () => {
    render(
      <ExploreLandingScreen
        {...baseProps({
          ...withStay,
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
    expect(screen.queryByText('도시 검색') === null).toBe(true);

    expect(screen.getByText('부산광역시 숙소')).toBeOnTheScreen();
    expect(screen.getByText('부산광역시 장소')).toBeOnTheScreen();
  });

  it('RF3 · ✕ press → onClear 1 · onPressSearch 0, 검색바 press → onPressSearch 1 · onClear 0', () => {
    const onClear = jest.fn();
    const onPressSearch = jest.fn();
    render(
      <ExploreLandingScreen
        {...baseProps({
          ...withStay,
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

  it('RF4 · ✕ 는 버튼 역할이고 hitSlop 네 변이 모두 12 이상이다(시각 20 + hitSlop 12 = 히트 44)', () => {
    render(
      <ExploreLandingScreen
        {...baseProps({
          ...withStay,
          regionFilter: { label: '부산광역시', onClear: jest.fn() },
        })}
      />
    );

    const clear = screen.getByTestId('explore-region-chip-clear');
    expect(clear.props.accessibilityRole).toBe('button');
    expect(minHitSlop(clear.props.hitSlop) >= 12).toBe(true);
  });

  it.each([
    ['필터 없음', undefined],
    ['필터 있음', { label: '부산광역시', onClear: () => {} }],
  ] as const)(
    'RF5 · %s — 숙소·장소 카드 루트가 모두 w-[160px] 이고 숙소 카드에 w-[200px] 은 없다',
    (_, regionFilter) => {
      render(
        <ExploreLandingScreen {...baseProps({ ...withStay, regionFilter })} />
      );

      const stay = tokensOf(`explore-stay-card-${STAY_CARD.key}`);
      const place = tokensOf(`explore-place-card-${PLACE_CARD.poiId}`);
      expect(stay).toContain('w-[160px]');
      expect(stay).not.toContain('w-[200px]');
      expect(place).toContain('w-[160px]');
    }
  );

  it('RF6 · 로딩 스켈레톤도 카드와 같은 폭 160 이다(숙소·장소 첫 칸)', () => {
    render(
      <ExploreLandingScreen {...baseProps({ ...withStay, isLoading: true })} />
    );

    expect(screen.getByTestId('explore-landing-skeleton-stay-0')).toHaveStyle({
      width: 160,
    });
    expect(screen.getByTestId('explore-landing-skeleton-place-0')).toHaveStyle({
      width: 160,
    });
  });
});

// ---------------------------------------------------------------------------
// TRIP-1049 · 장소 가로 레인 카드 저장 하트 (Figma 4664:2585) — d05 목적지 결과(`DestinationDetailScreen.test.tsx`
// TRIP-1049 절)와 같은 계약을 d01 레인에 건다(접두만 `explore-place-*`).
//  - 저장 배선(onToggleSave)이 없으면 하트가 없다(AC-8). 담김/안 담김 = 서로 다른 글리프 testID + `selected`(색 X).
//  - 하트 press → onToggleSave(poiId), 카드 이동 0(AC-4). 대기 중엔 둘 다 0(02a ★2).
//  - 실패 문구 배너(AC-7 표시면), 로딩 얼굴에선 배너를 그리지 않는다(숙소 배너 선례).
// ---------------------------------------------------------------------------
describe('TRIP-1049 · d01 장소 레인 저장 하트', () => {
  /** 저장 필드를 갖춘 장소 레인(카드 A·B). */
  function savingLane(over: Partial<PlaceLane> = {}) {
    return baseProps({
      placeLane: placeLane({
        cards: [PLACE_CARD, PLACE_CARD_B],
        savedPoiIds: [],
        pendingPoiIds: [],
        onToggleSave: jest.fn(),
        saveErrorMessage: null,
        onDismissSaveError: jest.fn(),
        ...over,
      }),
    });
  }
  const A = PLACE_CARD;
  const B = PLACE_CARD_B;

  it('S-1 · 저장 배선이 없으면 하트가 없고 카드는 그대로다(무회귀)', () => {
    render(
      <ExploreLandingScreen
        {...savingLane({
          savedPoiIds: undefined,
          pendingPoiIds: undefined,
          onToggleSave: undefined,
          saveErrorMessage: undefined,
          onDismissSaveError: undefined,
        })}
      />
    );

    expect(screen.queryByTestId(`explore-place-save-${A.poiId}`)).toBeNull();
    expect(
      screen.getByTestId(`explore-place-card-${A.poiId}`)
    ).toBeOnTheScreen();
  });

  it('S-2 · 담긴 장소는 찬 하트+선택됨, 안 담긴 장소는 빈 하트+선택 아님', () => {
    render(
      <ExploreLandingScreen {...savingLane({ savedPoiIds: [A.poiId] })} />
    );

    expect(
      screen.getByTestId(`explore-place-heart-filled-${A.poiId}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`explore-place-heart-outline-${A.poiId}`)
    ).toBeNull();
    expect(screen.getByTestId(`explore-place-save-${A.poiId}`)).toBeSelected();

    expect(
      screen.getByTestId(`explore-place-heart-outline-${B.poiId}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`explore-place-save-${B.poiId}`)
    ).not.toBeSelected();
  });

  it('S-3 · 하트 press → onToggleSave(poiId) 1회, 카드 이동은 0회', () => {
    const onToggleSave = jest.fn();
    const onPressCard = jest.fn();
    render(
      <ExploreLandingScreen {...savingLane({ onToggleSave, onPressCard })} />
    );

    fireEvent.press(screen.getByTestId(`explore-place-save-${B.poiId}`));

    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onToggleSave).toHaveBeenCalledWith(B.poiId);
    expect(onPressCard).not.toHaveBeenCalled();
  });

  it('S-4 · 대기 중 하트는 disabled 이고, 눌러도 담기·카드 이동 모두 0회다', () => {
    const onToggleSave = jest.fn();
    const onPressCard = jest.fn();
    render(
      <ExploreLandingScreen
        {...savingLane({
          pendingPoiIds: [A.poiId],
          onToggleSave,
          onPressCard,
        })}
      />
    );
    const heart = screen.getByTestId(`explore-place-save-${A.poiId}`);

    expect(heart).toBeDisabled();
    fireEvent.press(heart);

    expect(onToggleSave).not.toHaveBeenCalled();
    expect(onPressCard).not.toHaveBeenCalled();
    // 짝 — 옆 카드 하트는 살아 있다.
    expect(
      screen.getByTestId(`explore-place-save-${B.poiId}`)
    ).not.toBeDisabled();
  });

  it('S-5 · 실패 문구 배너가 문구 그대로 보이고, 누르면 닫기 콜백 · 문구 없으면 배너 없음', () => {
    const onDismissSaveError = jest.fn();
    const message = '지금은 담을 수 없는 장소예요';
    const { rerender } = render(<ExploreLandingScreen {...savingLane()} />);
    expect(screen.queryByTestId('explore-place-save-error')).toBeNull();

    rerender(
      <ExploreLandingScreen
        {...savingLane({ saveErrorMessage: message, onDismissSaveError })}
      />
    );
    const banner = screen.getByTestId('explore-place-save-error');

    expect(within(banner).getByText(message)).toBeOnTheScreen();
    fireEvent.press(banner);
    expect(onDismissSaveError).toHaveBeenCalledTimes(1);
  });

  it('S-6 · 로딩 얼굴(isLoading)에서는 실패 배너를 그리지 않는다', () => {
    render(
      <ExploreLandingScreen
        {...{
          ...savingLane({ saveErrorMessage: '연결이 불안정해 담지 못했어요' }),
          isLoading: true,
        }}
      />
    );

    expect(screen.queryByTestId('explore-place-save-error')).toBeNull();
    // 앵커 — 정말 로딩 얼굴이다.
    expect(
      screen.getByTestId('explore-landing-skeleton-place-0')
    ).toBeOnTheScreen();
  });
});

// ---------------------------------------------------------------------------
// TRIP-704 — loading 얼굴(Figma 3612:2006). `isLoading`(옵셔널, 기본 false)이 켜지면 숙소 2·장소 3 스켈레톤만
// 그리고 실카드/폴백·FAB 은 안 그리며, 헤딩·검색창·섹션 제목은 실텍스트를 유지한다. L5 가 미지정 무회귀 앵커.
// ---------------------------------------------------------------------------
describe('TRIP-704 · loading 얼굴', () => {
  const loadingProps = (over: Partial<ExploreLandingScreenProps> = {}) =>
    baseProps({
      stayLane: stayLane({ cards: [STAY_CARD] }),
      onPressCreateTrip: jest.fn(),
      ...over,
    });

  it('L1 · isLoading 이면 숙소 2·장소 3 스켈레톤 박스를 정확히 그린다', () => {
    render(<ExploreLandingScreen {...loadingProps({ isLoading: true })} />);

    expect(screen.getByTestId('explore-landing-skeleton-stay-0')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-skeleton-stay-1')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-skeleton-place-0')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-skeleton-place-1')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-skeleton-place-2')).toBeTruthy();
    // 넘치지 않는다 — 숙소 2번째·장소 4번째 없음
    expect(screen.queryByTestId('explore-landing-skeleton-stay-2')).toBeNull();
    expect(screen.queryByTestId('explore-landing-skeleton-place-3')).toBeNull();
  });

  it('L2 · isLoading 이면 ♥·＋ FAB 둘 다 없다', () => {
    render(<ExploreLandingScreen {...loadingProps({ isLoading: true })} />);

    expect(screen.queryByTestId('explore-saved-menu-toggle')).toBeNull();
    expect(screen.queryByTestId('explore-create-trip-fab')).toBeNull();
  });

  it('L3 · isLoading 이면 장소 폴백(explore-lane-place-empty) 대신 스켈레톤이 뜬다', () => {
    // placeLane 미지정(빈 목록)이어도 로딩 중엔 폴백 대신 스켈레톤
    render(
      <ExploreLandingScreen
        {...loadingProps({ isLoading: true, placeLane: undefined })}
      />
    );

    expect(screen.queryByTestId('explore-lane-place-empty')).toBeNull();
    expect(screen.getByTestId('explore-landing-skeleton-place-0')).toBeTruthy();
  });

  it('L4 · 헤딩·검색창·"숙소"/"장소" 제목은 로딩 중에도 그대로다', () => {
    render(<ExploreLandingScreen {...loadingProps({ isLoading: true })} />);

    expect(screen.getByTestId('explore-landing-heading')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-search')).toBeTruthy();
    expect(screen.getByText('숙소')).toBeTruthy();
    expect(screen.getByText('장소')).toBeTruthy();
  });

  it('L5 · isLoading 을 안 주면 스켈레톤은 없고 FAB 는 있다(기본 얼굴)', () => {
    render(<ExploreLandingScreen {...loadingProps()} />);

    expect(screen.queryByTestId('explore-landing-skeleton-stay-0')).toBeNull();
    expect(screen.queryByTestId('explore-landing-skeleton-place-0')).toBeNull();
    expect(screen.getByTestId('explore-saved-menu-toggle')).toBeTruthy();
    expect(screen.getByTestId('explore-create-trip-fab')).toBeTruthy();
  });

  // 코드-비평 경고-2 봉합: 숙소 대기+장소 실패처럼 로딩·에러가 겹치는 실도달 상태에서
  // isLoading 분기가 에러 블록보다 먼저 타는지 잠근다. 삼항을 재배열하면 이 단언이 red.
  it('L6 · isLoading 이면 stay/place 에러여도 에러 블록이 아니라 스켈레톤을 그린다', () => {
    render(
      <ExploreLandingScreen
        {...loadingProps({
          isLoading: true,
          stayLane: stayLane({ error: true }),
          placeLane: placeLane({ error: true, cards: [] }),
        })}
      />
    );

    // 스켈레톤이 이긴다.
    expect(screen.getByTestId('explore-landing-skeleton-stay-0')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-skeleton-place-0')).toBeTruthy();
    // 에러 재시도 블록은 안 샌다.
    expect(screen.queryByTestId('explore-lane-stay-retry')).toBeNull();
    expect(screen.queryByTestId('explore-lane-place-retry')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TRIP-457 AC-6(화면 절반) · AC-7 — 숙소 카드 탭 → `stayLane.onPressCard?(card)` + press 분리.
// 배선(어느 라우트로 push)은 라우트(`(tabs)/explore.tsx`)가 진다 — 화면은 `@/features/stay` import 금지·순수 뷰.
// `StayCardVM` 은 `{key,name,region,priceText}` — 카드 press 는 이 VM 을 그대로 올린다.
// ---------------------------------------------------------------------------
describe('TRIP-457 · 숙소 카드 press 분리', () => {
  const stayProps = (over: Partial<StayLane> = {}) =>
    baseProps({ stayLane: stayLane({ cards: [STAY_CARD], ...over }) });

  it('E1 · 카드 루트 press → onPressCard(card), 저장 콜백은 안 온다', () => {
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    render(
      <ExploreLandingScreen {...stayProps({ onPressCard, onToggleSave })} />
    );

    fireEvent.press(screen.getByTestId(`explore-stay-card-${STAY_CARD.key}`));

    expect(onPressCard).toHaveBeenCalledWith(STAY_CARD);
    expect(onToggleSave).not.toHaveBeenCalled();
  });

  it('E2 · 하트 press → onToggleSave(card), onPressCard 는 안 온다', () => {
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    render(
      <ExploreLandingScreen {...stayProps({ onPressCard, onToggleSave })} />
    );

    fireEvent.press(screen.getByTestId(`explore-stay-save-${STAY_CARD.key}`));

    expect(onToggleSave).toHaveBeenCalledWith(STAY_CARD);
    expect(onPressCard).not.toHaveBeenCalled();
  });

  it('E3 · onPressCard 를 안 주면 카드 press 가 throw 하지 않는다', () => {
    render(<ExploreLandingScreen {...stayProps()} />);

    expect(() =>
      fireEvent.press(screen.getByTestId(`explore-stay-card-${STAY_CARD.key}`))
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TRIP-496 — 장소 레인 카드가 `imageUrl` 이 있을 때 그 사진(<Image>)을 그린다. 없으면(사이클
// 20261022-place-category-covers) 카드의 카테고리·poiId 로 고른 카테고리 생성 이미지가 같은 칸
// `explore-place-card-image-{poiId}` 를 채운다(회색 자리·INV-1 서술은 폐기).
// ---------------------------------------------------------------------------
describe('TRIP-496 · 장소 레인 카드 사진', () => {
  it('imageUrl 이 있으면 사진 <Image> 를 그린다', () => {
    render(
      <ExploreLandingScreen
        {...baseProps({
          placeLane: placeLane({
            cards: [
              {
                poiId: 'p1',
                name: '감천문화마을',
                region: '사하구',
                imageUrl: 'https://cdn.example.com/p1.jpg',
              },
            ],
          }),
        })}
      />
    );

    const image = screen.getByTestId('explore-place-card-image-p1');
    expect(image).toBeOnTheScreen();
    expect(image.props.source).toEqual([
      { uri: 'https://cdn.example.com/p1.jpg' },
    ]);
  });

  it('imageUrl 이 없으면 카드의 카테고리(술집)·poiId(p2)로 고른 생성 이미지가 같은 칸을 채운다', () => {
    render(
      <ExploreLandingScreen
        {...baseProps({
          placeLane: placeLane({
            cards: [{ ...PLACE_CARD_B, category: '술집' }],
          }),
        })}
      />
    );

    // 카드 자체는 뜨고(공허 통과 방지) 사진 칸은 비지 않는다. p2 는 변형 3 → bar-3.
    expect(screen.getByTestId('explore-place-card-p2')).toBeOnTheScreen();
    expect(
      screen.getByTestId('explore-place-card-image-p2').props.source
    ).toEqual([coverFor('술집', 'p2')]);
  });
});

// ---------------------------------------------------------------------------
// TRIP-1048 · AC-8 — d05 목적지 검색 결과가 같은 `PlaceRailCard` 를 2열 격자용 `variant="fill"` 로 쓰게 되면서,
// d01 은 가로 레인 그대로(160 고정폭)여야 한다. 다른 d01 테스트는 카드 폭을 보지 않아서 d01 에 fill 을 잘못 넘겨도
// 전부 green 이다 — 이 it 이 그 회귀를 잡는다.
// ---------------------------------------------------------------------------
describe('TRIP-1048 · 장소 레인 카드 폭', () => {
  it('W1 · 레인 카드는 모두 w-[160px] 이고 w-full 이 아니다', () => {
    render(
      <ExploreLandingScreen
        {...baseProps({
          placeLane: placeLane({
            cards: [
              PLACE_CARD,
              {
                poiId: 'p2',
                name: '자갈치 시장',
                region: '중구',
                imageUrl: null,
              },
            ],
          }),
        })}
      />
    );

    const cards = screen.getAllByTestId(/^explore-place-card-(?!image-)/);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const tokens = classTokens(card);
      expect(tokens).toContain('w-[160px]');
      expect(tokens).not.toContain('w-full');
    }
  });
});

// 토스트 바닥 레지스트리는 모듈 싱글턴이다 — 파일 최상위(describe 밖)에서 리셋해야 앞 테스트의 신고가 안 샌다(TRIP-1559).
afterEach(() => resetToastBottoms());

describe('TRIP-1559 · d01 토스트 바닥 신고: FAB 2단 스택 (이음새 ③)', () => {
  it('FAB 스택이 있는 탐색 랜딩은 그 윗변(FAB_STACK_TOP)을 신고하고 unmount 로 해제한다', () => {
    expect(getToastBottoms()).toEqual([]);

    const view = render(<ExploreLandingScreen {...baseProps()} />);

    expect(getToastBottoms()).toContain(FAB_STACK_TOP);

    view.unmount();
    expect(getToastBottoms()).toEqual([]);
  });
});

// TRIP-1555 — 세로 스크롤하는 동안 FAB 숨김(홈 TRIP-1435 Q-023 결정 1=A 를 탐색 랜딩에도).
// 훅 자체(디바운스·keepVisible 파생·정리)는 `useScrollHide.test.ts` 가 맡는다 — 여기는 "이 화면이 훅을 바깥
// 세로 ScrollView 와 FAB 래퍼에 제대로 이었는가"만 본다. 가로 레인 비영향은 jest 로 못 잰다(`fireEvent.scroll`
// 이 조상 onScroll 로 올라간다) → 6-b. pointerEvents·opacity 는 보이는 모양이 아니라 터치 통과 계약 + 숨김 자체(02a ★5).
describe('스크롤하는 동안 FAB 숨김', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // pointerEvents 와 opacity 가 같은 편을 들 때만 'hidden'/'shown' — 어긋나면 'mixed'(유령 FAB·터치 삼킴).
  function fabVisibility(testID: string): 'hidden' | 'shown' | 'mixed' {
    const { pointerEvents, style } = screen.getByTestId(testID).props;
    const opacity = StyleSheet.flatten(style)?.opacity ?? 1;
    if (pointerEvents === 'none' && opacity === 0) return 'hidden';
    if (pointerEvents !== 'none' && opacity === 1) return 'shown';
    return 'mixed';
  }
  const scrollDown = () =>
    fireEvent.scroll(screen.getByTestId('explore-landing-scroll'), {
      nativeEvent: { contentOffset: { y: 120 } },
    });

  it('FAB 묶음은 바깥 세로 스크롤 안에서 ♥·＋ 를 모두 감싸고, 처음엔 보인다(앵커)', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    const stack = screen.getByTestId('explore-fab-stack');
    expect(within(stack).getByTestId('explore-saved-menu-toggle')).toBeTruthy();
    expect(within(stack).getByTestId('explore-create-trip-fab')).toBeTruthy();
    // 세로 컨테이너(가로 레인이 아니라) 가 testID 를 가졌는지 — 레인이 그 안에 있다.
    expect(
      within(screen.getByTestId('explore-landing-scroll')).getByTestId(
        'explore-lane-place'
      )
    ).toBeTruthy();
    expect(fabVisibility('explore-fab-stack')).toBe('shown');
  });

  it('스크롤하면 숨고 터치를 막지 않으며, 멈춘 지 250ms 뒤에 다시 보인다', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    scrollDown();
    expect(fabVisibility('explore-fab-stack')).toBe('hidden');

    act(() => jest.advanceTimersByTime(249));
    expect(fabVisibility('explore-fab-stack')).toBe('hidden');

    act(() => jest.advanceTimersByTime(1));
    expect(fabVisibility('explore-fab-stack')).toBe('shown');
  });

  it('담은 곳 메뉴가 열려 있으면 스크롤해도 숨기지 않는다', () => {
    render(
      <ExploreLandingScreen
        {...baseProps({ savedMenu: savedMenu({ open: true }) })}
      />
    );
    // 앵커 — 미니 FAB 둘이 실제로 펼쳐져 있다.
    expect(screen.getByTestId('explore-saved-places-fab')).toBeTruthy();
    expect(screen.getByTestId('explore-saved-stays-fab')).toBeTruthy();

    scrollDown();

    expect(fabVisibility('explore-fab-stack')).toBe('shown');
  });

  it('로딩 얼굴에는 FAB 묶음 자체가 없다(무회귀)', () => {
    render(<ExploreLandingScreen {...baseProps({ isLoading: true })} />);

    expect(screen.queryByTestId('explore-fab-stack') === null).toBe(true);
  });
});
