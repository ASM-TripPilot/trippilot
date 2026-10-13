import { fireEvent, render, screen } from '@testing-library/react-native';

import { HOME_DEFAULT_PROPS } from '../model/homeFixtures';
import { HomeScreen } from './HomeScreen';

/** TRIP-1221(d) · 실데이터 스팟·컬렉션 카드를 누르면 poiId 로 onPressCard 가 불린다. 하트는 따로. */
describe('홈 카드 press → 장소 상세', () => {
  it('스팟 카드 press → onPressCard(poiId), 하트 press 는 카드 이동을 부르지 않는다', () => {
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        spotsLane={{
          status: 'ready',
          cards: [{ poiId: 's1', title: 'A', tag: '#a' }],
          onRetry: jest.fn(),
          onToggleSave,
          onPressCard,
        }}
      />
    );
    fireEvent.press(screen.getByTestId('home-spot-card-0'));
    expect(onPressCard).toHaveBeenCalledWith('s1');
    onPressCard.mockClear();
    fireEvent.press(screen.getByTestId('home-spot-save-s1'));
    expect(onToggleSave).toHaveBeenCalledWith('s1');
    expect(onPressCard).not.toHaveBeenCalled();
  });

  it('컬렉션 카드 press → onPressCard(poiId)', () => {
    const onPressCard = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        collectionsLane={{
          status: 'ready',
          cards: [{ poiId: 'c1', title: 'C', region: '서울', badge: '명소' }],
          onRetry: jest.fn(),
          onPressCard,
        }}
      />
    );
    fireEvent.press(screen.getByTestId('home-collection-card-0'));
    expect(onPressCard).toHaveBeenCalledWith('c1');
  });

  it('픽스처 카드(poiId 없음)는 버튼이 아니다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);
    expect(
      screen.getByTestId('home-spot-card-0').props.accessibilityRole
    ).toBeUndefined();
  });
});
