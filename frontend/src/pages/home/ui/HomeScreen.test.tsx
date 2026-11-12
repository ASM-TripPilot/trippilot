import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

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

  // TRIP-1806 — 그림 이름은 글자일 뿐이다. 버튼이 되면 심사 2.1 의 "눌러도 반응 없는 버튼"이 된다.
  it.each([
    ['planning', HOME_PLANNING_PROPS],
    ['postTrip', HOME_POST_TRIP_PROPS],
  ])('%s — 그림 이름이 있어도 버튼 집합은 그대로다', (_face, props) => {
    const { phase } = props;
    if (!phase || phase.kind === 'discovery')
      throw new Error('여행 얼굴 픽스처여야 한다');

    render(
      <HomeScreen
        {...props}
        phase={{
          ...phase,
          trip: {
            ...phase.trip,
            coverSource: { uri: 'cover://26350' },
            coverLabel: '그림 · 해운대',
          },
        }}
      />
    );

    expect(screen.getByTestId('home-trip-hero-cover-label')).toHaveTextContent(
      '그림 · 해운대'
    );
    expect(buttonIds()).toEqual([...TRIP_FACE_BUTTONS].sort());
  });
});

/**
 * TRIP-1783 · 홈 종 미읽음 배지 — 숫자(`unreadCount`) → 글자·낭독 이름의 변환만 잰다(데이터가 어디서 오는지는
 * `HomePage.integration.test.tsx`). 콜백을 안 넘겨도 되는 순수 뷰 단위다.
 *
 * 무엇을 보장하나: 미읽음 N(1~99)이면 종 *안*에 N, 100 이상이면 `99+`. 종의 낭독 이름은 미읽음이 있을 때만 바뀌고
 * (`알림, 읽지 않은 알림 N개` · 100 이상 `…99개 이상`) 0건·모름·미지정이면 종전 그대로 `알림`이다. 배지는 버튼이 아니다
 * (버튼 census 불변). 배지의 색·크기·위치는 jest 사각 — 6-b 실화면.
 */
describe('TRIP-1783 · 종 미읽음 배지', () => {
  const BADGE = 'home-dashboard-bell-badge';
  // 낭독 중복을 막으려 구현이 배지를 접근성 트리에서 숨겨도 되므로 숨김 요소도 찾는다.
  const badgeIn = () =>
    within(screen.getByTestId('home-dashboard-bell')).queryByTestId(BADGE, {
      includeHiddenElements: true,
    });

  // [unreadCount, 배지 글자(null=배지 없음), 종의 낭독 이름]
  it.each<[number | null | undefined, string | null, string]>([
    [undefined, null, '알림'],
    [null, null, '알림'],
    [0, null, '알림'],
    [1, '1', '알림, 읽지 않은 알림 1개'],
    [3, '3', '알림, 읽지 않은 알림 3개'],
    [99, '99', '알림, 읽지 않은 알림 99개'],
    [100, '99+', '알림, 읽지 않은 알림 99개 이상'],
  ])('unreadCount=%s → 배지 %s · 이름 "%s"', (unreadCount, text, name) => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} unreadCount={unreadCount} />);

    // 앵커 — 종은 늘 그려지고 그 이름이 아래 기대와 정확히 같다(부분 일치 아님).
    expect(screen.getByRole('button', { name })).toHaveProp(
      'testID',
      'home-dashboard-bell'
    );
    if (text === null) {
      expect(badgeIn()).toBeNull();
    } else {
      expect(badgeIn()).toHaveTextContent(text);
    }
    // 배지는 눌리는 요소가 아니다 — 숫자가 붙어도 버튼 집합은 그대로.
    expect(buttonIds()).toEqual([...DISCOVERY_BUTTONS].sort());
  });
});
