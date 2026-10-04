import { render, screen, within } from '@testing-library/react-native';

import { HOME_DEFAULT_PROPS } from '../model/homeFixtures';
import { HomeScreen } from './HomeScreen';

/**
 * TRIP-1221(a) · 사진 없는 홈 카드(지금 뜨는 장소·컬렉션)는 회색 그라데이션뿐이 아니라
 * 사진 자리 글리프(placeholder)를 그린다. 사진이 있으면 그리지 않는다.
 */
const SPOTS = [
  { poiId: 's1', title: '사진 있음', tag: '#a', imageUrl: 'https://x/1.jpg' },
  { poiId: 's2', title: '사진 없음', tag: '#b', imageUrl: null },
];
const COLLS = [
  {
    poiId: 'c1',
    title: '컬 있음',
    region: '서울',
    badge: '명소',
    imageUrl: 'https://x/2.jpg',
  },
  { poiId: 'c2', title: '컬 없음', region: '서울', badge: '명소' },
];

describe('홈 카드 · 사진 없음 대체 표시', () => {
  it('스팟 카드 — imageUrl 없을 때만 placeholder', () => {
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        spotsLane={{ status: 'ready', cards: SPOTS, onRetry: jest.fn() }}
      />
    );
    const c0 = screen.getByTestId('home-spot-card-0');
    const c1 = screen.getByTestId('home-spot-card-1');
    expect(within(c0).queryByTestId('home-spot-photo-placeholder')).toBeNull();
    expect(
      within(c1).getByTestId('home-spot-photo-placeholder')
    ).toBeOnTheScreen();
  });

  it('컬렉션 카드 — imageUrl 없을 때만 placeholder', () => {
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        collectionsLane={{ status: 'ready', cards: COLLS, onRetry: jest.fn() }}
      />
    );
    const c0 = screen.getByTestId('home-collection-card-0');
    const c1 = screen.getByTestId('home-collection-card-1');
    expect(
      within(c0).queryByTestId('home-collection-photo-placeholder')
    ).toBeNull();
    expect(
      within(c1).getByTestId('home-collection-photo-placeholder')
    ).toBeOnTheScreen();
  });
});
