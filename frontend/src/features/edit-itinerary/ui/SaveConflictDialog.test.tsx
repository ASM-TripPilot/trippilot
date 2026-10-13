import { fireEvent, render, screen } from '@testing-library/react-native';

import { SaveConflictDialog } from './SaveConflictDialog';

/**
 * TRIP-1095 · 저장 후 위반 요약 게이트(BR-U3-13) — **뷰 전용** 심판. 직접 짜기(h19)와 일정 편집(h12·i07)이
 * 같은 다이얼로그를 쓰고 긍정 버튼 라벨만 prop 으로 다르다.
 *
 * 무엇을 보장하나:
 *  - 제목은 「N곳에서 시간이 안 맞아요」 한 줄이다(완전 일치, 본문 없음 — 01 Q5).
 *  - 버튼은 정확히 둘: 왼쪽 [고치기] · 오른쪽 긍정([그대로 확정]/[그대로 저장] = `confirmLabel`).
 *    [AI 자동 보정](`-save-repair`)은 없다(결정 2 — repair 계약 부재).
 *  - 각 버튼은 제 콜백만 부른다.
 *  - 레이아웃 토큰은 TripDeleteDialog 계열이다(결정 3).
 *
 * 커버하지 않는 것: 딤 실제 덮임·중앙 정렬·터치 차단(조건부 렌더 오버레이의 jest 사각 — 6-b). 언제 뜨고
 * 누른 뒤 어디로 가는지는 두 페이지의 `*.save-conflict.integration` 몫.
 *
 * 3동작: 준비(jest.fn 콜백) → 실행(render + press) → 단언(텍스트·콜백·토큰).
 */

const GATE = 'itinerary-edit-save-conflict';
const CARD = 'itinerary-edit-save-conflict-card';
const ASIS = 'itinerary-edit-save-asis';
const BACK = 'itinerary-edit-save-back';

function tokens(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function renderDialog({
  count = 1,
  confirmLabel = '그대로 확정',
}: { count?: number; confirmLabel?: string } = {}) {
  const onConfirm = jest.fn();
  const onBack = jest.fn();
  render(
    <SaveConflictDialog
      count={count}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      onBack={onBack}
    />
  );
  return { onConfirm, onBack };
}

describe('SaveConflictDialog · 문구 (BR-U3-13 「○곳에서 시간이 안 맞아요」)', () => {
  it('D1 · count=2 면 제목이 「2곳에서 시간이 안 맞아요」와 완전히 같다', () => {
    renderDialog({ count: 2 });

    expect(screen.getByTestId(GATE)).toBeOnTheScreen();
    expect(screen.getByText('2곳에서 시간이 안 맞아요')).toBeOnTheScreen();
  });

  it('D2 · count=1 이면 「1곳에서 시간이 안 맞아요」이고 다른 수는 없다', () => {
    renderDialog({ count: 1 });

    expect(screen.getByText('1곳에서 시간이 안 맞아요')).toBeOnTheScreen();
    expect(screen.queryByText('2곳에서 시간이 안 맞아요')).toBeNull();
  });

  it.each(['그대로 확정', '그대로 저장'])(
    'D3 · 긍정 버튼 라벨은 confirmLabel(%s) 그대로이고 [고치기] 라벨은 「고치기」다',
    (label) => {
      renderDialog({ confirmLabel: label });

      expect(screen.getByTestId(ASIS)).toHaveTextContent(label);
      expect(screen.getByTestId(BACK)).toHaveTextContent('고치기');
    }
  );
});

describe('SaveConflictDialog · 버튼 (결정 1·2 — 두 갈래, repair 없음)', () => {
  it('D4 · 버튼은 정확히 둘이고 왼쪽 [고치기] · 오른쪽 긍정 순서다 · -save-repair 는 없다', () => {
    renderDialog();

    const order = screen
      .getAllByRole('button')
      .map((button) => button.props.testID);

    expect(order).toEqual([BACK, ASIS]);
    expect(screen.queryByTestId('itinerary-edit-save-repair')).toBeNull();
  });

  it('D5 · 긍정 버튼을 누르면 onConfirm 만 한 번 부른다', () => {
    const { onConfirm, onBack } = renderDialog();

    fireEvent.press(screen.getByTestId(ASIS));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('D6 · [고치기]를 누르면 onBack 만 한 번 부른다', () => {
    const { onConfirm, onBack } = renderDialog();

    fireEvent.press(screen.getByTestId(BACK));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('SaveConflictDialog · 레이아웃 토큰 (결정 3 — TripDeleteDialog 계열)', () => {
  it('D7 · 딤 55% 전면 · 카드 330/20 캔버스 · 제목 19 Bold ink · 버튼 52 · 긍정만 코랄', () => {
    renderDialog({ count: 3 });

    expect(tokens(screen.getByTestId(GATE))).toEqual(
      expect.arrayContaining(['absolute', 'inset-0', 'bg-scrim/55'])
    );
    expect(tokens(screen.getByTestId(CARD))).toEqual(
      expect.arrayContaining(['w-[330px]', 'rounded-[20px]', 'bg-canvas'])
    );
    expect(tokens(screen.getByText('3곳에서 시간이 안 맞아요'))).toEqual(
      expect.arrayContaining(['font-noto-bold', 'text-[19px]', 'text-ink'])
    );
    for (const id of [ASIS, BACK]) {
      expect(tokens(screen.getByTestId(id))).toEqual(
        expect.arrayContaining(['h-[52px]', 'rounded-button'])
      );
    }
    expect(tokens(screen.getByTestId(ASIS))).toContain('bg-primary');
    expect(tokens(screen.getByTestId(BACK))).toContain(
      'border-hairline-strong'
    );
    expect(tokens(screen.getByTestId(BACK))).not.toContain('bg-primary');
  });
});
