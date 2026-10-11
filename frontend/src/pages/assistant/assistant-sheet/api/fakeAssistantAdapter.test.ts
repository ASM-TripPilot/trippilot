import { AssistantApiError } from './assistantPort';
import type { AssistantMessage, SendTurnRequest } from './assistantContract';
import { FakeAssistantAdapter, routeUtterance } from './fakeAssistantAdapter';

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
