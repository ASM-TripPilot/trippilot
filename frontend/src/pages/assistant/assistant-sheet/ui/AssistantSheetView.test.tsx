import { DeviceEventEmitter, Keyboard, Text, TextInput } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type {
  AssistantSurface,
  ProposalStatus,
} from '../api/assistantContract';
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
 *
 * TRIP-1525·1526 — 새 틀(헤더 ✦ + 더보기 + 닫기, 입력 카드 위 컨텍스트 칩, 대화 유무·키보드에 따른 배치).
 * 패널이 떠 있는지·둥근지·색 전환 등 생김새는 jest 사각(6-b/시뮬).
 */

// TRIP-1526 — 키보드 이벤트는 RN `Keyboard` 가 구독하는 기기 이벤트 통로(DeviceEventEmitter)로 쏜다
// (선례 AssistantFab.test).
type KeyboardEventName =
  | 'keyboardWillShow'
  | 'keyboardDidShow'
  | 'keyboardWillHide'
  | 'keyboardDidHide';

function emitKeyboard(name: KeyboardEventName): void {
  const frame = { screenX: 0, screenY: 508, width: 390, height: 336 };
  act(() => {
    DeviceEventEmitter.emit(name, {
      startCoordinates: frame,
      endCoordinates: frame,
      duration: 250,
      easing: 'keyboard',
      isEventFromThisApp: true,
    });
  });
}

// `Keyboard` 는 "지금 떠 있나" 를 모듈 싱글턴에 기억한다 — 한 케이스가 떠 있는 채로 끝나면 다음으로 새므로
// 파일 최상위에서 매번 내린다.
afterEach(() => {
  emitKeyboard('keyboardDidHide');
});

// RN jest 목에서 TextInput 의 focus 는 모든 인스턴스가 공유하는 jest.fn 이다(prototype).
const inputFocus = (TextInput as unknown as { prototype: { focus: jest.Mock } })
  .prototype.focus;

function renderView(overrides: Partial<AssistantSheetViewProps> = {}) {
  const transcript = sampleTranscript('greeting');
  const props: AssistantSheetViewProps = {
    state: 'READY',
    surface: 'ITINERARY',
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
    // TRIP-1526 — 보이는 문구는 surface 별 고정 라벨, 서버 문구(BR-U8-03)는 칩의 접근성 라벨로 보존한다.
    const chip = screen.getByTestId('assistant-context-chip');
    expect(chip).toHaveTextContent('이 일정에 관해 질문하기');
    expect(screen.queryByText('부산 2박 3일 · 등록 숙소 서면')).toBeNull();
    expect(chip.props.accessibilityLabel).toContain(
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

  it('BR-U8-05 · 여행 없이 열면(NO_CONTEXT) 능력 보기 칩 + 입력 활성 + 여행 만들기·숙소 탐색 행동', () => {
    const transcript = sampleTranscript('no-context', null);
    const props = renderView({
      state: 'NO_CONTEXT',
      contextChip: null,
      messages: transcript.messages,
      quickReplies: transcript.quickReplies,
    });
    const chip = screen.getByTestId('assistant-context-chip');
    expect(chip).toHaveTextContent('내가 할 수 있는 것 보기');
    fireEvent.press(chip);
    expect(props.onPressCapabilities).toHaveBeenCalledTimes(1);
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

  it('TRIP-1529 · NO_CONTEXT 의 행동 행은 아이콘 행, READY 의 행은 링크 행(아이콘 없음)', () => {
    const transcript = sampleTranscript('no-context', null);
    renderView({
      state: 'NO_CONTEXT',
      contextChip: null,
      messages: transcript.messages,
      quickReplies: transcript.quickReplies,
    });
    expect(
      screen.getByTestId('assistant-next-action-icon-CREATE_TRIP')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('assistant-next-action-icon-OPEN_STAY_SEARCH')
    ).toBeOnTheScreen();
  });

  it('TRIP-1529 · READY 면 행동 행에 아이콘이 없다', () => {
    renderView();
    expect(
      screen.getByTestId('assistant-next-action-OPEN_ITINERARY')
    ).toBeOnTheScreen();
    expect(
      screen.queryAllByTestId(/^assistant-next-action-icon-/)
    ).toHaveLength(0);
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

describe('헤더 (TRIP-1525 · 01b Q1)', () => {
  it('✦ 마크 + 닫기만 있고, 제목 "AI 도우미"·새 대화 아이콘은 없다', () => {
    renderView();

    expect(screen.getByTestId('assistant-sheet-mark')).toBeOnTheScreen();
    expect(
      screen.getByTestId('assistant-sheet-close').props.accessibilityLabel
    ).toBe('닫기');
    expect(screen.queryByText('AI 도우미')).toBeNull();
    expect(screen.queryByTestId('assistant-new-conversation')).toBeNull();
    expect(screen.queryByLabelText('새 대화')).toBeNull();
  });

  it('열기 로딩 중에도 ✦·닫기는 있고, 더보기 자리(headerTrailing)는 열린 뒤에만 그린다', () => {
    const trailing = <Text testID="trailing-stub">더보기</Text>;
    const loading = renderView({ state: 'LOADING', headerTrailing: trailing });
    expect(screen.getByTestId('assistant-sheet-mark')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('assistant-sheet-close'));
    expect(loading.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('trailing-stub')).toBeNull();
  });

  it('열린 상태(READY)에서는 headerTrailing 을 그린다', () => {
    renderView({
      headerTrailing: <Text testID="trailing-stub">더보기</Text>,
    });
    expect(screen.getByTestId('trailing-stub')).toBeOnTheScreen();
  });
});

describe('입력 카드 · 컨텍스트 칩 (TRIP-1526 · 01b Q3·Q4)', () => {
  const LABELS: [AssistantSurface, string][] = [
    ['ITINERARY', '이 일정에 관해 질문하기'],
    ['LIVE', '이 일정에 관해 질문하기'],
    ['STAY_DETAIL', '이 숙소에 관해 질문하기'],
    ['STAY_SEARCH', '이 검색 결과에 관해 질문하기'],
    ['HOME', '이 일정에 관해 질문하기'],
  ];

  it.each(LABELS)(
    'READY · surface %s 이면 칩 문구는 "%s" 다',
    (surface, label) => {
      renderView({ surface });
      const chip = screen.getByTestId('assistant-context-chip');
      expect(chip).toHaveTextContent(label);
      expect(chip.props.accessibilityRole).toBe('button');
    }
  );

  it('tripId 없음(NO_CONTEXT)이 surface 보다 우선한다 — 일정 화면에서 열어도 능력 보기', () => {
    renderView({
      state: 'NO_CONTEXT',
      surface: 'ITINERARY',
      contextChip: null,
    });
    expect(screen.getByTestId('assistant-context-chip')).toHaveTextContent(
      '내가 할 수 있는 것 보기'
    );
  });

  it('서버 contextChip 은 화면 텍스트가 아니라 칩의 접근성 라벨에 실린다(라벨 문구도 함께)', () => {
    renderView({ surface: 'STAY_DETAIL', contextChip: '서면 호텔 · 1박' });

    const chip = screen.getByTestId('assistant-context-chip');
    expect(screen.queryByText('서면 호텔 · 1박')).toBeNull();
    expect(chip.props.accessibilityLabel).toContain('서면 호텔 · 1박');
    expect(chip.props.accessibilityLabel).toContain('이 숙소에 관해 질문하기');
  });

  it('READY 칩을 누르면 입력에 포커스만 간다 — 보내기·능력 보기·입력 변경은 없다', () => {
    inputFocus.mockClear();
    const props = renderView({ surface: 'ITINERARY' });
    // 아직 포커스 호출 없음 — 앵커
    expect(inputFocus).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('assistant-context-chip'));

    expect(inputFocus).toHaveBeenCalledTimes(1);
    expect(props.onSend).not.toHaveBeenCalled();
    expect(props.onPressCapabilities).not.toHaveBeenCalled();
    expect(props.onChangeDraft).not.toHaveBeenCalled();
  });

  it('능력 보기 칩(NO_CONTEXT)은 포커스가 아니라 SHOW_CAPABILITIES 를 올린다', () => {
    inputFocus.mockClear();
    const props = renderView({
      state: 'NO_CONTEXT',
      surface: 'HOME',
      contextChip: null,
    });

    fireEvent.press(screen.getByTestId('assistant-context-chip'));

    expect(props.onPressCapabilities).toHaveBeenCalledTimes(1);
    expect(inputFocus).not.toHaveBeenCalled();
  });

  it('HOME + READY(진행 중 여행 있음) 칩은 "이 일정에 관해 질문하기" 이고 누르면 포커스다 — 문장을 보내지 않는다', () => {
    inputFocus.mockClear();
    const props = renderView({ state: 'READY', surface: 'HOME' });
    const chip = screen.getByTestId('assistant-context-chip');
    expect(chip).toHaveTextContent('이 일정에 관해 질문하기');
    // 아직 아무것도 안 불렸다 — 앵커
    expect(inputFocus).not.toHaveBeenCalled();

    fireEvent.press(chip);

    expect(inputFocus).toHaveBeenCalledTimes(1);
    expect(props.onPressCapabilities).not.toHaveBeenCalled();
    expect(props.onSend).not.toHaveBeenCalled();
  });

  // 분기는 라벨 문자열이 아니라 상태(NO_CONTEXT)로 가른다 — 6-b 실기에서 HOME 라벨이 능력 보기 문구와 같아
  // 눌렀더니 그 문장이 전송된 결함을 막는다.
  const SURFACES: AssistantSurface[] = [
    'HOME',
    'STAY_SEARCH',
    'ITINERARY',
    'LIVE',
    'STAY_DETAIL',
  ];

  it.each(SURFACES)(
    'READY · surface %s 칩은 능력 보기로 가지 않고 포커스만 한다',
    (surface) => {
      inputFocus.mockClear();
      const props = renderView({ state: 'READY', surface });

      fireEvent.press(screen.getByTestId('assistant-context-chip'));

      expect(inputFocus).toHaveBeenCalledTimes(1);
      expect(props.onPressCapabilities).not.toHaveBeenCalled();
    }
  );

  it.each(SURFACES)(
    'NO_CONTEXT · surface %s 칩은 포커스가 아니라 능력 보기를 올린다',
    (surface) => {
      inputFocus.mockClear();
      const props = renderView({
        state: 'NO_CONTEXT',
        surface,
        contextChip: null,
      });

      fireEvent.press(screen.getByTestId('assistant-context-chip'));

      expect(props.onPressCapabilities).toHaveBeenCalledTimes(1);
      expect(inputFocus).not.toHaveBeenCalled();
    }
  );

  it('+ 버튼은 없다(첨부 기능 없음 — 죽은 버튼 금지)', () => {
    renderView();
    expect(screen.queryByTestId('assistant-composer-plus')).toBeNull();
    expect(screen.queryByLabelText('추가')).toBeNull();
  });

  it('입력이 있으면 보내기가 활성이고 누르면 onSend 를 부른다', () => {
    const props = renderView({ canSend: true, draft: '안녕' });
    expect(
      screen.getByTestId('assistant-send').props.accessibilityState
    ).toEqual(expect.objectContaining({ disabled: false }));
    fireEvent.press(screen.getByTestId('assistant-send'));
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it('진행 줄(statusRow)은 같은 화면에 그려진다', () => {
    renderView({ statusRow: <Text testID="status-stub">진행</Text> });
    expect(screen.getByTestId('status-stub')).toBeOnTheScreen();
  });
});

describe('이력 보기(body) 중 틀 (W1)', () => {
  it('body 가 주어지면 대화 목록·quick reply·입력 카드·칩은 그리지 않고 body 만 그린다', () => {
    renderView({
      messages: sampleTranscript('review').messages,
      body: <Text testID="body-stub">이력</Text>,
    });

    expect(screen.getByTestId('body-stub')).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-message-list')).toBeNull();
    expect(screen.queryByTestId('assistant-quick-replies-row')).toBeNull();
    expect(screen.queryByTestId('assistant-quick-replies-stack')).toBeNull();
    expect(
      screen.queryByTestId('assistant-quick-reply-capabilities')
    ).toBeNull();
    expect(screen.queryByTestId('assistant-context-chip')).toBeNull();
    expect(screen.queryByTestId('assistant-input')).toBeNull();
    expect(screen.queryByTestId('assistant-send')).toBeNull();
  });

  it('body 가 있으면 키보드가 떠도 모드는 full 그대로다(compact·shrunk 로 가지 않는다)', () => {
    renderView({ messages: [], body: <Text testID="body-stub">이력</Text> });
    emitKeyboard('keyboardDidShow');

    expect(
      screen
        .queryAllByTestId(/^assistant-sheet-mode-/)
        .map((n) => n.props.testID)
    ).toEqual(['assistant-sheet-mode-full']);
    expect(screen.getByTestId('body-stub')).toBeOnTheScreen();
  });
});

describe('quick reply 배치 (TRIP-1526 · 01b Q8)', () => {
  it('대화가 없으면(인사만) 세로 스택이고 상시 칩이 맨 앞이다', () => {
    renderView({ messages: sampleTranscript('greeting').messages });

    expect(
      screen.getByTestId('assistant-quick-replies-stack')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-quick-replies-row')).toBeNull();
    const ids = screen
      .getAllByTestId(/^assistant-quick-reply-/)
      .map((node) => node.props.testID);
    expect(ids[0]).toBe('assistant-quick-reply-capabilities');
  });

  it('메시지가 아예 없어도 세로 스택이다', () => {
    renderView({ messages: [] });
    expect(
      screen.getByTestId('assistant-quick-replies-stack')
    ).toBeOnTheScreen();
  });

  it('사용자가 말한 대화가 있으면 가로 줄이고 상시 칩이 맨 앞이다', () => {
    renderView({ messages: sampleTranscript('review').messages });

    expect(screen.getByTestId('assistant-quick-replies-row')).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-quick-replies-stack')).toBeNull();
    const ids = screen
      .getAllByTestId(/^assistant-quick-reply-/)
      .map((node) => node.props.testID);
    expect(ids[0]).toBe('assistant-quick-reply-capabilities');
  });

  it.each([
    ['세로 스택', () => sampleTranscript('greeting')],
    ['가로 줄', () => sampleTranscript('review')],
  ])('%s 에서도 칩을 누르면 그 칩을 올린다', (_name, transcript) => {
    const { messages, quickReplies } = transcript();
    const props = renderView({ messages, quickReplies });
    const first = quickReplies[0];

    fireEvent.press(screen.getByTestId(`assistant-quick-reply-${first.id}`));

    expect(props.onPressQuickReply).toHaveBeenCalledWith(first);
  });

  it('repliesDisabled 이면 칩이 비활성이다(스택 모드)', () => {
    renderView({ messages: [], repliesDisabled: true });
    expect(
      screen.getByTestId('assistant-quick-reply-capabilities').props
        .accessibilityState
    ).toEqual(expect.objectContaining({ disabled: true }));
  });
});

describe('키보드 모드 (TRIP-1526 · 01b Q6)', () => {
  const MODE = /^assistant-sheet-mode-/;
  const modeIds = () =>
    screen.queryAllByTestId(MODE).map((node) => node.props.testID);
  const review = () => sampleTranscript('review').messages;

  it.each<KeyboardEventName>(['keyboardWillShow', 'keyboardDidShow'])(
    '%s · 대화 없음 + 키보드 → 작은 입력 카드(손잡이·본문 없음, 제안 칩 스택은 남는다)',
    (showEvent) => {
      renderView({ messages: [] });
      // 아직 full — 앞 케이스가 남긴 "떠 있음"이 새도 green 이 되는 것을 막는 앵커
      expect(modeIds()).toEqual(['assistant-sheet-mode-full']);
      expect(screen.getByTestId('assistant-sheet-handle')).toBeOnTheScreen();

      emitKeyboard(showEvent);

      expect(modeIds()).toEqual(['assistant-sheet-mode-compact']);
      expect(screen.queryByTestId('assistant-sheet-handle')).toBeNull();
      expect(screen.queryByTestId('assistant-message-list')).toBeNull();
      expect(screen.queryByTestId('assistant-quick-replies-row')).toBeNull();
      expect(screen.getByTestId('assistant-context-chip')).toBeOnTheScreen();
      expect(screen.getByTestId('assistant-input')).toBeOnTheScreen();
      expect(screen.getByTestId('assistant-send')).toBeOnTheScreen();
    }
  );

  it.each<KeyboardEventName>(['keyboardWillShow', 'keyboardDidShow'])(
    '%s · 대화 있음 + 키보드 → 패널이 줄어들지만 목록·칩·입력은 그대로 있다',
    (showEvent) => {
      renderView({ messages: review() });
      expect(modeIds()).toEqual(['assistant-sheet-mode-full']);

      emitKeyboard(showEvent);

      expect(modeIds()).toEqual(['assistant-sheet-mode-shrunk']);
      expect(screen.getByTestId('assistant-message-list')).toBeOnTheScreen();
      expect(screen.getByTestId('assistant-context-chip')).toBeOnTheScreen();
      expect(screen.getByTestId('assistant-input')).toBeOnTheScreen();
    }
  );

  it('TRIP-1527 · 줄어든(shrunk) 패널에서도 위로 올리면 ↓ 버튼이 나타난다', () => {
    renderView({ messages: review() });
    emitKeyboard('keyboardDidShow');
    expect(modeIds()).toEqual(['assistant-sheet-mode-shrunk']);
    expect(screen.queryByTestId('assistant-scroll-down')).toBeNull();

    fireEvent.scroll(screen.getByTestId('assistant-message-list'), {
      nativeEvent: {
        contentOffset: { x: 0, y: 300 },
        contentSize: { width: 390, height: 2000 },
        layoutMeasurement: { width: 390, height: 400 },
      },
    });

    expect(screen.getByTestId('assistant-scroll-down')).toBeOnTheScreen();
  });

  it.each<KeyboardEventName>(['keyboardWillHide', 'keyboardDidHide'])(
    '%s · 키보드를 내리면 원래 틀(full)로 돌아온다(대화 없음·있음 모두)',
    (hideEvent) => {
      renderView({ messages: [] });
      emitKeyboard('keyboardDidShow');
      expect(modeIds()).toEqual(['assistant-sheet-mode-compact']);

      emitKeyboard(hideEvent);

      expect(modeIds()).toEqual(['assistant-sheet-mode-full']);
      expect(screen.getByTestId('assistant-sheet-handle')).toBeOnTheScreen();
      expect(
        screen.getByTestId('assistant-quick-replies-stack')
      ).toBeOnTheScreen();
    }
  );

  it('대화 있음도 내리면 full 로 돌아온다', () => {
    renderView({ messages: review() });
    emitKeyboard('keyboardDidShow');
    expect(modeIds()).toEqual(['assistant-sheet-mode-shrunk']);

    emitKeyboard('keyboardWillHide');

    expect(modeIds()).toEqual(['assistant-sheet-mode-full']);
    expect(screen.getByTestId('assistant-quick-replies-row')).toBeOnTheScreen();
  });
});

const modeOf = () =>
  screen.queryAllByTestId(/^assistant-sheet-mode-/).map((n) => n.props.testID);

describe('키보드 + 대화 전: 제안 칩 스택이 카드 위에 남는다 (Figma bv3-입력(제안 칩))', () => {
  const greeting = () => sampleTranscript('greeting');

  it.each<KeyboardEventName>(['keyboardWillShow', 'keyboardDidShow'])(
    '%s · compact 에서도 세로 스택 칩이 입력 카드와 같이 그려지고 누르면 올린다',
    (showEvent) => {
      const { messages, quickReplies } = greeting();
      const props = renderView({ messages, quickReplies });
      // 키보드 전에는 스택이 이미 있다 — 앵커
      expect(
        screen.getByTestId('assistant-quick-replies-stack')
      ).toBeOnTheScreen();

      emitKeyboard(showEvent);

      expect(
        screen
          .queryAllByTestId(/^assistant-sheet-mode-/)
          .map((n) => n.props.testID)
      ).toEqual(['assistant-sheet-mode-compact']);
      expect(
        screen.getByTestId('assistant-quick-replies-stack')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('assistant-quick-replies-row')).toBeNull();
      expect(screen.getByTestId('assistant-input')).toBeOnTheScreen();
      expect(screen.getByTestId('assistant-send')).toBeOnTheScreen();
      // 본문·헤더·손잡이는 계속 없다
      expect(screen.queryByTestId('assistant-message-list')).toBeNull();
      expect(screen.queryByTestId('assistant-sheet-mark')).toBeNull();
      expect(screen.queryByTestId('assistant-sheet-close')).toBeNull();
      expect(screen.queryByTestId('assistant-sheet-handle')).toBeNull();
      const first = quickReplies[0];
      fireEvent.press(screen.getByTestId(`assistant-quick-reply-${first.id}`));
      expect(props.onPressQuickReply).toHaveBeenCalledWith(first);
    }
  );

  it('compact 에서도 상시 칩이 스택 맨 앞이다', () => {
    renderView({ messages: [] });
    emitKeyboard('keyboardDidShow');

    const ids = screen
      .getAllByTestId(/^assistant-quick-reply-/)
      .map((n) => n.props.testID);
    expect(ids[0]).toBe('assistant-quick-reply-capabilities');
  });

  it('대화가 있으면(shrunk) 가로 줄이 그대로 보존된다', () => {
    renderView({ messages: sampleTranscript('review').messages });
    emitKeyboard('keyboardDidShow');

    expect(modeOf()).toEqual(['assistant-sheet-mode-shrunk']);
    expect(screen.getByTestId('assistant-quick-replies-row')).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-quick-replies-stack')).toBeNull();
  });
});
