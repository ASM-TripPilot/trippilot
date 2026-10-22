import { DeviceEventEmitter, Keyboard, Text, TextInput } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type {
  AssistantSurface,
  ProposalStatus,
  QuickReply,
  QuickReplyAction,
} from '../api/assistantContract';
import {
  assistantSample,
  sampleActionLogs,
  sampleTranscript,
} from '../api/assistantSamples';
import { needsCapabilitiesChip } from '../model/sheetModel';
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
// (선례 useKeyboardVisible.test).
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

// TRIP-1567 — 컨텍스트 칩이 추천 질문 목록을 펼친다. 항목 testID 는 목록 안에서도, 카드 위 줄(되묻기 보기·재시도)에서도
// 같은 형식이라 "어디에 있나"를 가르려면 목록 범위(within)로 센다(02a ★2).
const REPLY_ID = /^assistant-quick-reply-/;
const LINE_ID = /^assistant-quick-replies-(stack|row)$/;
const chip = () => screen.getByTestId('assistant-context-chip');
const suggestionList = () => screen.queryByTestId('assistant-chip-suggestions');
const idsOf = (nodes: ReturnType<typeof screen.queryAllByTestId>): string[] =>
  nodes.map((node) => node.props.testID);
const listIds = () =>
  idsOf(
    within(screen.getByTestId('assistant-chip-suggestions')).queryAllByTestId(
      REPLY_ID
    )
  );
const allReplyIds = () => idsOf(screen.queryAllByTestId(REPLY_ID));
const lineIds = () =>
  screen
    .queryAllByTestId(LINE_ID)
    .flatMap((line) => idsOf(within(line).queryAllByTestId(REPLY_ID)));
const mkReply = (id: string, action: QuickReplyAction): QuickReply => ({
  id,
  label: `${id} 라벨`,
  action,
  params: {},
});

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
    // TRIP-1567 — quick reply 는 칩 안에 접혀 있다가 칩을 누르면 보인다(옛: 열자마자 줄로 보임).
    expect(allReplyIds()).toEqual([]);
    fireEvent.press(chip);
    transcript.quickReplies.forEach((reply) =>
      expect(
        screen.getByTestId(`assistant-quick-reply-${reply.id}`)
      ).toHaveTextContent(reply.label)
    );
  });

  it('BR-U8-04 · "내가 할 수 있는 것 보기"는 칩을 펼치면 늘 닿는다(TRIP-1567: 상시 = 열자마자 줄 → 한 번 눌러 닿는 목록)', () => {
    const props = renderView();
    // 펼치기 전엔 닿지 않는다 — 앵커(옛 계약: 열자마자 줄로 보였다)
    expect(
      screen.queryByTestId('assistant-quick-reply-capabilities')
    ).toBeNull();
    fireEvent.press(chip());
    fireEvent.press(screen.getByTestId('assistant-quick-reply-capabilities'));
    expect(props.onPressCapabilities).toHaveBeenCalledTimes(1);
  });

  it('TRIP-1436 Q-134 · 상시 칩이 추천 질문 목록의 맨 앞이다(서버 칩이 늘어도 뒤로 안 밀린다)', () => {
    renderView();
    fireEvent.press(chip());

    const ids = listIds();

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
    fireEvent.press(chip());

    const ids = listIds();

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
    // 접힌 quick reply 는 어차피 안 보여 이것만으론 공허하다 — 칩·입력 카드 자체가 없는 것을 함께 본다.
    expect(screen.queryByTestId('assistant-context-chip')).toBeNull();
    expect(screen.queryByTestId('assistant-input')).toBeNull();
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

  // TRIP-1567 — 옛 계약 "READY 칩 = 입력 포커스"는 뒤집혔다: 칩은 추천 질문을 펼치고 포커스는 하지 않는다.
  it('READY 칩을 누르면 포커스가 아니라 추천 질문이 펼쳐진다 — 보내기·능력 보기·입력 변경은 없다', () => {
    inputFocus.mockClear();
    const props = renderView({ surface: 'ITINERARY' });
    // 아직 포커스 호출도 목록도 없다 — 앵커
    expect(inputFocus).not.toHaveBeenCalled();
    expect(suggestionList()).toBeNull();

    fireEvent.press(chip());

    expect(inputFocus).not.toHaveBeenCalled();
    expect(suggestionList()).toBeOnTheScreen();
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

  it('HOME + READY(진행 중 여행 있음) 칩은 "이 일정에 관해 질문하기" 이고 누르면 펼쳐진다 — 능력 보기·문장 전송은 없다', () => {
    inputFocus.mockClear();
    const props = renderView({ state: 'READY', surface: 'HOME' });
    expect(chip()).toHaveTextContent('이 일정에 관해 질문하기');
    // 아직 아무것도 안 불렸다 — 앵커
    expect(inputFocus).not.toHaveBeenCalled();
    expect(suggestionList()).toBeNull();

    fireEvent.press(chip());

    expect(suggestionList()).toBeOnTheScreen();
    expect(inputFocus).not.toHaveBeenCalled();
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
    'READY · surface %s 칩은 능력 보기로 가지 않고 목록만 펼친다(포커스도 없다)',
    (surface) => {
      inputFocus.mockClear();
      const props = renderView({ state: 'READY', surface });

      fireEvent.press(chip());

      expect(suggestionList()).toBeOnTheScreen();
      expect(chip()).toBeExpanded();
      expect(inputFocus).not.toHaveBeenCalled();
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
      // TRIP-1567 — 능력 보기 칩은 펼치는 칩이 아니다: 목록도, 펼침 상태 표시(스크린리더가 "펼치기" 로 읽음)도 없다.
      expect(suggestionList()).toBeNull();
      expect(chip()).not.toBeExpanded();
      expect(chip()).not.toBeCollapsed();
      expect(chip().props.accessibilityState?.expanded).toBeUndefined();
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

// TRIP-1567 · 컨텍스트 칩 = 추천 질문 펼침. 옛 "quick reply 배치(대화 전 세로 스택/대화 중 가로 줄)" 계약(TRIP-1526 · 01b Q8)은
// 폐기했다 — READY 에서는 질문형 quick reply 가 입력 카드 안 칩 아래 목록으로 들어가고, 카드 위 줄에는 응답에 묶인 보기
// (되묻기 PICK_OPTION·재시도 RETRY)만 남는다. 줄의 얼굴(stack/row)은 굳히지 않는다(생김새 — 02a ★3).
// 못 보는 것(6-b): 카드가 위로 자라는 모양 · maxHeight 와의 충돌 · 키보드가 올라온 채 펼쳤을 때 입력칸 가림 · 포커스 유지.
describe('추천 질문 펼침 (TRIP-1567)', () => {
  const greeting = () => sampleTranscript('greeting');
  // 서버 목록 하나로 렌더하고, 상시 능력 칩 필요 여부는 page 가 하는 대로 계산한다.
  const renderWith = (
    quickReplies: QuickReply[],
    overrides: Partial<AssistantSheetViewProps> = {}
  ) =>
    renderView({
      quickReplies,
      showCapabilitiesChip: needsCapabilitiesChip(quickReplies),
      ...overrides,
    });

  let dismiss: jest.SpyInstance;
  beforeEach(() => {
    dismiss = jest.spyOn(Keyboard, 'dismiss');
  });
  afterEach(() => {
    dismiss.mockRestore();
  });

  it('처음 열면 접혀 있다 — 목록도 카드 위 질문 줄도 없고 칩과 입력만 있다 (AC 접힘 기본)', () => {
    renderView();

    // 칩이 접힌 펼침 버튼으로 있다 — 화면이 통째로 비어서 우연히 green 이 되는 것을 막는 앵커
    expect(chip()).toBeCollapsed();
    expect(screen.getByTestId('assistant-input')).toBeOnTheScreen();
    expect(suggestionList()).toBeNull();
    expect(allReplyIds()).toEqual([]);
    expect(screen.queryAllByTestId(LINE_ID)).toHaveLength(0);
  });

  it('칩을 누르면 펼치고 다시 누르면 접는다 — 입력칸 포커스·전송·능력 보기는 일어나지 않는다', () => {
    inputFocus.mockClear();
    const props = renderView();
    // 눌러 보기 전엔 아무것도 안 불렸다 — 앵커
    expect(inputFocus).not.toHaveBeenCalled();
    expect(chip()).toBeCollapsed();

    fireEvent.press(chip());
    expect(suggestionList()).toBeOnTheScreen();
    expect(chip()).toBeExpanded();

    fireEvent.press(chip());
    expect(suggestionList()).toBeNull();
    expect(chip()).toBeCollapsed();

    expect(inputFocus).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    expect(props.onSend).not.toHaveBeenCalled();
    expect(props.onChangeDraft).not.toHaveBeenCalled();
    expect(props.onPressCapabilities).not.toHaveBeenCalled();
    expect(props.onPressQuickReply).not.toHaveBeenCalled();
  });

  it('펼치면 항목이 이 순서로 있다 — 능력 보기 맨 앞, 서버 순서 그대로, 라벨은 서버 문구', () => {
    const { quickReplies } = greeting();
    renderWith(quickReplies);

    fireEvent.press(chip());

    expect(listIds()).toEqual([
      'assistant-quick-reply-capabilities',
      ...quickReplies.map((r) => `assistant-quick-reply-${r.id}`),
    ]);
    expect(
      screen.getByTestId('assistant-quick-reply-capabilities')
    ).toHaveTextContent('내가 할 수 있는 것 보기');
    quickReplies.forEach((r) =>
      expect(
        screen.getByTestId(`assistant-quick-reply-${r.id}`)
      ).toHaveTextContent(r.label)
    );
  });

  it('서버가 능력 보기를 목록 맨 끝에 줘도 맨 앞이고, 클라 합성 칩과 겹쳐 두 번 나오지 않는다', () => {
    const replies = [
      ...greeting().quickReplies,
      mkReply('qr-capabilities', 'SHOW_CAPABILITIES'),
    ];
    renderWith(replies);

    fireEvent.press(chip());

    expect(listIds()[0]).toBe('assistant-quick-reply-qr-capabilities');
    expect(listIds()).toHaveLength(replies.length);
  });

  it('후보 고르기(PICK_CANDIDATE)는 접혀 있어도 펼쳐도 어디에도 없다 — 후보 카드가 고르기를 맡는다', () => {
    const send = mkReply('qr-send', 'SEND_TEXT');
    renderWith([
      send,
      mkReply('qr-pick-a', 'PICK_CANDIDATE'),
      mkReply('qr-pick-b', 'PICK_CANDIDATE'),
    ]);
    expect(allReplyIds()).toEqual([]);

    fireEvent.press(chip());

    expect(allReplyIds().filter((id) => id.includes('qr-pick'))).toEqual([]);
    // 앵커 — 같은 목록의 질문형 항목은 펼침에 있다(분류가 전부 지운 게 아니다)
    expect(listIds()).toContain('assistant-quick-reply-qr-send');
  });

  it('되묻기 보기(PICK_OPTION)·재시도(RETRY)는 칩을 안 눌러도 카드 위 줄에 있고, 펼침 목록에는 없다 (BR-U8-11)', () => {
    const props = renderWith(
      [
        mkReply('qr-send', 'SEND_TEXT'),
        mkReply('qr-opt-a', 'PICK_OPTION'),
        mkReply('qr-opt-b', 'PICK_OPTION'),
        mkReply('qr-retry', 'RETRY'),
      ],
      { messages: sampleTranscript('review').messages }
    );
    const answers = [
      'assistant-quick-reply-qr-opt-a',
      'assistant-quick-reply-qr-opt-b',
      'assistant-quick-reply-qr-retry',
    ];

    // 접힌 채로도 답할 방법이 보인다
    expect(suggestionList()).toBeNull();
    expect(lineIds()).toEqual(answers);

    fireEvent.press(chip());

    expect(lineIds()).toEqual(answers);
    expect(listIds()).not.toEqual(expect.arrayContaining(answers));
    expect(listIds()).toContain('assistant-quick-reply-qr-send');

    fireEvent.press(screen.getByTestId('assistant-quick-reply-qr-opt-b'));
    expect(props.onPressQuickReply).toHaveBeenCalledTimes(1);
    expect(props.onPressQuickReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'qr-opt-b', action: 'PICK_OPTION' })
    );
  });

  it('응답 중(repliesDisabled)이면 카드 위 줄의 보기도 비활성이다 — 눌러도 아무것도 안 올린다', () => {
    const props = renderWith(
      [mkReply('qr-opt-a', 'PICK_OPTION'), mkReply('qr-retry', 'RETRY')],
      { repliesDisabled: true }
    );
    // 줄이 실제로 있다 — 앵커
    expect(lineIds()).toHaveLength(2);

    lineIds().forEach((id) => {
      expect(screen.getByTestId(id).props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true })
      );
      fireEvent.press(screen.getByTestId(id));
    });

    expect(props.onPressQuickReply).not.toHaveBeenCalled();
  });

  it.each([
    ['대화 전(인사만)', () => sampleTranscript('greeting')],
    ['대화 중(사용자 말 있음)', () => sampleTranscript('review')],
  ])(
    '%s 에도 카드 위에 질문 줄이 남지 않는다 — 화면의 모든 quick reply 가 펼침 목록 안에 있다 (AC 금지)',
    (_name, transcript) => {
      const { messages, quickReplies } = transcript();
      renderWith(quickReplies, { messages });
      // 접힘 — 줄 없음 + 칩은 있음(앵커)
      expect(chip()).toBeCollapsed();
      expect(screen.queryAllByTestId(LINE_ID)).toHaveLength(0);

      fireEvent.press(chip());

      expect(screen.queryAllByTestId(LINE_ID)).toHaveLength(0);
      expect(listIds().length).toBeGreaterThan(0);
      // 개수 등식 — 목록과 줄에 같은 칩을 이중으로 그리면 화면 전체가 목록보다 많아진다
      expect(allReplyIds()).toEqual(listIds());
    }
  );

  it.each([0, 1, 2])(
    '서버 항목 #%i 를 누르면 그 reply 로 전송을 1회 올리고 목록이 접히고 키보드를 내린다 (AC 항목 누름)',
    (index) => {
      const { messages, quickReplies } = greeting();
      const props = renderWith(quickReplies, { messages });
      fireEvent.press(chip());
      // 펼치는 것만으로는 키보드를 내리지 않는다 — 앵커
      expect(dismiss).not.toHaveBeenCalled();
      const picked = quickReplies[index];

      fireEvent.press(screen.getByTestId(`assistant-quick-reply-${picked.id}`));

      expect(props.onPressQuickReply).toHaveBeenCalledTimes(1);
      expect(props.onPressQuickReply).toHaveBeenCalledWith(picked);
      expect(props.onSend).not.toHaveBeenCalled();
      expect(props.onChangeDraft).not.toHaveBeenCalled();
      expect(props.onPressCapabilities).not.toHaveBeenCalled();
      expect(suggestionList()).toBeNull();
      expect(chip()).toBeCollapsed();
      expect(dismiss).toHaveBeenCalledTimes(1);
    }
  );

  it('능력 보기 항목 · 클라 합성 항목은 onPressCapabilities 를 올리고 접히고 키보드를 내린다', () => {
    const first = renderView();
    fireEvent.press(chip());
    fireEvent.press(screen.getByTestId('assistant-quick-reply-capabilities'));
    expect(first.onPressCapabilities).toHaveBeenCalledTimes(1);
    expect(first.onPressQuickReply).not.toHaveBeenCalled();
    expect(suggestionList()).toBeNull();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('능력 보기 항목 · 서버가 발급한 SHOW_CAPABILITIES 는 그 reply 로 올린다(능력 보기 콜백이 아니다)', () => {
    const issued = mkReply('qr-capabilities', 'SHOW_CAPABILITIES');
    const props = renderWith([issued, mkReply('qr-send', 'SEND_TEXT')]);
    fireEvent.press(chip());

    fireEvent.press(
      screen.getByTestId('assistant-quick-reply-qr-capabilities')
    );

    expect(props.onPressQuickReply).toHaveBeenCalledTimes(1);
    expect(props.onPressQuickReply).toHaveBeenCalledWith(issued);
    expect(props.onPressCapabilities).not.toHaveBeenCalled();
    expect(suggestionList()).toBeNull();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('응답 중(repliesDisabled)에는 항목이 비활성이라 눌러도 전송·접힘·키보드가 없고, 칩 토글은 그대로 된다 (AC 비활성)', () => {
    const props = renderView({ repliesDisabled: true });

    // 칩 토글은 응답 중에도 된다 — "눌렀는데 아무 일도 없음" 이 이번 티켓의 원 결함이다
    fireEvent.press(chip());
    expect(chip()).toBeExpanded();
    const ids = listIds();
    expect(ids.length).toBeGreaterThan(1);

    ids.forEach((id) => {
      expect(screen.getByTestId(id).props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true })
      );
      fireEvent.press(screen.getByTestId(id));
    });

    expect(props.onPressQuickReply).not.toHaveBeenCalled();
    expect(props.onPressCapabilities).not.toHaveBeenCalled();
    expect(suggestionList()).toBeOnTheScreen();
    expect(dismiss).not.toHaveBeenCalled();

    fireEvent.press(chip());
    expect(suggestionList()).toBeNull();
    fireEvent.press(chip());
    expect(suggestionList()).toBeOnTheScreen();
  });

  it('키보드가 떠도(compact) 펼친 목록은 그대로 있고 입력 카드도 사라지지 않는다 — 칩은 포커스를 건드리지 않는다', () => {
    inputFocus.mockClear();
    renderView();
    // 키보드 전엔 full — 앞 케이스가 남긴 compact 가 새서 green 이 되는 것을 막는 앵커
    expect(
      screen
        .queryAllByTestId(/^assistant-sheet-mode-/)
        .map((n) => n.props.testID)
    ).toEqual(['assistant-sheet-mode-full']);
    fireEvent.press(chip());
    expect(suggestionList()).toBeOnTheScreen();

    emitKeyboard('keyboardDidShow');

    expect(
      screen
        .queryAllByTestId(/^assistant-sheet-mode-/)
        .map((n) => n.props.testID)
    ).toEqual(['assistant-sheet-mode-compact']);
    expect(suggestionList()).toBeOnTheScreen();
    expect(chip()).toBeExpanded();
    expect(screen.getByTestId('assistant-input')).toBeOnTheScreen();
    expect(inputFocus).not.toHaveBeenCalled();
  });

  it('키보드 + 대화 전(compact)에는 카드 위에 줄이 없고, 카드 안에서 칩을 눌러 펼쳐 항목을 보낼 수 있다', () => {
    const { messages, quickReplies } = greeting();
    const props = renderView({ messages, quickReplies });
    emitKeyboard('keyboardDidShow');
    expect(
      screen
        .queryAllByTestId(/^assistant-sheet-mode-/)
        .map((n) => n.props.testID)
    ).toEqual(['assistant-sheet-mode-compact']);
    expect(chip()).toBeCollapsed();
    expect(screen.queryAllByTestId(LINE_ID)).toHaveLength(0);
    expect(allReplyIds()).toEqual([]);

    fireEvent.press(chip());
    const first = quickReplies[0];
    fireEvent.press(screen.getByTestId(`assistant-quick-reply-${first.id}`));

    expect(props.onPressQuickReply).toHaveBeenCalledWith(first);
    expect(suggestionList()).toBeNull();
  });
});

describe('상시 능력 칩 중복 제거 (TRIP-1531 결함 3)', () => {
  const noContext = () => {
    const transcript = sampleTranscript('no-context', null);
    return {
      state: 'NO_CONTEXT' as const,
      contextChip: null,
      messages: transcript.messages,
      quickReplies: transcript.quickReplies,
      showCapabilitiesChip: true,
    };
  };

  it('NO_CONTEXT 면 입력 칩이 이미 능력 보기라 빠른 답 줄의 상시 능력 칩은 그리지 않는다', () => {
    renderView(noContext());

    expect(screen.getByTestId('assistant-context-chip')).toHaveTextContent(
      '내가 할 수 있는 것 보기'
    );
    expect(
      screen.queryByTestId('assistant-quick-reply-capabilities')
    ).toBeNull();
  });

  it('상시 칩이 사라져도 능력 보기 진입은 입력 칩으로 가능하다', () => {
    const props = renderView(noContext());

    fireEvent.press(screen.getByTestId('assistant-context-chip'));

    expect(props.onPressCapabilities).toHaveBeenCalledTimes(1);
  });

  it('NO_CONTEXT 에서도 서버 quick reply 는 그대로 그린다', () => {
    const base = noContext();
    renderView(base);

    base.quickReplies.forEach((reply) =>
      expect(
        screen.getByTestId(`assistant-quick-reply-${reply.id}`)
      ).toBeOnTheScreen()
    );
  });

  it('NO_CONTEXT 면 서버가 준 SHOW_CAPABILITIES 칩도 줄에서 뺀다 — 다른 서버 칩은 그대로', () => {
    const base = noContext();
    const serverCapabilities = {
      id: 'qr-capabilities',
      label: '내가 할 수 있는 것 보기',
      action: 'SHOW_CAPABILITIES' as const,
      params: {},
    };
    renderView({
      ...base,
      quickReplies: [serverCapabilities, ...base.quickReplies],
      showCapabilitiesChip: false,
    });

    expect(
      screen.queryByTestId('assistant-quick-reply-qr-capabilities')
    ).toBeNull();
    base.quickReplies.forEach((reply) =>
      expect(
        screen.getByTestId(`assistant-quick-reply-${reply.id}`)
      ).toBeOnTheScreen()
    );
  });

  // TRIP-1567 — READY 의 "줄에 남는다"는 "펼침 목록 안에 있다"로 바뀌었다(NO_CONTEXT 위 3건은 줄 그대로).
  it('READY 면 서버 SHOW_CAPABILITIES 칩이 펼침 목록에 남는다', () => {
    renderView({
      quickReplies: [
        {
          id: 'qr-capabilities',
          label: '내가 할 수 있는 것 보기',
          action: 'SHOW_CAPABILITIES' as const,
          params: {},
        },
      ],
      showCapabilitiesChip: false,
    });
    fireEvent.press(chip());

    expect(listIds()).toEqual(['assistant-quick-reply-qr-capabilities']);
  });

  it('READY 는 상시 능력 칩이 펼침 목록에 남는다(BR-U8-04)', () => {
    renderView({ state: 'READY', showCapabilitiesChip: true });
    fireEvent.press(chip());

    expect(
      within(screen.getByTestId('assistant-chip-suggestions')).getByTestId(
        'assistant-quick-reply-capabilities'
      )
    ).toBeOnTheScreen();
  });
});

describe('키보드 모드 (TRIP-1526 · 01b Q6)', () => {
  const MODE = /^assistant-sheet-mode-/;
  const modeIds = () =>
    screen.queryAllByTestId(MODE).map((node) => node.props.testID);
  const review = () => sampleTranscript('review').messages;

  it.each<KeyboardEventName>(['keyboardWillShow', 'keyboardDidShow'])(
    '%s · 대화 없음 + 키보드 → 작은 입력 카드(손잡이·본문 없음, 카드 위 줄도 없다)',
    (showEvent) => {
      renderView({ messages: [] });
      // 아직 full — 앞 케이스가 남긴 "떠 있음"이 새도 green 이 되는 것을 막는 앵커
      expect(modeIds()).toEqual(['assistant-sheet-mode-full']);
      expect(screen.getByTestId('assistant-sheet-handle')).toBeOnTheScreen();

      emitKeyboard(showEvent);

      expect(modeIds()).toEqual(['assistant-sheet-mode-compact']);
      expect(screen.queryByTestId('assistant-sheet-handle')).toBeNull();
      expect(screen.queryByTestId('assistant-message-list')).toBeNull();
      expect(screen.queryAllByTestId(LINE_ID)).toHaveLength(0);
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
      // TRIP-1567 — 내려와도 카드 위 줄은 없고 칩만 있다(접힌 기본값)
      expect(screen.getByTestId('assistant-context-chip')).toBeOnTheScreen();
      expect(screen.queryAllByTestId(LINE_ID)).toHaveLength(0);
    }
  );

  it('대화 있음도 내리면 full 로 돌아온다', () => {
    renderView({ messages: review() });
    emitKeyboard('keyboardDidShow');
    expect(modeIds()).toEqual(['assistant-sheet-mode-shrunk']);

    emitKeyboard('keyboardWillHide');

    expect(modeIds()).toEqual(['assistant-sheet-mode-full']);
    // TRIP-1567 — 옛: 가로 줄이 돌아온다. 새: 줄이 없고 칩이 돌아온다
    expect(screen.getByTestId('assistant-context-chip')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(LINE_ID)).toHaveLength(0);
  });
});
