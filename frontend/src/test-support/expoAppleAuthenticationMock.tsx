/**
 * expo-apple-authentication 의 테스트용 목(네이티브 대체) + 관찰 스파이 (TRIP-932).
 *
 * 각 테스트가 `jest.mock('expo-apple-authentication', () =>
 * require('@/test-support/expoAppleAuthenticationMock').expoAppleAuthenticationModule)` 로 건다.
 * 패키지가 설치돼 있으므로 `virtual: true` 는 필요 없다.
 *
 * 왜 별도 목이 필요한가: jest-expo 가 네이티브 모듈을 자동 목으로 두지만 그 함수들은 값을
 * 돌려주지 않는다 — `isAvailableAsync()` 가 undefined 가 되어 애플 버튼이 조용히 숨고,
 * `signInAsync` 는 빈 credential 로 실패한다.
 *
 * enum 은 패키지의 진짜 값을 그대로 싣는다(`AppleAuthenticationScope.EMAIL === 1` 등). 목이
 * enum 을 지어내면 구현과 테스트가 같은 가짜를 봐서 단언이 동어반복이 된다. types 파일은 순수
 * enum 이라 네이티브를 부르지 않는다.
 *
 * 팩토리가 바깥 변수를 참조하면 jest 가 거부하므로 스파이를 이 파일에 두고, 테스트도 같은
 * 경로로 import 해 레지스트리에서 같은 인스턴스를 공유한다(nativeSocialSdkMock 과 같은 패턴).
 */

/** `signInAsync(options)` 스파이. 성공은 mockResolvedValue, 취소·실패는 mockRejectedValue. */
export const appleSignInAsyncSpy = jest.fn();

/** `isAvailableAsync()` 스파이. true/false/대기/reject 를 테스트가 주입한다. */
export const appleIsAvailableAsyncSpy = jest.fn();

/**
 * jest.mock('expo-apple-authentication', …) 이 반환할 shape.
 *
 * 시스템 버튼(`AppleAuthenticationButton`)의 대역은 일부러 싣지 않는다(TRIP-1124) — 애플 버튼은
 * 직접 그린 커스텀 버튼이라, 구현이 시스템 버튼으로 되돌아가면 undefined 엘리먼트로 렌더가 터져
 * LoginPage.apple.test.tsx 가 빨개진다.
 */
export const expoAppleAuthenticationModule = {
  __esModule: true,
  ...jest.requireActual(
    'expo-apple-authentication/build/AppleAuthentication.types'
  ),
  signInAsync: appleSignInAsyncSpy,
  isAvailableAsync: appleIsAvailableAsyncSpy,
};

/** 스파이의 호출 기록·주입값을 되돌린다(테스트 간 격리). */
export function resetExpoAppleAuthenticationMock(): void {
  appleSignInAsyncSpy.mockReset();
  appleIsAvailableAsyncSpy.mockReset();
}
