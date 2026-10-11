import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
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
