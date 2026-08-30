import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useGetMeNotificationSettings } from '@/shared/api/generated/notification/notification';
import type {
  NotificationToggle,
  NotificationToggleKind,
  UpdateToggleRequest,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { useToggles, type ToggleOutcome } from './useToggles';

/**
 * TRIP-607 · l02 알림 설정 · 정상-2·3 — useToggles 낙관 갱신 + 바뀐 필드만 PATCH + kind×채널 롤백.
 *
 * 무엇을 보장하나:
 *  - **U1 (정상-2 · openapi UpdateToggleRequest)** 한 채널을 토글하면 그 채널 하나만 낙관 반영하고,
 *    나간 PATCH 바디가 **바뀐 필드 하나뿐**이다 — 푸시를 끄면 `{pushEnabled:false}` 만, `inAppEnabled`
 *    는 바디에 **없다**(null=변경없음: 두 필드를 매번 동봉하면 다른 쪽을 덮는다). 성공하면 목록을 무효화한다.
 *  - **U2 (정상-2 대칭)** 인앱을 토글하면 `{inAppEnabled:...}` 만 나가고 `pushEnabled` 는 바디에 없다.
 *  - **U3 (정상-3 · INV-4)** PATCH 가 실패하면 그 kind×채널만 이전 값으로 되돌리고, 실패를 호출자에게
 *    알리며(조용히 삼키면 INV-4 위반), 실패 경로에서는 무효화하지 않는다(재요청이 롤백을 덮으면
 *    "되돌렸나"를 관측 못 함 — savedPlaces/useVisitCheck 규율).
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청·바디"와 "응답 전 캐시 상태"다 — msw + 실 QueryClient
 * 로만 관측된다(`useVisitCheck.integration.test.tsx` 와 같은 자리·장치). 낙관 갱신은 GET 정본 쿼리키
 * (`getGetMeNotificationSettingsQueryKey()`)에 얹혀야 화면이 읽으므로, 관측도 그 키를 읽는 별도
 * 조회 프로브로 한다.
 */

// authedClient(생성 클라이언트의 mutator 인증 계층)가 @/shared/storage 를 정적으로 문다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';

/** 토글 하나. 케이스가 push/inApp 만 바꾼다. */
const tg = (
  kind: NotificationToggleKind,
  pushEnabled: boolean,
  inAppEnabled: boolean
): NotificationToggle => ({ kind, pushEnabled, inAppEnabled });

/** 서버가 보내는 초기 7종(기본값 — SLOT_PRE·PLAN_B 푸시 OFF). */
const INITIAL_ITEMS: NotificationToggle[] = [
  tg('STAY', true, true),
  tg('TRIP_PRE', true, true),
  tg('TRIP_DAY', true, true),
  tg('SLOT_PRE', false, true),
  tg('PLAN_B', false, true),
  tg('REFLECTION', true, true),
  tg('COMMUNITY', true, true),
];

/** 테스트가 열어 줄 때까지 응답하지 않는 문(useVisitCheck 선례) — "응답 전"을 시간이 아닌 신호로. */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

let observedHits: string[] = [];
let capturedBodies: UpdateToggleRequest[] = [];
let capturedKinds: string[] = [];
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  capturedBodies = [];
  capturedKinds = [];
  setAccessToken('a');
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

/** 정본 GET 쿼리로 낙관 캐시를 직접 관찰 + useToggles 를 함께 띄운다. */
function useProbe() {
  return {
    settings: useGetMeNotificationSettings(),
    toggles: useToggles(),
  };
}

/** 초기 7종이 도착한 상태를 만든다. */
async function renderProbeReady() {
  server.use(
    http.get(`${BASE}/me/notification-settings`, () =>
      HttpResponse.json({ items: INITIAL_ITEMS })
    )
  );
  const rendered = renderHook(() => useProbe(), { wrapper: createWrapper() });
  await waitFor(() =>
    expect(rendered.result.current.settings.isSuccess).toBe(true)
  );
  return rendered;
}

/** 지금 캐시에서 그 kind 의 pushEnabled / inAppEnabled. */
const pushOf = (
  settings: { data?: { items: NotificationToggle[] } },
  kind: NotificationToggleKind
): boolean | undefined =>
  (settings.data?.items ?? []).find((i) => i.kind === kind)?.pushEnabled;
const inAppOf = (
  settings: { data?: { items: NotificationToggle[] } },
  kind: NotificationToggleKind
): boolean | undefined =>
  (settings.data?.items ?? []).find((i) => i.kind === kind)?.inAppEnabled;

describe('정상-2 · 푸시 토글 — 바뀐 필드만 PATCH + 응답 전 낙관 + 성공 후 무효화 (U1)', () => {
  it('U1 응답 전에 그 kind 푸시가 꺼져 보이고, 바디는 {pushEnabled:false} 뿐이며(inAppEnabled 없음), 성공 후 목록을 다시 받아온다', async () => {
    const gate = createGate();
    const { result } = await renderProbeReady();
    server.use(
      http.patch(
        `${BASE}/me/notification-settings/:kind`,
        async ({ request, params }) => {
          capturedKinds.push(String(params.kind));
          capturedBodies.push((await request.json()) as UpdateToggleRequest);
          await gate.opened;
          return HttpResponse.json(tg('STAY', false, true));
        }
      )
    );
    // 앵커 — 시작은 STAY 푸시 ON(act 전 .data 를 읽어 tracked-props 가 이후 낙관 변경을 통지하게).
    expect(pushOf(result.current.settings, 'STAY')).toBe(true);

    // 실행 ① — 푸시 끄기를 발사만.
    let pending!: Promise<ToggleOutcome>;
    await act(async () => {
      pending = result.current.toggles.toggle('STAY', 'push', false);
    });

    // 단언 ① — 서버가 아직 답하지 않았는데 이미 꺼짐(낙관).
    expect(pushOf(result.current.settings, 'STAY')).toBe(false);
    // 단언 ② — 인앱은 건드리지 않았다(그 kind 낙관은 채널 단위).
    expect(inAppOf(result.current.settings, 'STAY')).toBe(true);
    // 단언 ③ — PATCH 는 그 kind 로 나갔고, 바디는 바뀐 필드 하나뿐이다.
    expect(capturedKinds).toEqual(['STAY']);
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0]).toEqual({ pushEnabled: false });
    // 두 필드 동봉 금지의 급소 — inAppEnabled 키가 바디에 아예 없다(null 도 아님).
    expect(capturedBodies[0]).not.toHaveProperty('inAppEnabled');

    // 실행 ② — 문을 연다.
    gate.release();
    let outcome!: ToggleOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ④⑤ — 성공으로 수렴 + 목록 재요청(무효화, 1 → 2).
    expect(outcome).toEqual({ kind: 'ok' });
    await waitFor(() =>
      expect(hitCount('GET /api/v1/me/notification-settings')).toBe(2)
    );
  });
});

describe('정상-2 대칭 · 인앱 토글 — {inAppEnabled} 만 나가고 pushEnabled 는 바디에 없다 (U2)', () => {
  it('U2 인앱 끄기의 바디는 {inAppEnabled:false} 뿐이고, 그 kind 푸시는 낙관에서 불변이다', async () => {
    const { result } = await renderProbeReady();
    server.use(
      http.patch(
        `${BASE}/me/notification-settings/:kind`,
        async ({ request, params }) => {
          capturedKinds.push(String(params.kind));
          capturedBodies.push((await request.json()) as UpdateToggleRequest);
          return HttpResponse.json(tg('STAY', true, false));
        }
      )
    );
    expect(inAppOf(result.current.settings, 'STAY')).toBe(true);

    let outcome!: ToggleOutcome;
    await act(async () => {
      outcome = await result.current.toggles.toggle('STAY', 'inapp', false);
    });

    expect(outcome).toEqual({ kind: 'ok' });
    expect(capturedKinds).toEqual(['STAY']);
    expect(capturedBodies[0]).toEqual({ inAppEnabled: false });
    // 급소 대칭 — pushEnabled 키가 바디에 없다.
    expect(capturedBodies[0]).not.toHaveProperty('pushEnabled');
  });
});

describe('정상-3 · PATCH 실패 → kind×채널 롤백 + 실패 통지 + 무효화 안 함 (U3 · INV-4)', () => {
  it('U3 네트워크 실패 → STAY 푸시를 이전 값(ON)으로 되돌리고, 실패를 알리며, 목록 재요청 0건', async () => {
    const { result } = await renderProbeReady();
    server.use(
      http.patch(`${BASE}/me/notification-settings/:kind`, () =>
        HttpResponse.error()
      )
    );
    expect(pushOf(result.current.settings, 'STAY')).toBe(true);

    let outcome!: ToggleOutcome;
    await act(async () => {
      outcome = await result.current.toggles.toggle('STAY', 'push', false);
    });

    // 단언 ① — 실패가 호출자에게 도달한다(조용히 삼키면 INV-4 위반).
    expect(outcome.kind).toBe('failed');
    // 단언 ② — 호출 전 값(푸시 ON)으로 되돌아갔다.
    expect(pushOf(result.current.settings, 'STAY')).toBe(true);
    // 단언 ③ — 실패 경로는 무효화하지 않는다(초기 GET 1건만 유지).
    expect(hitCount('GET /api/v1/me/notification-settings')).toBe(1);
  });
});
