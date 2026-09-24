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
 * TRIP-797 · h12 편집기 통일(묶음 C 재조립) → TRIP-927 · 시트를 h04(시간대 조정) 변형으로 전환.
 * 편집 배선의 **시각조정 개폐·로컬성·저장 흐름**을 실 HTTP 로 태우는 심판. 시각칩은 `SlotStopCard` 의
 * 누름 칩(`slot-stopcard-timechip-*`)이고 시트는 `TimeSheet mode="h04"`(접두 `itinerary-edit-time`) 다.
 *
 * 무엇을 보장하나(전부 페이지 층 배선):
 *  - 🔴 비고정 시각칩 → **시트 조건부 마운트**(등장, IT1), 고정은 **누름 칩 자체가 없다**(IT2 · INV-U3-03).
 *  - 🔴 시트는 h04 얼굴 — default 셀·취소 버튼이 없다(IT3, AC-8). 요약 행 = 슬롯 이름·사진뿐(IT3b, AC-9).
 *  - 🔴 스와이프·딤으로 닫히면 카드 무변경·PUT 0, 같은 칩을 다시 누르면 다시 열린다(IT4, AC-7).
 *  - 🔴 종료를 안 건드리고 적용 → 로컬 반영·PUT 0(IT5a), 저장 PUT 의 endAt 은 **드래프트 원값 그대로**
 *    (초까지), endsNextDay 는 새 시작 기준으로 다시 유도(IT5b·IT5c, AC-10). 모든 endAt 은 string(AC-13).
 *  - 🔴 종료를 설정하고 적용 → 저장 PUT 의 endAt 이 그 값(IT6, AC-11).
 *
 * ⚠️ 옛 IT4 [취소]는 h04 에 취소 버튼이 없어(Figma 3974:2574) 닫힘 경로(onClose)로 대체했다(02a §6).
 * ⚠️ 슬롯 a 의 endAt 은 일부러 `11:45:30` — 위젯은 초를 `:00` 으로 만들므로, "null 대신 시드 endAt 방출"
 *    과 "페이지가 null 을 드래프트 원값으로 풀기"가 여기서 갈린다(02a ★3).
 * ⚠️ 휠은 12시간제·활성 탭 한 벌 — 10:15(오전)→23시는 `ap-오후` 다음 `h-11` 두 번이다(02a ★4).
 * 시트 실개폐·스와이프 실동작은 `@gorhom/bottom-sheet` 통과형 목이 원리적으로 못 본다(6-b 실기).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=시각칩/탭/휠/적용·닫힘·저장 → 단언=시트 개폐·카드·PUT.
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
const t = (suffix: string): string => `itinerary-edit-time-${suffix}`;
const B_IMAGE = 'https://example.com/blueline.jpg';

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

/**
 * day1 = [고정 체크아웃(09:00) · 비고정 a(10:15–11:45:30, 사진 없음) · 비고정 b(12:30–13:30, 사진 있음)].
 * 고정은 편집 어포던스 자체가 없어야 한다.
 */
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
          endAt: '11:45:30',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: ['바다'],
          nameKo: '광안리',
        },
        {
          poiId: 'poi-b',
          startAt: '12:30:00',
          endAt: '13:30:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
          nameKo: '해운대 블루라인파크',
          imageUrl: B_IMAGE,
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
async function openSheetFor(poiId: string) {
  await screen.findByTestId(cardId(poiId));
  fireEvent.press(screen.getByTestId(timeChip(poiId)));
  await screen.findByTestId(SHEET);
}

/** h04 셀·탭·적용을 순서대로 누른다(접두 생략). */
function press(...suffixes: string[]) {
  suffixes.forEach((suffix) => fireEvent.press(screen.getByTestId(t(suffix))));
}

async function applyAndWaitClosed() {
  press('apply');
  await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
}

async function saveAndGetSlot(poiId: string) {
  fireEvent.press(screen.getByTestId(SAVE));
  await waitFor(() => expect(putCalls).toBe(1));
  const body = putBody as EditItineraryRequest;
  return body.days[0].slots.find((s) => s.poiId === poiId);
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

describe('🔴 IT3 · AC-8 — 시트는 h04 얼굴이다 (default 셀·취소 없음)', () => {
  it('제목 "시간대 조정"·시작/종료 탭·요약 행이 있고, default 시 셀과 [취소]는 없다', async () => {
    renderPage();
    await openSheetFor('poi-a');

    expect(screen.getByText('시간대 조정')).toBeOnTheScreen();
    expect(screen.getByTestId(t('seg-start'))).toBeOnTheScreen();
    expect(screen.getByTestId(t('place-summary'))).toBeOnTheScreen();

    expect(
      screen.queryAllByTestId(/^itinerary-edit-time-start-h-/)
    ).toHaveLength(0);
    expect(screen.queryByTestId(t('cancel'))).toBeNull();
  });
});

describe('🔴 IT3b · AC-9 — 요약 행은 슬롯 이름·사진뿐이다', () => {
  it('사진 없는 a: 이름만(배지·지역 줄 없음), 썸네일 이미지 없음', async () => {
    renderPage();
    await openSheetFor('poi-a');

    // 완전일치 — 이름 외 텍스트(배지·"꼭 갈 곳" 줄)가 없다(Q1).
    expect(screen.getByTestId(t('place-summary'))).toHaveTextContent('광안리');
    expect(screen.queryByTestId(t('place-thumb-image'))).toBeNull();
  });

  it('사진 있는 b: 이름 + 그 사진 URL 썸네일', async () => {
    renderPage();
    await openSheetFor('poi-b');

    expect(screen.getByTestId(t('place-summary'))).toHaveTextContent(
      '해운대 블루라인파크'
    );
    expect(screen.getByTestId(t('place-thumb-image')).props.source).toEqual({
      uri: B_IMAGE,
    });
  });
});

describe('🔴 IT4 · AC-7 — 스와이프·딤으로 닫힘: 카드 무변경·PUT 0·다시 열린다', () => {
  it('시작을 바꿔 봐도 닫히면 카드는 10:15 그대로고, 같은 칩을 다시 누르면 시트가 다시 뜬다', async () => {
    renderPage();
    await openSheetFor('poi-a');

    press('wheel-h-11'); // 오전 11시 — 적용 전이라 드래프트엔 안 들어가야 한다.
    fireEvent(screen.getByTestId(SHEET), 'close');

    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
    expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(/10:15/);
    expect(screen.getByTestId(timeChip('poi-a'))).not.toHaveTextContent(
      /11:15/
    );
    expect(putCalls).toBe(0);

    // 상태 고착 없음 — 닫힘이 편집 중 슬롯을 풀어야 같은 칩이 다시 시트를 연다(브리프 §9①).
    fireEvent.press(screen.getByTestId(timeChip('poi-a')));
    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
    expect(screen.getByTestId(t('readout'))).toHaveTextContent(/오전 10:15/);
  });
});

describe('🔴 IT5 · AC-10 — 종료를 안 건드리면 기존 endAt 유지 + endsNextDay 재유도', () => {
  it('IT5a · 시작만 23:15 로 적용하면 카드가 23:15–11:45 로 바뀌고 저장은 안 나간다(로컬)', async () => {
    renderPage();
    await openSheetFor('poi-a');

    press('wheel-ap-오후', 'wheel-h-11');
    await applyAndWaitClosed();

    expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(
      /23:15–11:45/
    );
    // 로컬 편집 — 시각조정만으로 서버를 안 건드린다(INV-2).
    expect(putCalls).toBe(0);
  });

  it('IT5b · 저장 PUT 의 a 는 startAt 23:15:00 · endAt 원값 11:45:30(초 보존) · endsNextDay true', async () => {
    renderPage();
    await openSheetFor('poi-a');

    press('wheel-ap-오후', 'wheel-h-11');
    await applyAndWaitClosed();
    const slotA = await saveAndGetSlot('poi-a');

    expect(slotA?.startAt).toBe('23:15:00');
    expect(slotA?.endAt).toBe('11:45:30');
    // 원값은 false — 새 시작(23:15) 기준으로 다시 유도해야 true 다.
    expect(slotA?.endsNextDay).toBe(true);

    // AC-13 — 서버 계약 endAt 은 항상 string(null 이 새지 않는다).
    const body = putBody as EditItineraryRequest;
    const endAts = body.days.flatMap((day) => day.slots.map((s) => s.endAt));
    expect(endAts.filter((endAt) => typeof endAt !== 'string')).toEqual([]);
  });

  it('IT5c · 종료를 먼저 23:45 로 적용한 뒤 다시 열어 시작만 바꾸면 endAt 은 드래프트 23:45:00 이다(서버 원값 아님)', async () => {
    renderPage();

    // 1차 — 종료를 오후 11:45 로 설정해 적용한다.
    await openSheetFor('poi-a');
    press('seg-end', 'wheel-ap-오후');
    await applyAndWaitClosed();

    // 2차 — 다시 열어 시작만 오전 9시로 바꾼다(종료 미설정).
    fireEvent.press(screen.getByTestId(timeChip('poi-a')));
    await screen.findByTestId(SHEET);
    press('wheel-h-9');
    await applyAndWaitClosed();

    const slotA = await saveAndGetSlot('poi-a');
    expect(slotA?.startAt).toBe('09:15:00');
    expect(slotA?.endAt).toBe('23:45:00');
    expect(slotA?.endsNextDay).toBe(false);
  });
});

describe('🔴 IT6 · AC-11 — 종료를 설정하고 적용하면 저장 PUT 의 endAt 이 그 값이다', () => {
  it('종료를 오후 1:45 로 설정해 저장하면 a 는 10:15:00–13:45:00 · endsNextDay false', async () => {
    renderPage();
    await openSheetFor('poi-a');

    press('seg-end', 'wheel-ap-오후', 'wheel-h-1');
    await applyAndWaitClosed();
    expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(
      /10:15–13:45/
    );

    const slotA = await saveAndGetSlot('poi-a');
    expect(slotA?.startAt).toBe('10:15:00');
    expect(slotA?.endAt).toBe('13:45:00');
    expect(slotA?.endsNextDay).toBe(false);
  });
});
