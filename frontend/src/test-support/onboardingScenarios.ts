/**
 * 온보딩 목 시나리오 — **테스트 전용 모듈**(앱 번들 밖).
 *
 * 왜 `src/mocks/scenarios.ts` 가 아니라 여기인가:
 * `src/mocks/scenarios.ts` 는 프로덕션 코드(`features/auth/lib/makeAuthorize.ts`)가 참조하고 있어
 * **앱 정적 그래프 안에 있다.** 거기에 온보딩 목 거동을 얹으면 테스트 전용 데이터가 앱 번들로 실린다
 * (직전 사이클 `20260721-trip161-mock-removal` 의 "목을 앱에서 뺀다" 결정 위배).
 * `src/test-support/` 는 이미 테스트 전용 더블만 두는 자리이고 어떤 프로덕션 파일도 참조하지 않는다.
 * 이 모듈을 읽는 곳은 MSW 핸들러(`src/mocks/handlers.ts` — 테스트 오라클 전용)와 통합테스트뿐이다.
 * 그 계약은 `src/__tests__/noMswInStaticGraph.test.ts` 가 기계적으로 강제한다.
 *
 * 로그인 시나리오(`src/mocks/scenarios.ts` 10종)와 **독립된 상태**다 — 온보딩 통합테스트는
 * 로그인 시나리오를 건드리지 않고 온보딩 거동만 갈아끼운다.
 */

/** POST /me/consents 거동 (TRIP-162 · AC A7·A8) */
export type ConsentBehavior =
  | 'ok' // 200 반영 완료
  | 'server-error'; // 500 — 다음 단계로 넘어가면 안 된다(INV-4)

/**
 * 닉네임 계열 거동 (TRIP-162 · AC B1·B5·B6·B8·B9).
 * 금칙어(banned-word)·중복(taken) 판정은 **서버 권한**이라 시나리오로만 주입한다 —
 * 클라이언트에는 같은 규칙을 심지 않는다(루트 CLAUDE.md).
 */
export type NicknameBehavior =
  | 'ok' // check: available, PATCH: 200
  | 'taken' // check: {available:false, reason:'TAKEN'}
  | 'banned-word' // check: {available:false, reason:'BANNED_WORD'}
  | 'save-failed'; // PATCH: 500 — complete 를 불러선 안 된다

export interface OnboardingScenario {
  key: string;
  label: string;
  consent: ConsentBehavior;
  nickname: NicknameBehavior;
}

export const ONBOARDING_SCENARIOS = {
  'onboarding-happy': {
    key: 'onboarding-happy',
    label: '온보딩: 약관·닉네임 정상 통과',
    consent: 'ok',
    nickname: 'ok',
  },
  'onboarding-consent-error': {
    key: 'onboarding-consent-error',
    label: '온보딩: 동의 저장 서버 오류(500)',
    consent: 'server-error',
    nickname: 'ok',
  },
  'onboarding-nickname-taken': {
    key: 'onboarding-nickname-taken',
    label: '온보딩: 닉네임 중복(TAKEN)',
    consent: 'ok',
    nickname: 'taken',
  },
  'onboarding-nickname-banned': {
    key: 'onboarding-nickname-banned',
    label: '온보딩: 닉네임 금칙어(BANNED_WORD)',
    consent: 'ok',
    nickname: 'banned-word',
  },
  'onboarding-nickname-save-failed': {
    key: 'onboarding-nickname-save-failed',
    label: '온보딩: 닉네임 저장 실패(500)',
    consent: 'ok',
    nickname: 'save-failed',
  },
} satisfies Record<string, OnboardingScenario>;

export type OnboardingScenarioKey = keyof typeof ONBOARDING_SCENARIOS;

const DEFAULT_KEY: OnboardingScenarioKey = 'onboarding-happy';

let activeKey: OnboardingScenarioKey = DEFAULT_KEY;

export function setOnboardingScenario(key: OnboardingScenarioKey): void {
  activeKey = key;
}

export function getOnboardingScenario(): OnboardingScenario {
  return ONBOARDING_SCENARIOS[activeKey];
}

export function resetOnboardingScenario(): void {
  activeKey = DEFAULT_KEY;
}
