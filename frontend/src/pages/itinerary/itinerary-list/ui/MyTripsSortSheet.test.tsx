import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { MyTripsSortSheet } from './MyTripsSortSheet';

/**
 * TRIP-1122 · AC-3~AC-6 — h06 정렬 시트(Figma 4750:2946)의 렌더·배선 계약.
 *
 * 무엇을 보장하나:
 *  - 제목 `정렬`, 옵션 3개(최신순·출발일순·이름순), 보조 문구는 앞 둘에만.
 *  - 지금 기준만 선택(`accessibilityState.selected`)이고 체크도 그 행 안에만 있다.
 *  - 옵션을 누르면 그 기준으로 `onSelect` 1회 — 적용 버튼 없음. 스크림 탭·끌어내리기는 `onClose`.
 *
 * 완전 제어 — 선택·열림은 페이지가 쥔다(StayPriceSheet 선례). gorhom 목이 통과형이라 실제 열림·딤
 * 덮임·끌기 제스처는 무심판(6-b 실기, 02a ★1).
 *
 * *(개념 — toBeSelected)* `accessibilityState.selected`(스크린리더의 "선택됨")를 읽는다. 색은 jest 가
 *   못 보므로 선택 여부는 이 값으로 잰다.
 */

function noop(): void {}

const OPTION_ID = /^my-trips-sort-option-(recent|start|title)$/;
const KEYS = ['recent', 'start', 'title'] as const;

describe('🔴 T1 · 구조 — 제목 · 옵션 3개 · 보조 문구 (AC-3)', () => {
  it('정렬 제목과 최신순·출발일순·이름순, 보조 문구는 앞 둘에만', () => {
    // 준비·실행
    render(
      <MyTripsSortSheet selected="recent" onSelect={noop} onClose={noop} />
    );

    // 단언 — 시트·제목
    expect(screen.getByTestId('my-trips-sort-sheet')).toBeOnTheScreen();
    expect(screen.getByText('정렬')).toBeOnTheScreen();

    // 단언 — 옵션은 정확히 3개(행 수)
    expect(screen.getAllByTestId(OPTION_ID)).toHaveLength(3);

    // 단언 — 라벨·보조 문구는 각 옵션 안에
    const recent = screen.getByTestId('my-trips-sort-option-recent');
    const start = screen.getByTestId('my-trips-sort-option-start');
    const title = screen.getByTestId('my-trips-sort-option-title');
    expect(within(recent).getByText('최신순')).toBeOnTheScreen();
    expect(within(recent).getByText('최근에 고친 여행부터')).toBeOnTheScreen();
    expect(within(start).getByText('출발일순')).toBeOnTheScreen();
    expect(within(start).getByText('가까운 출발일부터')).toBeOnTheScreen();
    // 이름순은 보조 문구 없음 — 옵션 글자 전체가 라벨과 완전 일치(02a ★11)
    expect(title).toHaveTextContent('이름순');
  });
});

describe('🔴 T2 · 지금 기준만 선택 · 체크는 그 행 안에만 (AC-3 · 02a ★12)', () => {
  it.each(KEYS)('selected=%s', (selected) => {
    render(
      <MyTripsSortSheet selected={selected} onSelect={noop} onClose={noop} />
    );

    for (const key of KEYS) {
      const option = screen.getByTestId(`my-trips-sort-option-${key}`);
      if (key === selected) {
        expect(option).toBeSelected();
        expect(
          within(option).getByTestId(`my-trips-sort-check-${key}`)
        ).toBeOnTheScreen();
      } else {
        expect(option).not.toBeSelected();
        expect(screen.queryByTestId(`my-trips-sort-check-${key}`)).toBeNull();
      }
    }
  });
});

describe('🔴 T4 · 옵션 탭 = 그 기준으로 onSelect 1회, 적용 버튼 없음 (AC-4 · 02a ★9)', () => {
  it('이름순을 누르면 onSelect("title") 1회', () => {
    const onSelect = jest.fn();
    render(
      <MyTripsSortSheet selected="recent" onSelect={onSelect} onClose={noop} />
    );

    fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('title');
    expect(screen.queryByText('적용')).toBeNull();
  });
});

describe('🔴 T5 · 스크림 — 탭하면 onClose 만 (AC-5)', () => {
  it('스크림을 누르면 onClose 1회, onSelect 0회', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    render(
      <MyTripsSortSheet
        selected="recent"
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    const scrim = screen.getByTestId('my-trips-sort-scrim');
    fireEvent.press(scrim);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('🔴 T6 · 끌어내려 닫기 — 라이브러리가 부르는 onClose 가 그대로 이어진다 (AC-5)', () => {
  it('enablePanDownToClose 가 켜져 있고 그 노드의 onClose 가 onClose 를 부른다', () => {
    const onClose = jest.fn();
    render(
      <MyTripsSortSheet selected="recent" onSelect={noop} onClose={onClose} />
    );

    // 통과형 목은 BottomSheet prop 을 노드에 그대로 싣는다(StayPriceSheet P3 선례). 실제 끌기는 6-b.
    const panNodes = screen.UNSAFE_root.findAll(
      (node) => node.props?.enablePanDownToClose === true
    );
    expect(panNodes.length).toBeGreaterThan(0);
    (panNodes[panNodes.length - 1].props.onClose as () => void)();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
