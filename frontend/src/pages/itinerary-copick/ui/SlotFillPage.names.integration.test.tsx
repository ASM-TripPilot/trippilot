import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  SlotCandidates,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotFillPage } from './SlotFillPage';

/**
 * TRIP-1024 · AC-3·4·6·7 — h10 같이 짜기 후보 선택이 후보 응답의 이름·태그·사진을 **실 HTTP 로** 받아
 * 그린다(QA #070).
 *
 * 무엇을 보장하나:
 *  - 🔴 F1 응답 `nameKo`·`tags` 가 카드 이름 leaf·태그 leaf 로 뜬다(페이지가 값을 버리면 red).
 *  - 🔴 F2 `imageUrl` 이 있으면 같은 testID leaf 가 그 URL 을 source 로, null·'' 면 source 없는 회색 자리.
 *    크기는 h10 **78**(Figma `3849:2272`, Q1) · `rounded-thumb` — h08(56)과 갈린다.
 *  - 🔴 F3 `nameKo` null → 플레이스홀더, poiId 원문 비노출(INV-1).
 *  - 🔴 F4 후보 카드 텍스트에 소요시간 단위 0(INV-3).
 *
 * 기존 `SlotFillPage.integration.test.tsx` 공유 픽스처는 건드리지 않는다 — 그 파일의 후보 루트 정규식이
 * `tags-` 를 제외하지 않아, 태그를 거기 넣으면 무관한 개수 단언이 깨진다. 그래서 픽스처를 여기 따로 둔다.
 *
 * 3동작: 준비=가짜 서버 응답(GET 일정 + POST 후보) → 실행=페이지 마운트 후 컨셉 탭 → 단언=보이는 leaf.
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
const TRIP_ID = '22222222-2222-2222-2222-222222222222';

// TRIP-1043 — 페이지가 진행 줄 여행지 접두를 위해 여행(`GET /trips/:tripId`)을 조회한다. 이 파일은 접두를
// 재지 않으므로 여행지 없는 여행으로 답한다(접두 생략 degrade — 기존 `N일차` 단언이 그대로 유효). 핸들러를
// 빼면 MSW 'error' 전략이 console.error 만 찍고 쿼리를 조용히 실패시켜 누락이 드러나지 않는다(02a ★1).
const TRIP_NO_DESTINATIONS: Trip = {
  tripId: TRIP_ID,
  title: '테스트 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-11',
  party: 1,
  preferenceSnapshot: {},
  destinations: [],
  status: 'PLANNED',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  baseCount: 0,
  itineraryDayCount: 1,
};
const DAY1 = '2026-06-10';
const SLOT_KEY = buildSlotKey(DAY1, 'a');

const X_IMG = 'https://img.example/x.jpg';
/** 정본에 값이 없는 후보 — poiId 원문이 새면 바로 보이도록 일부러 튀는 id. */
const RAW_ID = 'poi-raw-7788';

function itinerary(): Itinerary {
  return {
    itineraryId: 'itin-2',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'a',
            nameKo: '경복궁',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ],
  };
}

/** 값이 다 있는 X · 값이 없는 RAW_ID · 사진만 빈 문자열인 Z(Q4). */
const CANDIDATES: SlotCandidates = {
  candidates: [
    {
      poiId: 'X',
      distanceRange: '420m',
      rationale: '가장 가까운 교회',
      nameKo: '남부산교회',
      tags: ['교회', '야외'],
      imageUrl: X_IMG,
    },
    {
      poiId: RAW_ID,
      distanceRange: '1.1km',
      rationale: '조용한 곳',
      nameKo: null,
      tags: [],
      imageUrl: null,
    },
    {
      poiId: 'Z',
      distanceRange: '2.4km',
      rationale: '바다 옆 사찰',
      nameKo: '해동용궁사',
      tags: ['사찰'],
      imageUrl: '',
    },
  ],
  radiusMUsed: 2400,
  degraded: false,
};

const ALL_IDS = ['X', RAW_ID, 'Z'];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () =>
      HttpResponse.json(TRIP_NO_DESTINATIONS)
    ),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.post(`${BASE}/trips/:tripId/itinerary/slot-candidates`, () =>
      HttpResponse.json(CANDIDATES)
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
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<SlotFillPage tripId={TRIP_ID} slotKey={SLOT_KEY} />, {
    wrapper: Wrapper,
  });
}

/** 마운트 → 컨셉(전시·문화) 탭 → 후보 3개가 다 그려질 때까지 기다린다. */
async function renderAndPickConcept() {
  renderPage();
  await screen.findByTestId('itinerary-copick-concept-culture');
  fireEvent.press(screen.getByTestId('itinerary-copick-concept-culture'));
  for (const id of ALL_IDS) {
    await screen.findByTestId(`itinerary-candidate-${id}`);
  }
}

/** className 을 공백으로 쪼갠 토큰 목록 — `min-h-[78px]` 같은 부분 일치 오탐을 막는다. */
const classTokens = (testID: string): string[] =>
  String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);

const THUMB_78 = ['h-[78px]', 'w-[78px]', 'rounded-thumb'];

/** 소요시간 단위(INV-3) — 거리만 보여야 한다. */
const DURATION = /분|시간|\bmin\b|소요/;

describe('🔴 TRIP-1024 h10 후보 카드 — 이름·태그·사진', () => {
  it('F1 · AC-3 — 응답 nameKo·tags 가 카드 이름 leaf·태그 leaf 로 뜬다', async () => {
    await renderAndPickConcept();

    expect(screen.getByTestId('itinerary-candidate-name-X')).toHaveTextContent(
      '남부산교회'
    );
    expect(screen.getByTestId('itinerary-candidate-name-Z')).toHaveTextContent(
      '해동용궁사'
    );
    // h10 태그 표기(`#` 위치)는 Figma 와 드리프트 중이라 내용만 잰다(정규식 = 부분 포함).
    const tags = screen.getByTestId('itinerary-candidate-tags-X');
    expect(tags).toHaveTextContent(/교회/);
    expect(tags).toHaveTextContent(/야외/);
  });

  it('F2 · AC-4·Q1·비주얼(a) — 사진 있으면 그 URL 이 source, null·빈 문자열이면 source 없는 회색 자리(78·thumb)', async () => {
    await renderAndPickConcept();

    expect(
      screen.getByTestId('itinerary-candidate-image-X').props.source
    ).toEqual({ uri: X_IMG });
    // 회색 자리도 testID 는 유지된다(존재) — 그리고 이미지 source 는 없다(부재).
    for (const id of [RAW_ID, 'Z']) {
      const leaf = screen.getByTestId(`itinerary-candidate-image-${id}`);
      expect(leaf.props.source).toBeUndefined();
    }
    for (const id of ALL_IDS) {
      expect(classTokens(`itinerary-candidate-image-${id}`)).toEqual(
        expect.arrayContaining(THUMB_78)
      );
    }
  });

  it('F3 · AC-6·INV-1 — nameKo null 이면 플레이스홀더, poiId 원문은 화면 어디에도 없다', async () => {
    await renderAndPickConcept();

    expect(
      screen.getByTestId(`itinerary-candidate-name-${RAW_ID}`)
    ).toHaveTextContent('이름 준비 중');
    // 긍정 짝 — 이름 매핑 자체는 살아 있다.
    expect(screen.getByTestId('itinerary-candidate-name-X')).toHaveTextContent(
      '남부산교회'
    );
    expect(screen.queryByText(new RegExp(RAW_ID))).toBeNull();
  });

  it('F4 · AC-7·INV-3 — 후보 카드 텍스트에 소요시간 단위가 없다', async () => {
    await renderAndPickConcept();

    for (const id of ALL_IDS) {
      expect(
        screen.getByTestId(`itinerary-candidate-${id}`)
      ).not.toHaveTextContent(DURATION);
    }
    // 긍정 짝 — 카드 텍스트를 실제로 읽고 있다.
    expect(screen.getByTestId('itinerary-candidate-X')).toHaveTextContent(
      /남부산교회/
    );
  });
});
