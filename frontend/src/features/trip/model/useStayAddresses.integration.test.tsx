import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { SavedStay } from '@/shared/api/generated/schemas';

import { useStayAddresses } from './useStayAddresses';

/**
 * TRIP-1011(#036 · 01b Q1) — 저장 숙소 좌표마다 기존 `/stays/reverse-geocode`로 주소를 받아
 * savedStayId 별 상태(`known`/`unknown`/`loading`)로 돌려주는 훅. `SavedStay`에 주소 필드가 없어서
 * (openapi·생성 타입·DDL 실측) 섹션 분리의 재료를 이 조회로 만든다.
 *
 * 무엇을 보장하나 — **실제로 나간 요청**으로 잰다(msw):
 *  - 좌표가 있는 숙소마다 그 좌표(lat·lng)로 요청하고, 주소 문자열이 오면 `known`.
 *  - 좌표가 없는 숙소(`lat`/`lng` null)는 **요청하지 않고** `unknown`.
 *  - `address: null`(그 좌표에 주소 없음)도, 503(조회 실패)도 `unknown` — 둘 다 "위치 확인 안 됨"이라
 *    시트에서 숨기지 않고 두 번째 섹션으로 간다(INV-4 · 01b Q2). 화면 층은 둘을 구분할 필요가 없다.
 *  - 응답 전에는 `loading`.
 *  - 같은 좌표(중복 등록 숙소 #021)는 한 번만 요청한다(react-query 캐시 — 좌표가 캐시 키).
 *
 * 왜 통합 버킷인가: "몇 번, 어떤 좌표로 나갔나"는 msw 만 관찰할 수 있다(`useTripBases.integration.test.tsx`
 * 와 같은 이유). 페이지 테스트는 이 훅 모듈 경로를 목으로 바꿔 끼운다(QueryClientProvider 없음).
 */

// authedClient 가 @/shared/storage 를 정적으로 문다 — expo-secure-store 실물 로드 회피(리포 관례).
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

function stay(over: Partial<SavedStay>): SavedStay {
  return {
    savedStayId: 'stay-x',
    name: '숙소',
    coordConfirmed: true,
    linkedTripIds: [],
    checkIn: null,
    checkOut: null,
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

// QA 재현(#036) 좌표. 파라다이스는 중복 등록(#021)이라 같은 좌표로 두 줄이다.
const JW = stay({ savedStayId: 'jw', lat: 37.57, lng: 127.009 });
const DENBA = stay({ savedStayId: 'denba', lat: 35.26, lng: 129.09 });
const PARA_1 = stay({ savedStayId: 'para-1', lat: 35.16, lng: 129.164 });
const PARA_2 = stay({ savedStayId: 'para-2', lat: 35.16, lng: 129.164 });
const NO_COORD = stay({ savedStayId: 'no-coord', lat: null, lng: null });

/** lat → 응답. 표에 없는 lat 는 테스트 준비 실수라 500 으로 드러낸다. */
type Reply = { address: string | null } | 'fail-503';
let replyByLat: Record<string, Reply> = {};
/** 실제로 나간 reverse-geocode 요청의 `lat,lng` 목록. */
let requested: string[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  requested = [];
  replyByLat = {
    '37.57': { address: '서울특별시 종로구 청계천로 279' },
    '35.26': { address: '부산 금정구 구서동 1' },
    '35.16': { address: '부산광역시 해운대구 해운대해변로 296' },
  };
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/stays/reverse-geocode`, ({ request }) => {
      const url = new URL(request.url);
      const lat = url.searchParams.get('lat') ?? '';
      const lng = url.searchParams.get('lng') ?? '';
      requested.push(`${lat},${lng}`);
      const reply = replyByLat[lat];
      if (reply === undefined) return new HttpResponse(null, { status: 500 });
      if (reply === 'fail-503') {
        return HttpResponse.json(
          {
            error: {
              code: 'UPSTREAM_UNAVAILABLE',
              message: '장소 검색을 잠시 쓸 수 없어요',
            },
          },
          { status: 503 }
        );
      }
      return HttpResponse.json({
        address: reply.address,
        lat: Number(lat),
        lng: Number(lng),
      });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    // retry:false — 503 이 곧바로 실패로 떨어지게. gcTime:0 — 타이머가 프로세스를 붙잡지 않게(리포 관례).
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

describe('U1 · 좌표마다 조회해 주소를 붙인다 (01b Q1)', () => {
  it('좌표가 있는 두 숙소 → 각자 그 좌표로 요청하고 known 주소를 돌려준다', async () => {
    const { result } = renderHook(() => useStayAddresses([JW, DENBA]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.jw?.status).toBe('known'));
    await waitFor(() => expect(result.current.denba?.status).toBe('known'));

    expect(result.current.jw).toEqual({
      status: 'known',
      address: '서울특별시 종로구 청계천로 279',
    });
    expect(result.current.denba).toEqual({
      status: 'known',
      address: '부산 금정구 구서동 1',
    });
    // 요청이 그 숙소의 좌표를 실었다(순서 무관).
    expect([...requested].sort()).toEqual(['35.26,129.09', '37.57,127.009']);
  });
});

describe('U2 · 좌표가 없으면 요청 없이 unknown (INV-U1-08 · 브리프 §3)', () => {
  it('lat/lng null 숙소는 unknown 이고, 요청은 좌표 있는 숙소 몫만 나간다', async () => {
    const { result } = renderHook(() => useStayAddresses([NO_COORD, JW]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.jw?.status).toBe('known'));

    expect(result.current['no-coord']).toEqual({ status: 'unknown' });
    expect(requested).toEqual(['37.57,127.009']);
  });
});

describe('U3 · address:null 과 503 은 둘 다 unknown (INV-4 · 01b Q2)', () => {
  it('주소 없음(null)은 unknown', async () => {
    replyByLat['37.57'] = { address: null };
    const { result } = renderHook(() => useStayAddresses([JW]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(requested).toHaveLength(1));
    await waitFor(() =>
      expect(result.current.jw).toEqual({ status: 'unknown' })
    );
  });

  it('조회 실패(503)도 unknown — 성공한 다른 숙소는 known 그대로', async () => {
    replyByLat['35.16'] = 'fail-503';
    const { result } = renderHook(() => useStayAddresses([JW, PARA_1]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.jw?.status).toBe('known'));
    await waitFor(() =>
      expect(result.current['para-1']).toEqual({ status: 'unknown' })
    );
  });
});

describe('U4 · 응답 전에는 loading (AC-6)', () => {
  it('첫 렌더 직후 좌표 있는 숙소는 loading, 좌표 없는 숙소는 unknown', async () => {
    const { result } = renderHook(() => useStayAddresses([JW, NO_COORD]), {
      wrapper: createWrapper(),
    });

    // 응답이 오기 전(같은 틱) — 아직 조회 중이다.
    expect(result.current.jw).toEqual({ status: 'loading' });
    expect(result.current['no-coord']).toEqual({ status: 'unknown' });

    // 정리 — 응답을 받아 known 이 된다(열린 요청을 남기지 않는다).
    await waitFor(() => expect(result.current.jw?.status).toBe('known'));
  });
});

describe('U5 · 같은 좌표는 한 번만 요청한다 (중복 등록 #021 · 좌표 캐시 키)', () => {
  it('파라다이스 두 줄(같은 좌표) → 요청 1회, 두 id 모두 같은 주소', async () => {
    // useQueries 에 같은 키를 두 번 넣으면 TanStack 이 "Duplicate Queries" 경고를 낸다 — 좌표로 먼저
    // 묶고(중복 제거) 결과를 숙소마다 나눠 주라는 신호로 이 경고 0회를 함께 잰다.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useStayAddresses([PARA_1, PARA_2]), {
        wrapper: createWrapper(),
      });

      await waitFor(() =>
        expect(result.current['para-1']?.status).toBe('known')
      );
      await waitFor(() =>
        expect(result.current['para-2']?.status).toBe('known')
      );

      expect(requested).toEqual(['35.16,129.164']);
      expect(result.current['para-2']).toEqual(result.current['para-1']);
      expect(
        warn.mock.calls.filter((call) =>
          String(call[0]).includes('Duplicate Queries')
        )
      ).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * TRIP-1028 — 주소는 "시트를 열 때" 묻고, 받은 주소는 앱 세션 동안 기억한다.
 *
 * 훅 계약: `useStayAddresses(stays, { enabled })`. `enabled` 를 안 주면 지금처럼 켜져 있다(위 U1~U5 가
 * 옵션 없이 부르는 것이 그 앵커다). 페이지가 "시트를 한 번이라도 열었나"를 이 손잡이로 넘긴다.
 */

/** 이 파일 기본 래퍼와 같은 설정이지만, 두 번의 렌더가 **같은 캐시**를 보게 client 를 밖에서 받는다. */
function wrapperFor(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

/** 요청이 나갈 틈을 준다 — 0건 단언이 "아직 안 나갔을 뿐"으로 공짜 통과하지 않게(실시간 50ms). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('TRIP-1028 H1 · enabled:false 면 묻지 않고, 켜는 순간 묻는다 (AC-1·AC-2)', () => {
  it('꺼진 동안 요청 0건 · 좌표 있는 숙소는 loading(모름이 아니다) → 켜면 그 좌표로 요청하고 known', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useStayAddresses([JW, NO_COORD], { enabled }),
      { wrapper: createWrapper(), initialProps: { enabled: false } }
    );

    await settle();
    // 꺼진 동안 — 아무것도 안 나갔다.
    expect(requested).toEqual([]);
    // 아직 묻지 않은 것은 "조회 전"이지 "위치 확인 안 됨"(unknown)이 아니다 — unknown 으로 돌려주면
    // 시트가 묻지도 않은 숙소를 "위치 확인 안 됨"으로 단정한다. 좌표 없는 숙소만 unknown.
    expect(result.current.jw).toEqual({ status: 'loading' });
    expect(result.current['no-coord']).toEqual({ status: 'unknown' });

    // 켠다 — 이제 나간다(0건이 "핸들러가 죽어서"가 아님을 같은 it 안에서 보인다).
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.jw?.status).toBe('known'));
    expect(requested).toEqual(['37.57,127.009']);
  });
});

describe('TRIP-1028 H2 · 받은 주소는 세션 동안 기억한다 — 전역 기본값이 아니라 이 조회가 스스로 (AC-4·AC-6)', () => {
  it('받은 뒤 언마운트하고 하루가 지나 다시 써도 같은 좌표는 다시 묻지 않고, 새 좌표만 묻는다', async () => {
    // 래퍼 기본값 gcTime:0 은 "캐시를 바로 지운다"는 뜻이다. 그런데도 살아남아야 한다 = 이 조회가
    // 자기 옵션으로 수명을 들고 있다(앱 전역 QueryClient 기본값에 기대지 않는다, AC-6).
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const first = renderHook(() => useStayAddresses([JW]), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(first.result.current.jw?.status).toBe('known'));
    expect(requested).toEqual(['37.57,127.009']);

    // 화면을 떠난다(관찰자 0명 → 캐시 정리 타이머가 여기서 걸린다) → 하루를 흘린다.
    // 가짜 시계는 이 구간에만 켠다 — 요청·응답(msw)은 진짜 시계 구간에서만 오간다.
    jest.useFakeTimers();
    try {
      first.unmount();
      act(() => {
        jest.advanceTimersByTime(DAY_MS);
      });
    } finally {
      jest.useRealTimers();
    }

    const second = renderHook(() => useStayAddresses([JW, DENBA]), {
      wrapper: wrapperFor(client),
    });
    // 같은 틱 — JW 는 캐시에서 곧바로 known(다시 묻는 중이면 loading 이 나온다).
    expect(second.result.current.jw).toEqual({
      status: 'known',
      address: '서울특별시 종로구 청계천로 279',
    });
    await waitFor(() =>
      expect(second.result.current.denba?.status).toBe('known')
    );
    // 새 좌표(DENBA)만 한 번 더 나갔다.
    expect(requested).toEqual(['37.57,127.009', '35.26,129.09']);

    client.clear();
  });
});
