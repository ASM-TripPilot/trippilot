import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
  type StayCardVM,
} from './ExploreLandingScreen';

/**
 * TRIP-457 AC-6(화면 절반) · AC-7 — d01 탐색 랜딩 숙소 카드 탭 → 상세 이동 콜백 + press 분리.
 *
 * 무엇을 보장하나: d01 레인 카드 루트가 press 되면 `stayLane.onPressCard?(card)` 를 올린다(현재
 * 카드 루트는 비-Pressable `View`). 배선(어느 라우트로 push)은 라우트(`(tabs)/explore.tsx`)가
 * 진다 — 화면은 `@/features/stay` import 금지·순수 뷰라 콜백만 받는다(맹점 2). 하트 press 는 저장
 * 토글만, 카드 push 를 삼키지 않는다(AC-7, ★F-4 findEventHandler).
 *
 * *(개념)* `StayCardVM` 은 `{key,name,region,priceText}` — 화면은 전체 `StayItem` 을 모르므로
 * 카드 press 는 이 VM 을 그대로 올린다(라우트가 key 로 원본 item 을 역조회해 push, onToggleSave 선례).
 */

const CARD: StayCardVM = {
  key: 'NAVER:s1',
  name: '해운대 그랜드 호텔',
  region: '해운대',
  priceText: '145,000원~',
};

function baseProps(
  overrides: Partial<ExploreLandingScreenProps['stayLane']> = {}
): ExploreLandingScreenProps {
  return {
    heading: { title: '무엇을 둘러볼까요?', subtitle: '숙소·장소를 둘러봐요' },
    onPressSearch: () => {},
    stayLane: {
      error: false,
      cards: [CARD],
      onRetry: () => {},
      onSeeAll: () => {},
      ...overrides,
    },
    bridge: { savedCount: 0, onPressCreateTrip: () => {} },
  };
}

describe('E1 · 카드 press = onPressCard(card) (AC-6 화면 절반)', () => {
  it('카드 루트 press → onPressCard(card), 저장 콜백은 안 온다', () => {
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    render(
      <ExploreLandingScreen {...baseProps({ onPressCard, onToggleSave })} />
    );

    fireEvent.press(screen.getByTestId(`explore-stay-card-${CARD.key}`));

    expect(onPressCard).toHaveBeenCalledWith(CARD);
    expect(onToggleSave).not.toHaveBeenCalled();
  });
});

describe('E2 · 하트 press = 저장만 (AC-7)', () => {
  it('하트 press → onToggleSave(card), onPressCard 는 안 온다', () => {
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    render(
      <ExploreLandingScreen {...baseProps({ onPressCard, onToggleSave })} />
    );

    fireEvent.press(screen.getByTestId(`explore-stay-save-${CARD.key}`));

    expect(onToggleSave).toHaveBeenCalledWith(CARD);
    expect(onPressCard).not.toHaveBeenCalled();
  });
});

describe('E3 · onPressCard 미지정 무회귀', () => {
  it('onPressCard 를 안 주면 카드 press 가 throw 하지 않는다', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    expect(() =>
      fireEvent.press(screen.getByTestId(`explore-stay-card-${CARD.key}`))
    ).not.toThrow();
  });
});
