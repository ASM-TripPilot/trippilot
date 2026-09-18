/**
 * expo-auth-session · expo-web-browser · expo-crypto 의 테스트용 목(네이티브 대체) + 관찰 스파이.
 *
 * 세 패키지는 (1) 아직 미설치이고 (2) 네이티브 모듈이라 jest 에서 실로드하면 크래시난다.
 * 실 authorize 경로(makeAuthorize 토글 off + config)가 lazy 로 이들을 부를 때 jest 가 이 목으로
 * 대체하도록, 각 테스트가 `jest.mock('expo-auth-session', () => require(...).expoAuthSessionModule,
 * { virtual: true })` 로 등록한다. `virtual: true` 는 "실제로 없는 모듈"을 목킹할 수 있게 해준다.
 *
 * 스파이·결과 주입 핸들을 목 shape 와 같은 파일에 두는 이유: 테스트도 이 파일을 `@/test-support/...`
 * 로 import 하므로 jest 모듈 레지스트리에서 같은 인스턴스가 되어, 팩토리가 반환하는 목과 테스트가
 * 관찰하는 스파이가 동일해진다(expoRouterStackMock 과 같은 "모듈 스코프 목 + require 팩토리" 패턴).
 *
 * 이 파일은 실 패키지를 import 하지 않으므로 tsc 가 미설치 모듈을 만나지 않는다(정적 import 부재).
 */

type MockPromptResult =
  | { type: 'success'; params: Record<string, string> }
  | { type: 'cancel' }
  | { type: 'dismiss' };

const DEFAULT_PROMPT_RESULT: MockPromptResult = {
  type: 'success',
  params: { code: 'mock-auth-code' },
};
const DEFAULT_CODE_VERIFIER = 'mock-code-verifier';

let currentPromptResult: MockPromptResult = DEFAULT_PROMPT_RESULT;
let currentCodeVerifier = DEFAULT_CODE_VERIFIER;

/** promptAsync(로그인 창) 호출을 관찰하는 스파이. 결과는 setPromptResult 로 주입한다. */
export const promptAsyncSpy = jest.fn(
  async (_discovery?: unknown): Promise<MockPromptResult> => currentPromptResult
);

/** AuthRequest 생성 인자를 관찰하는 스파이(usePKCE·clientId 계약 확인용). */
export const authRequestConstructorSpy = jest.fn();

/** makeRedirectUri 호출 스파이. REDIRECT_URI env 미설정 시 파생 경로 흉내. */
export const makeRedirectUriSpy = jest.fn(
  (_options?: unknown): string => 'trippilot://oauth/google'
);

/**
 * expo-auth-session 의 명령형 AuthRequest 흉내.
 * - 생성자: PKCE 옵션을 받고 codeVerifier 를 노출한다(setCodeVerifier 로 주입).
 * - promptAsync(discovery): 주입된 결과를 돌려준다.
 *
 * codeVerifier 는 usePKCE:false 일 때 undefined 다(02 §3-6 실측: 실 라이브러리
 * `node_modules/expo-auth-session/build/AuthRequest.js` 는 usePKCE 기본값이 true 이고,
 * PKCE 가 꺼지면 codeVerifier 를 만드는 ensureCodeIsSetupAsync 자체를 건너뛴다). 이전 목은
 * usePKCE 값과 무관하게 항상 문자열을 돌려줘서, naver 경로(PKCE 미지원)의 진짜 위험 —
 * 빈 codeVerifier 가 백엔드 @NotBlank 를 건드려 400 이 나는 상황 — 을 재현하지 못했다.
 */
class MockAuthRequest {
  readonly codeVerifier: string | undefined;

  constructor(config: Record<string, unknown>) {
    authRequestConstructorSpy(config);
    this.codeVerifier =
      config.usePKCE === false ? undefined : currentCodeVerifier;
  }

  async promptAsync(discovery?: unknown): Promise<MockPromptResult> {
    return promptAsyncSpy(discovery);
  }
}

/** jest.mock('expo-auth-session', () => (…).expoAuthSessionModule) 가 반환할 shape. */
export const expoAuthSessionModule = {
  AuthRequest: MockAuthRequest,
  makeRedirectUri: makeRedirectUriSpy,
  ResponseType: { Code: 'code' },
};

/** jest.mock('expo-web-browser', …) 용. maybeCompleteAuthSession 등 네이티브 진입점 흉내. */
export const expoWebBrowserModule = {
  maybeCompleteAuthSession: jest.fn(() => ({ type: 'success' })),
  openAuthSessionAsync: jest.fn(),
};

/** jest.mock('expo-crypto', …) 용. auth-session 의 PKCE 네이티브 의존 흉내. */
export const expoCryptoModule = {
  digestStringAsync: jest.fn(async (): Promise<string> => 'mock-digest'),
  getRandomBytesAsync: jest.fn(
    async (): Promise<Uint8Array> => new Uint8Array(32)
  ),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64URL: 'base64url', BASE64: 'base64' },
};

/** 다음 promptAsync 결과를 주입한다(success/cancel/dismiss). */
export function setPromptResult(result: MockPromptResult): void {
  currentPromptResult = result;
}

/** 다음 AuthRequest 인스턴스의 codeVerifier(PKCE) 값을 주입한다. */
export function setCodeVerifier(verifier: string): void {
  currentCodeVerifier = verifier;
}

/** 스파이 호출 기록과 주입값을 기본값으로 되돌린다(테스트 간 격리). */
export function resetExpoAuthSessionMock(): void {
  currentPromptResult = DEFAULT_PROMPT_RESULT;
  currentCodeVerifier = DEFAULT_CODE_VERIFIER;
  promptAsyncSpy.mockClear();
  authRequestConstructorSpy.mockClear();
  makeRedirectUriSpy.mockClear();
  expoWebBrowserModule.maybeCompleteAuthSession.mockClear();
  expoWebBrowserModule.openAuthSessionAsync.mockClear();
}
