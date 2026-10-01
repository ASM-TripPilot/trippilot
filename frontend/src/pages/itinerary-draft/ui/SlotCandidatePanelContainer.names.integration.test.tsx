import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type { Itinerary, SlotCandidates } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotCandidatePanelContainer } from './SlotCandidatePanelContainer';

/**
 * TRIP-1024 · AC-2·4·5·6·7 — h08 "다른 후보 시트"가 후보 응답의 이름·태그·사진을 **실 HTTP 로** 받아
 * 그린다(QA #053 "이름 준비 중"·회색 사진).
 *
 * 무엇을 보장하나:
 *  - 🔴 H1 응답 `nameKo`·`tags` 가 이름 leaf·태그 leaf 로 뜬다(매핑이 이름을 버리면 red).
 *  - 🔴 H2 `imageUrl` 이 있으면 같은 testID leaf 가 그 URL 을 source 로, null·'' 면 source 없는 회색 자리.
 *    크기는 h08 56 · `rounded-thumb`.
 *  - 🔴 H3 현재 행 사진은 GET 슬롯의 `imageUrl`(POST 가 아니라).
 *  - 🔴 H4 `nameKo` null → 플레이스홀더, poiId 원문 비노출(INV-1).
 *  - 🔴 H5 후보 카드 텍스트에 소요시간 단위 0(INV-3).
 *
 * 기존 `SlotCandidatePanelContainer.integration.test.tsx` 의 공유 픽스처는 건드리지 않는다 — 거기 후보는
 * 이름·사진이 없는 옛 응답 모양으로 남아 "값이 없어도 안 깨진다"를 계속 지킨다.
 *
 * 3동작: 준비=가짜 서버 응답(GET 일정 + POST 후보) → 실행=컨테이너 마운트(=시트 열림) → 단언=보이는 leaf.
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

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const CURRENT_SLOT_KEY = buildSlotKey(DAY1, 'a');

const CURRENT_IMG = 'https://img.example/current.jpg';
const X_IMG = 'https://img.example/x.jpg';
/** 정본에 값이 없는 후보 — poiId 원문이 새면 바로 보이도록 일부러 튀는 id. */
const RAW_ID = 'poi-raw-7788';

function itinerary(): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
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
            category: '문화',
            imageUrl: CURRENT_IMG,
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

function renderContainer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <SlotCandidatePanelContainer
      tripId={TRIP_ID}
      slotKey={CURRENT_SLOT_KEY}
      onClose={jest.fn()}
    />,
    { wrapper: Wrapper }
  );
}

/** 후보 3개가 다 그려질 때까지 기다린다(POST 응답 도착). */
async function renderAndWaitCandidates() {
  renderContainer();
  for (const id of ALL_IDS) {
    await screen.findByTestId(`itinerary-candidate-${id}`);
  }
}

/** className 을 공백으로 쪼갠 토큰 목록 — `min-h-[56px]` 같은 부분 일치 오탐을 막는다. */
const classTokens = (testID: string): string[] =>
  String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);

const THUMB_56 = ['h-[56px]', 'w-[56px]', 'rounded-thumb'];

/** 소요시간 단위(INV-3) — 거리만 보여야 한다. */
const DURATION = /분|시간|\bmin\b|소요/;

describe('🔴 TRIP-1024 h08 후보 시트 — 이름·태그·사진', () => {
  it('H1 · AC-2 — 응답 nameKo·tags 가 이름 leaf·태그 leaf 로 뜨고 플레이스홀더가 없다', async () => {
    await renderAndWaitCandidates();

    expect(screen.getByTestId('itinerary-candidate-name-X')).toHaveTextContent(
      '남부산교회'
    );
    // h08 태그 줄은 Figma 와 코드가 같다 — 첫 태그만 `#`, 나머지는 ` · `(완전일치).
    expect(screen.getByTestId('itinerary-candidate-tags-X')).toHaveTextContent(
      '#교회 · 야외'
    );
    expect(screen.getByTestId('itinerary-candidate-X')).not.toHaveTextContent(
      /이름 준비 중/
    );
  });

  it('H2 · AC-4·비주얼(a) — 사진 있으면 그 URL 이 source, null·빈 문자열이면 source 없는 회색 자리(56·thumb)', async () => {
    await renderAndWaitCandidates();

    expect(
      screen.getByTestId('itinerary-candidate-image-X').props.source
    ).toEqual({ uri: X_IMG });
    // 회색 자리도 testID 는 유지된다(존재) — 그리고 이미지 source 는 없다(부재). 둘을 짝으로 본다.
    for (const id of [RAW_ID, 'Z']) {
      const leaf = screen.getByTestId(`itinerary-candidate-image-${id}`);
      expect(leaf.props.source).toBeUndefined();
    }
    for (const id of ALL_IDS) {
      expect(classTokens(`itinerary-candidate-image-${id}`)).toEqual(
        expect.arrayContaining(THUMB_56)
      );
    }
  });

  it('H3 · AC-5 — 현재 행 사진은 GET 슬롯의 imageUrl 이다(56·thumb)', async () => {
    await renderAndWaitCandidates();

    // GET 과 POST 도착 순서는 보장이 없다 — source 가 들어올 때까지 기다린다.
    await waitFor(() =>
      expect(
        screen.getByTestId('itinerary-candidate-image-current').props.source
      ).toEqual({ uri: CURRENT_IMG })
    );
    expect(classTokens('itinerary-candidate-image-current')).toEqual(
      expect.arrayContaining(THUMB_56)
    );
  });

  it('H4 · AC-6·INV-1 — nameKo null 이면 플레이스홀더, poiId 원문은 화면 어디에도 없다', async () => {
    await renderAndWaitCandidates();

    expect(
      screen.getByTestId(`itinerary-candidate-name-${RAW_ID}`)
    ).toHaveTextContent('이름 준비 중');
    // 긍정 짝 — 이름 매핑 자체는 살아 있다(전부 플레이스홀더라서 참인 게 아니다).
    expect(screen.getByTestId('itinerary-candidate-name-X')).toHaveTextContent(
      '남부산교회'
    );
    expect(screen.queryByText(new RegExp(RAW_ID))).toBeNull();
  });

  it('H5 · AC-7·INV-3 — 후보 카드 텍스트에 소요시간 단위가 없다', async () => {
    await renderAndWaitCandidates();

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
