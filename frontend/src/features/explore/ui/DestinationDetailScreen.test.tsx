import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  DestinationDetailScreen,
  type DestinationDetailScreenProps,
} from './DestinationDetailScreen';
import type { PlaceCardVM, StayCardVM } from './ExploreLandingScreen';

/**
 * U1 소급 백필(20260824) · d03 목적지 상세 — 순수 프레젠테이션 회귀 심판.
 *
 * 무엇을 보장하나: 이 화면(`DestinationDetailScreen`)은 라우터를 모르는 순수 뷰다 — 커밋
 * 7cda1f5(발표용 domo, 사이클 없이 들어옴)로 397줄이 무심판으로 있었다. 여기서 잠그는 것은
 * "props로 받은 콜백이 올바른 요소 press에 연결돼 있고, 레인이 에러/빈/목록 세 얼굴을 옳게
 * 가른다"이다. 배선(어느 라우트로 push)은 페이지(`DestinationDetailPage`)가 지므로 이 파일의
 * 범위 밖이다(형제 `ExploreLandingScreen.cardPress.test.tsx`와 같은 자리).
 *
 * (개념) `StayCardVM`/`PlaceCardVM` 은 화면이 아는 최소 뷰모델 — 카드 press 는 이 VM(또는 poiId)을
 * 그대로 올리고, 원본 전체 데이터로의 역조회는 페이지가 한다.
 */

const STAY: StayCardVM = {
  key: 'NAVER:s1',
  name: '해운대 그랜드 호텔',
  region: '해운대',
  priceText: '145,000원~',
};

const PLACE: PlaceCardVM = {
  poiId: 'poi-1',
  name: '광안리 해수욕장',
  region: '수영구',
  imageUrl: null,
};

// 모든 콜백을 jest.fn 으로 채운 기본 props — 각 테스트는 관심 있는 콜백만 덮어쓴다.
function baseProps(
  overrides: Partial<DestinationDetailScreenProps> = {}
): DestinationDetailScreenProps {
  return {
    regionName: '부산',
    onPressSearch: jest.fn(),
    stayLane: {
      error: false,
      cards: [STAY],
      onRetry: jest.fn(),
      onSeeAll: jest.fn(),
      onPressCard: jest.fn(),
    },
    placeLane: {
      error: false,
      cards: [PLACE],
      onRetry: jest.fn(),
      onSeeAll: jest.fn(),
      onPressCard: jest.fn(),
    },
    onPressTab: jest.fn(),
    savedMenu: {
      open: false,
      savedCount: 0,
      onToggle: jest.fn(),
      onPressSavedPlaces: jest.fn(),
      onPressSavedStays: jest.fn(),
    },
    ...overrides,
  };
}

describe('D1 · 헤딩·검색바', () => {
  it('지역명으로 헤딩을 그리고, 검색바 press 는 onPressSearch 를 올린다', () => {
    const onPressSearch = jest.fn();
    render(<DestinationDetailScreen {...baseProps({ onPressSearch })} />);

    // Assert: 헤딩이 regionName 을 담아 렌더된다("'부산' 검색 결과"). 어포스트로피(&apos;)
    // 코드포인트에 안 걸리도록 정규식으로 "부산 … 검색 결과" 순서만 잠근다.
    expect(screen.getByTestId('destination-detail-heading')).toHaveTextContent(
      /부산.*검색 결과/
    );

    // Act + Assert: 검색바(입력 불가 진입 버튼)를 누르면 콜백이 인자 없이 올라간다.
    fireEvent.press(screen.getByTestId('destination-detail-search'));
    expect(onPressSearch).toHaveBeenCalledTimes(1);
  });
});

describe('D2 · 숙소 레인', () => {
  it('카드 press → onPressCard(card), 모두 보기 → onSeeAll', () => {
    const onPressCard = jest.fn();
    const onSeeAll = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          stayLane: {
            error: false,
            cards: [STAY],
            onRetry: jest.fn(),
            onSeeAll,
            onPressCard,
          },
        })}
      />
    );

    fireEvent.press(
      screen.getByTestId(`destination-detail-stay-card-${STAY.key}`)
    );
    expect(onPressCard).toHaveBeenCalledWith(STAY);

    fireEvent.press(screen.getByTestId('destination-detail-stay-seeall'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('error=true 면 카드 대신 재시도 블록을 그리고, 재시도 press → onRetry', () => {
    const onRetry = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          stayLane: {
            error: true,
            cards: [STAY],
            onRetry,
            onSeeAll: jest.fn(),
            onPressCard: jest.fn(),
          },
        })}
      />
    );

    // Assert: 에러 얼굴이면 카드는 안 뜨고 재시도 버튼만 뜬다.
    expect(
      screen.queryByTestId(`destination-detail-stay-card-${STAY.key}`)
    ).toBeNull();

    fireEvent.press(screen.getByTestId('destination-detail-stay-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('D3 · 장소 레인', () => {
  it('카드 press → onPressCard(poiId), 모두 보기 → onSeeAll', () => {
    const onPressCard = jest.fn();
    const onSeeAll = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          placeLane: {
            error: false,
            cards: [PLACE],
            onRetry: jest.fn(),
            onSeeAll,
            onPressCard,
          },
        })}
      />
    );

    fireEvent.press(
      screen.getByTestId(`destination-detail-place-card-${PLACE.poiId}`)
    );
    // 숙소와 달리 장소 카드는 poiId 문자열만 올린다(화면 계약 차이).
    expect(onPressCard).toHaveBeenCalledWith(PLACE.poiId);

    fireEvent.press(screen.getByTestId('destination-detail-place-seeall'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('cards 가 비면(0건) 빈 자리 프롬프트를 그리고 그 press 는 onSeeAll 로 간다', () => {
    const onSeeAll = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          placeLane: {
            error: false,
            cards: [],
            onRetry: jest.fn(),
            onSeeAll,
            onPressCard: jest.fn(),
          },
        })}
      />
    );

    // Assert: 카드 0건 → 카드가 아니라 "둘러보기" 빈 자리(별도 testID)가 뜬다.
    expect(
      screen.queryByTestId(`destination-detail-place-card-${PLACE.poiId}`)
    ).toBeNull();

    fireEvent.press(screen.getByTestId('destination-detail-place-empty'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('error=true 면 재시도 블록을 그리고 재시도 press → onRetry', () => {
    const onRetry = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          placeLane: {
            error: true,
            cards: [PLACE],
            onRetry,
            onSeeAll: jest.fn(),
            onPressCard: jest.fn(),
          },
        })}
      />
    );

    fireEvent.press(screen.getByTestId('destination-detail-place-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('D4 · 하단 탭바(뒤로가기 대체)', () => {
  it('탭 press → onPressTab(key)', () => {
    const onPressTab = jest.fn();
    render(<DestinationDetailScreen {...baseProps({ onPressTab })} />);

    // BottomTabBar 는 탭 키를 testID `shell-tabbar-tab-{key}` 로 노출한다(공용 계약).
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));
    expect(onPressTab).toHaveBeenCalledWith('home');
  });
});

describe('D5 · 담은 곳 하트 FAB', () => {
  it('닫힘 상태: 토글 press → onToggle, 미니 FAB 은 안 보인다', () => {
    const onToggle = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          savedMenu: {
            open: false,
            savedCount: 3,
            onToggle,
            onPressSavedPlaces: jest.fn(),
            onPressSavedStays: jest.fn(),
          },
        })}
      />
    );

    expect(
      screen.queryByTestId('destination-detail-saved-places-fab')
    ).toBeNull();

    fireEvent.press(screen.getByTestId('destination-detail-saved-menu-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('열림 상태: 미니 FAB 2개가 뜨고 각 press 가 제 콜백으로 간다', () => {
    const onPressSavedPlaces = jest.fn();
    const onPressSavedStays = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          savedMenu: {
            open: true,
            savedCount: 3,
            onToggle: jest.fn(),
            onPressSavedPlaces,
            onPressSavedStays,
          },
        })}
      />
    );

    fireEvent.press(screen.getByTestId('destination-detail-saved-places-fab'));
    expect(onPressSavedPlaces).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('destination-detail-saved-stays-fab'));
    expect(onPressSavedStays).toHaveBeenCalledTimes(1);
  });
});

/**
 * ── TRIP-709 신규(d05 Figma 정합) — 게이트① 동결: 위 D1~D5 는 무수정, 아래만 추가한다.
 * 신규 prop 은 전부 옵셔널(stayLane 저장 5필드 · onPressCreateTrip)이라 baseProps 가 그대로
 * 유효하다. (TRIP-709 의 AC-1 부제·AC-3 세그 3탭·AC-4 세그 필터는 TRIP-1048 이 세그먼트를 없애며
 * 삭제했다 — 파일 끝 `TRIP-1048` describe 가 대체한다.)
 */

describe('AC-2 · 여행자 일정 레인 제거', () => {
  it('itin 레인 testID·"준비 중" 문구가 모두 사라진다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    expect(screen.queryByTestId('destination-detail-lane-itin')).toBeNull();
    expect(screen.queryByText(/여행자들의 일정을 준비/)).toBeNull();
  });
});

describe('AC-5 · 숙소 저장 하트', () => {
  // save 배선을 얹은 stayLane — baseProps().stayLane 을 펼쳐 저장 5필드만 덧댄다.
  function stayLaneWithSave(
    over: {
      savedKeys?: string[];
      onToggleSave?: (card: StayCardVM) => void;
      onPressCard?: (card: StayCardVM) => void;
    } = {}
  ) {
    return {
      error: false,
      cards: [STAY],
      onRetry: jest.fn(),
      onSeeAll: jest.fn(),
      onPressCard: over.onPressCard ?? jest.fn(),
      savedKeys: over.savedKeys ?? [],
      pendingKeys: [],
      onToggleSave: over.onToggleSave ?? jest.fn(),
      saveError: false,
    };
  }

  it('미담김: 빈 하트(outline) + not selected', () => {
    render(
      <DestinationDetailScreen
        {...baseProps({ stayLane: stayLaneWithSave({ savedKeys: [] }) })}
      />
    );

    expect(
      screen.getByTestId(`destination-detail-stay-heart-outline-${STAY.key}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`destination-detail-stay-save-${STAY.key}`)
    ).not.toBeSelected();
  });

  it('담김: 찬 하트(filled) + selected — 색이 아니라 서로 다른 글리프로 갈린다', () => {
    render(
      <DestinationDetailScreen
        {...baseProps({
          stayLane: stayLaneWithSave({ savedKeys: [STAY.key] }),
        })}
      />
    );

    expect(
      screen.getByTestId(`destination-detail-stay-heart-filled-${STAY.key}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`destination-detail-stay-save-${STAY.key}`)
    ).toBeSelected();
  });

  it('하트 press → onToggleSave(card) 1회, 카드 press(onPressCard)는 안 삼킨다(★F-4)', () => {
    const onToggleSave = jest.fn();
    const onPressCard = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          stayLane: stayLaneWithSave({ onToggleSave, onPressCard }),
        })}
      />
    );

    fireEvent.press(
      screen.getByTestId(`destination-detail-stay-save-${STAY.key}`)
    );

    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onToggleSave).toHaveBeenCalledWith(STAY);
    // 하트는 카드 Pressable 의 자식 Pressable — press 가 하트에서 멈춰 카드 push 를 안 부른다.
    expect(onPressCard).not.toHaveBeenCalled();
  });

  it('save 미전달(기존 baseProps)이면 하트가 없고 카드는 그대로다(무회귀)', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    // 저장 배선이 없으면 하트 자체가 안 그려진다(StaySearchCard save 미지정).
    expect(
      screen.queryByTestId(`destination-detail-stay-save-${STAY.key}`)
    ).toBeNull();
    // 카드는 여전히 렌더된다(D2 계약 무회귀).
    expect(
      screen.getByTestId(`destination-detail-stay-card-${STAY.key}`)
    ).toBeOnTheScreen();
  });
});

describe('AC-6 · 검색바 chevron', () => {
  it('진입 버튼에 › 트레일링 chevron 이 있다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    // 검색바 subtree 로 좁혀 레인 헤더·place-empty 의 다른 › 와 충돌을 피한다.
    expect(
      within(screen.getByTestId('destination-detail-search')).getByText('›')
    ).toBeOnTheScreen();
  });
});

describe('AC-7 · FAB 2단 (하트 + ＋)', () => {
  it('하트 saved-menu FAB 과 ＋ create-trip FAB 이 둘 다 뜬다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    expect(
      screen.getByTestId('destination-detail-saved-menu-toggle')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('destination-detail-create-trip-fab')
    ).toBeOnTheScreen();
  });

  it('＋ FAB press → onPressCreateTrip 1회', () => {
    const onPressCreateTrip = jest.fn();
    render(<DestinationDetailScreen {...baseProps({ onPressCreateTrip })} />);

    fireEvent.press(screen.getByTestId('destination-detail-create-trip-fab'));
    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
  });

  it('onPressCreateTrip 미지정이면 ＋ press 가 no-op 이다(무회귀)', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    // 미지정 렌더에서 눌러도 throw 하지 않는다(옵셔널 가드).
    expect(() =>
      fireEvent.press(screen.getByTestId('destination-detail-create-trip-fab'))
    ).not.toThrow();
  });
});

// TRIP-1019 #024(결정 1) — d03 하트 토글도 d01 과 같은 계약이다(`ExploreLandingScreen.parity`
// 의 같은 describe 참고). `savedCount` 는 담은 장소 수뿐이라 라벨을 "담은 장소 N곳" 으로 좁힌다.
// ★ `toHaveAccessibleName(문자열)` 은 완전일치(RNTL 13.3.3 실검증).
describe('🔴 TRIP-1019 #024 · 닫힌 하트 토글 라벨 "담은 장소 N곳"', () => {
  function savedMenu(open: boolean, savedCount: number) {
    return {
      open,
      savedCount,
      onToggle: jest.fn(),
      onPressSavedPlaces: jest.fn(),
      onPressSavedStays: jest.fn(),
    };
  }

  it('닫힘 · 담은 장소 3개 → "담은 장소 3곳", 옛 "담은 곳 N곳" 라벨은 없다', () => {
    render(
      <DestinationDetailScreen
        {...baseProps({ savedMenu: savedMenu(false, 3) })}
      />
    );

    expect(
      screen.getByTestId('destination-detail-saved-menu-toggle')
    ).toHaveAccessibleName('담은 장소 3곳');
    expect(screen.queryAllByLabelText(/담은 곳 \d+곳/)).toHaveLength(0);
  });

  it('닫힘 · 담은 장소 0개 → "담은 장소 0곳"', () => {
    render(
      <DestinationDetailScreen
        {...baseProps({ savedMenu: savedMenu(false, 0) })}
      />
    );

    expect(
      screen.getByTestId('destination-detail-saved-menu-toggle')
    ).toHaveAccessibleName('담은 장소 0곳');
    expect(screen.queryAllByLabelText('담은 곳 0곳')).toHaveLength(0);
  });

  it('열림 · 토글 "담은 곳 메뉴 닫기"·미니 FAB "담은 장소 N곳" 은 그대로다 (01b Q5 유지)', () => {
    render(
      <DestinationDetailScreen
        {...baseProps({ savedMenu: savedMenu(true, 3) })}
      />
    );

    expect(
      screen.getByTestId('destination-detail-saved-menu-toggle')
    ).toHaveAccessibleName('담은 곳 메뉴 닫기');
    expect(
      screen.getByTestId('destination-detail-saved-places-fab')
    ).toHaveAccessibleName('담은 장소 3곳');
  });
});

/**
 * ── TRIP-1048 (QA 2026-09-28 #009, Figma `4663:2540`) — 세그먼트 제거 · 부제 · 장소 2열 격자.
 *
 * 무엇을 보장하나: 전체/숙소/장소 세그먼트가 사라져 두 레인이 늘 함께 보이고, 부제에서 없는
 * "여행지"가 빠지고, 장소 레인이 가로 줄이 아니라 2열 격자(행 × 칸 2개)가 된다.
 *
 * (개념) jest 는 레이아웃을 계산하지 않는다 — "2열·같은 폭"은 픽셀로 못 잰다. 그래서 격자를
 * **행 testID · 칸 testID · 칸 className** 구조로 잰다: 모든 행에 칸이 2개이고, 모든 칸의
 * className 이 같고, 카드는 칸을 채운다(`w-full`). 실제 173pt·간격 12 는 스크린샷 대조 몫이다.
 * 장소 카드 하트는 TRIP-1049 몫이라 여기서 단언하지 않는다.
 */
describe('TRIP-1048 · 세그먼트 제거 · 부제 · 장소 2열 격자', () => {
  // 카드 루트만 센다 — 사진 leaf(`…-card-image-{poiId}`)가 같은 접두라 부정 전방탐색으로 뺀다.
  const CARD_ROOT = /^destination-detail-place-card-(?!image-)/;

  function places(n: number): PlaceCardVM[] {
    return Array.from({ length: n }, (_, i) => ({
      poiId: `p${i + 1}`,
      name: `장소 ${i + 1}`,
      region: '부산 중구',
      imageUrl: i % 2 === 0 ? `https://example.com/p${i + 1}.jpg` : null,
    }));
  }

  function placeLaneOf(
    cards: PlaceCardVM[],
    onPressCard: (poiId: string) => void = jest.fn()
  ): DestinationDetailScreenProps['placeLane'] {
    return {
      error: false,
      cards,
      onRetry: jest.fn(),
      onSeeAll: jest.fn(),
      onPressCard,
    };
  }

  // className 문자열 → 정렬된 토큰 배열. 순서만 다른 같은 className 을 같다고 보려고 정렬한다.
  function tokens(node: { props: { className?: string } }): string[] {
    return String(node.props.className ?? '')
      .trim()
      .split(/\s+/)
      .sort();
  }

  it('G1 · 세그먼트 탭(destination-detail-seg-*)이 하나도 없다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    expect(screen.queryAllByTestId(/^destination-detail-seg-/)).toHaveLength(0);
    // G11(여행자 일정 제거) 계약은 계속 산다 — 옛 세그 테스트에서 옮겨 온 단언.
    expect(screen.queryByText('여행자 일정')).toBeNull();
  });

  it('G2 · 숙소 레인과 장소 레인이 처음부터 함께 있고, 각 "모두 보기"가 제 콜백을 부른다', () => {
    const staySeeAll = jest.fn();
    const placeSeeAll = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          stayLane: {
            error: false,
            cards: [STAY],
            onRetry: jest.fn(),
            onSeeAll: staySeeAll,
            onPressCard: jest.fn(),
          },
          placeLane: {
            error: false,
            cards: [PLACE],
            onRetry: jest.fn(),
            onSeeAll: placeSeeAll,
            onPressCard: jest.fn(),
          },
        })}
      />
    );

    expect(
      screen.getByTestId('destination-detail-lane-stay')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('destination-detail-lane-place')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('destination-detail-stay-seeall'));
    expect(staySeeAll).toHaveBeenCalledTimes(1);
    expect(placeSeeAll).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('destination-detail-place-seeall'));
    expect(placeSeeAll).toHaveBeenCalledTimes(1);
    expect(staySeeAll).toHaveBeenCalledTimes(1);
  });

  it('G3 · 부제는 정확히 "장소 · 숙소에서 찾았어요"이고 헤딩에 "여행지"가 없다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    // getByText(문자열)은 완전 일치 — 앞뒤에 다른 글자가 붙으면 못 찾는다.
    expect(screen.getByText('장소 · 숙소에서 찾았어요')).toBeOnTheScreen();
    expect(
      screen.getByTestId('destination-detail-heading')
    ).not.toHaveTextContent(/여행지/);
    // 그보다 옛 부제(…여행자 일정에서 찾았어요)도 계속 없다(옛 AC-1 에서 옮겨 온 단언).
    expect(screen.queryByText(/여행자 일정에서 찾았어요/)).toBeNull();
  });

  it('G4 · 장소 8장이면 격자 4행 × 2칸에 입력 순서대로 놓이고, 카드 press → onPressCard(poiId)', () => {
    const onPressCard = jest.fn();
    const cards = places(8);
    render(
      <DestinationDetailScreen
        {...baseProps({ placeLane: placeLaneOf(cards, onPressCard) })}
      />
    );

    const grid = within(
      screen.getByTestId('destination-detail-lane-place')
    ).getByTestId('destination-detail-place-grid');

    // 카드 8장이 격자 안에, 입력 순서(행 우선)대로.
    expect(
      within(grid)
        .getAllByTestId(CARD_ROOT)
        .map((node) => node.props.testID)
    ).toEqual(cards.map((c) => `destination-detail-place-card-${c.poiId}`));

    // 4행, 행마다 칸 2개, 칸마다 카드 1장(짝수라 빈 칸 없음).
    const rows = within(grid).getAllByTestId(
      'destination-detail-place-grid-row'
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const cells = within(row).getAllByTestId(
        'destination-detail-place-grid-cell'
      );
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        expect(within(cell).queryAllByTestId(CARD_ROOT)).toHaveLength(1);
      }
    }

    fireEvent.press(screen.getByTestId('destination-detail-place-card-p5'));
    expect(onPressCard).toHaveBeenCalledWith('p5');
  });

  it('G5 · 장소 레인엔 가로 스크롤이 없고, 숙소 레인엔 그대로 있다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    // 가로 ScrollView 하나가 트리에선 여러 노드로 잡힌다 — 숙소 쪽은 "0보다 크다"로만 본다.
    const horizontalIn = (testID: string) =>
      screen
        .getByTestId(testID)
        .findAll((node) => node.props.horizontal === true).length;

    expect(horizontalIn('destination-detail-lane-place')).toBe(0);
    expect(horizontalIn('destination-detail-lane-stay')).toBeGreaterThan(0);
  });

  it('G6 · 홀수(5장)면 마지막 행은 왼쪽 칸에만 카드가 있고, 빈 칸도 다른 칸과 같은 className 이다', () => {
    render(
      <DestinationDetailScreen
        {...baseProps({ placeLane: placeLaneOf(places(5)) })}
      />
    );

    const grid = screen.getByTestId('destination-detail-place-grid');
    const rows = within(grid).getAllByTestId(
      'destination-detail-place-grid-row'
    );
    expect(rows).toHaveLength(3);

    // 모든 행이 칸 2개 — 마지막 행도 빈 칸을 하나 둔다(카드가 한 줄 전체로 늘어나지 않게).
    const cellsPerRow = rows.map((row) =>
      within(row).getAllByTestId('destination-detail-place-grid-cell')
    );
    for (const cells of cellsPerRow) {
      expect(cells).toHaveLength(2);
    }

    // 행은 가로로 칸을 늘어놓는다 — 이 토큰이 빠지면 격자가 1열로 무너진다(5-b 경고-1).
    for (const row of rows) {
      expect(tokens(row)).toContain('flex-row');
    }

    // 모든 칸(빈 칸 포함)의 className 이 같다 = 같은 폭 규칙.
    const allCells = cellsPerRow.flat();
    // 칸은 행 폭을 반씩 나눈다 — 빈 문자열끼리 같아도 통과하지 않게 토큰을 직접 본다.
    for (const cell of allCells) {
      expect(tokens(cell)).toContain('flex-1');
    }
    const first = tokens(allCells[0]);
    for (const cell of allCells) {
      expect(tokens(cell)).toEqual(first);
    }

    // 마지막 행: 왼쪽 칸에 5번째 카드, 오른쪽 칸은 비었다.
    const [lastLeft, lastRight] = cellsPerRow[2];
    expect(
      within(lastLeft)
        .getAllByTestId(CARD_ROOT)
        .map((node) => node.props.testID)
    ).toEqual(['destination-detail-place-card-p5']);
    expect(within(lastRight).queryAllByTestId(CARD_ROOT)).toHaveLength(0);

    // 격자 안 카드는 칸을 채운다(w-full) — d01 레인의 160 고정폭이 아니다.
    for (const card of within(grid).getAllByTestId(CARD_ROOT)) {
      expect(tokens(card)).toContain('w-full');
      expect(tokens(card)).not.toContain('w-[160px]');
    }
  });

  it('G7a · 장소 조회 실패면 재시도 블록만 있고 격자는 없다(INV-4)', () => {
    render(
      <DestinationDetailScreen
        {...baseProps({
          placeLane: { ...placeLaneOf(places(4)), error: true },
        })}
      />
    );

    expect(
      screen.getByTestId('destination-detail-place-retry')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('destination-detail-place-grid')).toBeNull();
  });

  it('G7b · 장소 0건이면 빈 자리 프롬프트만 있고 격자는 없다', () => {
    render(
      <DestinationDetailScreen {...baseProps({ placeLane: placeLaneOf([]) })} />
    );

    expect(
      screen.getByTestId('destination-detail-place-empty')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('destination-detail-place-grid')).toBeNull();
  });
});

/**
 * ── TRIP-1049 · 장소 격자 카드 저장 하트 (d05, Figma 4663:2540) ──────────────────────────
 * 숙소 레인(TRIP-709 AC-5)과 같은 계약을 장소 격자에 얹는다. 위 케이스는 무수정, 아래만 추가.
 *
 * 무엇을 보장하나:
 *  - 저장 배선(onToggleSave)이 없으면 하트가 없다(프리뷰·기존 테스트 무회귀, AC-8).
 *  - 담김/안 담김은 서로 다른 글리프 testID + `selected` 로 갈린다(색 X — SVG fill 은 jest 사각).
 *  - 하트 press 는 카드 이동을 부르지 않는다(AC-4). 대기 중엔 하트도 카드도 반응하지 않는다 —
 *    disabled 하트 press 는 부모 카드로 새기 때문이다(02a ★2).
 *  - 실패 안내는 받은 문구를 그대로 보이고, 누르면 닫힌다(AC-7 표시면).
 */
describe('TRIP-1049 · 장소 격자 저장 하트', () => {
  const PLACE_B: PlaceCardVM = {
    poiId: 'poi-2',
    name: '감천문화마을',
    region: '사하구',
    imageUrl: null,
  };

  function placeLaneWithSave(
    over: Partial<DestinationDetailScreenProps['placeLane']> = {}
  ): DestinationDetailScreenProps['placeLane'] {
    return {
      error: false,
      cards: [PLACE, PLACE_B],
      onRetry: jest.fn(),
      onSeeAll: jest.fn(),
      onPressCard: jest.fn(),
      savedPoiIds: [],
      pendingPoiIds: [],
      onToggleSave: jest.fn(),
      saveErrorMessage: null,
      onDismissSaveError: jest.fn(),
      ...over,
    };
  }

  it('S-1 · 저장 배선이 없으면(기존 baseProps) 하트가 없고 카드·격자는 그대로다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    expect(
      screen.queryByTestId(`destination-detail-place-save-${PLACE.poiId}`)
    ).toBeNull();
    expect(
      screen.getByTestId(`destination-detail-place-card-${PLACE.poiId}`)
    ).toBeOnTheScreen();
  });

  it('S-2 · 담긴 장소는 찬 하트+선택됨, 안 담긴 장소는 빈 하트+선택 아님', () => {
    render(
      <DestinationDetailScreen
        {...baseProps({
          placeLane: placeLaneWithSave({ savedPoiIds: [PLACE_B.poiId] }),
        })}
      />
    );

    // 안 담김(PLACE)
    expect(
      screen.getByTestId(
        `destination-detail-place-heart-outline-${PLACE.poiId}`
      )
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(
        `destination-detail-place-heart-filled-${PLACE.poiId}`
      )
    ).toBeNull();
    expect(
      screen.getByTestId(`destination-detail-place-save-${PLACE.poiId}`)
    ).not.toBeSelected();
    // 담김(PLACE_B)
    expect(
      screen.getByTestId(
        `destination-detail-place-heart-filled-${PLACE_B.poiId}`
      )
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`destination-detail-place-save-${PLACE_B.poiId}`)
    ).toBeSelected();
  });

  it('S-3 · 하트 press → onToggleSave(poiId) 1회, 카드 이동(onPressCard)은 0회', () => {
    const onToggleSave = jest.fn();
    const onPressCard = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          placeLane: placeLaneWithSave({ onToggleSave, onPressCard }),
        })}
      />
    );

    fireEvent.press(
      screen.getByTestId(`destination-detail-place-save-${PLACE.poiId}`)
    );

    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onToggleSave).toHaveBeenCalledWith(PLACE.poiId);
    expect(onPressCard).not.toHaveBeenCalled();
  });

  it('S-4 · 대기 중 하트는 disabled 이고, 눌러도 담기·카드 이동 모두 0회다', () => {
    const onToggleSave = jest.fn();
    const onPressCard = jest.fn();
    render(
      <DestinationDetailScreen
        {...baseProps({
          placeLane: placeLaneWithSave({
            pendingPoiIds: [PLACE.poiId],
            onToggleSave,
            onPressCard,
          }),
        })}
      />
    );
    const heart = screen.getByTestId(
      `destination-detail-place-save-${PLACE.poiId}`
    );

    expect(heart).toBeDisabled();
    fireEvent.press(heart);

    expect(onToggleSave).not.toHaveBeenCalled();
    // disabled 하트 press 는 부모 카드로 샌다 — 카드가 대기를 보고 막아야 0 이다(02a ★2).
    expect(onPressCard).not.toHaveBeenCalled();
    // 짝 — 대기 중이 아닌 옆 카드 하트는 살아 있다(전체를 막는 구현 차단).
    expect(
      screen.getByTestId(`destination-detail-place-save-${PLACE_B.poiId}`)
    ).not.toBeDisabled();
  });

  it('S-5 · 실패 문구가 오면 배너에 그대로 보이고, 누르면 닫기 콜백이 온다 · 없으면 배너 없음', () => {
    const onDismissSaveError = jest.fn();
    const message = '연결이 불안정해 담지 못했어요';
    const { rerender } = render(
      <DestinationDetailScreen
        {...baseProps({ placeLane: placeLaneWithSave() })}
      />
    );
    // 앵커 — 문구가 없으면 배너도 없다.
    expect(
      screen.queryByTestId('destination-detail-place-save-error')
    ).toBeNull();

    rerender(
      <DestinationDetailScreen
        {...baseProps({
          placeLane: placeLaneWithSave({
            saveErrorMessage: message,
            onDismissSaveError,
          }),
        })}
      />
    );
    const banner = screen.getByTestId('destination-detail-place-save-error');

    // 문구는 한 Text 노드의 완전 일치로 잰다(02a ★13).
    expect(within(banner).getByText(message)).toBeOnTheScreen();
    fireEvent.press(banner);
    expect(onDismissSaveError).toHaveBeenCalledTimes(1);
  });

  it('S-7 · 하트는 격자 칸 안(카드 위)에 그려진다 — 격자 밖에 따로 그리지 않는다', () => {
    render(
      <DestinationDetailScreen
        {...baseProps({ placeLane: placeLaneWithSave() })}
      />
    );

    const cells = screen.getAllByTestId('destination-detail-place-grid-cell');
    expect(
      within(cells[0]).getByTestId(
        `destination-detail-place-save-${PLACE.poiId}`
      )
    ).toBeOnTheScreen();
    expect(
      within(cells[1]).getByTestId(
        `destination-detail-place-save-${PLACE_B.poiId}`
      )
    ).toBeOnTheScreen();
  });
});

/**
 * TRIP-1076 (8) · AC-8 — 격자 오른쪽 열 하트가 우하단 FAB 묶음 아래로 숨지 않게, 격자가 FAB 폭만큼 오른쪽
 * 여백을 가진다(결정 4 (A) — Figma d05 에 해법이 없어서, Figma 16/16 대칭과는 드리프트).
 *
 * 왜 이 부등식인가: 스크롤 콘텐츠는 이미 좌우 16 패딩이 있고 FAB 묶음은 화면 오른쪽 16(`right-lg`)에서 폭 56
 * 이다. 격자가 오른쪽으로 56 을 더 비우면 격자 오른쪽 끝(16+56=72)과 FAB 왼쪽 끝(16+56=72)이 만나 가로로
 * 겹치지 않는다. 실제 겹침(스크롤 위치별)은 jest 사각 — 6-b 육안이 유일한 그물.
 *
 * 3동작 뼈대: 준비=장소 4장 → 실행=렌더 → 단언=격자 노드의 오른쪽 여백 합 ≥ 56 + FAB 전제(폭 56·right-lg).
 */
describe('🔴 G-FAB · 격자 오른쪽 여백 ≥ FAB 폭 (TRIP-1076 AC-8)', () => {
  const FAB_WIDTH = 56;
  // tailwind.config.js spacing 확장 스케일(px). 최대가 32 라 56 은 임의값·style 로만 나온다(02a ★15).
  const SCALE: Record<string, number> = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    '2xl': 24,
    '3xl': 32,
  };

  function classTokens(node: { props: { className?: unknown } }): string[] {
    return String(node.props.className ?? '')
      .split(/\s+/)
      .filter(Boolean);
  }

  /** 노드 자신의 오른쪽 여백(margin+padding) — className(임의값 `[Npx]`·스케일 이름) + style 합. */
  function rightInset(node: {
    props: { className?: unknown; style?: unknown };
  }): number {
    const fromClass = classTokens(node).reduce((sum, token) => {
      const match = /^(mr|pr|mx|px)-(?:\[(\d+)px\]|([a-z0-9]+))$/.exec(token);
      if (!match) return sum;
      const value =
        match[2] !== undefined ? Number(match[2]) : (SCALE[match[3]] ?? 0);
      return sum + value;
    }, 0);
    const style = StyleSheet.flatten(node.props.style as never) as
      Record<string, unknown> | undefined;
    const num = (key: string) =>
      typeof style?.[key] === 'number' ? (style[key] as number) : 0;
    const fromStyle =
      num('marginRight') +
      num('paddingRight') +
      (style?.marginRight === undefined ? num('marginHorizontal') : 0) +
      (style?.paddingRight === undefined ? num('paddingHorizontal') : 0);
    return fromClass + fromStyle;
  }

  const FOUR_PLACES: PlaceCardVM[] = Array.from({ length: 4 }, (_, i) => ({
    poiId: `p${i + 1}`,
    name: `장소 ${i + 1}`,
    region: '부산 중구',
    imageUrl: null,
  }));

  it('격자 노드의 오른쪽 여백 합이 FAB 폭(56) 이상이다', () => {
    // 준비·실행 — 장소 4장(2행) 격자.
    render(
      <DestinationDetailScreen
        {...baseProps({
          placeLane: {
            error: false,
            cards: FOUR_PLACES,
            onRetry: jest.fn(),
            onSeeAll: jest.fn(),
            onPressCard: jest.fn(),
          },
        })}
      />
    );

    // 전제 앵커 — FAB 폭은 56 이고 묶음은 화면 오른쪽 16(right-lg)에 붙은 absolute 다.
    // (이 값이 바뀌면 아래 부등식의 근거가 무너지므로 함께 잠근다.)
    const fab = screen.getByTestId('destination-detail-create-trip-fab');
    expect(classTokens(fab)).toContain('w-[56px]');
    // 가장 가까운 absolute 조상 = FAB 묶음(합성 컴포넌트 층이 끼므로 위로 걸어 올라간다).
    let group = fab.parent;
    while (group !== null && !classTokens(group).includes('absolute')) {
      group = group.parent;
    }
    expect(group).not.toBeNull();
    if (group === null) return;
    expect(classTokens(group)).toContain('right-lg');

    // 단언 — 격자 그 노드(감싸는 View·ScrollView 패딩이 아니다, 02a ★14)가 오른쪽을 56 이상 비운다.
    const grid = screen.getByTestId('destination-detail-place-grid');
    expect(rightInset(grid)).toBeGreaterThanOrEqual(FAB_WIDTH);
  });
});

// TRIP-1103 AC-1 — FAB 묶음 루트 View 에는 testID 가 없다. FAB 에서 조상으로 올라가 처음 만나는
// `absolute` 노드가 묶음 루트다(02a ★1). 하트 토글은 flex-row 행 안에 한 겹 더 들어 있다.
function fabBundleRoot(fabTestId: string) {
  let node = screen.getByTestId(fabTestId).parent;
  while (node) {
    const tokens = String(node.props.className ?? '').split(/\s+/);
    if (tokens.includes('absolute')) return node;
    node = node.parent;
  }
  throw new Error(`${fabTestId} 위에 absolute 조상이 없다`);
}

describe('TRIP-1103 AC-1 · 목적지 상세 FAB 묶음 바닥 오프셋 84 (Figma d05 fabCollapsed 바닥 84)', () => {
  it('♥·＋ FAB 묶음 루트가 bottom-[84px] 이고 bottom-[100px] 은 없다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    const root = fabBundleRoot('destination-detail-create-trip-fab');
    // 앵커 — 하트 토글(행 한 겹 안쪽)도 같은 묶음 루트에 닿는다.
    expect(fabBundleRoot('destination-detail-saved-menu-toggle')).toBe(root);
    const tokens = String(root.props.className ?? '').split(/\s+/);
    expect(tokens).toContain('bottom-[84px]');
    expect(tokens).not.toContain('bottom-[100px]');
  });
});
