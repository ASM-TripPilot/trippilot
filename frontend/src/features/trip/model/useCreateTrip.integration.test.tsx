import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useGetTrips } from '@/shared/api/generated/trips/trips';
import type {
  CreateTripRequest,
  PreferenceView,
  Trip,
} from '@/shared/api/generated/schemas';

import {
  buildCreateTripRequest,
  type CreateTripInput,
} from './createTripRequest';
import { useCreateTrip } from './useCreateTrip';
import { usePreferencePrefill } from './usePreferencePrefill';

/**
 * TRIP-203 AC-2 (+ TRIP-207 AC-2 · AC-3 갱신) — 여행 생성 훅이 성공 경로를 끝까지 잇는다.
 *
 * 무엇을 보장하나:
 *  - **D-1 (AC-2)** 여행을 만들면 ① "내 여행 목록" 캐시가 무효화되어 실제로 다시 받아 오고
 *    ② 서버가 준 `Trip`이 가공 없이 호출자에게 돌아온다.
 *  - **D-2·D-3 (TRIP-207 AC-2·AC-3 + TRIP-484 정책 A)** 사용자가 넣은 예산이 **나가는 실제 요청
 *    바디**에 실리거나(넣었을 때) 키가 아예 없다(안 넣었을 때 — **취향에 러프값이 있어도**).
 *    그리고 **`preferenceSnapshot`은 입력이 실었을 때만 wire까지 그대로 나가고**(D-2), 입력이
 *    안 실었으면 wire에도 없다(D-3 — 훅이 스냅숏을 지어내지 않는다).
 *
 * ⚠️ **TRIP-207에서 D-2·D-3의 주어가 바뀌었다**(02a §6-2). TRIP-203 승인 당시에는 예산 입력
 * UI가 없어 "취향 → 예산 → 요청" 한 줄기가 유일한 경로였다. TRIP-207이 입력을 붙이면서
 * US-TRIP-01("예산은 **선택**")이 요구하는 것이 뒤집혔고, `buildCreateTripRequest`는 취향을
 * 인자로 받지 않는다. **D-3은 이 갱신으로 오히려 강해졌다** — 옛 D-3은 취향 응답을
 * `rawAmount: null`로 덮어써서 만든 상황이었지만, 새 D-3은 기본 취향(`rawAmount: 1200000`)을
 * 그대로 둔 채 입력에 예산 없이 보내 **AC-2를 wire 층에서 직접 심판한다**.
 *
 * > *(개념)* **mutation(뮤테이션)** — 서버 데이터를 *바꾸는* 호출(생성·수정·삭제)을 다루는
 * > TanStack Query 훅. 읽기용 `useQuery`와 달리 화면에 뜨자마자 저절로 실행되지 않고, 버튼을
 * > 누르는 등의 시점에 **명시적으로 한 번 발사**한다(`mutateAsync`). 리포에서 사람이 직접 쓴
 * > `useMutation`은 이번이 처음이다.
 * >
 * > *(개념)* **쿼리 무효화(invalidate)** — 캐시를 지우는 것이 아니라 "이 캐시는 이제 못 믿는다,
 * > 필요해지면 다시 받아라"라는 **상한 표시**를 붙이는 동작. 화면에 떠 있는(=활성) 쿼리는 그
 * > 표시가 붙는 즉시 다시 요청한다 — 이 테스트가 무효화를 관찰하는 방법이 그것이다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청**"이다. 요청 바디의 최종 형태(JSON 직렬화
 * 이후)와 재요청 횟수는 msw만 관찰할 수 있다(`useStaySearch.integration.test.tsx`와 같은 이유).
 *
 * ⚠️ **wire 층은 "키 부재"와 "`undefined`"를 구별할 수 없다.** JSON 직렬화가 값이 `undefined`인
 * 키를 지우기 때문이다(02a ★4 실측). 그래서 여기서는 "`null`이 아니다 + JSON에 키가 없다"까지
 * 지고, **키를 아예 붙이지 않는다**는 조립 규칙 자체는 순수 함수 단위(`createTripRequest.test.ts`)가
 * `in` 연산자로 잠근다. 두 층이 합쳐져야 AC-5가 온전히 덮인다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 응답 shape(`Trip`)과 무효화 대상(`GET /trips`)이 바뀌지 않는 한
 * 유효하다. 여행 생성 화면(TRIP-205~209)이 붙어도 이 단언들은 red를 내지 않는다.
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage 를 정적으로
// 물고 있다. 이 시나리오는 401 이 없어 실제로 호출되지는 않지만, expo-secure-store 실물
// 로드를 피하려면 useStaySearch.integration.test.tsx:35 와 같은 형태로 목킹해야 한다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

/** authWiring.integration.test.ts:59 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

/**
 * 서버가 돌려주는 여행. openapi `Trip.required` 10필드를 그대로 채운다(상상해서 만들지 않는다).
 * `preferenceSnapshot`이 **응답에는 required**라는 점에 유의 — 클라이언트가 보내지 않아도
 * 서버가 채워 돌려준다는 뜻이고, 그것이 AC-6이 서 있는 자리다.
 */
const TRIP_FIXTURE: Trip = {
  tripId: '11111111-1111-1111-1111-111111111111',
  title: '제주 2박 3일',
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  party: 2,
  companionType: '친구',
  budgetTotal: 1200000,
  preferenceSnapshot: { pace: '균형있게' },
  destinations: [{ seq: 1, region: '제주', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
};

/** 예산 러프값이 실제로 있는 취향. `companionTypes`에 `커플`이 들어 있는 것이 정상이다 —
 * 온보딩 축과 여행 축(`CompanionType`)은 다른 목록이다(BR-U1-39). */
const PREF_WITH_AMOUNT: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  companion: {
    companionTypes: ['커플'],
    petFlag: false,
    isNeutralDefault: false,
  },
  budget: { tier: '중간', rawAmount: 1200000, isNeutralDefault: false },
};

const BASE_INPUT: CreateTripInput = {
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  party: 2,
  destinations: [{ seq: 1, region: '제주', nights: 2 }],
};

/** 나간 요청의 `METHOD /경로` 누적 — 재요청 횟수를 세는 데 쓴다. */
let observedHits: string[] = [];
/** `POST /trips`가 실제로 실어 보낸 본문(JSON 직렬화 **이후**의 값). */
let capturedBody: Record<string, unknown> | null = null;

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
  capturedBody = null;
  clearAccessToken();
  // 기본 handlers.ts 에 여행 목록 핸들러가 없고(AC-8이 정한 것은 POST /trips·
  // GET /me/preferences 둘뿐), POST /trips 는 여기서 **본문을 캡처하는** 것으로 덮는다.
  // afterEach 의 resetHandlers() 가 지우므로 beforeEach 에서 다시 건다
  // (useStaySearch.integration.test.tsx:88 과 같은 이유).
  server.use(
    http.get(`${BASE}/trips`, () => HttpResponse.json([])),
    http.get(`${BASE}/me/preferences`, () =>
      HttpResponse.json(PREF_WITH_AMOUNT)
    ),
    http.post(`${BASE}/trips`, async ({ request }) => {
      capturedBody = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(TRIP_FIXTURE, { status: 201 });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime: 0 — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를
      // 붙잡는다. **mutations 쪽도 반드시 0으로 둔다**: mutation 기본 gcTime 은 5분이고,
      // 빼면 이 버킷이 300초 매달린다(02a ★3 실측 — 2분 타임아웃 → 0.5초 종료).
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

/** 목록 캐시까지 띄운 관찰용 훅 — 무효화가 **실제 재요청**으로 이어지는지 보려면 그 쿼리가
 * 활성 상태여야 한다(활성 쿼리만 무효화 즉시 다시 받는다). */
function useTripProbeWithList() {
  return {
    list: useGetTrips(),
    prefill: usePreferencePrefill(),
    create: useCreateTrip(),
  };
}

/** 목록 없이 취향·생성만 — 요청 바디만 볼 때 쓴다(무효화 재요청이 끼어들지 않는다). */
function useTripProbe() {
  return {
    prefill: usePreferencePrefill(),
    create: useCreateTrip(),
  };
}

describe('AC-2 · 여행 생성 성공 경로 (D-1)', () => {
  it('생성에 성공하면 여행 목록만 다시 받아오고, 서버가 준 Trip이 가공 없이 돌아온다', async () => {
    // 준비 — 목록·취향 두 쿼리가 각각 한 번씩 서버를 다녀온 상태를 만든다.
    setAccessToken('valid-access');
    const { result } = renderHook(() => useTripProbeWithList(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.prefill.isSuccess).toBe(true));

    // 앵커 — 초기 상태가 실제로 "각 1회"다. 이게 없으면 아래 증가 단언이 무엇에서 무엇으로
    // 늘었는지 말하지 못한다.
    expect(hitCount('GET /api/v1/trips')).toBe(1);
    expect(hitCount('GET /api/v1/me/preferences')).toBe(1);

    // 실행 — 생성을 딱 한 번 발사한다.
    await act(async () => {
      await result.current.create.mutateAsync({
        data: buildCreateTripRequest(BASE_INPUT),
      });
    });

    // 단언 ① — 여행 목록 캐시가 무효화되어 실제로 다시 받아왔다(1 → 2).
    await waitFor(() => expect(hitCount('GET /api/v1/trips')).toBe(2));

    // 단언 ② (부정 짝, 01b Seed D5) — 무효화 사정거리는 목록 하나다. 이 단언이 없으면
    // `invalidateQueries()`를 인자 없이 불러 **모든 캐시**를 날리는 구현도 통과한다.
    expect(hitCount('GET /api/v1/me/preferences')).toBe(1);

    // 단언 ③ — 응답이 가공 없이 그대로 돌아온다(tripId·status 포함 전 필드).
    expect(result.current.create.data).toEqual(TRIP_FIXTURE);
  });
});

describe('TRIP-207 AC-2 · AC-3 · 나가는 요청 바디 (D-2 · D-3)', () => {
  it('입력이 실은 예산과 preferenceSnapshot이 wire까지 그대로 나간다 (D-2)', async () => {
    // 준비 — 취향 조회는 그대로 돈다(프리필의 출처). 조립에 넘어가는 스냅숏은 **입력이 실은 값**이다.
    setAccessToken('valid-access');
    const { result } = renderHook(() => useTripProbe(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.prefill.isSuccess).toBe(true));

    // 실행 — 예산과 override 스냅숏이 **입력에서** 온다(화면의 예산 필드·취향 시트가 넘긴 값).
    // `CreateTripRequest`(변수)로 타이핑해야 `preferenceSnapshot`을 실을 수 있다(★8, 리터럴
    // 이면 excess-property 검사에 걸린다).
    const input: CreateTripRequest = {
      ...BASE_INPUT,
      budgetTotal: 1200000,
      preferenceSnapshot: { styles: ['휴양'] },
    };
    await act(async () => {
      await result.current.create.mutateAsync({
        data: buildCreateTripRequest(input),
      });
    });

    // 앵커 — 요청이 실제로 나갔다. 없으면 아래 단언이 "아무것도 안 보내서" 통과한다.
    expect(capturedBody).not.toBeNull();

    // 단언 — 입력값이 그대로 실렸다.
    expect(capturedBody).toMatchObject({
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      budgetTotal: 1200000,
    });

    // 단언 — 스냅숏이 wire까지 그대로 나간다(TRIP-484 정책 A — 뮤테이션 훅이 우회로 지우지 않는다).
    expect(capturedBody).toMatchObject({
      preferenceSnapshot: { styles: ['휴양'] },
    });
  });

  it('예산을 안 넣으면 취향에 러프값이 있어도 budgetTotal 키가 아예 나가지 않는다 (D-3)', async () => {
    // 준비 — 취향 응답을 **덮지 않는다**. 기본 핸들러가 `rawAmount: 1200000`을 주고 있고,
    // 프리필이 성공한 것도 아래에서 기다려 확인한다. 그 상태에서 예산 없이 보낸다 —
    // TRIP-206까지의 구현이라면 여기서 1200000이 자동으로 붙었다(TRIP-207 AC-2가 뒤집은
    // 바로 그 동작). 순진한 구현이 `budgetTotal: null`을 실어 보내는 자리이기도 하다.
    setAccessToken('valid-access');
    const { result } = renderHook(() => useTripProbe(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.prefill.isSuccess).toBe(true));
    // 앵커 — 취향에 러프값이 실제로 도착했다. 이게 없으면 "취향이 비어서" 키가 안 붙은
    // 것과 구별되지 않아 이 케이스가 AC-2를 심판하지 못한다.
    expect(result.current.prefill.data?.budget?.rawAmount).toBe(1200000);

    // 실행
    await act(async () => {
      await result.current.create.mutateAsync({
        data: buildCreateTripRequest(BASE_INPUT),
      });
    });

    // 앵커(긍정) — 요청이 나갔고 나머지 필드는 정상이다.
    expect(capturedBody).toMatchObject({
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    });

    // 단언 — 서버가 받은 JSON에 키 자체가 없다. `null`이 들어 있으면 실패한다
    // ("키 부재 ≠ null 전송" — 선례 buildStayRegisterRequest / TRIP-198 AC-5).
    expect(Object.keys(capturedBody ?? {})).not.toContain('budgetTotal');
    expect(capturedBody?.budgetTotal).not.toBeNull();

    // 단언 — 입력이 스냅숏을 안 실었으므로 wire에도 없다(훅이 지어내지 않는다 — 조건부 통과의
    // 나머지 절반, D-2의 짝).
    expect(Object.keys(capturedBody ?? {})).not.toContain('preferenceSnapshot');
  });
});
