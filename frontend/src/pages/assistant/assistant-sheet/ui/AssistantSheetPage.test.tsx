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
  within,
} from '@testing-library/react-native';

import { resetPressGuard } from '@/shared/lib/pressGuard';

import { setAssistantPort } from '../api/assistantClient';
import type {
  AssistantMessage,
  NextAction,
  QuickReply,
} from '../api/assistantContract';
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
const mockPush = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    push: mockPush,
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

// TRIP-1565 — push 갈래는 모듈 전역 400ms 연타 창(guardPress)을 연다. 창이 테스트 사이에 새면 다음 테스트의 첫 누름이
// 조용히 먹힌다(순서 의존 간헐 실패) → describe 안이 아니라 파일 최상위에서 매번 닫는다.
beforeEach(() => resetPressGuard());

afterEach(() => {
  restore?.();
  clients.splice(0).forEach((client) => client.clear());
  mockBack.mockClear();
  mockReplace.mockClear();
  mockPush.mockClear();
});

// TRIP-1567 — 시작 quick reply 는 칩 안에 접혀 있다. 누르기 전에 칩으로 펼친다.
async function openSuggestions(): Promise<void> {
  fireEvent.press(await screen.findByTestId('assistant-context-chip'));
}

describe('AssistantSheetPage (TRIP-1322)', () => {
  it('여행 문맥으로 열면 칩·인사가 뜨고 시작 quick reply 는 칩을 펼치면 보인다(BR-U8-03·04)', async () => {
    renderPage();
    // TRIP-1526 — 보이는 문구는 surface 별 고정 라벨, 서버 문구(BR-U8-03)는 접근성 라벨에 실린다.
    const chip = await screen.findByTestId('assistant-context-chip');
    expect(chip).toHaveTextContent('이 일정에 관해 질문하기');
    expect(screen.queryByText('부산 2박 3일 · 등록 숙소 서면')).toBeNull();
    expect(chip.props.accessibilityLabel).toContain(
      '부산 2박 3일 · 등록 숙소 서면'
    );
    // TRIP-1567 — 시작 quick reply 는 칩 안에 접혀 있다가 칩을 누르면 보인다(옛: 열자마자 줄로 보임).
    expect(chip).toBeCollapsed();
    expect(screen.queryByTestId('assistant-quick-reply-qr-review')).toBeNull();
    fireEvent.press(chip);
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
    // TRIP-1526 — 여행 문맥이 없으면 칩이 능력 보기다(surface 보다 우선).
    expect(screen.getByTestId('assistant-context-chip')).toHaveTextContent(
      '내가 할 수 있는 것 보기'
    );
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
    await openSuggestions();
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-quick-reply-qr-review'));
    });
    expect(
      await screen.findByText('지금까지 진행 상태를 정리했어요.')
    ).toBeOnTheScreen();
  });

  // TRIP-1566 — 이 자리의 옛 케이스("누르면 replace('/trips/t1/itinerary')")는 고정 라우트를 굳힌 것이라 폐기했다.
  // 「일정 보기」 의 이동은 누른 시점의 일정 조회 결과로 정해지고 그건 요청 횟수·지연·실패를 봐야 하므로 MSW 가 있는
  // AssistantSheetPage.integration.test 로 옮겼다. 여기(MSW 없음)는 행이 "그려지는가"까지만 본다 — 누르면 실제 GET 이 나간다.
  it('여행 문맥이 있으면 「일정 보기」 행이 그대로 그려진다(능력 보기로 안 바뀐다)', async () => {
    renderPage();
    expect(
      (await screen.findAllByTestId('assistant-next-action-OPEN_ITINERARY'))
        .length
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.queryByTestId('assistant-next-action-SHOW_CAPABILITIES')
    ).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('AssistantSheetPage · NO_CONTEXT 능력 보기 (TRIP-1531 결함 3)', () => {
  // 서버가 발급한 SHOW_CAPABILITIES 칩이 실린 "여행 없음" 열기 응답 — 라벨을 입력 칩 문구와 달리 둬서 어느 쪽이 갔는지 가른다.
  const issued = {
    id: 'qr-issued-capabilities',
    label: '도움말',
    action: 'SHOW_CAPABILITIES' as const,
    params: {},
  };
  const seed = () => [
    {
      ...assistantSample('no-context', {
        id: 'm-seed',
        tripId: null,
        createdAt: '2026-10-21T00:00:00.000Z',
      }),
      quickReplies: [issued],
    },
  ];

  it('서버 SHOW_CAPABILITIES 칩은 줄에 안 그리고, 입력 칩을 누르면 서버 발급 id 의 ACTION 으로 보낸다(TEXT 아님)', async () => {
    renderPage({ seedMessages: seed() }, { surface: 'HOME' });
    const chip = await screen.findByTestId('assistant-context-chip');
    expect(
      screen.queryByTestId('assistant-quick-reply-qr-issued-capabilities')
    ).toBeNull();
    const sendTurn = jest.spyOn(fake, 'sendTurn');

    await act(async () => {
      fireEvent.press(chip);
    });

    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn.mock.calls[0][1].input).toEqual({
      type: 'ACTION',
      quickReplyId: 'qr-issued-capabilities',
    });
  });
});

// TRIP-1567 — 컨텍스트 칩이 추천 질문을 펼치고, 항목 누름은 기존 handleQuickReply(ACTION + quickReplyId)를 쓴다.
// 못 보는 것(6-b): 카드가 위로 자라는 모양 · 키보드와의 공존 · 입력 포커스 유지.
describe('AssistantSheetPage · 추천 질문 배선 (TRIP-1567)', () => {
  const LIST = 'assistant-chip-suggestions';
  const optionReply = (id: string, label: string): QuickReply => ({
    id,
    label,
    action: 'PICK_OPTION',
    params: {},
  });
  const clarifyMessage = (): AssistantMessage => ({
    id: 'm-clarify',
    role: 'ASSISTANT',
    kind: 'CLARIFY',
    text: '어느 쪽을 말씀하세요?',
    nextActions: [
      {
        type: 'SHOW_CAPABILITIES',
        label: '내가 할 수 있는 것 보기',
        params: {},
      },
    ],
    quickReplies: [
      optionReply('qr-opt-a', '둘째 날 검토'),
      optionReply('qr-opt-b', '셋째 날 검토'),
    ],
    createdAt: '2026-10-22T00:00:00.000Z',
  });

  it('항목을 누르면 서버 id 의 ACTION 턴 1회로 보내고(TEXT 아님) 목록이 접힌다', async () => {
    renderPage();
    const chip = await screen.findByTestId('assistant-context-chip');
    const sendTurn = jest.spyOn(fake, 'sendTurn');
    // 눌러 보기 전엔 아무 턴도 안 나갔고 목록도 없다 — 앵커
    expect(sendTurn).not.toHaveBeenCalled();
    expect(screen.queryByTestId(LIST)).toBeNull();
    fireEvent.press(chip);
    expect(screen.getByTestId(LIST)).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-quick-reply-qr-next'));
    });

    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    // 라벨(다음 장소 어디야)이 말풍선에 보이는 것과 별개로, 전송 입력은 발급 id 의 ACTION 이다
    expect(sendTurn.mock.calls[0][1].input).toEqual({
      type: 'ACTION',
      quickReplyId: 'qr-next',
    });
    expect(await screen.findByText('다음 장소 어디야')).toBeOnTheScreen();
    expect(screen.queryByTestId(LIST)).toBeNull();
    expect(chip).toBeCollapsed();
  });

  it('응답 중에는 항목이 비활성이라 눌러도 턴이 더 나가지 않고, 칩 토글은 된다', async () => {
    renderPage();
    const chip = await screen.findByTestId('assistant-context-chip');
    fake.configure({ latencyMs: 400 });
    fireEvent.press(chip);
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-quick-reply-qr-review'));
    });
    // 응답이 아직 안 왔다 — 앵커
    expect(await screen.findByTestId('assistant-progress')).toBeOnTheScreen();
    expect(fake.calls.sendTurn).toBe(1);

    fireEvent.press(chip);

    expect(chip).toBeExpanded();
    const items = within(screen.getByTestId(LIST)).getAllByTestId(
      /^assistant-quick-reply-/
    );
    expect(items.length).toBeGreaterThan(1);
    items.forEach((item) => {
      expect(item.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true })
      );
      fireEvent.press(item);
    });
    expect(fake.calls.sendTurn).toBe(1);

    // 열려 있는 요청을 끝까지 흘려 보낸다(테스트 사이로 새지 않게)
    expect(
      await screen.findByText('지금까지 진행 상태를 정리했어요.')
    ).toBeOnTheScreen();
  });

  it('되묻기 보기(PICK_OPTION)는 칩을 안 눌러도 카드 위에 보이고 펼침 목록에는 없으며, 누르면 그 id 의 ACTION 턴이다 (BR-U8-11)', async () => {
    renderPage({ seedMessages: [clarifyMessage()] });
    await screen.findByTestId('assistant-message-m-clarify');
    const sendTurn = jest.spyOn(fake, 'sendTurn');
    expect(screen.queryByTestId(LIST)).toBeNull();
    expect(
      screen.getByTestId('assistant-quick-reply-qr-opt-a')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('assistant-quick-reply-qr-opt-b')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('assistant-context-chip'));

    // 펼친 목록 안에는 없다 — 앵커: 목록은 실제로 열렸고 능력 보기 항목이 있다
    const list = within(screen.getByTestId(LIST));
    expect(
      list.getByTestId('assistant-quick-reply-capabilities')
    ).toBeOnTheScreen();
    expect(list.queryByTestId('assistant-quick-reply-qr-opt-a')).toBeNull();
    expect(list.queryByTestId('assistant-quick-reply-qr-opt-b')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-quick-reply-qr-opt-a'));
    });

    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn.mock.calls[0][1].input).toEqual({
      type: 'ACTION',
      quickReplyId: 'qr-opt-a',
    });
  });
});

describe('AssistantSheetPage · 카드 배선 (TRIP-1323)', () => {
  it('검토 quick reply → 진행 검토 카드 + 문제 행, 해결 행동을 누르면 그 화면으로 간다', async () => {
    renderPage();
    await openSuggestions();
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-quick-reply-qr-review'));
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
    // TRIP-1565 — 상세류(숙소)는 시트 위에 쌓는다. 이전 기대값은 mockReplace 였다.
    expect(mockPush.mock.calls).toEqual([['/stays/stay-songjeong']]);
    expect(mockReplace).not.toHaveBeenCalled();
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
    // TRIP-1528 — 응답 실패 문장은 평문과 카드에 겹쳐 두 번 나오지 않는다
    expect(
      screen.getAllByText('지금 도우미가 응답하지 못했어요.')
    ).toHaveLength(1);
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
  it('TRIP-1525 · 더보기(⋮) 토글은 접근성 라벨 "더보기" 이고 이력일 때 selected, 틀에는 제목이 없다', async () => {
    renderPage();
    await screen.findByTestId('assistant-context-chip');
    const toggle = () => screen.getByTestId('assistant-history-toggle');
    expect(toggle().props.accessibilityLabel).toBe('더보기');
    expect(toggle().props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
    expect(screen.queryByText('AI 도우미')).toBeNull();

    fireEvent.press(toggle());

    expect(await screen.findByTestId('assistant-history')).toBeOnTheScreen();
    expect(toggle().props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
  });

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

  it('TRIP-1529 · 이력의 [닫기]는 헤더 X 와 같은 닫기다 — 라우터 back 1회(연타해도 1회)', async () => {
    renderPage();
    await screen.findByTestId('assistant-context-chip');
    fireEvent.press(screen.getByTestId('assistant-history-toggle'));

    fireEvent.press(await screen.findByTestId('assistant-history-close'));
    fireEvent.press(screen.getByTestId('assistant-history-close'));

    expect(mockBack).toHaveBeenCalledTimes(1);
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

// TRIP-1564 — 후보 카드를 눌렀을 때: 고르기가 있으면 고르기(ACTION 턴), 없고 장소 보기가 있으면 그 행과 같은 이동,
// 둘 다 없으면 눌리지 않는다. 판정 범위는 그 카드가 속한 메시지 하나다(옛 메시지의 고르기는 보지 않는다).
describe('AssistantSheetPage · 후보 카드 누름', () => {
  const openPlace = (poiId: string, label = `${poiId} 장소`): NextAction => ({
    type: 'OPEN_PLACE',
    label,
    params: { poiId },
  });
  const pickReply = (id: string, poiId: string): QuickReply => ({
    id,
    label: `${poiId} 고르기`,
    action: 'PICK_CANDIDATE',
    params: { poiId },
  });
  const cardsMessage = (
    id: string,
    poiIds: string[],
    parts: { quickReplies?: QuickReply[]; nextActions?: NextAction[] } = {}
  ): AssistantMessage => ({
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
    quickReplies: parts.quickReplies,
    createdAt: '2026-10-22T00:00:00.000Z',
  });
  const infoMessage = (id: string, action: NextAction): AssistantMessage => ({
    id,
    role: 'ASSISTANT',
    kind: 'INFO',
    text: '장소 정보예요.',
    payload: {
      infoKind: 'PLACE',
      title: '이름-poi-a',
      rows: [{ label: '영업', value: '매일' }],
    },
    nextActions: [action],
    createdAt: '2026-10-22T00:00:01.000Z',
  });

  // 같은 poiId 카드가 여러 메시지에 있을 수 있어 항상 메시지 범위부터 잡는다.
  const card = (messageId: string, poiId: string) =>
    within(screen.getByTestId(`assistant-message-${messageId}`)).getByTestId(
      `assistant-candidate-${poiId}`
    );
  async function press(element: Parameters<typeof fireEvent.press>[0]) {
    await act(async () => {
      fireEvent.press(element);
    });
  }
  // router 의 어느 메서드로 갔는지까지 합친 기록 — TRIP-1565 가 replace→push 로 갈라도 카드·행이 함께 움직이는지 본다.
  const navCalls = () => [
    ...mockReplace.mock.calls.map((args) => ['replace', ...args]),
    ...mockPush.mock.calls.map((args) => ['push', ...args]),
  ];
  const navHrefs = () => navCalls().map((call) => call[1]);

  it.each([
    ['ITINERARY', '/explore/places/poi-a'],
    ['LIVE', '/trips/t1/live/place/poi-a'],
  ] as const)(
    '장소 보기 카드를 누르면(%s) 장소 상세로 가고 새 턴은 안 나간다',
    async (surface, href) => {
      renderPage(
        {
          seedMessages: [
            cardsMessage('m-cand', ['poi-a'], {
              nextActions: [openPlace('poi-a')],
            }),
          ],
        },
        { tripId: 't1', surface }
      );
      await screen.findByTestId('assistant-message-m-cand');

      await press(card('m-cand', 'poi-a'));

      expect(navHrefs()).toEqual([href]);
      // TRIP-1565 — 장소 상세는 push 다(카드 전용 경로가 없다 — 빨간 행과 같은 이동).
      expect(navCalls()).toEqual([['push', href]]);
      expect(fake.calls.sendTurn).toBe(0);
    }
  );

  it('장소 보기 카드가 있으면 같은 장소의 빨간 행은 없고, 다른 메시지(정보 카드)의 같은 장소 행은 남는다', async () => {
    renderPage({
      seedMessages: [
        cardsMessage('m-cand', ['poi-a'], {
          nextActions: [openPlace('poi-a')],
        }),
        infoMessage('m-info', openPlace('poi-a', '장소 보기')),
      ],
    });
    await screen.findByTestId('assistant-message-m-info');

    expect(
      screen.queryAllByTestId('assistant-next-action-OPEN_PLACE')
    ).toHaveLength(1);
    expect(
      within(screen.getByTestId('assistant-message-m-info')).getByTestId(
        'assistant-next-action-OPEN_PLACE'
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('assistant-message-m-cand')).queryByTestId(
        'assistant-next-action-OPEN_PLACE'
      )
    ).toBeNull();
  });

  it('카드 누름과 같은 화면 빨간 행 누름은 router 에 같은 호출을 한다(카드 전용 이동 경로가 없다)', async () => {
    renderPage({
      seedMessages: [
        cardsMessage('m-cand', ['poi-a'], {
          nextActions: [openPlace('poi-a')],
        }),
        infoMessage('m-info', openPlace('poi-a', '장소 보기')),
      ],
    });
    await screen.findByTestId('assistant-message-m-info');

    await press(card('m-cand', 'poi-a'));
    const viaCard = navCalls();
    // TRIP-1565 — push 갈래는 이동 잠금(closingRef)을 세우지 않아 같은 인스턴스에서 둘을 다 누를 수 있다. 연타 창만 닫아 준다.
    mockReplace.mockClear();
    mockPush.mockClear();
    resetPressGuard();
    await press(
      within(screen.getByTestId('assistant-message-m-info')).getByTestId(
        'assistant-next-action-OPEN_PLACE'
      )
    );
    const viaRow = navCalls();

    expect(viaCard).toEqual([['push', '/explore/places/poi-a']]);
    expect(viaRow).toEqual(viaCard);
  });

  it('고르기 카드를 누르면 그 quick reply 의 ACTION 턴을 보내고 이동은 없다 — 같은 장소의 빨간 행도 그대로 있다', async () => {
    renderPage({
      seedMessages: [
        cardsMessage('m-pick', ['poi-a'], {
          quickReplies: [pickReply('qr-pick-a', 'poi-a')],
          nextActions: [openPlace('poi-a')],
        }),
      ],
    });
    await screen.findByTestId('assistant-message-m-pick');
    expect(
      screen.queryAllByTestId('assistant-next-action-OPEN_PLACE')
    ).toHaveLength(1);
    const sendTurn = jest.spyOn(fake, 'sendTurn');

    await press(card('m-pick', 'poi-a'));

    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn.mock.calls[0][1].input).toEqual({
      type: 'ACTION',
      quickReplyId: 'qr-pick-a',
    });
    expect(navCalls()).toEqual([]);
  });

  it('둘 다 없는 카드는 button 역할이 없고 눌러도 턴·이동이 없다 — 같은 화면의 고르기 카드는 정상 동작', async () => {
    renderPage({
      seedMessages: [
        cardsMessage('m-none', ['poi-a']),
        cardsMessage('m-pick', ['poi-b'], {
          quickReplies: [pickReply('qr-pick-b', 'poi-b')],
        }),
      ],
    });
    await screen.findByTestId('assistant-message-m-pick');
    const sendTurn = jest.spyOn(fake, 'sendTurn');

    expect(card('m-none', 'poi-a').props.accessibilityRole).not.toBe('button');
    await press(card('m-none', 'poi-a'));
    // 앵커 — 같은 화면에서 눌리는 카드는 실제로 턴을 보낸다. 그 한 번이 전부여야 앞의 누름이 아무것도 안 보낸 것이다.
    await press(card('m-pick', 'poi-b'));

    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn.mock.calls[0][1].input).toEqual({
      type: 'ACTION',
      quickReplyId: 'qr-pick-b',
    });
    expect(navCalls()).toEqual([]);
  });

  it('앞선 메시지에 같은 장소의 고르기가 있어도 새 메시지의 카드는 그것을 보내지 않는다(판정 범위는 그 카드의 메시지)', async () => {
    // 같은 장소의 고르기가 앞선 두 메시지에 각각 다른 id 로 있다 — 대화 전체를 훑는 옛 구현이면 m-new 가 첫 일치(qr-1)를 보낸다
    renderPage({
      seedMessages: [
        cardsMessage('m-old1', ['poi-a'], {
          quickReplies: [pickReply('qr-1', 'poi-a')],
        }),
        cardsMessage('m-old2', ['poi-a'], {
          quickReplies: [pickReply('qr-2', 'poi-a')],
        }),
        cardsMessage('m-new', ['poi-a']),
      ],
    });
    await screen.findByTestId('assistant-message-m-new');
    const sendTurn = jest.spyOn(fake, 'sendTurn');

    await press(card('m-new', 'poi-a'));
    // 앵커 — 둘째 메시지의 자기 카드는 자기 고르기(qr-2)로 정상 동작한다. 앞의 누름이 턴을 보냈다면 이 누름은 막혀 qr-1 이 남는다
    await press(card('m-old2', 'poi-a'));

    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn.mock.calls[0][1].input).toEqual({
      type: 'ACTION',
      quickReplyId: 'qr-2',
    });
  });
});

// TRIP-1565 — 이동 방식. 상세류(장소·숙소·회고·요약·스타일)는 시트를 닫지 않고 그 위에 쌓고(router.push),
// 흐름·탭 목적지는 시트 자리를 교체한다(router.replace). push 갈래는 시트가 남으므로 이동 잠금(closingRef)을 세우지 않고
// 연타만 공용 가드(400ms)로 막는다 — 돌아와서 ✕·같은 행이 다시 눌려야 한다.
// 못 보는 것(6-b): 상세가 뜨는 모양 · 시트가 밑에 남는 것 · 스크롤 위치 · 400ms 를 빠져나가는 느린 이중 탭.
describe('AssistantSheetPage · 이동 방식 (TRIP-1565)', () => {
  const act1 = (type: string, params: Record<string, string> = {}) => ({
    type,
    label: `${type} 라벨`,
    params,
  });
  const actionInfo = (id: string, action: NextAction): AssistantMessage => ({
    id,
    role: 'ASSISTANT',
    kind: 'INFO',
    text: '안내예요.',
    payload: {
      infoKind: 'PLACE',
      title: '이름',
      rows: [{ label: '영업', value: '매일' }],
    },
    nextActions: [action],
    createdAt: '2026-10-22T00:00:00.000Z',
  });
  const rowOf = (messageId: string, type: string) =>
    within(screen.getByTestId(`assistant-message-${messageId}`)).getByTestId(
      `assistant-next-action-${type}`
    );
  async function press(element: Parameters<typeof fireEvent.press>[0]) {
    await act(async () => {
      fireEvent.press(element);
    });
  }
  /** 행 하나만 있는 시트를 띄우고 행이 그려질 때까지 기다린다. */
  async function openWith(
    action: NextAction,
    surface: 'ITINERARY' | 'LIVE' = 'ITINERARY'
  ) {
    renderPage(
      { seedMessages: [actionInfo('m-1', action)] },
      { tripId: 't1', surface }
    );
    await screen.findByTestId('assistant-message-m-1');
    return () => rowOf('m-1', action.type);
  }

  it.each([
    ['OPEN_PLACE', { poiId: 'poi-a' }, 'ITINERARY', '/explore/places/poi-a'],
    ['OPEN_PLACE', { poiId: 'poi-a' }, 'LIVE', '/trips/t1/live/place/poi-a'],
    ['OPEN_OTA', { stayId: 'stay-1' }, 'ITINERARY', '/stays/stay-1'],
    ['OPEN_STYLE', {}, 'ITINERARY', '/records/style'],
    ['OPEN_TRIP_SUMMARY', {}, 'ITINERARY', '/trips/t1/records/summary'],
    [
      'OPEN_REFLECTION',
      { date: '2026-11-02' },
      'ITINERARY',
      '/trips/t1/records/reflection/2026-11-02',
    ],
  ] as const)(
    '%s(%j · %s) 는 시트를 닫지 않고 그 위에 쌓는다 — push 1회·replace 0회',
    async (type, params, surface, href) => {
      const row = await openWith(act1(type, params), surface);
      // 앵커 — 누르기 전엔 이동이 없다
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();

      await press(row());

      expect(mockPush.mock.calls).toEqual([[href]]);
      expect(mockReplace).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['OPEN_STAY_SEARCH', '/stays'],
    ['OPEN_REPLAN', '/trips/t1/planb'],
    ['OPEN_LIVE', '/trips/t1/live'],
    ['OPEN_ITINERARY_EDIT', '/trips/t1/itinerary/edit'],
    ['OPEN_ITINERARY_METHOD', '/trips/t1/itinerary/method'],
    ['OPEN_REGENERATE', '/trips/t1/itinerary/method'],
    ['CREATE_TRIP', '/trips/new/step1'],
  ])(
    '%s 는 시트 자리를 교체한다 — replace 1회·push 0회',
    async (type, href) => {
      const row = await openWith(act1(type));
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();

      await press(row());

      expect(mockReplace.mock.calls).toEqual([[href]]);
      expect(mockPush).not.toHaveBeenCalled();
    }
  );

  it('push 로 이동한 뒤(연타 창이 지난 뒤) 같은 행을 다시 누르면 다시 이동한다 — 총 2회', async () => {
    const row = await openWith(act1('OPEN_PLACE', { poiId: 'poi-a' }));

    await press(row());
    expect(mockPush).toHaveBeenCalledTimes(1);
    // 상세를 보고 돌아오는 데 걸리는 시간 — 창(400ms)이 지난 상태
    resetPressGuard();
    await press(row());

    expect(mockPush.mock.calls).toEqual([
      ['/explore/places/poi-a'],
      ['/explore/places/poi-a'],
    ]);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  describe('연타 창의 경계', () => {
    const FROZEN_NOW = 1_790_000_000_000;
    let clock: jest.SpyInstance | undefined;
    afterEach(() => clock?.mockRestore());

    it('창은 400ms 다 — 399ms 뒤 누름은 무시되고 400ms 뒤 누름은 다시 이동한다', async () => {
      const row = await openWith(act1('OPEN_PLACE', { poiId: 'poi-a' }));
      // 시계는 화면이 다 그려진 뒤에 멈춘다(그 전에 멈추면 쿼리 신선도가 뒤틀린다) — 이후엔 waitFor 를 쓰지 않는다
      clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);

      fireEvent.press(row());
      expect(mockPush).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(FROZEN_NOW + 399);
      fireEvent.press(row());
      expect(mockPush).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(FROZEN_NOW + 400);
      fireEvent.press(row());
      expect(mockPush).toHaveBeenCalledTimes(2);
    });
  });

  it('같은 틱에 두 번 눌러도(연타) push 는 1회다', async () => {
    const row = await openWith(act1('OPEN_PLACE', { poiId: 'poi-a' }));

    await act(async () => {
      fireEvent.press(row());
      fireEvent.press(row());
    });

    expect(mockPush.mock.calls).toEqual([['/explore/places/poi-a']]);
  });

  it('push 로 이동한 뒤에도 ✕ 는 시트를 닫는다(이동 잠금이 안 남았다) — back 1회', async () => {
    const row = await openWith(act1('OPEN_PLACE', { poiId: 'poi-a' }));
    await press(row());
    // 앵커 — push 가 실제로 나갔다
    expect(mockPush).toHaveBeenCalledTimes(1);

    await press(screen.getByTestId('assistant-sheet-close'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('✕ 로 닫는 중에는 push 갈래를 눌러도 이동하지 않는다', async () => {
    const row = await openWith(act1('OPEN_PLACE', { poiId: 'poi-a' }));
    await press(screen.getByTestId('assistant-sheet-close'));
    // 앵커 — 닫기가 실제로 나갔다
    expect(mockBack).toHaveBeenCalledTimes(1);
    // 연타 창이 아니라 닫는 중 잠금이 막는 것을 고립한다
    resetPressGuard();

    await press(row());

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('replace 갈래를 한 번 누르면 이후 다른 이동은 replace 든 push 든 막힌다', async () => {
    renderPage(
      {
        seedMessages: [
          actionInfo('m-stay', act1('OPEN_STAY_SEARCH')),
          actionInfo('m-replan', act1('OPEN_REPLAN')),
          actionInfo('m-place', act1('OPEN_PLACE', { poiId: 'poi-a' })),
        ],
      },
      { tripId: 't1', surface: 'ITINERARY' }
    );
    await screen.findByTestId('assistant-message-m-place');

    await press(rowOf('m-stay', 'OPEN_STAY_SEARCH'));
    // 앵커 — 첫 이동은 나갔다
    expect(mockReplace.mock.calls).toEqual([['/stays']]);
    resetPressGuard();

    await press(rowOf('m-replan', 'OPEN_REPLAN'));
    await press(rowOf('m-place', 'OPEN_PLACE'));

    expect(mockReplace.mock.calls).toEqual([['/stays']]);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
