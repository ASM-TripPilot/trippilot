import fc from 'fast-check';

import {
  resolveBootstrapDestination,
  type BootstrapDestination,
  type BootstrapResponse,
} from './resolveBootstrapDestination';

const DESTINATIONS: BootstrapDestination[] = [
  'FORCE_UPDATE',
  'RECONSENT',
  'LOGIN',
  'ONBOARDING',
  'HOME',
];

type AppUpdateStatus = 'FORCED' | 'RECOMMENDED' | 'NONE';
type SessionState = 'AUTHENTICATED' | 'GUEST' | 'ONBOARDING_INCOMPLETE';

function makeBootstrap(overrides: {
  appUpdate?: AppUpdateStatus;
  reconsent?: boolean;
  session?: SessionState;
  onboardingCompleted?: boolean;
}): BootstrapResponse {
  return {
    appUpdate: {
      status: overrides.appUpdate ?? 'NONE',
      minSupportedVersion: '1.0.0',
    },
    reconsent: {
      required: overrides.reconsent ?? false,
      termsTypes: [],
    },
    session: {
      state: overrides.session ?? 'GUEST',
      onboardingCompleted: overrides.onboardingCompleted ?? false,
    },
  };
}

const appUpdateStatusArb = fc.constantFrom<AppUpdateStatus>(
  'FORCED',
  'RECOMMENDED',
  'NONE'
);
const sessionStateArb = fc.constantFrom<SessionState>(
  'AUTHENTICATED',
  'GUEST',
  'ONBOARDING_INCOMPLETE'
);

const bootstrapArb: fc.Arbitrary<BootstrapResponse> = fc.record({
  appUpdate: fc.record({
    status: appUpdateStatusArb,
    minSupportedVersion: fc.constant('1.0.0'),
  }),
  reconsent: fc.record({
    required: fc.boolean(),
    termsTypes: fc.constant([] as string[]),
  }),
  session: fc.record({
    state: sessionStateArb,
    onboardingCompleted: fc.boolean(),
  }),
});

describe('resolveBootstrapDestination — 예제 분기 (AC-SHELL-01-1~5)', () => {
  it('AUTHENTICATED + onboardingCompleted + 업데이트/재동의 없음 → HOME (AC-SHELL-01-1)', () => {
    const dest = resolveBootstrapDestination(
      makeBootstrap({
        appUpdate: 'NONE',
        reconsent: false,
        session: 'AUTHENTICATED',
        onboardingCompleted: true,
      }),
      true
    );
    expect(dest).toBe('HOME');
  });

  it('session.state=GUEST(무토큰) → LOGIN (AC-SHELL-01-2)', () => {
    const dest = resolveBootstrapDestination(
      makeBootstrap({ session: 'GUEST' }),
      false
    );
    expect(dest).toBe('LOGIN');
  });

  it('session.state=ONBOARDING_INCOMPLETE → ONBOARDING (AC-SHELL-01-3)', () => {
    const dest = resolveBootstrapDestination(
      makeBootstrap({ session: 'ONBOARDING_INCOMPLETE' }),
      true
    );
    expect(dest).toBe('ONBOARDING');
  });

  it('appUpdate=FORCED 는 재동의·세션보다 우선한다 → FORCE_UPDATE (AC-SHELL-01-4)', () => {
    const dest = resolveBootstrapDestination(
      makeBootstrap({
        appUpdate: 'FORCED',
        reconsent: true,
        session: 'AUTHENTICATED',
        onboardingCompleted: true,
      }),
      true
    );
    expect(dest).toBe('FORCE_UPDATE');
  });

  it('FORCED 아님 + reconsent.required 는 세션 분기보다 우선한다 → RECONSENT (AC-SHELL-01-5)', () => {
    const recommended = resolveBootstrapDestination(
      makeBootstrap({
        appUpdate: 'RECOMMENDED',
        reconsent: true,
        session: 'AUTHENTICATED',
        onboardingCompleted: true,
      }),
      true
    );
    const none = resolveBootstrapDestination(
      makeBootstrap({
        appUpdate: 'NONE',
        reconsent: true,
        session: 'AUTHENTICATED',
        onboardingCompleted: true,
      }),
      true
    );
    expect(recommended).toBe('RECONSENT');
    expect(none).toBe('RECONSENT');
  });
});

describe('resolveBootstrapDestination — 성질/PBT (AC-SHELL-01-6)', () => {
  it('임의 입력에 대해 항상 5개 목적지 중 하나를 반환하고, 동일 입력 → 동일 출력(결정적·부수효과 없음)', () => {
    fc.assert(
      fc.property(bootstrapArb, fc.boolean(), (bootstrap, hasLocalToken) => {
        const first = resolveBootstrapDestination(bootstrap, hasLocalToken);
        const second = resolveBootstrapDestination(bootstrap, hasLocalToken);
        expect(DESTINATIONS).toContain(first);
        expect(second).toBe(first);
      }),
      { numRuns: 500 }
    );
  });

  it('불변식: appUpdate=FORCED 이면 다른 필드·토큰과 무관하게 항상 FORCE_UPDATE (강제 업데이트 최우선)', () => {
    fc.assert(
      fc.property(bootstrapArb, fc.boolean(), (bootstrap, hasLocalToken) => {
        const forced: BootstrapResponse = {
          ...bootstrap,
          appUpdate: { ...bootstrap.appUpdate, status: 'FORCED' },
        };
        expect(resolveBootstrapDestination(forced, hasLocalToken)).toBe(
          'FORCE_UPDATE'
        );
      }),
      { numRuns: 500 }
    );
  });

  it('불변식: FORCED 아님 + reconsent.required=true 이면 세션 상태와 무관하게 항상 RECONSENT (재동의 > 세션)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AppUpdateStatus>('RECOMMENDED', 'NONE'),
        sessionStateArb,
        fc.boolean(),
        fc.boolean(),
        (appUpdate, session, onboardingCompleted, hasLocalToken) => {
          const bootstrap = makeBootstrap({
            appUpdate,
            reconsent: true,
            session,
            onboardingCompleted,
          });
          expect(resolveBootstrapDestination(bootstrap, hasLocalToken)).toBe(
            'RECONSENT'
          );
        }
      ),
      { numRuns: 500 }
    );
  });
});
