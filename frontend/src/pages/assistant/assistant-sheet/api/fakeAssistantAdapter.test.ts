import { AssistantApiError } from './assistantPort';
import type {
  AssistantMessage,
  FeedbackReason,
  FeedbackRequest,
  SendTurnRequest,
} from './assistantContract';
import { sampleLongConversation } from './assistantSamples';
import {
  FakeAssistantAdapter,
  fakeWithHistory,
  routeUtterance,
} from './fakeAssistantAdapter';

/** TRIP-1319 — 가짜 서버가 §6 계약과 서버 규칙(멱등·위조 차단·제안 상태기계·실패 응답)을 흉내 내는가. */

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
  it('세션을 열면 contextChip·messages·quickReplies 가 계약 모양으로 온다(§6)', async () => {
    const fake = new FakeAssistantAdapter();
    const opened = await fake.openSession({ tripId: 'trip-1' });

    expect(opened.session).toEqual({
      id: expect.any(String),
      tripId: 'trip-1',
      contextChip: expect.any(String),
    });
    expect(opened.messages.length).toBeGreaterThanOrEqual(1);
    expect(opened.quickReplies.length).toBeGreaterThanOrEqual(1);
  });

  it('여행 없이 열면 칩이 없고 일반 세션이다(b07)', async () => {
    const opened = await new FakeAssistantAdapter().openSession({
      tripId: null,
    });
    expect(opened.session.contextChip).toBeNull();
    expect(opened.messages[0].nextActions.map((a) => a.type)).toEqual([
      'CREATE_TRIP',
      'OPEN_STAY_SEARCH',
    ]);
  });

  it('같은 여행으로 다시 열면 직전 대화가 이어진다(BR-U8-17)', async () => {
    const fake = new FakeAssistantAdapter();
    const first = await fake.openSession({ tripId: 'trip-1' });
    await fake.sendTurn(first.session.id, textTurn('t1', '검토해줘'));
    const again = await fake.openSession({ tripId: 'trip-1' });
    expect(again.session.id).toBe(first.session.id);
    expect(again.messages.length).toBe(first.messages.length + 2);
  });

  it('열기 실패·401 을 낸다', async () => {
    expect(
      (
        await rejection(
          new FakeAssistantAdapter({ open: 'FAIL' }).openSession({
            tripId: null,
          })
        )
      ).code
    ).toBe('SERVER');
    expect(
      (
        await rejection(
          new FakeAssistantAdapter({ open: 'UNAUTHORIZED' }).openSession({
            tripId: null,
          })
        )
      ).code
    ).toBe('UNAUTHORIZED');
  });

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

  it('429 는 Retry-After 초를 싣고 한 번만 난다', async () => {
    const fake = new FakeAssistantAdapter({ rateLimitSeconds: 5 });
    const { session } = await fake.openSession({ tripId: 'trip-1' });
    const error = await rejection(
      fake.sendTurn(session.id, textTurn('a', '날씨'))
    );
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfterSeconds).toBe(5);
    await expect(
      fake.sendTurn(session.id, textTurn('b', '날씨'))
    ).resolves.toBeDefined();
  });

  it('BR-U8-32 · STALE 시나리오면 적용이 409 STALE 이다', async () => {
    const fake = new FakeAssistantAdapter({ apply: 'STALE' });
    const { session } = await fake.openSession({ tripId: 'trip-1' });
    const message = await proposalFrom(fake, session.id, '카페 바꿔줘');
    const error = await rejection(
      fake.applyProposal(message.proposal?.id ?? '')
    );
    expect(error.code).toBe('STALE');
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

  it('대기 취소(abort)는 ABORTED 로 끝난다', async () => {
    const fake = new FakeAssistantAdapter({ latencyMs: 50 });
    const { session } = await fake.openSession({ tripId: 'trip-1' });
    const controller = new AbortController();
    const pending = fake.sendTurn(session.id, textTurn('c', '날씨'), {
      signal: controller.signal,
    });
    controller.abort();
    expect((await rejection(pending)).code).toBe('ABORTED');
  });

  it('DEC-U8-10 · 숙소 발화는 숙소 검색으로 보낸다(숙소 결과 카드 없음)', () => {
    expect(routeUtterance('더 조용한 숙소로 찾아줘', true)).toBe('stay');
    expect(routeUtterance('일정 짜줘', false)).toBe('no-context');
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

  it('PUT 은 덮어쓰기 — 정규화한 값을 돌려주고, 조회·다시 열기에는 rating 만 실린다', async () => {
    const { fake, sessionId, answerId } = await opened();

    await expect(fake.putFeedback(sessionId, answerId, UP)).resolves.toEqual({
      messageId: answerId,
      rating: 'UP',
      reason: null,
      comment: null,
    });
    const saved = await fake.putFeedback(sessionId, answerId, {
      rating: 'DOWN',
      reason: 'WRONG',
      comment: '  동선이 너무 길어요  ',
    });

    expect(saved).toEqual({
      messageId: answerId,
      rating: 'DOWN',
      reason: 'WRONG',
      comment: '동선이 너무 길어요',
    });
    expect(await storedFeedback(fake, sessionId, answerId)).toBe('DOWN');
    const again = await fake.openSession({ tripId: 'trip-1' });
    const message = again.messages.find((item) => item.id === answerId);
    expect(message?.feedback).toBe('DOWN');
    expect(message).not.toHaveProperty('reason');
    expect(message).not.toHaveProperty('comment');
  });

  it('공백뿐인 의견은 null 로 저장하고, 300자까지는 받는다', async () => {
    const { fake, sessionId, answerId } = await opened();
    const blank = await fake.putFeedback(sessionId, answerId, {
      rating: 'DOWN',
      reason: null,
      comment: '   ',
    });
    const full = await fake.putFeedback(sessionId, answerId, {
      rating: 'DOWN',
      reason: null,
      comment: '가'.repeat(300),
    });
    expect(blank.comment).toBeNull();
    expect(full.comment).toBe('가'.repeat(300));
  });

  // 서버(AssistantFeedbackService)와 같은 잣대 — 앞뒤 공백을 지운 **뒤에** 재고, 길이는 코드 포인트로 센다.
  it('의견은 공백을 지운 뒤 잰다 — 공백뿐인 의견은 좋아요에 실려도 받고, 300자는 코드 포인트로 센다(이모지 = 1자)', async () => {
    const { fake, sessionId, answerId } = await opened();
    const emoji300 = EMOJI.repeat(300);

    const up = await fake.putFeedback(sessionId, answerId, {
      rating: 'UP',
      reason: null,
      comment: ' \n ',
    });
    const down = await fake.putFeedback(sessionId, answerId, {
      rating: 'DOWN',
      reason: null,
      comment: emoji300,
    });

    expect(up).toEqual({
      messageId: answerId,
      rating: 'UP',
      reason: null,
      comment: null,
    });
    expect(down.comment).toBe(emoji300);
  });

  it('DELETE 는 멱등 — 평가가 없어도 끝나고, 있으면 지운다', async () => {
    const { fake, sessionId, answerId } = await opened();
    await expect(
      fake.deleteFeedback(sessionId, answerId)
    ).resolves.toBeUndefined();
    await fake.putFeedback(sessionId, answerId, UP);

    await fake.deleteFeedback(sessionId, answerId);

    expect(await storedFeedback(fake, sessionId, answerId)).toBeNull();
  });

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

  it('feedback: SERVER_ERROR 면 PUT·DELETE 가 5xx(SERVER)이고 저장된 평가는 그대로다', async () => {
    const { fake, sessionId, answerId } = await opened();
    await fake.putFeedback(sessionId, answerId, UP);
    fake.configure({ feedback: 'SERVER_ERROR' });

    const put = await rejection(
      fake.putFeedback(sessionId, answerId, {
        rating: 'DOWN',
        reason: null,
        comment: null,
      })
    );
    const del = await rejection(fake.deleteFeedback(sessionId, answerId));

    expect([put.code, del.code]).toEqual(['SERVER', 'SERVER']);
    expect(await storedFeedback(fake, sessionId, answerId)).toBe('UP');
  });
});

describe('FakeAssistantAdapter · 메시지 페이지 (이전 대화 더 보기, 서버 계약 거울)', () => {
  const ids = (messages: AssistantMessage[]) => messages.map((m) => m.id);
  const longIds = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `long-${from + i}`);

  async function openedLong(count = 75) {
    const fake = new FakeAssistantAdapter({
      seedMessages: sampleLongConversation(count),
    });
    const opened = await fake.openSession({ tripId: 'trip-1' });
    return { fake, opened, sessionId: opened.session.id };
  }

  it('열면 가장 최근 30건(오래된 것 먼저)과 더 있다는 커서를 준다', async () => {
    const { opened } = await openedLong();

    expect(ids(opened.messages)).toEqual(longIds(46, 75));
    expect(typeof opened.nextBefore).toBe('string');
  });

  it.each([
    { count: 1, hasMore: false },
    { count: 30, hasMore: false },
    { count: 31, hasMore: true },
  ])(
    '$count건이면 nextBefore 가 있는가 = $hasMore (딱 한 쪽이면 커서가 없다)',
    async ({ count, hasMore }) => {
      const { opened, fake, sessionId } = await openedLong(count);

      const page = await fake.getMessages(sessionId);

      expect(opened.nextBefore !== null).toBe(hasMore);
      expect(page.nextBefore !== null).toBe(hasMore);
    }
  );

  it('커서를 그대로 이어 넘기면 옛 쪽이 차례로 오고, 이으면 빠짐·겹침 없이 1…75 가 한 번씩이다', async () => {
    // Arrange
    const { fake, opened, sessionId } = await openedLong();

    // Act
    const second = await fake.getMessages(sessionId, {
      before: opened.nextBefore ?? '',
    });
    const third = await fake.getMessages(sessionId, {
      before: second.nextBefore ?? '',
    });

    // Assert
    expect(ids(second.messages)).toEqual(longIds(16, 45));
    expect(typeof second.nextBefore).toBe('string');
    expect(ids(third.messages)).toEqual(longIds(1, 15));
    expect(third.nextBefore).toBeNull();
    expect(
      ids([...third.messages, ...second.messages, ...opened.messages])
    ).toEqual(longIds(1, 75));
  });

  it('옵션 없는 조회도 최근 30건, limit 은 쪽 크기를 바꾼다', async () => {
    const { fake, opened, sessionId } = await openedLong();

    const plain = await fake.getMessages(sessionId);
    const ten = await fake.getMessages(sessionId, { limit: 10 });
    const before = ten.nextBefore ?? '';
    const prevTen = await fake.getMessages(sessionId, { before, limit: 10 });

    expect(ids(plain.messages)).toEqual(longIds(46, 75));
    expect(plain.nextBefore).toBe(opened.nextBefore);
    expect(ids(ten.messages)).toEqual(longIds(66, 75));
    expect(typeof ten.nextBefore).toBe('string');
    expect(ids(prevTen.messages)).toEqual(longIds(56, 65));
  });

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

  it('호출 수를 세고, messages: SERVER_ERROR 면 before 유무와 상관없이 5xx 이며 되돌리면 다시 된다', async () => {
    const { fake, opened, sessionId } = await openedLong();
    expect(fake.calls.getMessages).toBe(0);

    fake.configure({ messages: 'SERVER_ERROR' });
    const plain = await rejection(fake.getMessages(sessionId));
    const older = await rejection(
      fake.getMessages(sessionId, { before: opened.nextBefore ?? '' })
    );
    fake.configure({ messages: 'OK' });
    const again = await fake.getMessages(sessionId, {
      before: opened.nextBefore ?? '',
    });

    expect([plain.code, older.code]).toEqual(['SERVER', 'SERVER']);
    expect(ids(again.messages)).toEqual(longIds(16, 45));
    expect(fake.calls.getMessages).toBe(3);
  });

  it('턴이 이어져도 쪽이 어긋나지 않는다 — 새 메시지는 최근 쪽 끝에 붙고, 이은 전체는 중복 없이 연속이다', async () => {
    // Arrange
    const { fake, sessionId } = await openedLong();

    // Act
    const reply = await fake.sendTurn(sessionId, textTurn('t-long', '날씨'));
    const first = await fake.getMessages(sessionId);
    const second = await fake.getMessages(sessionId, {
      before: first.nextBefore ?? '',
    });
    const third = await fake.getMessages(sessionId, {
      before: second.nextBefore ?? '',
    });

    // Assert
    expect(ids(first.messages).slice(-reply.messages.length)).toEqual(
      ids(reply.messages)
    );
    expect(
      ids([...third.messages, ...second.messages, ...first.messages])
    ).toEqual([...longIds(1, 75), ...ids(reply.messages)]);
    expect(third.nextBefore).toBeNull();
  });
});
