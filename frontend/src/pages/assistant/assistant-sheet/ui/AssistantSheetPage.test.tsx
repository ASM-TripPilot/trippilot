import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { setAssistantPort } from '../api/assistantClient';
import { assistantSample } from '../api/assistantSamples';
import {
  FakeAssistantAdapter,
  type FakeAssistantOptions,
} from '../api/fakeAssistantAdapter';
import { AssistantSheetPage } from './AssistantSheetPage';

/**
 * TRIP-1322 — 시트 page 배선(가짜 서버 주입). 서버 HTTP 가 없어 MSW 대신 `setAssistantPort` 로
 * FakeAssistantAdapter 를 끼운다 — 그래서 integration(MSW) 버킷이 아니라 node 버킷이다.
 */

// 전체 스위트 병렬 부하(+ 같은 기계의 다른 레인 jest)에서 한 테스트의 여러 왕복이 기본 1초·5초를 넘는 일이
// 실측됐다(TRIP-1324 전체 실행 3회 중 1회) — 이 파일만 기다림을 늘린다. 판정 내용은 그대로다.
configure({ asyncUtilTimeout: 8000 });
jest.setTimeout(20000);

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => {
    mockUuid += 1;
    return `uuid-${mockUuid}`;
  },
}));

let restore: (() => void) | undefined;
let fake: FakeAssistantAdapter;
const clients: QueryClient[] = [];

function renderPage(
  options: FakeAssistantOptions = {},
  props: { tripId?: string; surface?: 'HOME' | 'ITINERARY' | 'LIVE' } = {
    tripId: 't1',
    surface: 'ITINERARY',
  }
) {
  fake = new FakeAssistantAdapter(options);
  restore = setAssistantPort(fake);
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity },
    },
  });
  clients.push(client);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(
    <AssistantSheetPage
      surface={props.surface ?? 'ITINERARY'}
      tripId={props.tripId}
    />,
    { wrapper: Wrapper }
  );
}

afterEach(() => {
  restore?.();
  clients.splice(0).forEach((client) => client.clear());
  mockBack.mockClear();
  mockReplace.mockClear();
});

describe('AssistantSheetPage (TRIP-1322)', () => {
  it('여행 문맥으로 열면 칩·인사·시작 quick reply 가 뜬다(BR-U8-03·04)', async () => {
    renderPage();
    expect(
      await screen.findByTestId('assistant-context-chip')
    ).toHaveTextContent('부산 2박 3일 · 등록 숙소 서면');
    expect(
      screen.getByTestId('assistant-quick-reply-qr-review')
    ).toBeOnTheScreen();
    expect(fake.calls.openSession).toBe(1);
  });

  it('여행 없이 열면 b07 — CREATE_TRIP·OPEN_STAY_SEARCH 행동이 나온다(BR-U8-05)', async () => {
    renderPage({}, { surface: 'HOME' });
    expect(
      await screen.findByTestId('assistant-next-action-CREATE_TRIP')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('assistant-next-action-OPEN_STAY_SEARCH')
    ).toBeOnTheScreen();
  });

  it('열기 실패면 오류 + [다시 시도] — 누르면 다시 연다(BR-U8-07)', async () => {
    renderPage({ open: 'FAIL' });
    await screen.findByTestId('assistant-open-failed');
    fake.configure({ open: 'OK' });
    fireEvent.press(screen.getByTestId('assistant-open-retry'));
    expect(
      await screen.findByTestId('assistant-context-chip')
    ).toBeOnTheScreen();
    expect(fake.calls.openSession).toBe(2);
  });

  it('세션 생성 401 이면 시트를 닫는다', async () => {
    renderPage({ open: 'UNAUTHORIZED' });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  it('닫기를 두 번 눌러도 뒤로는 한 번', async () => {
    renderPage();
    await screen.findByTestId('assistant-context-chip');
    fireEvent.press(screen.getByTestId('assistant-sheet-close'));
    fireEvent.press(screen.getByTestId('assistant-sheet-close'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('금지 · 공백만·501자는 보낼 수 없고, 1~500자는 보낸다(§7)', async () => {
    renderPage();
    await screen.findByTestId('assistant-input');
    const input = screen.getByTestId('assistant-input');

    fireEvent.changeText(input, '   ');
    fireEvent.press(screen.getByTestId('assistant-send'));
    fireEvent.changeText(input, 'a'.repeat(501));
    fireEvent.press(screen.getByTestId('assistant-send'));
    expect(fake.calls.sendTurn).toBe(0);

    fireEvent.changeText(input, '오늘 날씨');
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-send'));
    });
    await waitFor(() => expect(fake.calls.sendTurn).toBe(1));
    expect(await screen.findByText('지금 날씨예요.')).toBeOnTheScreen();
  });

  it('quick reply 를 누르면 ACTION 턴으로 보내고 응답 카드가 붙는다', async () => {
    renderPage();
    await act(async () => {
      fireEvent.press(
        await screen.findByTestId('assistant-quick-reply-qr-review')
      );
    });
    expect(
      await screen.findByText('지금까지 진행 상태를 정리했어요.')
    ).toBeOnTheScreen();
  });

  it('next action 은 시트를 닫으며 그 화면으로 간다(replace)', async () => {
    renderPage();
    await act(async () => {
      fireEvent.press(
        (
          await screen.findAllByTestId('assistant-next-action-OPEN_ITINERARY')
        )[0]
      );
    });
    expect(mockReplace).toHaveBeenCalledWith('/trips/t1/itinerary');
  });
});

describe('AssistantSheetPage · 카드 배선 (TRIP-1323)', () => {
  it('검토 quick reply → 진행 검토 카드 + 문제 행, 해결 행동을 누르면 그 화면으로 간다', async () => {
    renderPage();
    await act(async () => {
      fireEvent.press(
        await screen.findByTestId('assistant-quick-reply-qr-review')
      );
    });
    expect(
      await screen.findByTestId('assistant-review-card')
    ).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-review-fix-0'));
    });
    expect(mockReplace).toHaveBeenCalledWith('/trips/t1/itinerary/edit');
  });

  it('후보 카드를 누르면 서버가 발급한 PICK_CANDIDATE quick reply 로 보낸다', async () => {
    renderPage();
    const input = await screen.findByTestId('assistant-input');
    fireEvent.changeText(input, '카페 다른 곳 추천해줘');
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-send'));
    });
    const candidate = await screen.findByTestId(
      'assistant-candidate-poi-bookcafe'
    );
    await act(async () => {
      fireEvent.press(candidate);
    });
    await waitFor(() => expect(fake.calls.sendTurn).toBe(2));
    expect(await screen.findByText(/조용한 카페로 바꾸면/)).toBeOnTheScreen();
  });

  it('예약 요청 → 외부 위임 카드, OTA 행동은 카드에만 한 번 있다(BR-U8-27)', async () => {
    renderPage();
    const input = await screen.findByTestId('assistant-input');
    fireEvent.changeText(input, '이 숙소 지금 예약해줘');
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-send'));
    });
    expect(await screen.findByTestId('assistant-scope-card')).toBeOnTheScreen();
    expect(
      screen.getByText(/예약·결제는 앱에서 못 하고 외부 사이트에서 진행돼요/)
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-next-action-OPEN_OTA')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-scope-ota'));
    });
    expect(mockReplace).toHaveBeenCalledWith('/stays/stay-songjeong');
  });

  it('폴백 [도우미 없이 계속]은 시트를 닫는다(BR-U8-41)', async () => {
    renderPage();
    const input = await screen.findByTestId('assistant-input');
    fireEvent.changeText(input, '조용한 동네 (응답 실패)');
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-send'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('assistant-fallback-continue'));
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('AssistantSheetPage · 제안 적용 (TRIP-1324)', () => {
  async function openProposal(): Promise<void> {
    const input = await screen.findByTestId('assistant-input');
    fireEvent.changeText(input, '둘째 날 카페를 조용한 곳으로 바꿔줘');
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-send'));
    });
    await screen.findByTestId('assistant-proposal-apply');
  }

  it('[적용] → apply 1회 · 적용 기록 메시지 · 일정 쿼리 무효화 (§4-4)', async () => {
    renderPage();
    const client = clients[clients.length - 1];
    client.setQueryData(['/trips/t1/itinerary'], { days: [] });
    await openProposal();

    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-proposal-apply'));
    });
    await waitFor(() => expect(fake.calls.applyProposal).toBe(1));
    expect(await screen.findByText('일정에 반영했어요.')).toBeOnTheScreen();
    expect(client.getQueryState(['/trips/t1/itinerary'])?.isInvalidated).toBe(
      true
    );
    expect(screen.getByTestId('assistant-proposal-status')).toHaveTextContent(
      '적용했어요'
    );
  });

  it('금지 · 적용 진행 중 [적용]을 다시 눌러도 두 번째 호출이 없다', async () => {
    renderPage({ latencyMs: 0 });
    await openProposal();
    fake.configure({ latencyMs: 30 });
    const apply = screen.getByTestId('assistant-proposal-apply');
    await act(async () => {
      fireEvent.press(apply);
      fireEvent.press(apply);
    });
    await waitFor(() =>
      expect(screen.queryByTestId('assistant-proposal-apply')).toBeNull()
    );
    expect(fake.calls.applyProposal).toBe(1);
  });

  it('금지 · [취소] 하면 apply 는 0회다', async () => {
    renderPage();
    await openProposal();
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-proposal-dismiss'));
    });
    // 호출 수는 가짜 서버가 응답 전에 올린다 — 결과 표지(응답 반영)를 기다린 뒤에 센다.
    expect(
      await screen.findByTestId('assistant-proposal-status')
    ).toHaveTextContent('취소했어요');
    expect(fake.calls.dismissProposal).toBe(1);
    expect(fake.calls.applyProposal).toBe(0);
  });

  it('BR-U8-32 · 409 STALE 이면 카드가 낡음으로 바뀌고 [다시 제안]은 같은 요청을 다시 보낸다', async () => {
    renderPage({ apply: 'STALE' });
    await openProposal();
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-proposal-apply'));
    });
    expect(
      await screen.findByTestId('assistant-proposal-stale')
    ).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-proposal-repropose'));
    });
    await waitFor(() => expect(fake.calls.sendTurn).toBe(2));
  });
});

describe('AssistantSheetPage · 이력 (TRIP-1325)', () => {
  it('이력 보기로 전환하면 적용 기록 행이 보이고, [대화 이어서]로 돌아온다', async () => {
    renderPage();
    await openAndApplyProposal();
    fireEvent.press(screen.getByTestId('assistant-history-toggle'));
    expect(await screen.findByTestId('assistant-history')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/assistant-history-row-/)).toHaveLength(1);
    fireEvent.press(screen.getByTestId('assistant-history-continue'));
    expect(screen.queryByTestId('assistant-history')).toBeNull();
    expect(screen.getByTestId('assistant-input')).toBeOnTheScreen();
  });

  it('[이력 지우기] → 확인 전 clear 0회, 확인 → 1회 후 일반 시작 상태로', async () => {
    renderPage();
    await screen.findByTestId('assistant-context-chip');
    fireEvent.press(screen.getByTestId('assistant-history-toggle'));
    fireEvent.press(await screen.findByTestId('assistant-history-clear'));
    expect(
      screen.getByTestId('assistant-history-clear-dialog')
    ).toBeOnTheScreen();
    expect(fake.calls.clearSession).toBe(0);
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-history-clear-confirm'));
    });
    await waitFor(() => expect(fake.calls.clearSession).toBe(1));
    expect(await screen.findByTestId('assistant-input')).toBeOnTheScreen();
    await waitFor(() => expect(fake.calls.openSession).toBe(2));
  });
});

async function openAndApplyProposal(): Promise<void> {
  const input = await screen.findByTestId('assistant-input');
  fireEvent.changeText(input, '둘째 날 카페를 조용한 곳으로 바꿔줘');
  await act(async () => {
    fireEvent.press(screen.getByTestId('assistant-send'));
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('assistant-proposal-apply'));
  });
  await screen.findByText('일정에 반영했어요.');
}

describe('AssistantSheetPage · 턴 흐름 (TRIP-1326)', () => {
  async function typeAndSend(text: string): Promise<void> {
    fireEvent.changeText(await screen.findByTestId('assistant-input'), text);
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-send'));
    });
  }

  it('BR-U8-21 · 저장 실패 → 보내지 못함, [다시 보내기]는 같은 clientTurnId 로 재전송', async () => {
    renderPage();
    await screen.findByTestId('assistant-input');
    const spy = jest.spyOn(fake, 'sendTurn');
    fake.configure({ turn: 'SERVER_ERROR' });
    await typeAndSend('오늘 날씨');
    expect(await screen.findByTestId('assistant-resend')).toBeOnTheScreen();
    expect(
      screen.getByTestId('assistant-user-bubble-pending')
    ).toHaveTextContent('오늘 날씨', { exact: false });

    fake.configure({ turn: 'OK' });
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-resend'));
    });
    expect(await screen.findByText('지금 날씨예요.')).toBeOnTheScreen();
    const ids = spy.mock.calls.map(([, request]) => request.clientTurnId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(screen.queryByTestId('assistant-user-bubble-pending')).toBeNull();
  });

  it('BR-U8-44 · 대기 중 [대기 취소] → 보내지 못함 + 입력 복원', async () => {
    renderPage();
    await screen.findByTestId('assistant-input');
    fake.configure({ latencyMs: 2000 });
    await typeAndSend('오늘 날씨');
    expect(screen.getByTestId('assistant-progress')).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-send-pending')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-progress-cancel'));
    });
    expect(await screen.findByTestId('assistant-resend')).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-input').props.value).toBe('오늘 날씨');
    expect(screen.queryByTestId('assistant-progress')).toBeNull();
  });

  it('429 Retry-After 5 → 보내기 비활성 + 남은 초 표시', async () => {
    renderPage({ rateLimitSeconds: 5 });
    await typeAndSend('오늘 날씨');
    expect(
      await screen.findByTestId('assistant-rate-limited')
    ).toHaveTextContent('5초', { exact: false });
    fireEvent.changeText(screen.getByTestId('assistant-input'), '다시');
    expect(
      screen.getByTestId('assistant-send').props.accessibilityState
    ).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('429 TURN_IN_PROGRESS → 말풍선·입력을 거두지 않고, Retry-After 뒤 [다시 보내기]는 같은 clientTurnId (TRIP-1409)', async () => {
    renderPage();
    await screen.findByTestId('assistant-input');
    const spy = jest.spyOn(fake, 'sendTurn');
    fake.configure({ turnInProgressSeconds: 1 });
    await typeAndSend('오늘 날씨');

    expect(
      await screen.findByTestId('assistant-rate-limited')
    ).toBeOnTheScreen();
    // 기록 안 된 429(RATE_LIMITED)와 반대: 말풍선은 남고 입력은 복원되지 않는다
    expect(
      screen.getByTestId('assistant-user-bubble-pending')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-input').props.value).toBe('');

    const resend = await screen.findByTestId(
      'assistant-resend',
      {},
      { timeout: 3000 }
    );
    await act(async () => {
      fireEvent.press(resend);
    });
    expect(await screen.findByText('지금 날씨예요.')).toBeOnTheScreen();
    const ids = spy.mock.calls.map(([, request]) => request.clientTurnId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it('금지 · 보내는 중 연타해도 턴 요청은 1회', async () => {
    renderPage();
    await screen.findByTestId('assistant-input');
    fake.configure({ latencyMs: 100 });
    fireEvent.changeText(screen.getByTestId('assistant-input'), '오늘 날씨');
    const send = screen.getByTestId('assistant-send');
    await act(async () => {
      fireEvent.press(send);
      fireEvent.press(send);
    });
    expect(await screen.findByText('지금 날씨예요.')).toBeOnTheScreen();
    expect(fake.calls.sendTurn).toBe(1);
  });

  it('BR-U8-44 · 15초가 지나면 진행 표시를 유지하고 [대기 취소]를 강조한다', async () => {
    renderPage();
    await screen.findByTestId('assistant-input');
    jest.useFakeTimers();
    try {
      fake.configure({ latencyMs: 60_000 });
      fireEvent.changeText(screen.getByTestId('assistant-input'), '오늘 날씨');
      act(() => {
        fireEvent.press(screen.getByTestId('assistant-send'));
      });
      act(() => {
        jest.advanceTimersByTime(14_000);
      });
      expect(screen.queryByTestId('assistant-progress-slow')).toBeNull();
      act(() => {
        jest.advanceTimersByTime(2_000);
      });
      expect(screen.getByTestId('assistant-progress-slow')).toBeOnTheScreen();
      expect(screen.getByTestId('assistant-progress-cancel')).toBeOnTheScreen();
      act(() => {
        fireEvent.press(screen.getByTestId('assistant-progress-cancel'));
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * US-ASSIST-09 답 평가 — 엄지 토글(같은 쪽 다시 = DELETE, 반대쪽 = PUT) · 싫어요 이유 칩·직접 적기 · 낙관 갱신과
 * 실패 롤백(침묵 실패 금지). 가짜 서버가 여행 t1 으로 연 세션은 `session-t1`, 인사 답은 `m-1` 이다.
 */
describe('AssistantSheetPage · 답 평가 (US-ASSIST-09)', () => {
  const SESSION = 'session-t1';
  const GREETING = 'm-1';

  function a11y(testID: string) {
    return screen.getByTestId(testID).props.accessibilityState;
  }

  /** 누르고, 그 평가 요청이 끝나 엄지가 다시 눌리는 상태가 될 때까지 기다린다. */
  async function pressAndSettle(testID: string): Promise<void> {
    await act(async () => {
      fireEvent.press(screen.getByTestId(testID));
    });
    await waitFor(() =>
      expect(a11y(`assistant-feedback-up-${GREETING}`)).toEqual(
        expect.objectContaining({ disabled: false })
      )
    );
  }

  async function storedFeedback(messageId: string) {
    const page = await fake.getMessages(SESSION);
    return page.messages.find((message) => message.id === messageId)?.feedback;
  }

  it('👍 → PUT {UP} 한 번·선택됨, 같은 엄지를 다시 누르면 DELETE·선택 풀림', async () => {
    renderPage();
    await screen.findByTestId(`assistant-feedback-up-${GREETING}`);
    const putSpy = jest.spyOn(fake, 'putFeedback');

    await pressAndSettle(`assistant-feedback-up-${GREETING}`);

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(SESSION, GREETING, {
      rating: 'UP',
      reason: null,
      comment: null,
    });
    expect(a11y(`assistant-feedback-up-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(a11y(`assistant-feedback-down-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: false })
    );

    await pressAndSettle(`assistant-feedback-up-${GREETING}`);

    expect(fake.calls.deleteFeedback).toBe(1);
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(a11y(`assistant-feedback-up-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: false })
    );
    expect(await storedFeedback(GREETING)).toBeNull();
  });

  it('👍 뒤 👎 는 바꾸기 — DELETE 없이 PUT {DOWN} 이고 이유 칩이 열린다', async () => {
    renderPage();
    await screen.findByTestId(`assistant-feedback-up-${GREETING}`);
    const putSpy = jest.spyOn(fake, 'putFeedback');

    await pressAndSettle(`assistant-feedback-up-${GREETING}`);
    await pressAndSettle(`assistant-feedback-down-${GREETING}`);

    expect(putSpy.mock.calls.map(([, , body]) => body.rating)).toEqual([
      'UP',
      'DOWN',
    ]);
    expect(putSpy).toHaveBeenLastCalledWith(SESSION, GREETING, {
      rating: 'DOWN',
      reason: null,
      comment: null,
    });
    expect(fake.calls.deleteFeedback).toBe(0);
    expect(a11y(`assistant-feedback-up-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: false })
    );
    expect(a11y(`assistant-feedback-down-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(
      screen.getByTestId(`assistant-feedback-reason-WRONG-${GREETING}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`assistant-feedback-comment-${GREETING}`)
    ).toBeOnTheScreen();
  });

  it('👎 → 이유 칩 → PUT {DOWN, reason} · 고마워요 안내 · 칩이 접힌다', async () => {
    renderPage();
    await screen.findByTestId(`assistant-feedback-down-${GREETING}`);
    const putSpy = jest.spyOn(fake, 'putFeedback');

    await pressAndSettle(`assistant-feedback-down-${GREETING}`);
    await pressAndSettle(`assistant-feedback-reason-WRONG-${GREETING}`);

    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(putSpy).toHaveBeenLastCalledWith(SESSION, GREETING, {
      rating: 'DOWN',
      reason: 'WRONG',
      comment: null,
    });
    expect(
      screen.getByTestId(`assistant-feedback-thanks-${GREETING}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`assistant-feedback-reason-WRONG-${GREETING}`)
    ).toBeNull();
    expect(a11y(`assistant-feedback-down-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: true })
    );
  });

  it('👎 → 직접 적기 → 이유를 고르고(아직 안 보냄) 의견을 적어 [보내기] → PUT {DOWN, reason, comment(앞뒤 공백 제거)}', async () => {
    renderPage();
    await screen.findByTestId(`assistant-feedback-down-${GREETING}`);
    const putSpy = jest.spyOn(fake, 'putFeedback');
    await pressAndSettle(`assistant-feedback-down-${GREETING}`);

    fireEvent.press(
      screen.getByTestId(`assistant-feedback-comment-${GREETING}`)
    );
    fireEvent.press(
      screen.getByTestId(`assistant-feedback-reason-NOT_HELPFUL-${GREETING}`)
    );
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(a11y(`assistant-feedback-reason-NOT_HELPFUL-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: true })
    );
    fireEvent.changeText(
      screen.getByTestId(`assistant-feedback-comment-input-${GREETING}`),
      '  동선이 너무 길어요  '
    );
    await pressAndSettle(`assistant-feedback-comment-send-${GREETING}`);

    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(putSpy).toHaveBeenLastCalledWith(SESSION, GREETING, {
      rating: 'DOWN',
      reason: 'NOT_HELPFUL',
      comment: '동선이 너무 길어요',
    });
    expect(
      screen.getByTestId(`assistant-feedback-thanks-${GREETING}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`assistant-feedback-comment-input-${GREETING}`)
    ).toBeNull();
  });

  it('실패하면 엄지를 되돌리고 안내한다(침묵 실패 금지)', async () => {
    renderPage({ feedback: 'SERVER_ERROR' });
    await screen.findByTestId(`assistant-feedback-up-${GREETING}`);

    await pressAndSettle(`assistant-feedback-up-${GREETING}`);

    expect(fake.calls.putFeedback).toBe(1);
    expect(
      await screen.findByTestId(`assistant-feedback-error-${GREETING}`)
    ).toHaveTextContent('평가를 저장하지 못했어요', { exact: false });
    expect(a11y(`assistant-feedback-up-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: false })
    );
  });

  it('이유 보내기가 실패하면 칩을 다시 펴고 안내한다 — 싫어요는 그대로', async () => {
    renderPage();
    await screen.findByTestId(`assistant-feedback-down-${GREETING}`);
    await pressAndSettle(`assistant-feedback-down-${GREETING}`);
    fake.configure({ feedback: 'SERVER_ERROR' });

    await pressAndSettle(`assistant-feedback-reason-WRONG-${GREETING}`);

    expect(
      await screen.findByTestId(`assistant-feedback-error-${GREETING}`)
    ).toHaveTextContent('의견을 보내지 못했어요', { exact: false });
    expect(
      screen.getByTestId(`assistant-feedback-reason-WRONG-${GREETING}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`assistant-feedback-thanks-${GREETING}`)
    ).toBeNull();
    expect(a11y(`assistant-feedback-down-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: true })
    );
  });

  it('서버가 실은 평가를 그대로 그린다 — 다시 열어도 싫어요가 선택돼 있고 칩은 접혀 있다', async () => {
    renderPage({
      seedMessages: [
        { ...assistantSample('greeting', { id: 'a1' }), feedback: 'DOWN' },
      ],
    });

    await waitFor(() =>
      expect(a11y('assistant-feedback-down-a1')).toEqual(
        expect.objectContaining({ selected: true })
      )
    );
    expect(a11y('assistant-feedback-up-a1')).toEqual(
      expect.objectContaining({ selected: false })
    );
    expect(
      screen.queryByTestId('assistant-feedback-reason-WRONG-a1')
    ).toBeNull();
  });

  it('적용 기록(ACTION_LOG)에는 평가 줄이 없다 — 인사·제안 답에는 있다', async () => {
    renderPage();
    await openAndApplyProposal();

    const logRow = screen.getByTestId(/^assistant-action-log-/);
    const logId = String(logRow.props.testID).replace(
      'assistant-action-log-',
      ''
    );
    expect(screen.queryByTestId(`assistant-feedback-up-${logId}`)).toBeNull();
    expect(screen.queryAllByTestId(/^assistant-feedback-up-/)).toHaveLength(2);
  });

  it('금지 · 엄지를 같은 틱에 연타해도 평가 요청은 1회(겹치면 되돌릴 값이 꼬인다)', async () => {
    renderPage();
    const up = await screen.findByTestId(`assistant-feedback-up-${GREETING}`);
    fake.configure({ latencyMs: 30 });

    await act(async () => {
      fireEvent.press(up);
      fireEvent.press(up);
    });
    await waitFor(() =>
      expect(a11y(`assistant-feedback-up-${GREETING}`)).toEqual(
        expect.objectContaining({ selected: true, disabled: false })
      )
    );

    expect(fake.calls.putFeedback).toBe(1);
    expect(fake.calls.deleteFeedback).toBe(0);
  });

  // 메시지마다 결과를 따로 받는다 — `useAnswerFeedback` 이 mutate 대신 mutateAsync 를 쓰는 이유(TanStack v5 의
  // 호출별 콜백은 겹친 호출 중 마지막 것에만 불린다).
  it('두 답을 잇달아 평가해도 앞 답의 엄지가 비활성으로 남지 않는다', async () => {
    renderPage({
      seedMessages: [
        { ...assistantSample('greeting', { id: 'a1' }), feedback: null },
        { ...assistantSample('greeting', { id: 'a2' }), feedback: null },
      ],
    });
    await screen.findByTestId('assistant-feedback-up-a2');
    fake.configure({ latencyMs: 30 });

    // 앞 답의 요청이 끝나기 전에 뒤 답을 누른다
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-feedback-up-a1'));
      fireEvent.press(screen.getByTestId('assistant-feedback-up-a2'));
    });

    await waitFor(() => {
      expect(a11y('assistant-feedback-up-a1')).toEqual(
        expect.objectContaining({ selected: true, disabled: false })
      );
      expect(a11y('assistant-feedback-up-a2')).toEqual(
        expect.objectContaining({ selected: true, disabled: false })
      );
    });
    expect(fake.calls.putFeedback).toBe(2);
  });

  it('의견 보내기가 실패하면 쓰던 의견과 고른 이유가 되살아나고 안내한다', async () => {
    renderPage();
    await screen.findByTestId(`assistant-feedback-down-${GREETING}`);
    await pressAndSettle(`assistant-feedback-down-${GREETING}`);
    fireEvent.press(
      screen.getByTestId(`assistant-feedback-comment-${GREETING}`)
    );
    fireEvent.press(
      screen.getByTestId(`assistant-feedback-reason-NOT_HELPFUL-${GREETING}`)
    );
    fireEvent.changeText(
      screen.getByTestId(`assistant-feedback-comment-input-${GREETING}`),
      '동선이 너무 길어요'
    );
    fake.configure({ feedback: 'SERVER_ERROR' });

    await pressAndSettle(`assistant-feedback-comment-send-${GREETING}`);

    expect(
      await screen.findByTestId(`assistant-feedback-error-${GREETING}`)
    ).toHaveTextContent('의견을 보내지 못했어요', { exact: false });
    expect(
      screen.getByTestId(`assistant-feedback-comment-input-${GREETING}`)
    ).toHaveDisplayValue('동선이 너무 길어요');
    expect(a11y(`assistant-feedback-reason-NOT_HELPFUL-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(
      screen.queryByTestId(`assistant-feedback-thanks-${GREETING}`)
    ).toBeNull();
  });

  it('이유 칸이 열린 채 엄지를 바꾸다(PUT) 실패하면 그 칸이 되살아나고 싫어요로 돌아간다', async () => {
    renderPage();
    await screen.findByTestId(`assistant-feedback-down-${GREETING}`);
    await pressAndSettle(`assistant-feedback-down-${GREETING}`);
    fake.configure({ feedback: 'SERVER_ERROR' });

    await pressAndSettle(`assistant-feedback-up-${GREETING}`);

    expect(
      await screen.findByTestId(`assistant-feedback-error-${GREETING}`)
    ).toHaveTextContent('평가를 저장하지 못했어요', { exact: false });
    expect(
      screen.getByTestId(`assistant-feedback-reason-WRONG-${GREETING}`)
    ).toBeOnTheScreen();
    expect(a11y(`assistant-feedback-down-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(a11y(`assistant-feedback-up-${GREETING}`)).toEqual(
      expect.objectContaining({ selected: false })
    );
  });

  // 화면 글자만으로는 스크린리더가 모른다 — 고마워요·실패 안내를 소리로도 알린다.
  it('고마워요·실패 안내는 스크린리더에도 읽힌다(announceForAccessibility)', async () => {
    const announce = jest.mocked(AccessibilityInfo.announceForAccessibility);
    announce.mockClear();
    renderPage();
    await screen.findByTestId(`assistant-feedback-down-${GREETING}`);
    await pressAndSettle(`assistant-feedback-down-${GREETING}`);

    await pressAndSettle(`assistant-feedback-reason-WRONG-${GREETING}`);
    expect(announce).toHaveBeenLastCalledWith('의견 고마워요');

    // 👎 를 다시 누르면 취소(DELETE) — 그게 실패한다
    fake.configure({ feedback: 'SERVER_ERROR' });
    await pressAndSettle(`assistant-feedback-down-${GREETING}`);
    await waitFor(() =>
      expect(announce).toHaveBeenLastCalledWith(
        '평가를 저장하지 못했어요. 잠시 후 다시 시도해 주세요'
      )
    );
  });
});
