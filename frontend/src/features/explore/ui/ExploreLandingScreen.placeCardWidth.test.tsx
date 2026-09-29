import { render, screen } from '@testing-library/react-native';

import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
  type PlaceCardVM,
} from './ExploreLandingScreen';

/**
 * TRIP-1048 · AC-8 — d01 탐색 랜딩의 "가볼 곳" 레인 카드는 여전히 160 고정폭이다.
 *
 * 무엇을 보장하나: d05 목적지 검색 결과가 같은 `PlaceRailCard` 를 2열 격자용 `variant="fill"` 로
 * 쓰게 되면서, d01 은 가로 레인 그대로(160) 남아야 한다. 다른 d01 테스트는 카드 폭을 보지 않아서
 * d01 에 fill 을 잘못 넘겨도 전부 green 이다 — 이 파일이 그 회귀를 잡는다.
 *
 * (개념) 폭은 픽셀이 아니라 className 토큰(`w-[160px]`)으로 잰다 — jest 는 NativeWind className 을
 * style 로 바꾸지 않고 prop 문자열로 남긴다. 준비(카드 2장) → 실행(렌더) → 단언(카드마다 토큰).
 */

function baseProps(cards: PlaceCardVM[]): ExploreLandingScreenProps {
  return {
    heading: { title: '무엇을 둘러볼까요?', subtitle: '둘러봐요' },
    onPressSearch: () => {},
    stayLane: {
      error: false,
      cards: [],
      onRetry: () => {},
      onSeeAll: () => {},
    },
    placeLane: {
      error: false,
      cards,
      onRetry: () => {},
      onPressCard: () => {},
    },
    savedMenu: {
      open: false,
      savedCount: 0,
      onToggle: () => {},
      onPressSavedPlaces: () => {},
      onPressSavedStays: () => {},
    },
  };
}

describe('d01 가볼 곳 레인 카드 폭 (TRIP-1048 AC-8)', () => {
  it('W1 · 레인 카드는 모두 w-[160px] 이고 w-full 이 아니다', () => {
    render(
      <ExploreLandingScreen
        {...baseProps([
          {
            poiId: 'p1',
            name: '감천문화마을',
            region: '사하구',
            imageUrl: null,
          },
          { poiId: 'p2', name: '자갈치 시장', region: '중구', imageUrl: null },
        ])}
      />
    );

    const cards = screen.getAllByTestId(/^explore-place-card-(?!image-)/);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const tokens = String(card.props.className ?? '')
        .trim()
        .split(/\s+/);
      expect(tokens).toContain('w-[160px]');
      expect(tokens).not.toContain('w-full');
    }
  });
});
