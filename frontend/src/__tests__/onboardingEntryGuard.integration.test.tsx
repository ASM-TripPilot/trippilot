import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { PreferenceView } from '@/shared/api/index.schemas';
import { BASE } from '@/test-support/apiBase';
import {
  renderWithQueryClient,
  settle,
  newTestQueryClient,
} from '@/test-support/queryRender';
import OnboardingIndex from '@routes/(onboarding)/index';

/**
 * (onboarding)/index — 재진입 시 서버 GET 3개로 남은 첫 단계를 정한다 (TRIP-1421 AC7~AC12 · 옛 T2-1·T2-2 대체).
 *
 * 무엇을 보장하나: 온보딩을 끝내기 전에 앱을 다시 켜면 `/me/consents`·`/me/profile`·`/me/preferences`
 * 세 응답만 보고 **남은 첫 단계로 정확히 한 번** 보낸다.
 *  - 약관 3종이 다 granted 가 아니면 terms, 프로필이 404 면 nickname, 취향이 미저장이면 c08(location),
 *    다 됐는데 서버가 아직 미완이면 완료를 다시 시도하는 pref2. 홈('/')으로는 결코 보내지 않는다.
 *  - "취향 저장됨"은 설정 화면 "N/6"과 같은 정의다 — 예산 제외 6축, 축이 없으면 미설정(`initialSelection`).
 *  - GET 이 실패한 축은 "아직 안 됨"으로 접는다(막다른 화면 0). 프로필 404 만 실패가 아니라 "닉네임 없음".
 *  - 응답이 다 오기 전엔 아무것도 그리지도 보내지도 않고, **이번 마운트 뒤 받은 응답**으로만 보낸다.
 *
 * 왜 MSW 인가: 판정이 "어느 쿼리 키·어느 훅"으로 구현되든 상관없이, 서버가 이렇게 답하면 어디로 가는가만 본다.
 * `onUnhandledRequest: 'error'` 라 세 GET 밖의 요청을 부르면 준비 단계에서 죽는다(계약: GET 3개로 판정).
 *
 * 관찰: expo-router 를 기록기로 바꾼다. `<Redirect>` 는 href 가 바뀔 때마다 1건(`useEffect([href])`),
 * `router.replace`·`useRouter().replace/push` 도 같은 배열에 쌓는다 — "terms 를 한 번 번쩍인 뒤 location" 같은
 * 흔들림이 `['/(onboarding)/terms', '/(onboarding)/location']` 으로 드러난다(02a ★2).
 */

const mockNavigations: string[] = [];

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react') as typeof import('react');
  const record = (href: unknown) => {
    mockNavigations.push(String(href));
  };
  return {
    __esModule: true,
    Redirect: ({ href }: { href: unknown }) => {
      useEffect(() => {
        record(href);
      }, [href]);
      return null;
    },
    router: { replace: record, push: record },
    useRouter: () => ({ replace: record, push: record, back: jest.fn() }),
  };
});

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'tok', refreshToken: 'ref' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

/** openapi `ConsentState` 모양(termsType · granted · termsVersion). */
interface ConsentRow {
  termsType: string;
  granted: boolean;
  termsVersion: string;
}

const REQUIRED_TERMS = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'LOCATION_TERMS'];

const ALL_GRANTED: ConsentRow[] = REQUIRED_TERMS.map((termsType) => ({
  termsType,
  granted: true,
  termsVersion: '1.0',
}));

const PROFILE = {
  nickname: '여행자1234',
  nicknameUpdatedAt: '2026-10-17T00:00:00Z',
  onboardingCompletedAt: null,
};

/** 7축 전부 중립 기본값(= 아무것도 저장 안 함). 서버는 미설정도 "항상 완전"하게 파생해 준다(US-ONB-14). */
const NEUTRAL_PREFS: PreferenceView = {
  styles: { value: [], isNeutralDefault: true },
  activities: { value: [], isNeutralDefault: true },
  transportModes: { value: [], isNeutralDefault: true },
  foodTastes: { value: [], isNeutralDefault: true },
  pace: { value: null, isNeutralDefault: true },
  companion: { companionTypes: [], petFlag: false, isNeutralDefault: true },
  budget: { tier: null, rawAmount: null, isNeutralDefault: true },
};

type Failure = 'network-error' | 404 | 500;

interface ServerState {
  consents: ConsentRow[] | Failure;
  profile: 'ok' | Failure;
  preferences: PreferenceView | Failure;
}

function fail(failure: Failure) {
  return failure === 'network-error'
    ? HttpResponse.error()
    : HttpResponse.json({ code: 'ERROR' }, { status: failure });
}

function isFailure(value: unknown): value is Failure {
  return value === 'network-error' || value === 404 || value === 500;
}

/** 기본값 = 약관 ✓ · 닉네임 ✓ · 취향 미저장. 케이스는 바꿀 축만 덮어쓴다. */
function serve(overrides: Partial<ServerState> = {}): void {
  const state: ServerState = {
    consents: ALL_GRANTED,
    profile: 'ok',
    preferences: NEUTRAL_PREFS,
    ...overrides,
  };
  server.use(
    http.get(`${BASE}/me/consents`, () =>
      isFailure(state.consents)
        ? fail(state.consents)
        : HttpResponse.json(state.consents)
    ),
    http.get(`${BASE}/me/profile`, () =>
      state.profile === 'ok' ? HttpResponse.json(PROFILE) : fail(state.profile)
    ),
    http.get(`${BASE}/me/preferences`, () =>
      isFailure(state.preferences)
        ? fail(state.preferences)
        : HttpResponse.json(state.preferences)
    )
  );
}

/** 기록이 하나라도 생길 때까지 기다린 뒤, 늦게 오는 두 번째 이동이 없는지까지 흘려보낸다. */
async function settledNavigations(): Promise<string[]> {
  await waitFor(() => expect(mockNavigations.length).toBeGreaterThan(0));
  await settle();
  return [...mockNavigations];
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  mockNavigations.length = 0;
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('진입 판정 — 남은 첫 단계로 정확히 한 번 (AC7 · AC8 · AC9 · AC10)', () => {
  it('AC7 · 약관 ✓ · 닉네임 ✓ · 취향 7축 전부 중립이면 c08(location)부터 잇는다', async () => {
    // 준비 — 닉네임까지 끝내고 취향은 하나도 저장 안 한 사용자(결정 ③).
    serve();

    // 실행 — 온보딩 그룹 진입 라우트를 그린다.
    renderWithQueryClient(<OnboardingIndex />);

    // 단언 — location 으로 딱 한 번.
    expect(await settledNavigations()).toEqual(['/(onboarding)/location']);
  });

  it.each<[string, PreferenceView]>([
    [
      '예산만 중립이 아님(예산은 6축 밖)',
      {
        ...NEUTRAL_PREFS,
        budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
      },
    ],
    ['축이 아예 없음(축 부재 = 미설정)', {}],
  ])(
    'AC7 · 취향이 %s 이면 저장 안 한 것으로 보고 location 으로 간다',
    async (_label, preferences) => {
      // 준비 — "N/6 설정됨"이 0/6 인 취향.
      serve({ preferences });

      // 실행
      renderWithQueryClient(<OnboardingIndex />);

      // 단언
      expect(await settledNavigations()).toEqual(['/(onboarding)/location']);
    }
  );

  it('AC8 · 약관 ✓ · 프로필 404(닉네임 없음)면 nickname 으로 간다', async () => {
    // 준비 — 404 는 실패가 아니라 "프로필 행 없음 = 닉네임 미설정".
    serve({ profile: 404 });

    // 실행
    renderWithQueryClient(<OnboardingIndex />);

    // 단언
    expect(await settledNavigations()).toEqual(['/(onboarding)/nickname']);
  });

  it.each<[string, ConsentRow[]]>([
    ['동의 기록이 하나도 없음', []],
    [
      '위치기반 약관이 응답에 없음',
      ALL_GRANTED.filter((row) => row.termsType !== 'LOCATION_TERMS'),
    ],
    [
      '개인정보 약관이 granted:false',
      ALL_GRANTED.map((row) =>
        row.termsType === 'PRIVACY_POLICY' ? { ...row, granted: false } : row
      ),
    ],
  ])(
    'AC9 · %s 이면 닉네임·취향이 다 됐어도 terms 로 간다',
    async (_label, consents) => {
      // 준비 — 약관만 미완, 나머지는 저장된 상태(약관 우선순위 확인).
      serve({
        consents,
        preferences: {
          ...NEUTRAL_PREFS,
          styles: { value: ['휴양'], isNeutralDefault: false },
        },
      });

      // 실행
      renderWithQueryClient(<OnboardingIndex />);

      // 단언
      expect(await settledNavigations()).toEqual(['/(onboarding)/terms']);
    }
  );

  it.each<[string, PreferenceView]>([
    [
      '스타일 축이 저장됨',
      {
        ...NEUTRAL_PREFS,
        styles: { value: ['휴양'], isNeutralDefault: false },
      },
    ],
    [
      '페이스 축만 저장됨',
      {
        ...NEUTRAL_PREFS,
        pace: { value: '균형있게', isNeutralDefault: false },
      },
    ],
    [
      '동행이 반려동물만 저장됨(petFlag)',
      {
        ...NEUTRAL_PREFS,
        companion: {
          companionTypes: [],
          petFlag: true,
          isNeutralDefault: false,
        },
      },
    ],
  ])(
    'AC10 · 약관 ✓ · 닉네임 ✓ · %s 인데 서버가 미완이면 홈(/)이 아니라 pref2 로 보내 완료를 다시 시도하게 한다',
    async (_label, preferences) => {
      // 준비 — 취향까지 다 저장했지만 완료 호출이 서버에 안 닿은 사용자.
      serve({ preferences });

      // 실행
      renderWithQueryClient(<OnboardingIndex />);

      // 단언 — pref2 한 번. '/'는 온보딩 index 로 되풀려 루프가 된다(맹점 ①).
      const navigations = await settledNavigations();
      expect(navigations).toEqual(['/(onboarding)/pref2']);
      expect(navigations).not.toContain('/');
    }
  );
});

describe('진입 판정 — GET 실패는 그 축을 "미완"으로 접는다 (AC11)', () => {
  it.each<[string, string, Partial<ServerState>]>([
    [
      '약관 GET 네트워크 오류',
      '/(onboarding)/terms',
      { consents: 'network-error' },
    ],
    ['프로필 GET 500', '/(onboarding)/nickname', { profile: 500 }],
    [
      '프로필 GET 네트워크 오류',
      '/(onboarding)/nickname',
      { profile: 'network-error' },
    ],
    ['취향 GET 500', '/(onboarding)/location', { preferences: 500 }],
  ])(
    '%s 면 막다른 화면 없이 %s 로 한 번 보낸다',
    async (_label, expected, overrides) => {
      // 준비 — 나머지 축은 다 된 상태에서 한 축만 실패시킨다(취향은 저장됨).
      serve({
        preferences: {
          ...NEUTRAL_PREFS,
          styles: { value: ['휴양'], isNeutralDefault: false },
        },
        ...overrides,
      });

      // 실행
      renderWithQueryClient(<OnboardingIndex />);

      // 단언
      expect(await settledNavigations()).toEqual([expected]);
    }
  );
});

describe('진입 판정 — 응답 도착 전엔 아무것도 안 하고, 이번 마운트의 응답으로만 보낸다 (AC12)', () => {
  it('세 응답이 다 오기 전엔 그리지도 보내지도 않고, 다 온 뒤 정확히 한 번 보낸다', async () => {
    // 준비 — 약관 응답만 붙잡아 둔다(프로필·취향은 먼저 도착).
    let releaseConsents!: () => void;
    const consentsHeld = new Promise<void>((resolve) => {
      releaseConsents = resolve;
    });
    serve();
    server.use(
      http.get(`${BASE}/me/consents`, async () => {
        await consentsHeld;
        return HttpResponse.json(ALL_GRANTED);
      })
    );

    // 실행 ① — 그린다.
    renderWithQueryClient(<OnboardingIndex />);
    await settle();

    // 단언 ① — 일부만 도착한 상태로 판정하지 않는다(terms 한 프레임 번쩍임 금지) + 빈 화면(Q4).
    expect(mockNavigations).toEqual([]);
    expect(screen.toJSON()).toBeNull();

    // 실행 ② — 약관 응답을 놓아준다.
    await act(async () => {
      releaseConsents();
    });

    // 단언 ② — 이제 정확히 한 번.
    expect(await settledNavigations()).toEqual(['/(onboarding)/location']);
  });

  it('30초 캐시(앱 전역 staleTime)에 남은 옛 응답이 아니라 다시 마운트한 뒤 받은 응답으로 보낸다', async () => {
    // 준비 — 앱과 같은 staleTime 을 가진 클라이언트를 두 마운트가 공유한다(02a ★3).
    const client = newTestQueryClient({ staleTime: 30_000 });
    serve({ consents: [] });
    const first = renderWithQueryClient(<OnboardingIndex />, client);
    // 앵커 — 1차 마운트는 그때 서버 상태(약관 0건)대로 terms 로 갔다.
    expect(await settledNavigations()).toEqual(['/(onboarding)/terms']);
    first.unmount();

    // 서버 상태가 바뀐다 — 사용자가 약관·닉네임을 마쳤다.
    server.resetHandlers();
    serve();
    mockNavigations.length = 0;

    // 실행 — 30초 안에 같은 클라이언트로 다시 마운트.
    renderWithQueryClient(<OnboardingIndex />, client);

    // 단언 — 캐시의 "약관 0건"으로 terms 를 한 번이라도 보내면 안 된다.
    expect(await settledNavigations()).toEqual(['/(onboarding)/location']);
  });
});
