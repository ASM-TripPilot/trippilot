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
import type { SavedStay } from '@/shared/api/generated/schemas';

import { SavedStayPage } from './SavedStayPage';

/**
 * TRIP-461 · e04 저장한 숙소 배선(페이지 층) 승인 테스트 — AC-2·4·5·6·7.
 *
 * 무엇을 보장하나: 페이지가 `GET /saved-stays`를 읽어 카드 N개를 그리고(AC-2), 카드 press 시
 * `SavedStay`를 **e03가 받는 최소 `StayItem`으로 합성**해 넘긴다(AC-5, 01b Q1). 이 합성이
 * 헤드라인이다 — `SavedStay`를 그대로 넘기면 e03의 `isStayItemShape`가 false를 내 notFound를
 * 그린다(브리프 맹점 2). 그래서 이 테스트는 push 된 `item`을 **e03와 똑같은 게이트로** 다시
 * 검문한다(★1). 게스트(미로그인)는 조회를 아예 안 내보내고 게스트 얼굴을 그린다(AC-4·★5).
 *
 * 왜 통합 버킷인가 — 심판 대상이 "서버 데이터로 조립한 push payload"다. 합성·라우팅은 실
 * react-query 캐시에서 나온 실데이터라야 의미가 있다(d02 `SavedPlacesPage.rowtap` 선례).
 *
 * *(초심자용 개념)*
 *  - `server.use(...)` = 이 파일 안에서만 msw 응답을 갈아끼운다(기본 `/saved-stays`는 `[]`).
 *  - `render(...)` 후 `await screen.findByTestId(...)` = 서버 응답이 도착해 노드가 뜰 때까지 기다린다.
 *  - `mockPush.mock.calls` = 라우터 push가 어떤 인자로 불렸는지 기록한 배열.
 */

// storage 목 — tokenManager 부트스트랩이 실제 저장소를 건드리지 않게 한다(d02 rowtap 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 라우터 목 — push를 문자열이든 객체든 그대로 기록한다(e04 카드 push는 {pathname,params} 객체).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), back: () => {} },
  useRouter: () => ({ push: mockPush, back: () => {} }),
  useLocalSearchParams: () => ({}),
}));

const BASE = 'http://localhost:8080/api/v1';

/** e03가 손에 든 `item`을 실제로 검문하는 게이트 — `StayDetailPage.tsx:32-39`의 복제.
 * (그 함수는 비-export라 import가 안 돼, 게이트 로직을 문자 그대로 재현한다. 02a §2-2 실측.) */
function passesE03Gate(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { amenities?: unknown }).amenities)
  );
}

// 하트 저장분(외부키 있음) — stayId는 stayKey(=SOURCE:ID)가 돼야 한다.
const HEARTED: SavedStay = {
  savedStayId: 'ss-1',
  name: '해운대 오션뷰 호텔',
  lat: 35.1587,
  lng: 129.1604,
  coordConfirmed: true,
  checkIn: '2026-06-10',
  checkOut: '2026-06-13',
  externalSource: 'NAVER',
  externalId: 'n-99',
  registerRoute: 'MAP_SEARCH',
  memo: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

// 핀·수동 등록분(외부키 null) — stayId는 savedStayId로 폴백해야 한다(충돌 방지, ★2).
const PINNED: SavedStay = {
  savedStayId: 'ss-2',
  name: '제주 돌담 게스트하우스',
  lat: null,
  lng: null,
  coordConfirmed: false,
  checkIn: null,
  checkOut: null,
  externalSource: null,
  externalId: null,
  registerRoute: 'PIN',
  memo: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockPush.mockClear();
  clearAccessToken();
  setAccessToken('valid-access');
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

function createWrapper() {
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
  return Wrapper;
}

describe('AC-2 · 서버 N건 → 카드 N개 + 개수 부제', () => {
  it('저장 숙소 2건이면 카드 2개와 부제 개수 2가 뜬다', async () => {
    // 준비 — 서버가 2건을 준다.
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([HEARTED, PINNED])
      )
    );

    // 실행 — 페이지를 그리고 데이터 도착을 기다린다.
    render(<SavedStayPage />, { wrapper: createWrapper() });
    await screen.findByTestId('saved-stay-card-ss-1');

    // 단언 — 두 카드와 개수 부제(정규식=부분포함, 02a §5-1).
    expect(screen.getByTestId('saved-stay-card-ss-2')).toBeOnTheScreen();
    expect(screen.getByTestId('saved-stay-subtitle')).toHaveTextContent(/2곳/);
  });
});

describe('AC-5 · 카드 press → e03 합성 StayItem push (★1 게이트 정합)', () => {
  it('하트 숙소 카드 press → stayId=stayKey + item이 e03 게이트를 통과하고 숙소명을 담는다', async () => {
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([HEARTED, PINNED])
      )
    );
    render(<SavedStayPage />, { wrapper: createWrapper() });
    await screen.findByTestId('saved-stay-card-ss-1');

    // 음성 대조 — 원본 SavedStay는 amenities가 없어 게이트를 탈락한다(=notFound). 그래서
    // 합성이 필수다(02a §5-2에서 node로도 확인). 이 줄이 곧 AC-5의 존재 이유다.
    expect(passesE03Gate(HEARTED)).toBe(false);

    // 실행 — 하트 숙소 카드를 누른다.
    fireEvent.press(screen.getByTestId('saved-stay-card-ss-1'));

    // 단언 — push shape가 e03 진입 계약과 같고(StaySearchPage 선례), stayId는 stayKey다.
    expect(mockPush).toHaveBeenCalledTimes(1);
    const arg = mockPush.mock.calls[0][0] as {
      pathname: string;
      params: { stayId: string; item: string };
    };
    expect(arg.pathname).toBe('/stays/[stayId]');
    expect(arg.params.stayId).toBe('NAVER:n-99');

    // ★1 — 넘긴 item을 e03와 똑같은 게이트로 검문한다. 통과해야 notFound가 안 뜬다.
    const parsed: unknown = JSON.parse(arg.params.item);
    expect(passesE03Gate(parsed)).toBe(true);
    expect((parsed as { name: string }).name).toBe('해운대 오션뷰 호텔');
  });

  it('핀·수동 숙소(외부키 null) 카드 press → stayId=savedStayId 폴백 + 게이트 통과 (★2)', async () => {
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([HEARTED, PINNED])
      )
    );
    render(<SavedStayPage />, { wrapper: createWrapper() });
    await screen.findByTestId('saved-stay-card-ss-2');

    // 실행 — 외부키가 null인 핀 숙소 카드를 누른다.
    fireEvent.press(screen.getByTestId('saved-stay-card-ss-2'));

    // 단언 — stayKey가 "null:null"로 충돌하지 않고 savedStayId로 폴백한다.
    const arg = mockPush.mock.calls[0][0] as {
      pathname: string;
      params: { stayId: string; item: string };
    };
    expect(arg.params.stayId).toBe('ss-2');
    const parsed: unknown = JSON.parse(arg.params.item);
    expect(passesE03Gate(parsed)).toBe(true);
    expect((parsed as { name: string }).name).toBe('제주 돌담 게스트하우스');
  });
});

describe('AC-6 · 하단 "거점 지정" → /stays/register', () => {
  it('하단 버튼 press → /stays/register 로 push 한다', async () => {
    server.use(
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([HEARTED]))
    );
    render(<SavedStayPage />, { wrapper: createWrapper() });
    await screen.findByTestId('saved-stay-register');

    fireEvent.press(screen.getByTestId('saved-stay-register'));

    expect(mockPush.mock.calls).toEqual([['/stays/register']]);
  });
});

describe('AC-7 · empty CTA "숙소 둘러보기" → /stays', () => {
  it('0건 empty 에서 CTA press → /stays 로 push 한다', async () => {
    // 기본 핸들러가 [] 를 주지만 명시적으로 둔다(의도 표시).
    server.use(http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])));
    render(<SavedStayPage />, { wrapper: createWrapper() });
    await screen.findByTestId('saved-stay-browse');

    fireEvent.press(screen.getByTestId('saved-stay-browse'));

    expect(mockPush.mock.calls).toEqual([['/stays']]);
  });
});

describe('AC-4 · 게스트는 조회를 안 내보내고 게스트 얼굴을 그린다 (★5)', () => {
  it('미로그인이면 /saved-stays 요청이 0건이고, 게스트 얼굴이 뜬다(loading·empty 아님)', async () => {
    // 준비 — 토큰을 지우고, /saved-stays 히트를 세는 스파이 핸들러를 건다.
    clearAccessToken();
    let hits = 0;
    server.use(
      http.get(`${BASE}/saved-stays`, () => {
        hits += 1;
        return HttpResponse.json([HEARTED]);
      })
    );

    render(<SavedStayPage />, { wrapper: createWrapper() });

    // 단언 — 게스트 얼굴이 뜬다(enabled:isAuthed=false 라 조회가 영원히 pending인데, 게스트
    // 분기가 상태 판정보다 먼저라 끝나지 않는 로딩에 안 빠진다, d02 ★1).
    await screen.findByTestId('saved-stay-guest');
    expect(screen.queryByTestId('saved-stay-card-ss-1')).toBeNull();

    // 단언 — 조회가 아예 안 나갔다. `enabled:isAuthed` 게이트를 실제로 잠근다.
    await waitFor(() => expect(hits).toBe(0));
  });
});
