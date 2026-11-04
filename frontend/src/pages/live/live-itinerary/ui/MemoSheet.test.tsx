import { fireEvent, render, screen } from '@testing-library/react-native';
import { TextInput } from 'react-native';

import { MemoSheet } from './MemoSheet';

/**
 * TRIP-1503 — 입력 상자 어디를 눌러도 입력에 포커스를 넘긴다(구조 단언 + 포커스 위임).
 * 준비: 시트를 그린다 → 실행: 상자(live-memo-box)를 누른다 → 단언: 입력의 focus() 가 불린다.
 * 실제 키보드 노출은 통과형 바텀시트 목이라 jest 사각 — 6-b 실기 몫.
 */
describe('MemoSheet 입력 상자 탭 → 포커스 (TRIP-1503)', () => {
  it('상자(live-memo-box)를 누르면 입력의 focus() 가 1회 불린다', () => {
    render(
      <MemoSheet placeName="장소" onSubmit={jest.fn()} onClose={jest.fn()} />
    );
    const input = screen.UNSAFE_getByType(TextInput);
    const focus = jest.spyOn(input.instance, 'focus');

    fireEvent.press(screen.getByTestId('live-memo-box'));

    expect(focus).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRIP-1751 · 개정 AC-12 — 메모를 불러오지 못했을 때의 시트 얼굴(props 만 받는 순수 컴포넌트 단위).
 * 준비: `loadError` prop 을 준다(페이지가 훅 신호로 만든다) → 실행: 그린다·버튼을 누른다 → 단언: 안내·버튼·잠금·콜백 횟수.
 *  - 안내(`live-memo-load-error`)는 문구만 담는다(버튼은 형제) — `toHaveTextContent` 가 완전 일치라서다.
 *  - 버튼(`live-memo-load-retry`)은 `onRetry` 가 있을 때만 선다(오프라인 보류는 다시 시도해도 대기뿐이라 버튼 없음).
 *  - 재시도 응답을 기다리는 동안(`retrying`)은 안내를 남기고 버튼만 잠근다.
 * 시트 실개폐·키보드는 통과형 목이라 jest 사각 — 6-b 실기 몫.
 */
describe('MemoSheet 불러오지 못함 안내 (TRIP-1751)', () => {
  const ERROR = 'live-memo-load-error';
  const RETRY = 'live-memo-load-retry';

  it('L1 loadError 를 주면 안내·[다시 시도]가 서고, 버튼은 onRetry 를 1회 부르며, 입력·[저장]은 잠겨 저장 콜백이 안 나간다', () => {
    // 준비 — 잠금(editable=false) + 이미 draft 가 있는 상태(시드). draft 가 비어 있으면 [저장] 비활성이 공허해진다.
    const onRetry = jest.fn();
    const onSubmit = jest.fn();
    render(
      <MemoSheet
        placeName="장소"
        text="이미 쓴 글"
        editable={false}
        loadError={{ onRetry, retrying: false }}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );

    // 단언 ① — 안내 문구(완전 일치)·버튼 문구.
    expect(screen.getByTestId(ERROR)).toHaveTextContent(
      '메모를 불러오지 못했어요'
    );
    expect(screen.getByTestId(RETRY)).toHaveTextContent('다시 시도');
    // 단언 ② — 입력과 [저장]은 잠겨 있고, 눌러도 저장 콜백이 안 불린다.
    expect(screen.getByTestId('record-trip-memo-input')).toBeDisabled();
    expect(screen.getByTestId('live-memo-save')).toBeDisabled();
    fireEvent.press(screen.getByTestId('live-memo-save'));
    expect(onSubmit).not.toHaveBeenCalled();

    // 실행·단언 ③ — [다시 시도] 누름 → onRetry 1회.
    fireEvent.press(screen.getByTestId(RETRY));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('L2 retrying 이면 안내는 남고 [다시 시도]만 잠겨 눌러도 onRetry 가 안 불린다', () => {
    const onRetry = jest.fn();
    render(
      <MemoSheet
        placeName="장소"
        editable={false}
        loadError={{ onRetry, retrying: true }}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId(ERROR)).toHaveTextContent(
      '메모를 불러오지 못했어요'
    );
    expect(screen.getByTestId(RETRY)).toBeDisabled();
    fireEvent.press(screen.getByTestId(RETRY));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('L3 onRetry 가 없으면(오프라인 보류) 안내 문구만 서고 버튼은 없다', () => {
    render(
      <MemoSheet
        placeName="장소"
        editable={false}
        loadError={{ retrying: false }}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId(ERROR)).toHaveTextContent(
      '메모를 불러오지 못했어요'
    );
    expect(screen.queryByTestId(RETRY)).toBeNull();
  });

  it('L4 loadError 가 없거나 null 이면 안내·버튼 둘 다 없다(시트는 있다)', () => {
    const { rerender } = render(
      <MemoSheet placeName="장소" onSubmit={jest.fn()} onClose={jest.fn()} />
    );
    // 앵커 — 시트는 떠 있다.
    expect(screen.getByTestId('live-memo-sheet')).toBeOnTheScreen();
    expect(screen.queryByTestId(ERROR)).toBeNull();
    expect(screen.queryByTestId(RETRY)).toBeNull();

    rerender(
      <MemoSheet
        placeName="장소"
        loadError={null}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByTestId(ERROR)).toBeNull();
    expect(screen.queryByTestId(RETRY)).toBeNull();
  });
});
