import { render, screen, within } from '@testing-library/react-native';

import { HOME_DEFAULT_PROPS } from '../model/homeFixtures';
import { HomeScreen } from './HomeScreen';

/**
 * TRIP-1209 — 컬렉션 레인(`collectionsLane`)이 오면 고정 픽스처(`sections.collections`) 대신 그것을
 * 그린다. 모양(카드 testID·배지·지역)은 그대로, 데이터 소스와 3상태만 갈린다.
 */
const CARDS = [
  { poiId: 'a', title: '가 장소', region: '서울 종로구', badge: '명소' },
  { poiId: 'b', title: '나 장소', region: '서울 중구', badge: '카페' },
  { poiId: 'c', title: '다 장소', region: '서울 마포구', badge: '야경' },
];

describe('HomeScreen · collectionsLane', () => {
  it('ready — 레인 카드를 그리고 픽스처 카드는 그리지 않는다', () => {
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        collectionsLane={{ status: 'ready', cards: CARDS, onRetry: jest.fn() }}
      />
    );

    expect(
      within(screen.getByTestId('home-collection-card-1')).getByText('나 장소')
    ).toBeOnTheScreen();
    expect(screen.queryByText('감천문화마을')).toBeNull();
  });

  it('ready 인데 카드가 0장이면 섹션(헤더 포함)을 숨긴다', () => {
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        collectionsLane={{ status: 'ready', cards: [], onRetry: jest.fn() }}
      />
    );

    expect(screen.queryByText('요즘 사람들이 담는 곳')).toBeNull();
    expect(screen.queryByTestId('home-collection-card-0')).toBeNull();
  });
});
