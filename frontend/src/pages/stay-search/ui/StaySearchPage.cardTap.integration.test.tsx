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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { SavedStay, StayItem } from '@/shared/api/generated/schemas';
import { StaySearchPage } from './StaySearchPage';

/**
 * TRIP-420 AC-6·AC-7 (배선) — e02 카드 탭이 실제로 상세 라우트 push 로 이어지고, 하트 탭과
 * 섞이지 않는다는 증거. 화면은 라우터를 모르므로(FSD 경계), 카드 탭이 진짜로
 * `router.push('/stays/{encodeURIComponent(stayKey)}')` 로 가는지는 이 배선 층에서만 확인된다.
 *
 * 무엇을 보장하나:
 *  - **P1 (AC-6)** 카드 본문 탭 → `router.push('/stays/NAVER%3As1')` **정확 문자열**로 1회.
 *    콜론(`:`)이 path 세그먼트라 `encodeURIComponent` 로 `%3A` 인코딩된다(02a §5 실측).
 *    같은 탭에서 저장 요청(`POST /saved-stays`)은 나가지 않는다(카드 탭 ≠ 저장, AC-7 카드측).
 *  - **P2 (AC-7)** 하트 탭 → 저장 경로(`POST /saved-stays`)로 가고 상세 push 는 0(안 섞임).
 *
 * 인프라: `StaySearchPage.save.integration.test.tsx` 의 expo-router 목 + observedHits 관찰을
 * 복제한다(공용화 안 함 = 리포 관례). 인증은 `@/shared/api/tokenManager` 로 구동.
 *
 * *(개념)* jest 는 expo-router 를 목으로 갈아끼워 `router.push` 가 **어떤 문자열로 불렸는지**만
 *   본다 — 콜론 인코딩의 실제 라우팅 왕복(디코드 정확성)은 [검증] 6-b/실기 몫이다.
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

// 호이스팅 예외를 받으려면 이름이 mock 으로 시작해야 한다(기존 통합테스트 관례).
let mockSearchParams: { region?: string } = {};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    setParams: jest.fn(),
  },
}));

const BASE = 'http://localhost:8080/api/v1';

const ITEM_A: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 그랜드 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean'],
  stayType: 'HOTEL',
  price: { amount: 30000, currency: 'KRW' },
};
const ITEM_B: StayItem = {
  externalSource: 'NAVER',
  externalId: 's2',
  name: '서면 시티 호텔',
  lat: 35.1577,
  lng: 129.0594,
  region: '서면',
  amenities: ['wifi'],
  stayType: 'HOTEL',
  price: { amount: 10000, currency: 'KRW' },
};
const KEY_A = `${ITEM_A.externalSource}:${ITEM_A.externalId}`;

/** 카드 A(NAVER:s1)의 콜론이 인코딩된 상세 라우트 — 리터럴로 못 박는다(계산식으로 쓰면 화면이
 * 콜론을 안 인코딩해도 통과할 수 있다). `encodeURIComponent('NAVER:s1') === 'NAVER%3As1'`. */
const EXPECTED_DETAIL_HREF = '/stays/NAVER%3As1';

const SEARCH_RESPONSE = {
  items: [ITEM_A, ITEM_B],
  degraded: false,
  filterZeroReasons: [],
};

const NEW_SAVED_ID = '99999999-9999-9999-9999-999999999999';

/** openapi SavedStay.required + 외부키를 채운 서버 담기 기록(save.integration 과 동형). */
function savedFrom(item: StayItem, savedStayId: string): SavedStay {
  return {
    savedStayId,
    name: item.name,
    coordConfirmed: false,
    registerRoute: 'MAP_SEARCH',
    externalSource: item.externalSource,
    externalId: item.externalId,
    lat: item.lat,
    lng: item.lng,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

let observedHits: string[] = [];

function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  mockSearchParams = { region: '부산' };
  mockPush.mockClear();
  clearAccessToken();
  server.use(
    http.get(`${BASE}/stays/search`, () => HttpResponse.json(SEARCH_RESPONSE)),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
  );
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe('P1 · 카드 탭 → 상세 라우트 push (AC-6)', () => {
  it('카드 본문 탭 → router.push("/stays/NAVER%3As1") 1회 + 저장 요청 0', async () => {
    // 준비 — 로그인 + 검색결과 2건 도착.
    setAccessToken('valid-access');
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
      ).toBeOnTheScreen()
    );

    // 실행 — 카드 A 본문(루트)을 누른다.
    fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`));

    // 단언 ① — 콜론이 인코딩된 정확한 상세 문자열로 push 됐다.
    expect(mockPush).toHaveBeenCalledWith(EXPECTED_DETAIL_HREF);
    expect(mockPush).toHaveBeenCalledTimes(1);
    // 단언 ② (AC-7 카드측) — 카드 탭은 저장 경로로 안 샌다.
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
  });
});

describe('P2 · 하트 탭 → 저장 경로, 상세 push 0 (AC-7)', () => {
  it('하트 탭 → POST /saved-stays 로 가고 상세 라우트 push 는 나가지 않는다', async () => {
    // 준비 — 로그인 + POST 핸들러.
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-stays`, () =>
        HttpResponse.json(savedFrom(ITEM_A, NEW_SAVED_ID), { status: 201 })
      )
    );
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
      ).toBeOnTheScreen()
    );

    // 실행 — 하트 A 를 누른다.
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

    // 단언 ① — 저장 요청이 나갔다.
    await waitFor(() => expect(hitCount('POST /api/v1/saved-stays')).toBe(1));
    // 단언 ② — 하트 탭은 상세 라우트로 내비게이션하지 않는다(카드 탭과 안 섞임).
    expect(mockPush).not.toHaveBeenCalled();
  });
});
