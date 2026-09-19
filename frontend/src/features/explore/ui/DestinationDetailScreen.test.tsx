import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

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
 * 유효하고, 세그먼트 상태는 화면 로컬 useState('all')(D1) 라 prop 이 아니다.
 */

describe('AC-1 · 부제 G11 교체', () => {
  it('부제가 "여행지 · 장소 · 숙소에서 찾았어요"를 담고, 옛 문구는 0건이다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    // 헤딩(제목+부제)이 새 부제를 담는다 — 제목의 곡선/직선 따옴표에 안 걸리게 부분(정규식)으로.
    expect(screen.getByTestId('destination-detail-heading')).toHaveTextContent(
      /여행지 · 장소 · 숙소에서 찾았어요/
    );
    // 옛 부제(…여행자 일정에서 찾았어요)는 사라졌다.
    expect(screen.queryByText(/여행자 일정에서 찾았어요/)).toBeNull();
  });
});

describe('AC-2 · 여행자 일정 레인 제거', () => {
  it('itin 레인 testID·"준비 중" 문구가 모두 사라진다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    expect(screen.queryByTestId('destination-detail-lane-itin')).toBeNull();
    expect(screen.queryByText(/여행자들의 일정을 준비/)).toBeNull();
  });
});

describe('AC-3 · 세그먼트 3탭', () => {
  it('전체·숙소·장소 3탭이 뜨고(여행자 일정 세그 0건), 초기 활성은 전체다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    // 3탭 존재 + 라벨(seg subtree 텍스트가 라벨 하나뿐이라 문자열 완전일치로 안전).
    expect(screen.getByTestId('destination-detail-seg-all')).toHaveTextContent(
      '전체'
    );
    expect(screen.getByTestId('destination-detail-seg-stay')).toHaveTextContent(
      '숙소'
    );
    expect(
      screen.getByTestId('destination-detail-seg-place')
    ).toHaveTextContent('장소');
    // 여행자 일정 세그(및 옛 레인 헤더)는 어디에도 없다.
    expect(screen.queryByText('여행자 일정')).toBeNull();

    // 활성 표식은 색 fill 이 아니라 accessibilityState.selected — 초기 'all' 만 selected.
    expect(screen.getByTestId('destination-detail-seg-all')).toBeSelected();
    expect(
      screen.getByTestId('destination-detail-seg-stay')
    ).not.toBeSelected();
    expect(
      screen.getByTestId('destination-detail-seg-place')
    ).not.toBeSelected();
  });
});

describe('AC-4 · 세그먼트 레인 필터 (화면 로컬 useState)', () => {
  it('all=두 레인 / 숙소=stay만 / 장소=place만 로 갈리고 활성 표식이 따라간다', () => {
    render(<DestinationDetailScreen {...baseProps()} />);

    // 초기(all) — 두 레인 다 렌더.
    expect(
      screen.getByTestId('destination-detail-lane-stay')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('destination-detail-lane-place')
    ).toBeOnTheScreen();

    // 숙소 세그 press → stay 레인만, place 레인 null, seg-stay 활성.
    fireEvent.press(screen.getByTestId('destination-detail-seg-stay'));
    expect(
      screen.getByTestId('destination-detail-lane-stay')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('destination-detail-lane-place')).toBeNull();
    expect(screen.getByTestId('destination-detail-seg-stay')).toBeSelected();

    // 장소 세그 press → place 레인만, stay 레인 null, seg-place 활성.
    fireEvent.press(screen.getByTestId('destination-detail-seg-place'));
    expect(
      screen.getByTestId('destination-detail-lane-place')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('destination-detail-lane-stay')).toBeNull();
    expect(screen.getByTestId('destination-detail-seg-place')).toBeSelected();

    // 전체 세그 press → 두 레인 복귀, seg-all 활성.
    fireEvent.press(screen.getByTestId('destination-detail-seg-all'));
    expect(
      screen.getByTestId('destination-detail-lane-stay')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('destination-detail-lane-place')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('destination-detail-seg-all')).toBeSelected();
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
