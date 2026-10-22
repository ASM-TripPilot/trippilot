import type { ReactElement } from 'react';
import { FlatList, Image, View } from 'react-native';
import Svg from 'react-native-svg';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { AssistantMessage, NextAction } from '../api/assistantContract';
import { assistantSample, userMessage } from '../api/assistantSamples';
import { MessageCard } from './AssistantCards';
import { MessageList, type MessageListProps } from './MessageList';

/**
 * TRIP-1527 · 대화 목록 — 도우미 답은 평문(`assistant-message-text-*`), 사용자 말은 말풍선, ↓ 버튼, 응답 실패 중복 평문 생략.
 * 평문 색·말풍선 색/반경·간격·↓ 버튼 모양/위치·위쪽 페이드는 jest 사각(6-b/시뮬).
 */

const noop = () => undefined;

function renderList(overrides: Partial<MessageListProps> = {}) {
  const props: MessageListProps = {
    messages: [],
    onPressAction: jest.fn(),
    ...overrides,
  };
  const view = render(<MessageList {...props} />);
  return { props, ...view };
}

function withCards(onPressAction = jest.fn()): Partial<MessageListProps> {
  return {
    onPressAction,
    renderCard: (message) =>
      MessageCard({ message, onPressAction, onPickCandidate: noop }),
  };
}

function textMessage(id: string, text: string): AssistantMessage {
  return {
    id,
    role: 'ASSISTANT',
    kind: 'TEXT',
    text,
    nextActions: [],
    createdAt: '',
  };
}

// 화면 트리의 testID 를 위→아래(그려지는 순서) 로 모은다.
type Node = ReturnType<typeof screen.toJSON>;
function testIdsInOrder(node: Node, out: string[] = []): string[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((child) => testIdsInOrder(child, out));
    return out;
  }
  const id = (node.props as { testID?: string }).testID;
  if (id) out.push(id);
  node.children?.forEach((child) => {
    if (typeof child !== 'string') testIdsInOrder(child, out);
  });
  return out;
}

describe('MessageList · 도우미 답은 평문, 사용자 말은 말풍선 (TRIP-1527)', () => {
  it('도우미 답: 본문이 평문 요소에 있고 ✦ 아바타(Svg)가 없다', () => {
    renderList({ messages: [textMessage('a1', '지금 날씨예요.')] });

    expect(screen.getByTestId('assistant-message-text-a1')).toHaveTextContent(
      '지금 날씨예요.'
    );
    // 행동·카드가 없는 답이라 이 블록 안의 Svg 는 옛 ✦ 아바타뿐이었다
    const block = screen.getByTestId('assistant-message-a1');
    expect(within(block).UNSAFE_queryAllByType(Svg)).toHaveLength(0);
  });

  it('사용자 말: 기존 말풍선 testID 로 그려지고 평문 요소는 없다', () => {
    renderList({ messages: [userMessage('u1', '조용한 카페로 바꿔줘')] });

    expect(screen.getByTestId('assistant-user-bubble-u1')).toHaveTextContent(
      '조용한 카페로 바꿔줘'
    );
    expect(screen.queryByTestId('assistant-message-text-u1')).toBeNull();
  });

  it('한 답의 순서: 본문 → 카드 → 다음 행동 → 각주 → 평가 줄', () => {
    const message: AssistantMessage = {
      ...textMessage('o1', '정리했어요.'),
      nextActions: [{ type: 'OPEN_ITINERARY', label: '일정 보기', params: {} }],
      footnote: '* 서버 각주',
    };
    renderList({
      messages: [message],
      renderCard: () => <View testID="card-stub" />,
      renderFeedback: () => <View testID="feedback-stub" />,
    });

    const ids = testIdsInOrder(screen.toJSON());
    const order = [
      'assistant-message-text-o1',
      'card-stub',
      'assistant-next-action-OPEN_ITINERARY',
      'assistant-footnote-o1',
      'feedback-stub',
    ].map((id) => ids.indexOf(id));
    expect(order).not.toContain(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('MessageList · 뒤집힌(inverted) 목록 (TRIP-1527 · 심판 W1)', () => {
  it('FlatList 는 inverted 이고 최신 메시지가 데이터 맨 앞(index 0)에 온다 — ↓ 의 offset 0 = 맨 아래 전제', () => {
    renderList({
      messages: [
        userMessage('u1', '첫 질문'),
        textMessage('a1', '첫 답'),
        userMessage('u2', '둘째 질문'),
      ],
    });

    expect(screen.getByTestId('assistant-message-list').props.inverted).toBe(
      true
    );
    // 그려진 순서(위→아래 DOM)는 데이터 순서 = 최신 → 오래된 것
    const ids = testIdsInOrder(screen.toJSON());
    const pos = (id: string) => ids.indexOf(id);
    expect(pos('assistant-user-bubble-u2')).toBeGreaterThan(-1);
    expect(pos('assistant-user-bubble-u2')).toBeLessThan(
      pos('assistant-message-a1')
    );
    expect(pos('assistant-message-a1')).toBeLessThan(
      pos('assistant-user-bubble-u1')
    );
  });
});

describe('MessageList · 응답 실패 중복 평문 생략 (TRIP-1528 · 01b Q6)', () => {
  it('평문과 카드 문구가 같은 문장이면 카드만 그린다(문장 1번) — [다시 시도]는 그대로', () => {
    const message = assistantSample('fallback-error', { id: 'f1' });
    const onPressAction = jest.fn();
    renderList({ messages: [message], ...withCards(onPressAction) });

    // 조건 앵커: 샘플이 정말 같은 문장을 두 군데(text · payload.notice)에 싣는다
    expect(message.text).toBe('지금 도우미가 응답하지 못했어요.');
    expect(screen.queryByTestId('assistant-message-text-f1')).toBeNull();
    expect(
      screen.getAllByText('지금 도우미가 응답하지 못했어요.')
    ).toHaveLength(1);
    expect(screen.getByTestId('assistant-fallback')).toHaveTextContent(
      '지금 도우미가 응답하지 못했어요.',
      { exact: false }
    );
    fireEvent.press(screen.getByTestId('assistant-fallback-retry'));
    expect(onPressAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RETRY_TURN' })
    );
    // 심판 W3 — 스크린리더가 버튼으로 읽는다(역할 + 서버 라벨 '다시 시도')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBe(
      screen.getByTestId('assistant-fallback-retry')
    );
  });

  it('문구가 다르면 평문과 카드 둘 다 그린다(솔버 불가 — 직접 편집·나중에 출구 유지, 재시도 행은 만들지 않는다)', () => {
    const message = assistantSample('fallback-solver', { id: 'f2' });
    const onPressAction = jest.fn();
    renderList({ messages: [message], ...withCards(onPressAction) });

    expect(screen.getByTestId('assistant-message-text-f2')).toHaveTextContent(
      '지금은 시간·동선 검증을 할 수 없어요',
      { exact: false }
    );
    expect(screen.getByTestId('assistant-fallback')).toHaveTextContent(
      '추측으로 시각을 채우지 않아요',
      { exact: false }
    );
    const edit = screen.getByTestId(
      'assistant-next-action-OPEN_ITINERARY_EDIT'
    );
    expect(edit).toHaveTextContent('직접 편집');
    fireEvent.press(edit);
    expect(onPressAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'OPEN_ITINERARY_EDIT' })
    );
    const exit = screen.getByTestId('assistant-fallback-continue');
    expect(exit).toHaveTextContent('나중에');
    fireEvent.press(exit);
    expect(onPressAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'CONTINUE_WITHOUT_ASSISTANT' })
    );
    expect(screen.queryByText(/결정론/)).toBeNull();
    expect(screen.queryByTestId('assistant-fallback-retry')).toBeNull();
  });

  it('카드에 notice 가 없으면 평문을 지우지 않는다(안내가 통째로 사라지면 안 된다)', () => {
    const message: AssistantMessage = {
      id: 'f3',
      role: 'ASSISTANT',
      kind: 'FALLBACK',
      text: '잠시 후 다시 시도해 주세요.',
      payload: { cause: 'AI_UNAVAILABLE' },
      nextActions: [],
      createdAt: '',
    };
    renderList({ messages: [message], ...withCards() });

    expect(screen.getByTestId('assistant-message-text-f3')).toHaveTextContent(
      '잠시 후 다시 시도해 주세요.'
    );
  });
});

describe('MessageList · 접근성 (심판 W3)', () => {
  it('다음 행동 행 카드는 서버 라벨을 이름으로 가진 버튼이다', () => {
    const message: AssistantMessage = {
      ...textMessage('n1', '정리했어요.'),
      nextActions: [{ type: 'OPEN_ITINERARY', label: '일정 보기', params: {} }],
    };
    renderList({ messages: [message] });

    expect(screen.getByRole('button', { name: '일정 보기' })).toBe(
      screen.getByTestId('assistant-next-action-OPEN_ITINERARY')
    );
  });
});

describe('MessageList · 범위 밖 카드 (TRIP-1528 · 01b Q5)', () => {
  it('썸네일 이미지·두 번째 평문 문장 없이, 평문은 서버 문장 하나이고 OTA 위임은 카드에만 한 번', () => {
    const message = assistantSample('scope', { id: 's1' });
    const onPressAction = jest.fn();
    renderList({ messages: [message], ...withCards(onPressAction) });

    const card = screen.getByTestId('assistant-scope-card');
    expect(within(card).UNSAFE_queryAllByType(Image)).toHaveLength(0);
    expect(screen.queryByText(/솔버가 확인해요/)).toBeNull();
    expect(screen.getByTestId('assistant-message-text-s1')).toHaveTextContent(
      message.text ?? ''
    );
    expect(screen.queryByTestId('assistant-next-action-OPEN_OTA')).toBeNull();
    fireEvent.press(screen.getByTestId('assistant-scope-ota'));
    expect(onPressAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OPEN_OTA' })
    );
  });
});

describe('MessageList · 아래로 가기(↓) 버튼 (TRIP-1527 · 01b Q3)', () => {
  const DOWN = 'assistant-scroll-down';
  // 반드시 contentSize·layoutMeasurement 까지 싣는다 — contentOffset 만 있으면 VirtualizedList 가 던진다(02a ★3)
  const scrollTo = (y: number) =>
    fireEvent.scroll(screen.getByTestId('assistant-message-list'), {
      nativeEvent: {
        contentOffset: { x: 0, y },
        contentSize: { width: 390, height: 2000 },
        layoutMeasurement: { width: 390, height: 600 },
      },
    });
  const three = () => [
    userMessage('u1', '일정 검토해줘'),
    assistantSample('review', { id: 'a1' }),
    userMessage('u2', '다음 장소는?'),
  ];

  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(FlatList.prototype, 'scrollToOffset');
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it('맨 아래(offset 0)에서는 없고, 위로 올리면 나타나고, 다시 맨 아래로 오면 사라진다', () => {
    renderList({ messages: three() });
    expect(screen.queryByTestId(DOWN)).toBeNull();

    scrollTo(10); // ≈40px 임계값 안쪽 — 아직 "맨 아래 근처"
    expect(screen.queryByTestId(DOWN)).toBeNull();

    scrollTo(300);
    expect(screen.getByTestId(DOWN)).toBeOnTheScreen();

    scrollTo(0);
    expect(screen.queryByTestId(DOWN)).toBeNull();
  });

  it('누르면 맨 아래(inverted 의 offset 0)로 애니메이션 이동한다', () => {
    renderList({ messages: three() });
    scrollTo(300);
    expect(spy).not.toHaveBeenCalled();

    // 심판 W3 — 버튼 역할 + 접근성 라벨(구현에 있는 문구 '맨 아래로')
    expect(screen.getByRole('button', { name: '맨 아래로' })).toBe(
      screen.getByTestId(DOWN)
    );
    fireEvent.press(screen.getByTestId(DOWN));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it('위로 올려 둔 채 새 답이 와도 자동으로 내리지 않고 버튼은 그대로 남는다', () => {
    const { rerender, props } = renderList({ messages: three() });
    scrollTo(300);
    expect(screen.getByTestId(DOWN)).toBeOnTheScreen();

    const arrived: ReactElement = (
      <MessageList
        {...props}
        messages={[...three(), assistantSample('next-slot', { id: 'a2' })]}
      />
    );
    rerender(arrived);

    expect(screen.getByTestId('assistant-message-a2')).toBeOnTheScreen();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId(DOWN)).toBeOnTheScreen();
  });
});

describe('MessageList · next action 행 모양 가름 (TRIP-1529 · 01b Q6)', () => {
  const createTrip = {
    type: 'CREATE_TRIP',
    label: '새 여행 만들기',
    params: {},
  };
  const withAction = (): AssistantMessage => ({
    ...textMessage('n2', '도와드릴게요.'),
    nextActions: [createTrip],
  });

  it('noContext 면 행에 앞 아이콘이 있고, 터치는 행 전체로 그 행동을 올린다', () => {
    const { props } = renderList({ messages: [withAction()], noContext: true });

    expect(
      screen.getByTestId('assistant-next-action-icon-CREATE_TRIP')
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('assistant-next-action-CREATE_TRIP'));
    expect(props.onPressAction).toHaveBeenCalledWith(createTrip);
  });

  it.each([
    ['noContext 미지정', {}],
    ['noContext=false', { noContext: false }],
  ])(
    '%s 면 링크 행이라 아이콘이 없다(같은 행 testID·터치는 그대로)',
    (_l, extra) => {
      const { props } = renderList({ messages: [withAction()], ...extra });

      expect(
        screen.queryByTestId('assistant-next-action-icon-CREATE_TRIP')
      ).toBeNull();
      fireEvent.press(screen.getByTestId('assistant-next-action-CREATE_TRIP'));
      expect(props.onPressAction).toHaveBeenCalledWith(createTrip);
    }
  );
});

// TRIP-1564 — 후보 카드가 "장소 보기"(OPEN) 얼굴이면 같은 장소의 빨간 행은 숨긴다(카드가 그 행의 일을 한다).
// 고르기(PICK) 카드의 행은 그대로 둔다. 숨긴 뒤 줄이 비면 빈 버튼 줄 껍데기도 그리지 않는다.
describe('MessageList · 후보 카드와 버튼 줄', () => {
  const openPlace = (poiId: string, label: string): NextAction => ({
    type: 'OPEN_PLACE',
    label,
    params: { poiId },
  });
  const itinerary: NextAction = {
    type: 'OPEN_ITINERARY',
    label: '일정 보기',
    params: {},
  };
  function candidatesMessage(
    id: string,
    poiIds: string[],
    parts: { nextActions?: NextAction[]; pickPoiIds?: string[] }
  ): AssistantMessage {
    return {
      id,
      role: 'ASSISTANT',
      kind: 'CANDIDATES',
      text: '이런 곳이 있어요.',
      payload: {
        candidates: poiIds.map((poiId) => ({
          poiId,
          name: `이름-${poiId}`,
          reason: '이유',
        })),
      },
      nextActions: parts.nextActions ?? [],
      quickReplies: (parts.pickPoiIds ?? []).map((poiId) => ({
        id: `qr-pick-${poiId}`,
        label: `${poiId} 고르기`,
        action: 'PICK_CANDIDATE' as const,
        params: { poiId },
      })),
      createdAt: '',
    };
  }
  const rows = () =>
    screen.queryAllByTestId('assistant-next-action-OPEN_PLACE');
  // 한 메시지가 그리는 View 개수 — 빈 버튼 줄 껍데기는 testID 가 없어 개수 차이로만 보인다.
  function viewCount(message: AssistantMessage): number {
    const { unmount } = renderList({ messages: [message], ...withCards() });
    const count = within(
      screen.getByTestId(`assistant-message-${message.id}`)
    ).UNSAFE_queryAllByType(View).length;
    unmount();
    return count;
  }

  it('장소 보기 카드의 같은 장소 행은 없다(같은 장소가 둘이어도 둘 다). 카드에 없는 장소 행·다른 type 행은 남는다', () => {
    renderList({
      messages: [
        candidatesMessage('c1', ['a', 'b'], {
          nextActions: [
            openPlace('a', '장소-a'),
            openPlace('a', '장소-a(중복)'),
            openPlace('z', '장소-z'),
            itinerary,
          ],
        }),
      ],
      ...withCards(),
    });

    // 존재 앵커 — 카드는 그려졌고, 남아야 할 행은 남았다
    expect(screen.getByTestId('assistant-candidate-a')).toBeOnTheScreen();
    expect(
      screen.getByTestId('assistant-next-action-OPEN_ITINERARY')
    ).toBeOnTheScreen();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('장소-z');
  });

  it('고르기 카드는 같은 장소의 OPEN_PLACE 행을 숨기지 않는다(카드가 장소 보기가 아니므로)', () => {
    renderList({
      messages: [
        candidatesMessage('c1', ['a'], {
          pickPoiIds: ['a'],
          nextActions: [openPlace('a', '장소-a')],
        }),
      ],
      ...withCards(),
    });

    expect(screen.getByTestId('assistant-candidate-a')).toBeOnTheScreen();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('장소-a');
  });

  it('행이 전부 숨겨지면 빈 버튼 줄도 안 그린다 — 행동 없는 메시지와 같은 모양이고, 행이 남으면 더 그린다', () => {
    const hidden = candidatesMessage('h', ['a'], {
      nextActions: [openPlace('a', '장소-a')],
    });
    // 같은 카드 얼굴(고르기)에 행동이 아예 없는 메시지 — 버튼 줄이 있을 수 없는 기준선
    const baseline = candidatesMessage('b', ['a'], { pickPoiIds: ['a'] });
    // 앵커: 행이 하나 남는 메시지는 기준선보다 View 가 많다(개수가 의미 있다는 증거)
    const oneRow = candidatesMessage('o', ['a'], {
      pickPoiIds: ['a'],
      nextActions: [itinerary],
    });

    expect(viewCount(oneRow)).toBeGreaterThan(viewCount(baseline));
    expect(viewCount(hidden)).toBe(viewCount(baseline));

    renderList({ messages: [hidden], ...withCards() });
    expect(screen.queryAllByTestId(/^assistant-next-action-/)).toHaveLength(0);
  });
});
