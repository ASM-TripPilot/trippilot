import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey } from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { flushNotifications } from '@/test-support/flushNotifications';

import { TripRecordsPage } from './TripRecordsPage';

/**
 * 🔴 TRIP-1078 · AC-4·AC-5·AC-6 — j01 메모 저장 실패 안내 · 세션 캐시 시드(실 페이지 + MSW).
 *
 * 무엇을 보장하나:
 *  - AC-5 PUT 이 404·네트워크로 실패하면 **그 카드 안**에 안내 한 줄(`record-trip-memo-notice-{id}`)이 뜨고
 *    입력한 텍스트는 입력칸에 남는다(INV-4). 같은 텍스트로 다시 포커스를 빼면 PUT 이 다시 나가고, 성공하면
 *    안내가 사라진다.
 *  - AC-6 저장에 성공한 메모는 페이지가 언마운트됐다 다시 떠도(탭 이동) 입력칸에 그 텍스트로 보인다.
 *  - AC-4 다시 뜬 뒤 같은 텍스트로 포커스를 빼도 PUT 은 안 나간다.
 *
 * ★ 테스트 client 의 기본 gcTime 은 0 이다. GC 는 setTimeout 으로 예약되므로, 기다리지 않고 다시 렌더하면
 *   메모 캐시에 gcTime Infinity 가 없어도 통과한다 → 같은 조건의 photos 쿼리가 **실제로 지워졌음**을 먼저
 *   단언해 "GC 가 돌았다"를 증명한 뒤 시드를 본다.
 * ★ "PUT 0회" 는 시간 대기 대신 다음 저장의 바디까지 목록 전체를 `toEqual` 로 본다(중복이면 앞에 낀다).
 *
 * (개념) `unmount()`=렌더한 트리를 내림(탭 이동으로 화면이 사라진 것) · `getQueryCache().find`=캐시에 그 키
 *   쿼리가 남아 있는지 · `HttpResponse.error()`=MSW 네트워크 실패 · `toHaveTextContent(문자열)`=완전 일치.
 */

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';
const DAY = '2026-08-20';
const NOTICE = 'record-trip-memo-notice-v-in';
const NOTICE_COPY = '메모를 저장하지 못했어요. 다시 시도해 주세요.';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
  }),
}));

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  router: {
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

function itinerary() {
  return {
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'CONFIRMED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: DAY,
        slots: [
          {
            poiId: 'p1',
            nameKo: '광안리 해변',
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            tags: [] as string[],
          },
        ],
      },
    ],
  };
}

/** 도착만 한 방문(광안리) — 메모칸이 있는 카드. */
const V_IN = {
  visitCheckId: 'v-in',
  slotKey: `${DAY}#p1`,
  poiId: 'p1',
  arrivedAt: '2026-08-20T05:20:00Z',
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: '2026-08-20T07:00:00.000Z',
};

type MemoReply = 'ok' | 'not-found' | 'network';
let memoReply: MemoReply = 'ok';
let memoBodies: unknown[] = [];

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderPage(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, {
    wrapper: Wrapper,
  });
}

/**
 * n 번째 PUT 이 서버에 닿은 뒤, 응답(성공·실패 처리)이 화면에 반영될 때까지 기다린다(5-b 보강).
 * ★ `waitFor(안내 없음)` 만으로는 부족하다 — 재시도 직전에 안내를 지우는 순간 통과해, 성공 **뒤** 안내가
 *   다시 켜지는 구현을 못 본다. 요청 수를 센 뒤 응답이 돌아올 여유(50ms)를 두고 알림까지 비운 다음에
 *   부재를 단언한다(네트워크 실패는 msw 가 response 이벤트를 안 내므로 요청 수로 센다).
 */
async function settleMemoResponses(n: number) {
  await waitFor(() => expect(memoBodies).toHaveLength(n));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await flushNotifications();
}

const cardOf = () => screen.getByTestId('record-trip-visit-card-v-in');
const memoInput = () =>
  waitFor(() => within(cardOf()).getByTestId('record-trip-memo-input'));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setAccessToken('a');
  memoReply = 'ok';
  memoBodies = [];
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [V_IN] })
    ),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      HttpResponse.json({ items: [], count: 0 })
    ),
    http.put(
      `${BASE}/trips/:tripId/visits/:visitCheckId/memo`,
      async ({ request }) => {
        const body = (await request.json()) as { text: string };
        memoBodies.push(body);
        if (memoReply === 'network') return HttpResponse.error();
        if (memoReply === 'not-found') {
          return HttpResponse.json({ error: 'not found' }, { status: 404 });
        }
        return HttpResponse.json({
          text: body.text,
          updatedAt: '2026-08-20T08:00:00.000Z',
        });
      }
    )
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

describe('🔴 AC-5 · 저장 실패는 카드 안 안내 한 줄 + 입력 유지, 재시도 성공 시 안내가 사라진다', () => {
  it.each<[string, MemoReply]>([
    ['404', 'not-found'],
    ['네트워크 실패', 'network'],
  ])(
    'PUT %s → 안내 · 텍스트 유지 → 같은 텍스트 재시도 성공 → 안내 사라짐',
    async (_label, reply) => {
      renderPage(newClient());
      const input = await memoInput();
      // 앵커 — 실패 전엔 안내가 없다.
      expect(within(cardOf()).queryByTestId(NOTICE)).toBeNull();

      // 실행 ① — 실패하는 저장.
      memoReply = reply;
      fireEvent.changeText(input, '파도 소리가 좋았다');
      fireEvent(input, 'blur');

      // 단언 ① — 그 카드 안에 안내(완전 일치), 입력은 남는다.
      await waitFor(() =>
        expect(within(cardOf()).getByTestId(NOTICE)).toHaveTextContent(
          NOTICE_COPY
        )
      );
      expect(
        within(cardOf()).getByTestId('record-trip-memo-input').props.value
      ).toBe('파도 소리가 좋았다');

      // 실행 ② — 서버가 살아났고, 같은 텍스트로 다시 포커스를 뺀다.
      memoReply = 'ok';
      fireEvent(within(cardOf()).getByTestId('record-trip-memo-input'), 'blur');

      // 단언 ② — 마지막 성공값이 없으니 PUT 이 다시 나가고, 성공 응답이 반영된 **뒤에도** 안내가 없다.
      await settleMemoResponses(2);
      expect(within(cardOf()).queryByTestId(NOTICE)).toBeNull();
      expect(memoBodies).toEqual([
        { text: '파도 소리가 좋았다' },
        { text: '파도 소리가 좋았다' },
      ]);
      expect(cardOf()).toBeOnTheScreen();
    }
  );
});

describe('🔴 AC-6·AC-4 · 저장한 메모는 다시 떠도 보이고, 같은 텍스트는 다시 안 보낸다', () => {
  it('저장 → 언마운트(GC 확인) → 다시 렌더하면 입력칸이 저장 텍스트, 같은 텍스트 blur 는 PUT 0', async () => {
    const client = newClient();
    const first = renderPage(client);

    // 준비 — 저장 성공.
    const input = await memoInput();
    fireEvent.changeText(input, '바람이 좋았다');
    fireEvent(input, 'blur');
    await waitFor(() => expect(memoBodies).toHaveLength(1));
    // 5-b 보강 — 첫 저장 성공이 반영된 뒤 실패 안내가 없다(성공에도 안내를 켜는 구현 차단).
    await settleMemoResponses(1);
    expect(within(cardOf()).queryByTestId(NOTICE)).toBeNull();

    // 실행 ① — 페이지가 사라지고 GC 가 돈다.
    const photosKey = getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey(
      TRIP_ID,
      'v-in'
    );
    expect(client.getQueryCache().find({ queryKey: photosKey })).toBeDefined();
    first.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // 앵커 — gcTime 0 쿼리는 실제로 지워졌다(GC 가 돌았다는 증거).
    expect(
      client.getQueryCache().find({ queryKey: photosKey })
    ).toBeUndefined();

    // 실행 ② — 같은 세션(같은 client)으로 다시 들어온다.
    renderPage(client);
    const again = await memoInput();

    // 단언 ① — 저장한 텍스트로 시드된다.
    expect(again.props.value).toBe('바람이 좋았다');

    // 실행 ③ — 같은 텍스트로 포커스를 뺀 뒤, 다른 텍스트로 저장한다(순서 센티널).
    fireEvent(again, 'blur');
    fireEvent.changeText(
      within(cardOf()).getByTestId('record-trip-memo-input'),
      '노을도 좋았다'
    );
    fireEvent(within(cardOf()).getByTestId('record-trip-memo-input'), 'blur');

    // 단언 ② — 같은 텍스트 blur 는 PUT 0회(중복이면 두 바디 사이에 낀다).
    await waitFor(() =>
      expect(memoBodies).toContainEqual({ text: '노을도 좋았다' })
    );
    expect(memoBodies).toEqual([
      { text: '바람이 좋았다' },
      { text: '노을도 좋았다' },
    ]);
  });
});
