import { fireEvent, render, screen } from '@testing-library/react-native';

import { DeleteAccountDialog } from './DeleteAccountDialog';

/**
 * TRIP-935 Q7 — 삭제 다이얼로그 고지 문구가 실제 동작(30일 유예 · 그 안에 철회 가능)과 맞는다.
 *
 * 무엇을 보장하나:
 *  - 1단·2단 어디에도 "되돌릴 수 없다"는 고지가 없다 — 서버는 30일 유예로 들어가고 그동안 철회할
 *    수 있다(BR-U0-23 · BR-U6-26).
 *  - 최종 확인(2단)이 30일 유예와 그 전 취소/철회 가능을 알린다. 정확한 자구는 구현 재량(부분포함).
 *  - 2단 게이트(1단 [계속]은 콜백 0, 2단 [계정 삭제]만 1회)는 문구를 바꿔도 그대로다.
 *
 * 오버레이의 실제 덮임·열림은 jest 사각(repo-traps) — 여기선 그려진 글자와 콜백만 본다.
 */

function renderDialog() {
  const onCancel = jest.fn();
  const onConfirmDeletion = jest.fn();
  render(
    <DeleteAccountDialog
      onCancel={onCancel}
      onConfirmDeletion={onConfirmDeletion}
    />
  );
  return { onCancel, onConfirmDeletion };
}

describe('🔴 TRIP-935 Q7 · 삭제 고지는 30일 유예와 맞는다', () => {
  it('1단: "되돌릴 수 없" 고지가 없다', () => {
    renderDialog();

    // 앵커 — 1단이 그려졌다.
    expect(screen.getByTestId('settings-delete-confirm')).toBeOnTheScreen();
    expect(screen.queryAllByText(/되돌릴 수 없/)).toHaveLength(0);
  });

  it('2단: "되돌릴 수 없" 대신 30일 유예와 그 전 취소 가능을 알린다', () => {
    renderDialog();

    fireEvent.press(screen.getByTestId('settings-delete-confirm'));

    // 앵커 — 2단(최종 확인)으로 넘어왔다.
    expect(
      screen.getByTestId('settings-delete-confirm-final')
    ).toBeOnTheScreen();
    expect(screen.queryAllByText(/되돌릴 수 없/)).toHaveLength(0);
    expect(screen.getAllByText(/30일/).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/(취소|철회)할 수 있/).length
    ).toBeGreaterThanOrEqual(1);
  });

  it('짝: 문구가 바뀌어도 2단 게이트는 그대로 — 1단 [계속]은 콜백 0, 2단 [계정 삭제]가 1회', () => {
    const { onConfirmDeletion } = renderDialog();

    fireEvent.press(screen.getByTestId('settings-delete-confirm'));
    expect(onConfirmDeletion).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('settings-delete-confirm-final'));
    expect(onConfirmDeletion).toHaveBeenCalledTimes(1);
  });
});

// TRIP-772 · 맹점 ② — 2단 프리뷰 키가 생겨도 게이트의 기본 얼굴은 1단이다.
// 무엇을 보장하나: 필수 두 prop 만 주면 삭제 범위 고지(1단)부터 열리고, 최종 확인(2단)은 없다.
// 프로덕션이 두 prop 만 넘긴다는 사용처 잠금은 `deleteAccountDialogGate.test.ts`.
describe('TRIP-772 · 기본 렌더는 1단부터', () => {
  it('필수 prop 만 주면 1단 [계속]이 있고 2단 [계정 삭제]는 없다', () => {
    // 준비·실행: 필수 prop 두 개만으로 렌더.
    const { onConfirmDeletion } = renderDialog();

    // 단언: 1단 얼굴, 2단 최종 버튼 부재, 삭제 콜백 0회.
    expect(screen.getByTestId('settings-delete-confirm')).toBeOnTheScreen();
    expect(screen.queryByTestId('settings-delete-confirm-final')).toBeNull();
    expect(onConfirmDeletion).not.toHaveBeenCalled();
  });
});
