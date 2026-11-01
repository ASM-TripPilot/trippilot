import { fireEvent, render, screen } from '@testing-library/react-native';

import { HOME_DEFAULT_PROPS } from '../model/homeFixtures';
import {
  HOME_PLANNING_PROPS,
  HOME_POST_TRIP_PROPS,
} from '../model/__fixtures__/homePhaseFixtures';
import { HomeScreen } from './HomeScreen';

/**
 * 홈 — **출시 게이트 ①(버튼 role 전수 census, App Store 2.1)만** 남긴 뷰 단위.
 *
 * 화면 동작은 B안(2026-11-01, README §테스트 전략 판정 4)으로 `HomePage.test.tsx`·`HomePage.integration.test.tsx`
 * 가 지킨다. 버튼 집합은 콜백을 하나도 안 넘겨도 구조로 굳어 있어야 하므로(콜백 유무 파생 금지 — 죽은 버튼·
 * 숨은 버튼을 둘 다 잡는다) props 를 손으로 넣어 얼굴마다 완전일치로 잰다. 픽스처 모듈 계약은
 * `../model/homeFixtures.test.ts` 로 옮겼다.
 */

const buttonIds = (): string[] =>
  screen
    .queryAllByRole('button')
    .map((node) => String(node.props.testID))
    .sort();

// discovery — 배선된 CTA 만 버튼이다(TRIP-370·453·494·939·1432·1553). 컬렉션 "더 보기"는 목적지가 없어 그리지 않는다.
const DISCOVERY_BUTTONS = [
  'home-create-trip-fab',
  'home-saved-menu-toggle',
  'home-spots-more',
  'home-search-bar',
  'home-dashboard-bell',
  'home-dashboard-assistant',
  'home-magazine-hero',
  'home-hero-slide-1',
  'home-hero-slide-2',
];

// 계획 중(1섹션) — 여행 카드 본체·알약 + 도시 카드 3장. 스팟 섹션이 없어 home-spots-more 가 빠진다(TRIP-696).
const TRIP_FACE_BUTTONS = [
  'home-create-trip-fab',
  'home-saved-menu-toggle',
  'home-trip-hero-cta',
  'home-search-bar',
  'home-trip-hero',
  'home-dashboard-bell',
  'home-dashboard-assistant',
  'home-hero-slide-1',
  'home-hero-slide-2',
  'home-hero-slide-3',
];

describe('출시 게이트 ① · 버튼 역할 집합 == 배선 CTA 집합', () => {
  it('discovery — 콜백 없이 그려도 버튼은 배선된 CTA 뿐이다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    expect(buttonIds()).toEqual([...DISCOVERY_BUTTONS].sort());
  });

  it('planning — 여행 카드·알약·도시 카드·검색바·FAB·종·✦ 뿐이다', () => {
    render(<HomeScreen {...HOME_PLANNING_PROPS} />);

    expect(buttonIds()).toEqual([...TRIP_FACE_BUTTONS].sort());
  });

  // TRIP-1369 — 콜백 없는 "전체 보기"는 버튼이 아니다(죽은 버튼 금지), 콜백을 주면 그 하나만 버튼이 된다.
  it('postTrip — 콜백 없이 그리면 "전체 보기"는 버튼이 아니다', () => {
    render(<HomeScreen {...HOME_POST_TRIP_PROPS} />);

    expect(screen.getByTestId('home-past-trips-more')).toBeOnTheScreen();
    expect(buttonIds()).toEqual([...TRIP_FACE_BUTTONS].sort());
  });

  it('postTrip — onPressPastTripsMore 를 주면 "전체 보기"가 버튼이 되고 누르면 1회 발화한다', () => {
    const onPressPastTripsMore = jest.fn();
    render(
      <HomeScreen
        {...HOME_POST_TRIP_PROPS}
        onPressPastTripsMore={onPressPastTripsMore}
      />
    );

    expect(buttonIds()).toEqual(
      [...TRIP_FACE_BUTTONS, 'home-past-trips-more'].sort()
    );
    fireEvent.press(screen.getByTestId('home-past-trips-more'));
    expect(onPressPastTripsMore).toHaveBeenCalledTimes(1);
  });
});
