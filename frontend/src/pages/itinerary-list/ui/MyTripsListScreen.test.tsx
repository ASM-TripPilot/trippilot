import { fireEvent, render, screen } from '@testing-library/react-native';

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
