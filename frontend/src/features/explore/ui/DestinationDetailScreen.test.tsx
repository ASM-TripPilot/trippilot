import { fireEvent, render, screen } from '@testing-library/react-native';

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
