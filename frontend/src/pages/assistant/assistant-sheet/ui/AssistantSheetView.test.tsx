import { Keyboard, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ProposalStatus } from '../api/assistantContract';
import {
  assistantSample,
  sampleActionLogs,
  sampleTranscript,
} from '../api/assistantSamples';
import {
  AssistantSheetView,
  type AssistantSheetViewProps,
} from './AssistantSheetView';

/**
 * TRIP-1322 · b01 default · b07 no-context 껍데기(props only). 판정은 page 가 1회(`state`) — 뷰는 받은 값만 그린다.
 * 투명 모달 딤·키보드가 입력창을 밀어 올리는지는 jest 사각(6-b 실기).
 */

function renderView(overrides: Partial<AssistantSheetViewProps> = {}) {
  const transcript = sampleTranscript('greeting');
  const props: AssistantSheetViewProps = {
    state: 'READY',
    contextChip: transcript.session.contextChip,
    messages: transcript.messages,
    quickReplies: transcript.quickReplies,
    showCapabilitiesChip: true,
    draft: '',
    canSend: false,
    onChangeDraft: jest.fn(),
    onSend: jest.fn(),
    onPressQuickReply: jest.fn(),
    onPressCapabilities: jest.fn(),
    onPressAction: jest.fn(),
    onClose: jest.fn(),
    onRetryOpen: jest.fn(),
    ...overrides,
  };
  render(<AssistantSheetView {...props} />);
  return props;
}

describe('AssistantSheetView (TRIP-1322)', () => {
  it('BR-U8-03·04 · 칩 문구·직전 메시지·시작 quick reply 를 그린다', () => {
    const transcript = sampleTranscript('review');
    renderView({
      contextChip: '부산 2박 3일 · 등록 숙소 서면',
      messages: transcript.messages,
      quickReplies: transcript.quickReplies,
    });
    expect(screen.getByTestId('assistant-context-chip')).toHaveTextContent(
      '부산 2박 3일 · 등록 숙소 서면'
    );
    expect(
      screen.getByTestId(`assistant-user-bubble-${transcript.messages[0].id}`)
    ).toHaveTextContent('지금까지 짠 일정 검토해줘');
    transcript.quickReplies.forEach((reply) =>
      expect(
        screen.getByTestId(`assistant-quick-reply-${reply.id}`)
      ).toHaveTextContent(reply.label)
    );
  });

  it('BR-U8-04 · "내가 할 수 있는 것 보기" 칩이 상시 있다', () => {
    const props = renderView();
    fireEvent.press(screen.getByTestId('assistant-quick-reply-capabilities'));
    expect(props.onPressCapabilities).toHaveBeenCalledTimes(1);
  });

  it('TRIP-1436 Q-134 · 상시 칩이 quick reply 줄의 맨 앞이다(서버 칩이 늘어도 화면 밖으로 안 밀린다)', () => {
    renderView();

    const ids = screen
      .getAllByTestId(/^assistant-quick-reply-/)
      .map((node) => node.props.testID);

    expect(ids.length).toBeGreaterThan(1);
    expect(ids[0]).toBe('assistant-quick-reply-capabilities');
  });

  it('TRIP-1436 Q-134 · 실서버 모양(SHOW_CAPABILITIES 가 서버 칩 목록 맨 끝, 클라 칩 없음)이어도 그 칩이 맨 앞이다', () => {
    const replies = [
      ...sampleTranscript('greeting').quickReplies,
      {
        id: 'qr-capabilities',
        label: '내가 할 수 있는 것 보기',
        action: 'SHOW_CAPABILITIES' as const,
        params: {},
      },
    ];
    renderView({ quickReplies: replies, showCapabilitiesChip: false });

    const ids = screen
      .getAllByTestId(/^assistant-quick-reply-/)
      .map((node) => node.props.testID);

    expect(ids[0]).toBe('assistant-quick-reply-qr-capabilities');
    expect(ids.length).toBe(replies.length);
  });

  it('TRIP-1436 Q-134 · 보내기를 누르면 키보드를 내리고 onSend 를 부른다', () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const props = renderView({ canSend: true, draft: '안녕' });

    fireEvent.press(screen.getByTestId('assistant-send'));

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(props.onSend).toHaveBeenCalledTimes(1);
    dismiss.mockRestore();
  });

  it('BR-U8-05 · 여행 없이 열면(NO_CONTEXT) 회색 칩 + 입력 활성 + 여행 만들기·숙소 탐색 행동', () => {
    const transcript = sampleTranscript('no-context', null);
    renderView({
      state: 'NO_CONTEXT',
      contextChip: null,
      messages: transcript.messages,
      quickReplies: transcript.quickReplies,
    });
    expect(screen.getByTestId('assistant-context-chip')).toHaveTextContent(
      '진행 중인 여행 없음'
    );
    expect(screen.getByTestId('assistant-input').props.editable).not.toBe(
      false
    );
    expect(
      screen.getAllByTestId('assistant-next-action-CREATE_TRIP')
    ).toHaveLength(1);
    expect(
      screen.getAllByTestId('assistant-next-action-OPEN_STAY_SEARCH')
    ).toHaveLength(1);
  });

  it('BR-U8-07 · 열기 실패면 오류 + [다시 시도], 메시지·입력은 없다', () => {
    const props = renderView({ state: 'OPEN_FAILED' });
    expect(screen.getByTestId('assistant-open-failed')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('assistant-open-retry'));
    expect(props.onRetryOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('assistant-input')).toBeNull();
  });

  it('여는 중이면 진행 표시만', () => {
    renderView({ state: 'LOADING', messages: [] });
    expect(screen.getByTestId('assistant-sheet-loading')).toBeOnTheScreen();
  });

  it('금지 · 뷰는 재판정하지 않는다 — state 가 OPEN_FAILED 면 메시지가 있어도 오류 얼굴', () => {
    renderView({ state: 'OPEN_FAILED' });
    expect(
      screen.queryByTestId('assistant-quick-reply-capabilities')
    ).toBeNull();
  });

  it('보내기는 canSend 일 때만 누를 수 있다', () => {
    const blocked = renderView({ canSend: false, draft: '   ' });
    fireEvent.press(screen.getByTestId('assistant-send'));
    expect(blocked.onSend).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('assistant-send').props.accessibilityState
    ).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('닫기 · 딤을 누르면 onClose', () => {
    const props = renderView();
    fireEvent.press(screen.getByTestId('assistant-sheet-close'));
    fireEvent.press(screen.getByTestId('assistant-sheet-scrim'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('next action 을 누르면 그 행동을 올린다', () => {
    const props = renderView();
    fireEvent.press(
      screen.getAllByTestId('assistant-next-action-OPEN_ITINERARY')[0]
    );
    expect(props.onPressAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OPEN_ITINERARY' })
    );
  });
});

describe('제안 각주 (적용 뒤 거짓말 방지)', () => {
  function proposalMessage(status: ProposalStatus) {
    const base = assistantSample('proposal', { id: 'mf' });
    if (!base.proposal) throw new Error('샘플에 제안 없음');
    return { ...base, proposal: { ...base.proposal, status } };
  }

  it('열린 제안(PROPOSED)은 "적용 전까지" 각주를 그린다', () => {
    renderView({ messages: [proposalMessage('PROPOSED')] });
    expect(screen.getByTestId('assistant-footnote-mf')).toHaveTextContent(
      '적용 전까지',
      { exact: false }
    );
  });

  it.each(['APPLIED', 'DISMISSED', 'STALE', 'EXPIRED', 'FAILED'] as const)(
    '%s 이면 각주를 숨긴다',
    (status) => {
      renderView({ messages: [proposalMessage(status)] });
      expect(screen.queryByTestId('assistant-footnote-mf')).toBeNull();
    }
  );
});

describe('답 평가 줄 자리 (US-ASSIST-09)', () => {
  it('도우미의 답마다 renderFeedback 을 그리고, 사용자 말·적용 기록(ACTION_LOG)에는 그리지 않는다', () => {
    const transcript = sampleTranscript('review');
    renderView({
      messages: [...transcript.messages, ...sampleActionLogs()],
      renderFeedback: (message) => (
        <Text testID={`feedback-${message.id}`}>평가</Text>
      ),
    });
    expect(screen.getByTestId('feedback-m-review')).toBeOnTheScreen();
    expect(screen.queryByTestId('feedback-u-review')).toBeNull();
    expect(screen.queryByTestId('feedback-log-1')).toBeNull();
    expect(screen.queryByTestId('feedback-log-2')).toBeNull();
  });
});

describe('목록 맨 위 "이전 대화 더 보기" 행', () => {
  const review = sampleTranscript('review').messages;

  // inverted 목록: 트리 순서는 최신 → 옛 → 푸터이고, 푸터가 화면 맨 위에 그려진다(실제 위치는 6-b 실기).
  const rowTestIds = () =>
    screen
      .getAllByTestId(
        /^assistant-(?:user-bubble-|message-(?!list$)|older-more$)/
      )
      .map((node) => node.props.testID as string);

  it('idle 이면 행이 있고(버튼·문구), 모든 메시지 행보다 뒤(= 화면 맨 위)이며, 누르면 onPress', () => {
    // Arrange
    const onPress = jest.fn();
    renderView({ messages: review, older: { status: 'idle', onPress } });

    // Act
    fireEvent.press(screen.getByTestId('assistant-older-more'));

    // Assert
    const row = screen.getByTestId('assistant-older-more');
    expect(row).toHaveTextContent('이전 대화 더 보기');
    expect(row.props.accessibilityRole).toBe('button');
    const ids = rowTestIds();
    expect(ids.length).toBeGreaterThan(1);
    expect(ids[ids.length - 1]).toBe('assistant-older-more');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null])(
    'older 가 %s 면 행 자체가 없다(비활성이 아니라 부재)',
    (older) => {
      renderView({ older });

      expect(screen.getByTestId('assistant-message-list')).toBeOnTheScreen();
      expect(screen.queryByTestId('assistant-older-more')).toBeNull();
      expect(screen.queryByTestId('assistant-older-loading')).toBeNull();
      expect(screen.queryByTestId('assistant-older-error')).toBeNull();
    }
  );

  it('loading 이면 로딩 표시로 바뀌고 다시 누를 수 없다(콜백 0회)', () => {
    // Arrange
    const onPress = jest.fn();
    renderView({ older: { status: 'loading', onPress } });

    // Act
    fireEvent.press(screen.getByTestId('assistant-older-more'));

    // Assert
    expect(screen.getByTestId('assistant-older-loading')).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-older-more')).toBeDisabled();
    expect(screen.queryByText('이전 대화 더 보기')).toBeNull();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('error 이면 같은 자리에 실패 문구 + 다시 시도가 보이고(침묵 금지), 보이던 메시지는 그대로이며, 누르면 재요청', () => {
    // Arrange
    const onPress = jest.fn();
    renderView({ messages: review, older: { status: 'error', onPress } });

    // Act
    fireEvent.press(screen.getByTestId('assistant-older-more'));

    // Assert
    expect(screen.getByTestId('assistant-older-error')).toHaveTextContent(
      '이전 대화를 불러오지 못했어요'
    );
    expect(screen.getByText('다시 시도')).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-older-more')).toBeEnabled();
    expect(screen.queryByTestId('assistant-older-loading')).toBeNull();
    expect(
      screen.getByTestId('assistant-user-bubble-u-review')
    ).toBeOnTheScreen();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
