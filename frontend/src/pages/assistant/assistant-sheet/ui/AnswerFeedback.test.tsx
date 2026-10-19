import { fireEvent, render, screen } from '@testing-library/react-native';

import { AnswerFeedback, type AnswerFeedbackProps } from './AnswerFeedback';

/**
 * US-ASSIST-09 답 평가 줄(props only) — 엄지 둘 · 싫어요 뒤 이유 칩 셋 + "직접 적기" · 300자 입력 · 고마워요 안내 ·
 * 실패 안내. 판정(토글·낙관 갱신·롤백)은 page 쪽 훅이 하고 뷰는 받은 값만 그린다. Figma 없음 — 사용자 결정
 * (엄지 아이콘 두 개로 먼저 구현, Figma 는 나중에 맞춤). 생김새(색·채움)는 단언하지 않는다 — 상태는
 * `accessibilityState.selected` 로만 본다.
 */

function renderRow(overrides: Partial<AnswerFeedbackProps> = {}) {
  const props: AnswerFeedbackProps = {
    messageId: 'm1',
    rating: null,
    panel: null,
    busy: false,
    error: null,
    onPressThumb: jest.fn(),
    onPickReason: jest.fn(),
    onOpenComment: jest.fn(),
    onChangeComment: jest.fn(),
    onSubmitComment: jest.fn(),
    ...overrides,
  };
  render(<AnswerFeedback {...props} />);
  return props;
}

function stateOf(testID: string) {
  return screen.getByTestId(testID).props.accessibilityState;
}

describe('AnswerFeedback (US-ASSIST-09)', () => {
  it('엄지 둘은 이름 있는 버튼이고, 누르면 누른 쪽을 올린다', () => {
    const props = renderRow();
    const up = screen.getByTestId('assistant-feedback-up-m1');
    const down = screen.getByTestId('assistant-feedback-down-m1');
    expect(up.props.accessibilityRole).toBe('button');
    expect(down.props.accessibilityRole).toBe('button');
    expect(up.props.accessibilityLabel).toBe('좋아요');
    expect(down.props.accessibilityLabel).toBe('싫어요');

    fireEvent.press(up);
    fireEvent.press(down);

    expect(props.onPressThumb).toHaveBeenNthCalledWith(1, 'UP');
    expect(props.onPressThumb).toHaveBeenNthCalledWith(2, 'DOWN');
  });

  it.each([
    [null, false, false],
    ['UP', true, false],
    ['DOWN', false, true],
  ] as const)(
    '평가 %s → 좋아요 selected %s · 싫어요 selected %s',
    (rating, up, down) => {
      renderRow({ rating });
      expect(stateOf('assistant-feedback-up-m1')).toEqual(
        expect.objectContaining({ selected: up })
      );
      expect(stateOf('assistant-feedback-down-m1')).toEqual(
        expect.objectContaining({ selected: down })
      );
    }
  );

  it('이유 칸이 접혀 있으면(panel null) 칩도 입력창도 안내도 없다', () => {
    renderRow({ rating: 'DOWN' });
    expect(
      screen.queryByTestId('assistant-feedback-reason-WRONG-m1')
    ).toBeNull();
    expect(screen.queryByTestId('assistant-feedback-comment-m1')).toBeNull();
    expect(
      screen.queryByTestId('assistant-feedback-comment-input-m1')
    ).toBeNull();
    expect(screen.queryByTestId('assistant-feedback-thanks-m1')).toBeNull();
  });

  it('싫어요 뒤 이유 칸(REASONS) — 칩 셋 + "직접 적기", 누르면 그 이유·직접 적기를 올린다', () => {
    const props = renderRow({ rating: 'DOWN', panel: { step: 'REASONS' } });
    expect(
      screen.getByTestId('assistant-feedback-reason-WRONG-m1')
    ).toHaveTextContent('틀렸어요');
    expect(
      screen.getByTestId('assistant-feedback-reason-NOT_HELPFUL-m1')
    ).toHaveTextContent('도움이 안 돼요');
    expect(
      screen.getByTestId('assistant-feedback-reason-NOT_WHAT_I_WANTED-m1')
    ).toHaveTextContent('원한 답이 아니에요');
    expect(
      screen.getByTestId('assistant-feedback-comment-m1')
    ).toHaveTextContent('직접 적기');
    expect(
      screen.queryByTestId('assistant-feedback-comment-input-m1')
    ).toBeNull();

    fireEvent.press(screen.getByTestId('assistant-feedback-reason-WRONG-m1'));
    fireEvent.press(screen.getByTestId('assistant-feedback-comment-m1'));

    expect(props.onPickReason).toHaveBeenCalledWith('WRONG');
    expect(props.onOpenComment).toHaveBeenCalledTimes(1);
  });

  it('직접 적기(WRITING) — 300자 입력창·보내기, 고른 이유만 selected', () => {
    const props = renderRow({
      rating: 'DOWN',
      panel: { step: 'WRITING', reason: 'NOT_HELPFUL', comment: '멀어요' },
    });
    const input = screen.getByTestId('assistant-feedback-comment-input-m1');
    expect(input.props.maxLength).toBe(300);
    expect(input.props.value).toBe('멀어요');
    expect(stateOf('assistant-feedback-reason-NOT_HELPFUL-m1')).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(stateOf('assistant-feedback-reason-WRONG-m1')).toEqual(
      expect.objectContaining({ selected: false })
    );
    // 쓰는 중엔 "직접 적기"가 할 일이 없다 — 눌러도 아무 일 없는 버튼은 두지 않는다(심사 2.1): 고른 채 비활성.
    expect(stateOf('assistant-feedback-comment-m1')).toEqual(
      expect.objectContaining({ selected: true, disabled: true })
    );

    fireEvent.changeText(input, '동선이 너무 길어요');
    fireEvent.press(screen.getByTestId('assistant-feedback-comment-send-m1'));

    expect(props.onChangeComment).toHaveBeenCalledWith('동선이 너무 길어요');
    expect(props.onSubmitComment).toHaveBeenCalledTimes(1);
  });

  it('금지 · 의견이 공백뿐이고 이유도 없으면 [보내기]를 누를 수 없다', () => {
    const props = renderRow({
      rating: 'DOWN',
      panel: { step: 'WRITING', reason: null, comment: '   ' },
    });
    fireEvent.press(screen.getByTestId('assistant-feedback-comment-send-m1'));
    expect(props.onSubmitComment).not.toHaveBeenCalled();
    expect(stateOf('assistant-feedback-comment-send-m1')).toEqual(
      expect.objectContaining({ disabled: true })
    );
  });

  it('보낸 뒤(THANKS) — 고마워요 안내만 남고 칩·입력창은 접힌다', () => {
    renderRow({ rating: 'DOWN', panel: { step: 'THANKS' } });
    expect(
      screen.getByTestId('assistant-feedback-thanks-m1')
    ).toHaveTextContent('의견 고마워요', { exact: false });
    expect(
      screen.queryByTestId('assistant-feedback-reason-WRONG-m1')
    ).toBeNull();
    expect(
      screen.queryByTestId('assistant-feedback-comment-input-m1')
    ).toBeNull();
  });

  it('실패 안내를 그린다(침묵 실패 금지)', () => {
    renderRow({
      error: '평가를 저장하지 못했어요. 잠시 후 다시 시도해 주세요',
    });
    expect(screen.getByTestId('assistant-feedback-error-m1')).toHaveTextContent(
      '평가를 저장하지 못했어요',
      { exact: false }
    );
  });

  it('금지 · 보내는 중(busy)이면 엄지·칩을 누를 수 없다', () => {
    const props = renderRow({
      rating: 'DOWN',
      panel: { step: 'REASONS' },
      busy: true,
    });
    fireEvent.press(screen.getByTestId('assistant-feedback-up-m1'));
    fireEvent.press(screen.getByTestId('assistant-feedback-reason-WRONG-m1'));
    fireEvent.press(screen.getByTestId('assistant-feedback-comment-m1'));
    expect(props.onPressThumb).not.toHaveBeenCalled();
    expect(props.onPickReason).not.toHaveBeenCalled();
    expect(props.onOpenComment).not.toHaveBeenCalled();
    expect(stateOf('assistant-feedback-up-m1')).toEqual(
      expect.objectContaining({ disabled: true })
    );
  });
});
