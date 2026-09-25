import { render, screen } from '@testing-library/react-native';

import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
  type PlaceCardVM,
  type StayCardVM,
} from './ExploreLandingScreen';

/**
 * TRIP-704 — d01 탐색 랜딩 loading 얼굴(Figma 3612:2006).
 *
 * 무엇을 보장하나: `isLoading` 이 켜지면 화면이 조회 대기 얼굴로 바뀐다 —
 *  - 숙소 2·장소 3 스켈레톤(회색 박스)만 그리고 실카드/폴백은 안 그린다,
 *  - 우하단 FAB 2단(♥·＋)을 아예 안 그린다(로딩 중 조작 차단),
 *  - 장소 레인의 "가볼 만한 장소 둘러보기" 폴백(explore-lane-place-empty)을 노출하지 않는다,
 *  - 헤딩·검색창·섹션 제목("숙소"/"장소")은 실텍스트를 유지한다.
 *
 * *(개념)* `isLoading` 은 **옵셔널** prop 이다 — 안 주면(기본 false) 기존 default 얼굴 그대로라
 * cardPress·placePhoto 등 기존 테스트가 무수정 green(무회귀). 아래 L5 가 그 앵커다.
 *
 * *(개념)* 부재 단언은 `queryByTestId`(못 찾으면 throw 대신 null 반환), 존재 단언은 `getByTestId`
 * (못 찾으면 throw). 스켈레톤 존재는 getBy, FAB·폴백 부재는 queryBy 로 잰다.
 */

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
    onPressCreateTrip: () => {},
    placeLane: {
      error: false,
      cards: [PLACE_CARD],
      onRetry: () => {},
      onPressCard: () => {},
    },
    stayLane: {
      error: false,
      cards: [STAY_CARD],
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

describe('L1 · 로딩 스켈레톤 = 숙소 2 · 장소 3', () => {
  it('isLoading 이면 숙소 2·장소 3 스켈레톤 박스를 그린다', () => {
    // Arrange · Act
    render(<ExploreLandingScreen {...baseProps({ isLoading: true })} />);

    // Assert — 정확한 개수의 스켈레톤(0-index)
    expect(screen.getByTestId('explore-landing-skeleton-stay-0')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-skeleton-stay-1')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-skeleton-place-0')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-skeleton-place-1')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-skeleton-place-2')).toBeTruthy();
    // 넘치지 않는다 — 숙소 2번째·장소 4번째 없음
    expect(screen.queryByTestId('explore-landing-skeleton-stay-2')).toBeNull();
    expect(screen.queryByTestId('explore-landing-skeleton-place-3')).toBeNull();
  });
});

describe('L2 · 로딩 중 FAB 미렌더', () => {
  it('isLoading 이면 ♥·＋ FAB 둘 다 없다', () => {
    render(<ExploreLandingScreen {...baseProps({ isLoading: true })} />);

    expect(screen.queryByTestId('explore-saved-menu-toggle')).toBeNull();
    expect(screen.queryByTestId('explore-create-trip-fab')).toBeNull();
  });
});

describe('L3 · 로딩 중 장소 폴백 노출 중단', () => {
  it('isLoading 이면 explore-lane-place-empty 폴백이 안 뜬다', () => {
    // placeLane 미지정(빈 목록)이어도 로딩 중엔 폴백 대신 스켈레톤
    render(
      <ExploreLandingScreen
        {...baseProps({ isLoading: true, placeLane: undefined })}
      />
    );

    expect(screen.queryByTestId('explore-lane-place-empty')).toBeNull();
    expect(screen.getByTestId('explore-landing-skeleton-place-0')).toBeTruthy();
  });
});

describe('L4 · 로딩 중 헤딩·검색·섹션 제목 실텍스트 유지', () => {
  it('헤딩·검색창·"숙소"/"장소" 제목은 로딩 중에도 그대로다', () => {
    render(<ExploreLandingScreen {...baseProps({ isLoading: true })} />);

    expect(screen.getByTestId('explore-landing-heading')).toBeTruthy();
    expect(screen.getByTestId('explore-landing-search')).toBeTruthy();
    expect(screen.getByText('숙소')).toBeTruthy();
    expect(screen.getByText('장소')).toBeTruthy();
  });
});

describe('L5 · isLoading 미지정 무회귀 앵커', () => {
  it('isLoading 을 안 주면 스켈레톤은 없고 FAB 는 있다(기본 얼굴)', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    expect(screen.queryByTestId('explore-landing-skeleton-stay-0')).toBeNull();
    expect(screen.queryByTestId('explore-landing-skeleton-place-0')).toBeNull();
    expect(screen.getByTestId('explore-saved-menu-toggle')).toBeTruthy();
    expect(screen.getByTestId('explore-create-trip-fab')).toBeTruthy();
  });
});

describe('L6 · 로딩이 에러보다 우선(로딩+에러 동시)', () => {
  // 코드-비평 경고-2 봉합: 숙소 대기+장소 실패처럼 로딩·에러가 겹치는 실도달 상태에서
  // isLoading 분기가 에러 블록보다 먼저 타는지 잠근다. 삼항을 재배열하면 이 단언이 red.
  it('isLoading 이면 stay/place 에러여도 에러 블록이 아니라 스켈레톤을 그린다', () => {
    render(
      <ExploreLandingScreen
        {...baseProps({
          isLoading: true,
          stayLane: {
            error: true,
            cards: [],
            onRetry: () => {},
            onSeeAll: () => {},
          },
          placeLane: {
            error: true,
            cards: [],
            onRetry: () => {},
            onPressCard: () => {},
          },
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
