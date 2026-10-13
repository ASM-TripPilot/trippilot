import { fireEvent, render, screen } from '@testing-library/react-native';

import { AutoRevertDialog } from './AutoRevertDialog';

/** TRIP-1340 · 확인 다이얼로그 — 확정 전 호출 0회 · 409 미디어 안내 · 잠금 해제 고지. */
const P = 'execution-live-slot-auto-revert';

describe('AutoRevertDialog', () => {
  it('AD1 [취소] 는 onCancel 만, 확정 전 onConfirm 0회', () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(
      <AutoRevertDialog
        testIDPrefix={P}
        placeName="감천문화마을"
        part="COMPLETION"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
    expect(
      screen.getByText(/재계획에서 이 장소를 바꿀 수 있게 돼요/)
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId(`${P}-cancel`));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('AD2 [되돌리기] → onConfirm 1회', () => {
    const onConfirm = jest.fn();
    render(
      <AutoRevertDialog
        testIDPrefix={P}
        placeName="감천문화마을"
        part="ARRIVAL"
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />
    );
    fireEvent.press(screen.getByTestId(`${P}-confirm`));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('AD3 미디어 409 → 안내가 보이고 되돌리기는 눌리지 않는다', () => {
    const onConfirm = jest.fn();
    render(
      <AutoRevertDialog
        testIDPrefix={P}
        placeName="x"
        part="ARRIVAL"
        error="media"
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByTestId(`${P}-media-notice`)).toHaveTextContent(
      /먼저 사진·메모를 지워 주세요/
    );
    fireEvent.press(screen.getByTestId(`${P}-confirm`));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
