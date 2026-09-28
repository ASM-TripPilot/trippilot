import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
  VisitCheckList,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * TRIP-797 · h12 편집기 통일(묶음 C) — **AC-11 완료 슬롯 잠금 실연동**(사용자 밤 결정, §9 이연 뒤집음).
 *
 * 무엇을 보장하나: 페이지가 execution 방문 데이터(`GET /trips/{id}/visits/days/{day}`)를 조회해
 * `deriveVisitProgress` → 완료 poiId → `buildSlotKey(activeDate, poiId)` 로 `completedSlotKeys` 를 뽑아
 * `EditorView` 에 내리면, **그 슬롯 카드가 잠긴다**(`slot-stopcard-locked-*` 등장 · 편집 어포던스
 * `slot-stopcard-timechip-*` 사라짐 — `canEditTime = !fixed && !locked`, INV-U3-03/i07).
 *
 * 왜 통합인가: "배열(completedSlotKeys)→slotKey 매칭→per-slot 잠금" 은 페이지 조회·파생·prop 전달을
 * 관통해야 관측된다(카드 단위 `SlotStopCard.editor.test` 는 `locked` prop 만 잠갔다, 03b 경고-1 — 이
 * 파일이 그 배선 사각을 메운다).
 *
 * ⚠️ 03b 경고-1 근거: `EditorView.test.tsx` 에 completedSlotKeys 단언이 0건이라 "배열→매칭→잠금"
 * 배선을 어느 동결 테스트도 안 잠갔다. 이 파일이 그 배선을 처음 잠근다.
 *
 * 3동작 뼈대: 준비=방문 픽스처(완료 poi-a)+일정 → 실행=페이지 렌더 → 단언=잠긴 카드·짝(미완료 카드).
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';

const lockedKey = buildSlotKey(DAY1, 'poi-a');
const openKey = buildSlotKey(DAY1, 'poi-b');

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
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

/** day1 = [a, b] 둘 다 비고정 — a 만 방문 완료로 잠기고 b 는 편집 가능해야 한다(짝). */
function itinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'poi-a',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          alternatives: [],
          tags: [],
          nameKo: '성산일출봉',
        },
        {
          poiId: 'poi-b',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          alternatives: [],
          tags: [],
          nameKo: '섭지코지',
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

/**
 * 그 날 방문 기록 — poi-a 는 도착·완료(skippedAt null)라 `deriveVisitProgress` 가 완료로 잡는다.
 * slotKey 는 필수다: 슬롯 키가 없으면 즉석 방문이라 잠금 판정에서 빠진다(TRIP-1079 결정 1).
 */
function visitsWithCompleted(): VisitCheckList {
  return {
    visits: [
      {
        visitCheckId: 'vc-a',
        slotKey: lockedKey,
        poiId: 'poi-a',
        source: 'MANUAL',
        spontaneous: false,
        updatedAt: '2026-06-10T05:00:00.000Z',
        arrivedAt: '2026-06-10T04:00:00.000Z',
        completedAt: '2026-06-10T04:30:00.000Z',
        skippedAt: null,
      },
    ],
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  setAccessToken('valid-access');
  useItineraryEditStore.getState().reset();

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json(visitsWithCompleted())
    )
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

describe('🔴 CL1 · AC-11 — 방문 완료 슬롯이 잠기고 미완료 슬롯은 편집 가능하다', () => {
  it('완료 poi-a 는 잠금 표식+편집칩 부재, 미완료 poi-b 는 편집칩 present+잠금 부재', async () => {
    renderPage();

    // 완료 슬롯 — 잠금 표식이 뜨고 편집 어포던스(누름 시각칩)는 사라진다.
    await screen.findByTestId(`slot-stopcard-locked-${lockedKey}`);
    expect(
      screen.queryByTestId(`slot-stopcard-timechip-${lockedKey}`)
    ).toBeNull();

    // 짝(긍정) — 미완료 슬롯은 여전히 편집 가능하고 잠금 표식이 없다(공허 통과 방지).
    expect(
      screen.getByTestId(`slot-stopcard-timechip-${openKey}`)
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(`slot-stopcard-locked-${openKey}`)).toBeNull();
  });
});

describe('🔴 CL2 · TRIP-1079 AC-5 — 즉석 방문 완료는 같은 poi 의 계획 슬롯을 잠그지 않는다', () => {
  it('계획 완료 poi-a 는 잠기고, 즉석(slotKey null)으로만 완료된 poi-b 는 편집칩 present+잠금 부재', async () => {
    const [plannedDone] = visitsWithCompleted().visits;
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: [
            plannedDone,
            {
              ...plannedDone,
              visitCheckId: 'vc-b',
              slotKey: null,
              poiId: 'poi-b',
              spontaneous: true,
            },
          ],
        })
      )
    );

    renderPage();

    // 앵커 — 계획 완료 poi-a 가 잠겼다 = 방문 기록이 도착해 판정이 돌았다(공허 통과 방지).
    await screen.findByTestId(`slot-stopcard-locked-${lockedKey}`);

    // 즉석 완료 poi-b 는 잠기지 않는다.
    expect(screen.queryByTestId(`slot-stopcard-locked-${openKey}`)).toBeNull();
    expect(
      screen.getByTestId(`slot-stopcard-timechip-${openKey}`)
    ).toBeOnTheScreen();
  });
});

describe('🔴 CL3 · TRIP-1079 5-c 경고-2 — 2일차 탭의 완료 슬롯은 2일차 날짜로 세어 잠긴다', () => {
  it('2일차 탭으로 옮기면 2일차에 완료한 poi-c 는 잠기고, 같은 날 미완료 poi-d 는 편집 가능하다', async () => {
    const DAY2 = '2026-06-11';
    const day2LockedKey = buildSlotKey(DAY2, 'poi-c');
    const day2OpenKey = buildSlotKey(DAY2, 'poi-d');
    const base = itinerary();
    const [day1] = base.days;
    const [plannedDone] = visitsWithCompleted().visits;
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json({
          ...base,
          days: [
            day1,
            {
              date: DAY2,
              slots: day1.slots.map((s, i) => ({
                ...s,
                poiId: i === 0 ? 'poi-c' : 'poi-d',
              })),
            },
          ],
        })
      ),
      // 날짜마다 그 날의 기록만 준다 — 2일차 기록의 slotKey 는 2일차 날짜다.
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) =>
        HttpResponse.json(
          params.day === DAY2
            ? {
                visits: [
                  {
                    ...plannedDone,
                    visitCheckId: 'vc-c',
                    slotKey: day2LockedKey,
                    poiId: 'poi-c',
                  },
                ],
              }
            : visitsWithCompleted()
        )
      )
    );

    renderPage();

    // 앵커 — 1일차 탭의 poi-a 잠금 = 페이지·방문 기록이 다 떴다.
    await screen.findByTestId(`slot-stopcard-locked-${lockedKey}`);

    // 실행 — 2일차 탭.
    fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));

    // 단언 — 2일차 완료 poi-c 가 잠기고, 짝인 미완료 poi-d 는 편집칩이 있고 잠금이 없다.
    await screen.findByTestId(`slot-stopcard-locked-${day2LockedKey}`);
    expect(
      screen.queryByTestId(`slot-stopcard-timechip-${day2LockedKey}`)
    ).toBeNull();
    expect(
      screen.getByTestId(`slot-stopcard-timechip-${day2OpenKey}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`slot-stopcard-locked-${day2OpenKey}`)
    ).toBeNull();
  });
});
