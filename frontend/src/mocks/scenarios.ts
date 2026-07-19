import type { SocialProvider } from '@/shared/api';

/**
 * Mock 시나리오 정의 + 활성 시나리오 상태(테스트 인프라).
 *
 * 한 시나리오가 "가짜 OAuth 결과(auth)"·"소셜 서버 응답(social)"·"부트스트랩 응답(bootstrap)"을
 * 함께 규정한다 → dev 시나리오 스위처(구현자)와 통합테스트가 같은 정의를 공유한다.
 * MSW 핸들러는 getScenario() 로 서버 응답을, makeAuthorize(구현자)는 auth 로 가짜 인가 결과를 읽는다.
 * 이 모듈은 msw 를 import 하지 않는다(순수 상태) — flag 켠 유닛 테스트도 안전하게 참조한다.
 */

export type AuthOutcome = 'success' | 'cancel' | 'dismiss';

export type SocialServerBehavior =
  | 'new-user' // 신규 판정(isNewUser=true) → needs-age
  | 'existing-user' // 기존(isNewUser=false) → success
  | 'auth-failed' // 401 SOCIAL_AUTH_FAILED
  | 'email-conflict' // 409 SOCIAL_EMAIL_CONFLICT + existingProvider
  | 'rate-limited' // 429 RATE_LIMITED
  | 'age-restricted'; // 신규 → 연령확인 재전송 시 422 AGE_NOT_MET

export type BootstrapBehavior =
  | 'guest' // GUEST → LOGIN
  | 'authenticated' // AUTHENTICATED → HOME
  | 'onboarding' // ONBOARDING_INCOMPLETE → ONBOARDING
  | 'reconsent' // reconsent.required → RECONSENT
  | 'force-update'; // appUpdate FORCED → FORCE_UPDATE

export interface MockScenario {
  key: string;
  label: string;
  auth: AuthOutcome;
  social: SocialServerBehavior;
  bootstrap: BootstrapBehavior;
  existingProvider: SocialProvider | null;
}

export const SCENARIOS = {
  'login-success-existing': {
    key: 'login-success-existing',
    label: '로그인 성공(기존 계정)',
    auth: 'success',
    social: 'existing-user',
    bootstrap: 'authenticated',
    existingProvider: null,
  },
  'login-success-new': {
    key: 'login-success-new',
    label: '로그인 성공(신규 → 연령확인)',
    auth: 'success',
    social: 'new-user',
    bootstrap: 'onboarding',
    existingProvider: null,
  },
  'login-cancel': {
    key: 'login-cancel',
    label: '로그인 취소(cancel)',
    auth: 'cancel',
    social: 'existing-user',
    bootstrap: 'guest',
    existingProvider: null,
  },
  'login-dismiss': {
    key: 'login-dismiss',
    label: '로그인 창 dismiss',
    auth: 'dismiss',
    social: 'existing-user',
    bootstrap: 'guest',
    existingProvider: null,
  },
  'login-error-auth': {
    key: 'login-error-auth',
    label: '소셜 인증 실패(401)',
    auth: 'success',
    social: 'auth-failed',
    bootstrap: 'guest',
    existingProvider: null,
  },
  'login-rate-limited': {
    key: 'login-rate-limited',
    label: '요청 과다(429)',
    auth: 'success',
    social: 'rate-limited',
    bootstrap: 'guest',
    existingProvider: null,
  },
  'login-email-conflict': {
    key: 'login-email-conflict',
    label: '이메일 충돌(409, 기존 provider=kakao)',
    auth: 'success',
    social: 'email-conflict',
    bootstrap: 'guest',
    existingProvider: 'kakao',
  },
  'login-age-restricted': {
    key: 'login-age-restricted',
    label: '연령 미달(422)',
    auth: 'success',
    social: 'age-restricted',
    bootstrap: 'guest',
    existingProvider: null,
  },
  'bootstrap-force-update': {
    key: 'bootstrap-force-update',
    label: '부트스트랩: 강제 업데이트',
    auth: 'success',
    social: 'existing-user',
    bootstrap: 'force-update',
    existingProvider: null,
  },
  'bootstrap-reconsent': {
    key: 'bootstrap-reconsent',
    label: '부트스트랩: 재동의',
    auth: 'success',
    social: 'existing-user',
    bootstrap: 'reconsent',
    existingProvider: null,
  },
} satisfies Record<string, MockScenario>;

export type ScenarioKey = keyof typeof SCENARIOS;

const DEFAULT_KEY: ScenarioKey = 'login-success-existing';

let activeKey: ScenarioKey = DEFAULT_KEY;

export function setScenario(key: ScenarioKey): void {
  activeKey = key;
}

export function getScenario(): MockScenario {
  return SCENARIOS[activeKey];
}

export function getActiveScenarioKey(): ScenarioKey {
  return activeKey;
}

export function resetScenario(): void {
  activeKey = DEFAULT_KEY;
}

export const SCENARIO_LIST: MockScenario[] = Object.values(SCENARIOS);
