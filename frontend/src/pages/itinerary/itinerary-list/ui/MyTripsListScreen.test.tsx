import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ScrollView, View } from 'react-native';

import { MyTripsListScreen } from './MyTripsListScreen';

/**
 * TRIP-1122 · AC-1 — h06 목록 위 정렬 줄이 누를 수 있는 트리거가 된다.
 *
 * 무엇을 보장하나:
 *  - list 모드에서 `my-trips-sort` 는 버튼이고, 글자는 지금 기준(`최신순`·`출발일순`·`이름순`)이다.
 *  - 누르면 `onPressSort` 1회 — 시트는 화면이 아니라 페이지가 연다.
 *  - 기준을 안 주면 최신순(기본값).
 *  - loading·empty 에는 정렬 줄이 없다(현행 유지).
 *
 * *(개념 — getAllByRole)* 스크린리더가 보는 역할(button)로 찾는다. testID 로 찾은 노드가 그 목록에
 *   들어 있는지 보아 "그 줄이 곧 버튼"임을 굳힌다.
 */

function noop(): void {}

const LABEL = { recent: '최신순', start: '출발일순', title: '이름순' } as const;

describe('🔴 AC-1 · list 모드 트리거 — 버튼 · 라벨 = 지금 기준', () => {
  it.each(Object.entries(LABEL))(
    'sortKey=%s → 글자 "%s" 인 버튼',
    (sortKey, label) => {
      // 준비·실행
      render(
        <MyTripsListScreen
          mode="list"
          cards={null}
          sortKey={sortKey as keyof typeof LABEL}
          onPressSort={noop}
          onPressCreateTrip={noop}
        />
      );

      // 단언 — 글자 완전 일치(셰브런은 글자가 없다)
      const trigger = screen.getByTestId('my-trips-sort');
      expect(trigger).toHaveTextContent(label);
      // 단언 — 그 줄이 곧 버튼(접근성 이름은 계약 밖 — 역할만 본다)
      expect(screen.getAllByRole('button')).toContain(trigger);
    }
  );

  it('누르면 onPressSort 1회', () => {
    const onPressSort = jest.fn();
    render(
      <MyTripsListScreen
        mode="list"
        cards={null}
        sortKey="recent"
        onPressSort={onPressSort}
        onPressCreateTrip={noop}
      />
    );

    fireEvent.press(screen.getByTestId('my-trips-sort'));

    expect(onPressSort).toHaveBeenCalledTimes(1);
  });

  it('sortKey 를 안 주면 최신순', () => {
    render(
      <MyTripsListScreen
        mode="list"
        cards={null}
        onPressSort={noop}
        onPressCreateTrip={noop}
      />
    );

    expect(screen.getByTestId('my-trips-sort')).toHaveTextContent('최신순');
  });
});

describe('🟢 AC-1 · loading·empty 에는 정렬 줄이 없다 (선제 green — 회귀 그물)', () => {
  it('loading → 스켈레톤은 있고 my-trips-sort 는 없다', () => {
    render(
      <MyTripsListScreen
        mode="loading"
        sortKey="title"
        onPressSort={noop}
        onPressCreateTrip={noop}
      />
    );

    expect(screen.getByTestId('my-trip-skeleton-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-trips-sort')).toBeNull();
  });

  it('empty → 빈 상태는 있고 my-trips-sort 는 없다', () => {
    render(
      <MyTripsListScreen
        mode="empty"
        sortKey="title"
        onPressSort={noop}
        onPressCreateTrip={noop}
      />
    );

    expect(screen.getByTestId('itinerary-tab-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-trips-sort')).toBeNull();
  });
});

// TRIP-1297 — 목록 머리 통로. 큰 글자에서 페이지가 완료 배너를 여기 넣는다(정렬 줄 아래, 첫 카드 위, 스크롤과 함께 올라감).
describe('🔴 listHeader · 목록 스크롤의 첫 자식', () => {
  const CARDS = [
    <View key="1" testID="probe-card-1" />,
    <View key="2" testID="probe-card-2" />,
  ];

  /** 목록 스크롤 안의 probe testID 를 트리 순서대로. */
  function idsInScroll(): string[] {
    return within(screen.UNSAFE_getByType(ScrollView))
      .queryAllByTestId(/^probe-/)
      .map((n) => n.props.testID as string);
  }

  it('listHeader 를 주면 스크롤 안 카드들보다 앞에 오고, 정렬 줄은 스크롤 밖 그 위에 남는다', () => {
    // 준비·실행
    render(
      <MyTripsListScreen
        mode="list"
        cards={CARDS}
        listHeader={<View testID="probe-list-header" />}
        onPressSort={noop}
        onPressCreateTrip={noop}
      />
    );

    // 단언 ① 스크롤 안, 첫 카드 앞
    expect(idsInScroll()).toEqual([
      'probe-list-header',
      'probe-card-1',
      'probe-card-2',
    ]);
    // 단언 ② 정렬 줄은 스크롤 밖이고, 트리 순서상 머리보다 앞(= 화면에서 위)
    expect(
      within(screen.UNSAFE_getByType(ScrollView)).queryByTestId('my-trips-sort')
    ).toBeNull();
    expect(
      screen
        .queryAllByTestId(/^(my-trips-sort|probe-list-header)$/)
        .map((n) => n.props.testID as string)
    ).toEqual(['my-trips-sort', 'probe-list-header']);
  });

  it('listHeader 를 안 주면 스크롤 첫 자식은 지금처럼 첫 카드다 (선제 green)', () => {
    render(
      <MyTripsListScreen
        mode="list"
        cards={CARDS}
        onPressSort={noop}
        onPressCreateTrip={noop}
      />
    );

    expect(idsInScroll()).toEqual(['probe-card-1', 'probe-card-2']);
  });
});
