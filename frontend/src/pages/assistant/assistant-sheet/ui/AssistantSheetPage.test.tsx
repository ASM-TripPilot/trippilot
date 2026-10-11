import type { ReactNode } from 'react';
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
