import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import { buildSlotKey } from '@/features/itinerary/model/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * h24 편집 배선의 **시각조정 개폐·로컬성·저장 흐름**을 실 HTTP 로 태우는 심판(슬라이스3).
 *
 * 무엇을 보장하나(전부 페이지 층 배선):
 *  - 🔴 비고정 시각칩 → **시트 조건부 마운트**(등장)·고정은 안 열림(AC-T1·AC-T2 · 02a ★4).
 *  - 🔴 [적용] → 카드 시각 갱신·시트 닫힘·**PUT 0**(로컬 편집, INV-2 · 02a ★6)(AC-T3·AC-T7).
 *  - 🔴 [취소] → 카드 시각 무변경·시트 닫힘·PUT 0(AC-T5·AC-T7).
 *  - 🔴 조정값이 이후 **저장(PUT)에 그대로 실린다** — 슬라이스2 경로 재사용, 새 저장 코드 0(AC-T3·AC-T7).
 *
 * 왜 통합인가: "시트가 열렸다/닫혔다"는 페이지의 조건부 마운트라 목 시트의 mount/unmount 로만
 * 관찰된다(★4). "로컬 편집이라 서버를 안 건드린다"는 훅 호출수가 아니라 **PUT 실건수**로 재야
 * 가정이 사실이 된다(프로즌 통합 선례).
 *
 * ⚠️ 슬라이스1·2 프로즌 통합(`ItineraryEditPage.integration.test.tsx`)은 **손대지 않는다**(해시
 * 동결, 02a ★8) — 저장 PUT·409 2갈래·배지 지속 무회귀는 그 파일이 지고, 여기선 시각조정만 잰다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=시각칩/셀/적용·취소·저장 press → 단언=시트 개폐·카드·PUT.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: jest.fn() }),
}));

jest.mock('react-native-draggable-flatlist');

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';

const timeChip = (poiId: string) =>
  `itinerary-edit-slot-time-${buildSlotKey(DAY1, poiId)}`;
const cardId = (poiId: string) =>
  `itinerary-edit-slot-${buildSlotKey(DAY1, poiId)}`;
const SHEET = 'itinerary-edit-time-sheet';

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: DAY1,
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** day1 = [고정 체크아웃(09:00) · 비고정 a(10:15–11:45)]. 고정은 시각칩 탭이 무동작이어야 한다. */
function itinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'poi-fixed',
          startAt: '09:00:00',
          endAt: '10:00:00',
          isFixed: true,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
          nameKo: '해운대 OO호텔',
        },
        {
          poiId: 'poi-a',
          startAt: '10:15:00',
          endAt: '11:45:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: ['바다'],
          nameKo: '광안리',
        },
      ],
    },
  ];
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

let getCalls = 0;
let putCalls = 0;
let putBody: unknown = null;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  getCalls = 0;
  putCalls = 0;
  putBody = null;
  mockBack.mockClear();
  setAccessToken('valid-access');
  useItineraryEditStore.getState().reset();

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      getCalls += 1;
      return HttpResponse.json(itinerary());
    }),
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      putCalls += 1;
      putBody = await request.json();
      return HttpResponse.json(itinerary());
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<ItineraryEditPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

/** 비고정 시각칩을 눌러 시트를 연다 — 여러 케이스가 공유하는 준비 동작. */
async function openSheetForA() {
  await screen.findByTestId(cardId('poi-a'));
  fireEvent.press(screen.getByTestId(timeChip('poi-a')));
  await screen.findByTestId(SHEET);
}

describe('🔴 IT1 · AC-T1 — 비고정 시각칩 → 시각조정 시트가 마운트된다', () => {
  it('열기 전엔 시트가 없고, 비고정 시각칩을 누르면 뜬다', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-a'));

    // 열기 전 — 조건부 마운트라 트리에 없다(★4).
    expect(screen.queryByTestId(SHEET)).toBeNull();

    fireEvent.press(screen.getByTestId(timeChip('poi-a')));

    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
  });
});

describe('🔴 IT2 · AC-T2 — 고정 시각칩 → 시트가 열리지 않는다 (INV-U3-03)', () => {
  it('고정 슬롯 시각칩을 눌러도 시트가 마운트되지 않는다', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-fixed'));

    fireEvent.press(screen.getByTestId(timeChip('poi-fixed')));

    // 짝 — IT1 이 비고정 열림 긍정 앵커. 고정은 onPress 부재라 그대로 없다.
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });
});

describe('🔴 IT3 · AC-T3·AC-T7 — 적용: 카드 시각 갱신·시트 닫힘·PUT 0(로컬)', () => {
  it('시작을 23 시로 바꿔 적용하면 카드가 23:15·익일 로 바뀌고 저장은 안 나간다', async () => {
    renderPage();
    await openSheetForA();

    fireEvent.press(screen.getByTestId('itinerary-edit-time-start-h-23'));
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));

    // 카드 시각칩이 갱신된다 — 부분 포함이라 **regex**(문자열은 완전일치, 02a ★3).
    await waitFor(() =>
      expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(/23:15/)
    );
    expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(/익일/);

    // 시트가 닫힌다(unmount).
    expect(screen.queryByTestId(SHEET)).toBeNull();

    // ★6 로컬 편집 — 시각조정만으로 서버를 안 건드린다.
    expect(putCalls).toBe(0);
  });
});

describe('🔴 IT4 · AC-T5·AC-T7 — 취소: 카드 시각 무변경·시트 닫힘·PUT 0', () => {
  it('셀을 바꿔 봐도 취소하면 카드는 10:15 그대로고 저장도 안 나간다', async () => {
    renderPage();
    await openSheetForA();

    fireEvent.press(screen.getByTestId('itinerary-edit-time-start-h-23'));
    fireEvent.press(screen.getByTestId('itinerary-edit-time-cancel'));

    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

    // 무변경 — 원래 10:15 이 남고 23:15 은 없다(취소는 드래프트를 안 바꾼다).
    expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(/10:15/);
    expect(screen.getByTestId(timeChip('poi-a'))).not.toHaveTextContent(
      /23:15/
    );
    expect(putCalls).toBe(0);
  });
});

describe('🔴 IT5 · AC-T3·AC-T7 — 적용값이 슬라이스2 저장 PUT 에 그대로 실린다', () => {
  it('시각조정 후 저장하면 PUT 본문의 그 슬롯 startAt·endsNextDay 가 조정값이다', async () => {
    renderPage();
    await openSheetForA();

    fireEvent.press(screen.getByTestId('itinerary-edit-time-start-h-23'));
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

    // 무동작이던 저장이 슬라이스2 경로로 나간다(새 저장 코드 0 — 조립은 buildEditItineraryRequest).
    fireEvent.press(screen.getByTestId('itinerary-edit-save'));
    await waitFor(() => expect(putCalls).toBe(1));

    const body = putBody as EditItineraryRequest;
    const slotA = body.days[0].slots.find((s) => s.poiId === 'poi-a');
    expect(slotA?.startAt).toBe('23:15:00');
    expect(slotA?.endsNextDay).toBe(true);
    // 짝 — 안 건드린 종료 시각은 원값 그대로 실린다.
    expect(slotA?.endAt).toBe('11:45:00');
  });
});
