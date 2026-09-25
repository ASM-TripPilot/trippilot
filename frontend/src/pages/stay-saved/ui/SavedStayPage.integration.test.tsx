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
 * 상세 라우트로 **`stayId` 하나만** 실어 push 한다(AC-5). 게스트(미로그인)는 조회를 아예 안
 * 내보내고 게스트 얼굴을 그린다(AC-4·★5).
 *
 * TRIP-940 재작성(AC-10 · 01b D0·Q3): 예전엔 `SavedStay`를 e03가 받는 `StayItem`으로 **합성**해
 * `item`(JSON)으로 넘기고, 그 합성물이 e03 검문 게이트를 통과하는지를 여기서 복제 검문했다. 상세가
 * `GET /stays/{stayId}`로 스스로 조회하게 되면서 합성·게이트가 모두 사라졌다 — 이제는 "item 을
 * 싣지 않는다"가 계약이다. 외부키 없는 핀·수동 숙소는 여전히 `savedStayId`로 폴백 push 하고
 * (Q3 — 상세에서 400 식별자 오류 얼굴을 받는다, 새 티켓 후보: 등록 숙소 상세 정의).
 *
 * 왜 통합 버킷인가 — 심판 대상이 "서버 데이터로 조립한 push payload"다. 라우팅 인자는 실
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

describe('AC-5 · 카드 press → 상세 push 는 stayId 만 (TRIP-940 AC-10 재작성)', () => {
  it('하트 숙소 카드 press → stayId=stayKey 하나만 싣고 item 은 없다', async () => {
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([HEARTED, PINNED])
      )
    );
    render(<SavedStayPage />, { wrapper: createWrapper() });
    await screen.findByTestId('saved-stay-card-ss-1');

    // 실행 — 하트 숙소 카드를 누른다.
    fireEvent.press(screen.getByTestId('saved-stay-card-ss-1'));

    // 단언 — push 는 한 번, 객체형 전체를 완전일치로 본다(params 에 item 이 남으면 red).
    expect(mockPush.mock.calls).toEqual([
      [{ pathname: '/stays/[stayId]', params: { stayId: 'NAVER:n-99' } }],
    ]);
  });

  it('핀·수동 숙소(외부키 null) 카드 press → stayId=savedStayId 폴백 하나만 싣는다 (★2 · Q3)', async () => {
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([HEARTED, PINNED])
      )
    );
    render(<SavedStayPage />, { wrapper: createWrapper() });
    await screen.findByTestId('saved-stay-card-ss-2');

    // 실행 — 외부키가 null인 핀 숙소 카드를 누른다.
    fireEvent.press(screen.getByTestId('saved-stay-card-ss-2'));

    // 단언 — stayKey가 "null:null"로 충돌하지 않고 savedStayId로 폴백하며, item 은 없다.
    expect(mockPush.mock.calls).toEqual([
      [{ pathname: '/stays/[stayId]', params: { stayId: 'ss-2' } }],
    ]);
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

describe('AC-11 · 실앱 degrade — 페이지가 거점/지역/가격을 발명하지 않는다 (TRIP-729)', () => {
  it('서버 SavedStay 로드 시 카드는 이름만, 거점 배지·가격은 미표시 (계약 공백, 사변 금지)', async () => {
    // SavedStay 계약엔 isBase·region·price 필드가 없다. 페이지는 이 값들을 채우는 조회 훅을 만들지
    // 않고 VM 에 미설정으로 둔다 → 카드가 이름만 그린다(Figma 풀샷은 프리뷰 픽스처에서만).
    // 선제 green(회귀 트립와이어) — 페이지가 `isBase:true` 를 매핑하면 이 단언이 red 로 뒤집힌다.
    server.use(
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([HEARTED]))
    );
    render(<SavedStayPage />, { wrapper: createWrapper() });
    const card = await screen.findByTestId('saved-stay-card-ss-1');

    // 긍정 짝 — 이름은 뜬다(카드 자체가 안 떠서 공짜 통과하는 것 차단).
    expect(screen.getByText('해운대 오션뷰 호텔')).toBeOnTheScreen();
    // 부정 — 거점 배지·"거점" 문자열·가격 발명 0.
    expect(screen.queryByTestId('saved-stay-card-ss-1-base-badge')).toBeNull();
    expect(screen.queryByText('거점')).toBeNull();
    expect(card).not.toHaveTextContent(/원~|₩/);
  });
});
