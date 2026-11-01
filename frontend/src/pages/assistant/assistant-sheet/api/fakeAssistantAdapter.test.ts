import { AssistantApiError } from './assistantPort';
import type {
  AssistantMessage,
  FeedbackReason,
  FeedbackRequest,
  SendTurnRequest,
} from './assistantContract';
import { sampleLongConversation } from './assistantSamples';
import { FakeAssistantAdapter, fakeWithHistory } from './fakeAssistantAdapter';

/**
 * TRIP-1319 — 가짜 서버가 실물보다 관대하지 않은가만 본다(위조 차단·멱등·제안 상태기계·404·400·커서/limit 거절).
 * 가짜가 관대하면 이 가짜를 서버로 쓰는 `AssistantSheetPage` 테스트들이 공허해진다. 계약 모양·시나리오 흉내 같은
 * 가짜 자체의 충실도는 오라클 자기검증이라 두지 않는다(jest 축소 2026-11-01, L5 §5-2 (b)).
 */

function textTurn(clientTurnId: string, text: string): SendTurnRequest {
  return {
    clientTurnId,
    input: { type: 'TEXT', text },
    screen: { surface: 'ITINERARY' },
  };
}

async function proposalFrom(
  fake: FakeAssistantAdapter,
  sessionId: string,
  text: string
): Promise<AssistantMessage> {
  const response = await fake.sendTurn(sessionId, textTurn(`t-${text}`, text));
  const message = response.messages.find((item) => item.proposal);
  if (!message) throw new Error('제안 없음');
  return message;
}

async function rejection(
  promise: Promise<unknown>
): Promise<AssistantApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AssistantApiError) return error;
    throw error;
  }
  throw new Error('거절되지 않았다');
}

describe('FakeAssistantAdapter (TRIP-1319)', () => {
  it('INV-U8-05 · 같은 clientTurnId 를 다시 보내면 같은 응답이고 메시지가 늘지 않는다', async () => {
    const fake = new FakeAssistantAdapter();
    const { session } = await fake.openSession({ tripId: 'trip-1' });
    const first = await fake.sendTurn(session.id, textTurn('same', '날씨'));
    const second = await fake.sendTurn(session.id, textTurn('same', '날씨'));
    expect(second).toBe(first);
    const { messages } = await fake.getMessages(session.id);
    expect(messages.filter((m) => m.role === 'USER')).toHaveLength(1);
  });

  it('서버가 발급하지 않은 quick reply id 는 거절한다(위조 차단)', async () => {
    const fake = new FakeAssistantAdapter();
    const { session } = await fake.openSession({ tripId: 'trip-1' });
    const error = await rejection(
      fake.sendTurn(session.id, {
        clientTurnId: 'x',
        input: { type: 'ACTION', quickReplyId: 'forged' },
        screen: { surface: 'HOME' },
      })
    );
    expect(error.code).toBe('SERVER');
  });

  it('INV-U8-08 · 제안은 한 번만 적용되고, 적용하면 ACTION_LOG 가 온다', async () => {
    const fake = new FakeAssistantAdapter();
    const { session } = await fake.openSession({ tripId: 'trip-1' });
    const message = await proposalFrom(fake, session.id, '카페 바꿔줘');
    const applied = await fake.applyProposal(message.proposal?.id ?? '');
    expect(applied.proposal.status).toBe('APPLIED');
    expect(applied.messages[0].kind).toBe('ACTION_LOG');
    const again = await rejection(
      fake.applyProposal(message.proposal?.id ?? '')
    );
    expect(again.code).toBe('NOT_APPLICABLE');
  });

  it('BR-U8-31 · 위반 있는 제안은 적용할 수 없다', async () => {
    const fake = new FakeAssistantAdapter();
    const { session } = await fake.openSession({ tripId: 'trip-1' });
    const message = await proposalFrom(fake, session.id, '무리해서 옮겨줘');
    expect(message.proposal?.violations.length).toBeGreaterThan(0);
    const error = await rejection(
      fake.applyProposal(message.proposal?.id ?? '')
    );
    expect(error.code).toBe('NOT_APPLICABLE');
  });
});

/**
 * US-ASSIST-09 답 평가 — 가짜 서버가 평가 계약과 실패 응답을 흉내 내는가. 실패는 실 어댑터가 접는 모양 그대로
 * `SERVER` 코드다(404·400 은 화면이 따로 가르지 않는다) — 어느 갈래인지는 message 로 남긴다.
 */
describe('FakeAssistantAdapter · 답 평가 (US-ASSIST-09)', () => {
  const UP: FeedbackRequest = { rating: 'UP', reason: null, comment: null };
  /** 코드 포인트 1개 = UTF-16 2단위(`'😀'.length === 2`). */
  const EMOJI = '\u{1F600}';

  async function opened() {
    const fake = new FakeAssistantAdapter();
    const { session, messages } = await fake.openSession({ tripId: 'trip-1' });
    return { fake, sessionId: session.id, answerId: messages[0].id };
  }

  async function storedFeedback(
    fake: FakeAssistantAdapter,
    sessionId: string,
    messageId: string
  ) {
    const page = await fake.getMessages(sessionId);
    return page.messages.find((message) => message.id === messageId)?.feedback;
  }

  it('실패 응답 · 없는 대화·그 대화에 없는 메시지는 404 (SERVER · NOT_FOUND)', async () => {
    const { fake, sessionId } = await opened();
    const calls: (() => Promise<unknown>)[] = [
      () => fake.putFeedback('session-nope', 'm-1', UP),
      () => fake.putFeedback(sessionId, 'm-nope', UP),
      () => fake.deleteFeedback(sessionId, 'm-nope'),
    ];
    for (const call of calls) {
      const error = await rejection(call());
      expect([error.code, error.message]).toEqual(['SERVER', 'NOT_FOUND']);
    }
  });

  it('실패 응답 · 사용자 말·적용 기록·이상한 값·좋아요에 이유/의견·300자(코드 포인트) 넘거나 NUL 이 든 의견은 400 (SERVER · BAD_REQUEST)', async () => {
    const fake = fakeWithHistory();
    const { session } = await fake.openSession({ tripId: 'trip-1' });
    const turn = await fake.sendTurn(session.id, textTurn('t-fb', '날씨'));
    const [user, answer] = turn.messages;
    const calls: (() => Promise<unknown>)[] = [
      () => fake.putFeedback(session.id, user.id, UP),
      () => fake.putFeedback(session.id, 'log-1', UP),
      () => fake.deleteFeedback(session.id, 'log-1'),
      () =>
        fake.putFeedback(session.id, answer.id, {
          rating: 'MEH',
        } as unknown as FeedbackRequest),
      () =>
        fake.putFeedback(session.id, answer.id, {
          rating: 'UP',
          reason: 'WRONG',
          comment: null,
        }),
      () =>
        fake.putFeedback(session.id, answer.id, {
          rating: 'UP',
          reason: null,
          comment: '좋아요',
        }),
      () =>
        fake.putFeedback(session.id, answer.id, {
          rating: 'DOWN',
          reason: 'BORING' as FeedbackReason,
          comment: null,
        }),
      () =>
        fake.putFeedback(session.id, answer.id, {
          rating: 'DOWN',
          reason: null,
          comment: '가'.repeat(301),
        }),
      () =>
        fake.putFeedback(session.id, answer.id, {
          rating: 'DOWN',
          reason: null,
          comment: EMOJI.repeat(301),
        }),
      () =>
        fake.putFeedback(session.id, answer.id, {
          rating: 'DOWN',
          reason: null,
          comment: '멀어요\u0000',
        }),
    ];
    for (const call of calls) {
      const error = await rejection(call());
      expect([error.code, error.message]).toEqual(['SERVER', 'BAD_REQUEST']);
    }
    expect(
      (await storedFeedback(fake, session.id, answer.id)) ?? null
    ).toBeNull();
  });
});

describe('FakeAssistantAdapter · 메시지 페이지 (이전 대화 더 보기, 서버 계약 거울)', () => {
  async function openedLong(count = 75) {
    const fake = new FakeAssistantAdapter({
      seedMessages: sampleLongConversation(count),
    });
    const opened = await fake.openSession({ tripId: 'trip-1' });
    return { fake, opened, sessionId: opened.session.id };
  }

  it('금지 · 거울이 실물보다 관대하지 않다 — limit 범위 밖·깨진 커서는 서버처럼 거절한다', async () => {
    const { fake, sessionId } = await openedLong();

    const calls = [
      () => fake.getMessages(sessionId, { limit: 0 }),
      () => fake.getMessages(sessionId, { limit: 101 }),
      () => fake.getMessages(sessionId, { before: 'zzz' }),
    ];
    for (const call of calls) {
      expect((await rejection(call())).code).toBe('SERVER');
    }
  });
});
