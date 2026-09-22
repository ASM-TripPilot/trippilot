import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotFillPage } from './SlotFillPage';

/**
 * TRIP-794 · h09 진행줄·스텝퍼 **배선**(AC-9) — SlotFillPage 가 itinerary GET 캐시에서 진행줄·
 * 스텝퍼 props 를 조립해 순수 화면(ConceptPickerScreen)에 내리고, 스텝퍼(위젯)는 층 경계상 pages 가
 * 노드로 조립해 `stepperSlot` 으로 내린다.
 *
 * 동결 앵커는 형제 `SlotFillPage.integration.test.tsx`(C1~C14·U3 문맥줄)가 무변경으로 지킨다 —
 * 이 파일은 새 조립만 잰다.
 *
 * 무엇을 보장하나:
 *  - 🔴 W1 진행줄: GET 도착 후 진행줄이 뜨고 슬롯 수가 **위치 도출**(비고정 index+1 / 총수)이다.
 *  - 🔴 W2 스텝퍼 상태 라벨을 **슬롯 위치로 결정론 도출**한다(current 이전=고름·current=지금 고르는
 *       중·이후=비어 있음, seed D1).
 *  - 🔴 W3 이전 단 제목 = 직전 슬롯 이름(GET 캐시).
 *  - 🔴 W4 현재 단 제목: category 있으면 그것(D1).
 *  - 🔴 W5 degrade: category 없으면 시간대 라벨만(D1).
 *  - 🔴 W6 INV-3: 조립된 어느 표면에도 소요시간 0.
 *
 * 3동작: 준비=MSW 로 GET 고정 → 실행=SlotFillPage 마운트(컨셉 화면) → 단언=진행줄·스텝퍼 렌더값.
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

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '33333333-3333-3333-3333-333333333333';
const DAY1 = '2026-06-10';

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

// 슬롯 하나 만들기 헬퍼(계약 필수 필드 + 넘긴 것만 덮어쓰기).
function slot(
  over: Partial<ItineraryDaysItemSlotsItem> & { poiId: string; startAt: string }
): ItineraryDaysItemSlotsItem {
  return {
    endAt: '00:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  };
}

// day1 = [a 경복궁 09:30, b 13:00(category 전시), c 15:00] — 셋 다 비고정.
function itinerary(currentHasCategory: boolean): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        slot({ poiId: 'a', nameKo: '경복궁', startAt: '09:30:00' }),
        slot({
          poiId: 'b',
          startAt: '13:00:00',
          category: currentHasCategory ? '전시' : null,
        }),
        slot({ poiId: 'c', startAt: '15:00:00' }),
      ],
    },
  ];
  return {
    itineraryId: 'itin-3',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

let currentHasCategory = true;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  currentHasCategory = true;
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary(currentHasCategory))
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

// slotKey=b(가운데 비고정 슬롯) 로 진입 — prev=a, current=b, next=c.
function renderAtSlotB() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <SlotFillPage tripId={TRIP_ID} slotKey={buildSlotKey(DAY1, 'b')} />,
    { wrapper: Wrapper }
  );
}

describe('🔴 SlotFillPage — 진행줄·스텝퍼 배선(AC-9)', () => {
  it('W1 · 진행줄 슬롯 수가 위치 도출(가운데 슬롯 → 2 / 3)이고 일차 라벨이 뜬다', async () => {
    renderAtSlotB();

    // GET 도착 후 진행줄이 뜬다(비동기).
    await screen.findByTestId('itinerary-copick-concept-progress');

    // 슬롯 수 = 비고정 index(b=1)+1 / 총 비고정 3 → '2 / 3'(위치 도출, Figma 고정 3/4 픽스처와 다름).
    expect(
      screen.getByTestId('itinerary-copick-concept-progress-count')
    ).toHaveTextContent('2 / 3');

    // 일차 라벨은 '1일차' 를 포함한다(정확 날짜 서식은 6-b).
    expect(
      screen.getByTestId('itinerary-copick-concept-progress-day')
    ).toHaveTextContent(/1일차/);
  });

  it('W2 · 스텝퍼 상태 라벨을 슬롯 위치로 도출한다(고름/지금 고르는 중/비어 있음)', async () => {
    renderAtSlotB();

    expect(
      await screen.findByTestId('copick-stepper-prev-status')
    ).toHaveTextContent('고름');
    expect(
      screen.getByTestId('copick-stepper-current-status')
    ).toHaveTextContent('지금 고르는 중');
    expect(screen.getByTestId('copick-stepper-next-status')).toHaveTextContent(
      '비어 있음'
    );
  });

  it('W3 · 이전 단 제목 = 직전 슬롯 이름(경복궁)', async () => {
    renderAtSlotB();

    expect(
      await screen.findByTestId('copick-stepper-prev-title')
    ).toHaveTextContent('경복궁');
  });

  it('W4 · 현재 단 제목: category 있으면 그것(전시)', async () => {
    currentHasCategory = true;
    renderAtSlotB();

    // 부분매치(정규식) — '{시간대} · 전시' 든 '전시' 든 category 를 담는다.
    expect(
      await screen.findByTestId('copick-stepper-current-title')
    ).toHaveTextContent(/전시/);
  });

  it('W5 · degrade: category 없으면 시간대 라벨만(전시 없음)', async () => {
    currentHasCategory = false;
    renderAtSlotB();

    const title = await screen.findByTestId('copick-stepper-current-title');
    // category 미주입 → '전시' 없고, 시간대 라벨(점심 등)로 degrade.
    expect(title).not.toHaveTextContent(/전시/);
    expect(title).toHaveTextContent(/오전|점심|오후|저녁/);
  });

  it('W6 · INV-3 — 조립된 어느 표면에도 소요시간 0', async () => {
    renderAtSlotB();
    await screen.findByTestId('itinerary-copick-concept-progress');
    expect(screen.queryByText(DURATION_TEXT)).toBeNull();
  });
});
