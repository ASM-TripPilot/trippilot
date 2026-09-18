/**
 * @react-native-seoul/kakao-login · naver-login 의 테스트용 목(네이티브 대체) + 관찰 스파이.
 *
 * 두 패키지는 (1) 아직 미설치이고 (2) 네이티브 모듈이라 jest 에서 실로드할 수 없다. 각 테스트가
 * `jest.mock('@react-native-seoul/kakao-login', () => require(...).kakaoLoginModule,
 * { virtual: true })` 로 등록한다 — `virtual: true` 는 "실제로 없는 모듈"을 목킹할 수 있게 해준다
 * (expoAuthSessionMock 과 같은 "모듈 스코프 목 + require 팩토리" 패턴).
 *
 * ⚠️ 팩토리가 바깥 변수를 참조하면 jest 가 거부한다("module factory ... not allowed to reference
 * any out-of-scope variables"). 그래서 스파이를 이 파일에 두고 팩토리는 require 로만 가져온다 —
 * 테스트도 같은 경로로 import 하므로 레지스트리에서 동일 인스턴스가 된다.
 *
 * 목이 실 SDK 에 닿는 경로: 어댑터가 SDK 를 **정적** import 하고(→ babel 이 require 로 바꾼다 →
 * 레지스트리 → 이 목), makeAuthorize 가 그 어댑터를 **동적** import 한다. 테스트 파일에서
 * `await import('@react-native-seoul/...')` 를 직접 부르면 레지스트리를 우회해 실패한다.
 *
 * import 형태 3종(default · named 네임스페이스 · named 함수)을 모두 받도록 top-level 키와
 * 네임스페이스 키를 함께 둔다 — 어댑터가 어떤 형태로 가져가든 같은 스파이에 닿는다.
 *
 * 이 파일은 실 패키지를 import 하지 않으므로 tsc 가 미설치 모듈을 만나지 않는다.
 */

/** 카카오 `login()` 스파이. 성공은 mockResolvedValue, 취소·실패는 mockRejectedValue 로 준다. */
export const kakaoLoginSpy = jest.fn();

/** 네이버 `login()` 스파이. 취소도 **resolve** 로 온다({ isSuccess:false, failureResponse }). */
export const naverLoginSpy = jest.fn();

/**
 * 네이버 `initialize()` 스파이 — consumerKey/consumerSecret 이 env 에서 오는지 관찰한다.
 * ⚠️ resetNativeSocialSdkMock 이 이 스파이는 **지우지 않는다**: 어댑터가 초기화를 모듈 스코프에서
 * 한 번만 부르는(메모이즈) 구현일 수 있어, 매번 지우면 단언이 테스트 실행 순서에 좌우된다.
 */
export const naverInitializeSpy = jest.fn();

export const kakaoLogoutSpy = jest.fn();

/** jest.mock('@react-native-seoul/kakao-login', …) 이 반환할 shape. */
export const kakaoLoginModule = {
  login: kakaoLoginSpy,
  logout: kakaoLogoutSpy,
  initializeKakaoSDK: jest.fn(),
};

/** jest.mock('@react-native-seoul/naver-login', …) 이 반환할 shape. */
export const naverLoginModule = {
  login: naverLoginSpy,
  initialize: naverInitializeSpy,
  NaverLogin: {
    login: naverLoginSpy,
    initialize: naverInitializeSpy,
  },
};

/** 로그인 스파이의 호출 기록·주입값을 되돌린다(테스트 간 격리). initialize 는 위 사유로 제외. */
export function resetNativeSocialSdkMock(): void {
  kakaoLoginSpy.mockReset();
  naverLoginSpy.mockReset();
  kakaoLogoutSpy.mockReset();
}
