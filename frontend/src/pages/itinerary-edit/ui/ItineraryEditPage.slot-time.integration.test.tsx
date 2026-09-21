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
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * TRIP-797 · h12 편집기 통일(묶음 C 재조립) — 편집 배선의 **시각조정 개폐·로컬성·저장 흐름**을 실 HTTP
 * 로 태우는 심판. 소비 화면만 옛 `ItineraryEditScreen` → 순수 뷰 `EditorView` 로 바뀌고, 시각칩은 이제
 * `SlotStopCard` 의 누름 칩(`slot-stopcard-timechip-*`)이며 시트는 그대로 `TimeSheet`(접두
 * `itinerary-edit-time`) 다.
 *
 * 무엇을 보장하나(전부 페이지 층 배선):
 *  - 🔴 비고정 시각칩 → **시트 조건부 마운트**(등장, IT1), 고정은 **누름 칩 자체가 없다**(IT2 · INV-U3-03).
 *  - 🔴 [적용] → 카드 시각 갱신·시트 닫힘·**PUT 0**(로컬 편집, INV-2)(IT3).
 *  - 🔴 [취소] → 카드 시각 무변경·시트 닫힘·PUT 0(IT4).
 *  - 🔴 조정값이 이후 **저장(PUT)에 그대로 실린다** — 저장 경로 재사용, 새 저장 코드 0(IT5).
 *
 * ⚠️ 옛 IT3 의 "익일" 표기 단언은 뺐다 — `EditorView` 의 시각칩 라벨은 `HH:mm–HH:mm`(en-dash) 만
 * 조립하고 endsNextDay 접미를 그리지 않는다(위 뷰가 커밋된 계약, 02a-C §9). endsNextDay 는 저장 PUT
 * 본문(IT5)으로 잰다. 시트 실개폐·2스냅은 `@gorhom/bottom-sheet` 통과형 목이 원리적으로 못 본다.
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

// EditorView 가 조립하는 MapSheetShell → MapView 는 jest 에서 못 뜬다 — 관찰 목으로 대체.
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';

/** 편집 시각칩(누름 Pressable) — 비고정만 존재한다. */
const timeChip = (poiId: string) =>
  `slot-stopcard-timechip-${buildSlotKey(DAY1, poiId)}`;
const cardId = (poiId: string) => `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;
const SHEET = 'itinerary-edit-time-sheet';
const SAVE = 'sheet-cta-button-0';

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

/** day1 = [고정 체크아웃(09:00) · 비고정 a(10:15–11:45)]. 고정은 편집 어포던스 자체가 없어야 한다. */
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

let putCalls = 0;
let putBody: unknown = null;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  putCalls = 0;
  putBody = null;
  mockBack.mockClear();
  setAccessToken('valid-access');
  useItineraryEditStore.getState().reset();

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [] })
    ),
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

describe('🔴 IT1 · AC5 — 비고정 시각칩 → 시각조정 시트가 마운트된다', () => {
  it('열기 전엔 시트가 없고, 비고정 시각칩을 누르면 뜬다', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-a'));

    // 열기 전 — 조건부 마운트라 트리에 없다.
    expect(screen.queryByTestId(SHEET)).toBeNull();

    fireEvent.press(screen.getByTestId(timeChip('poi-a')));

    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
  });
});

describe('🔴 IT2 · AC5 — 고정 슬롯엔 편집 어포던스 자체가 없다 (INV-U3-03)', () => {
  it('고정 슬롯은 누름 시각칩이 없고, 시트도 열리지 않는다', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-fixed'));

    // 고정은 onPressTimeChip 미주입 → 누름 칩(`-timechip-`) 자체가 없다(IT1 이 비고정 열림 긍정 앵커).
    expect(screen.queryByTestId(timeChip('poi-fixed'))).toBeNull();
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });
});

describe('🔴 IT3 · AC5 — 적용: 카드 시각 갱신·시트 닫힘·PUT 0(로컬)', () => {
  it('시작을 23 시로 바꿔 적용하면 카드가 23:15 로 바뀌고 저장은 안 나간다', async () => {
    renderPage();
    await openSheetForA();

    fireEvent.press(screen.getByTestId('itinerary-edit-time-start-h-23'));
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));

    // 카드 시각칩이 갱신된다 — 부분 포함이라 regex(시각 leaf 는 완전일치라 부분 매칭은 regex 로).
    await waitFor(() =>
      expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(/23:15/)
    );

    // 시트가 닫힌다(unmount).
    expect(screen.queryByTestId(SHEET)).toBeNull();

    // 로컬 편집 — 시각조정만으로 서버를 안 건드린다(INV-2).
    expect(putCalls).toBe(0);
  });
});

describe('🔴 IT4 · AC5 — 취소: 카드 시각 무변경·시트 닫힘·PUT 0', () => {
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

describe('🔴 IT5 · AC5 — 적용값이 저장 PUT 에 그대로 실린다', () => {
  it('시각조정 후 저장하면 PUT 본문의 그 슬롯 startAt·endsNextDay 가 조정값이다', async () => {
    renderPage();
    await openSheetForA();

    fireEvent.press(screen.getByTestId('itinerary-edit-time-start-h-23'));
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

    // 저장이 기존 경로로 나간다(새 저장 코드 0 — 조립은 buildEditItineraryRequest).
    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));

    const body = putBody as EditItineraryRequest;
    const slotA = body.days[0].slots.find((s) => s.poiId === 'poi-a');
    expect(slotA?.startAt).toBe('23:15:00');
    expect(slotA?.endsNextDay).toBe(true);
    // 짝 — 안 건드린 종료 시각은 원값 그대로 실린다.
    expect(slotA?.endAt).toBe('11:45:00');
  });
});
