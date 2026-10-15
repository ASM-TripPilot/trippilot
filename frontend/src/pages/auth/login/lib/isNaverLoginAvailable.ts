/**
 * 네이버 로그인 버튼을 보여도 되는가(TRIP-1371).
 *
 * 서버가 네이버 code 교환(`POST /auth/social/naver`)을 501 `PROVIDER_NOT_SUPPORTED` 로 닫았다
 * (#1072 — 네이버는 PKCE 가 없어 가로챈 code 를 막을 수 없다). 남은 길은 SDK 토큰 경로뿐이고,
 * 그 키(`EXPO_PUBLIC_NAVER_URL_SCHEME`)가 없는 빌드에서는 누를 수 있는 로그인이 없으므로 버튼을 숨긴다.
 * dev fake 인가는 SDK 를 타지 않는 개발용 가짜 결과라 항상 보인다.
 *
 * makeAuthorize 의 `resolveRoute` 가 이 함수를 그대로 쓴다(둘이 갈라지면 버튼은 보이는데 누르면 throw).
 * 순수 env 읽기라 정적 import 해도 SDK 그래프에 닿지 않는다.
 */
export function isNaverLoginAvailable(): boolean {
  const fake = process.env.EXPO_PUBLIC_AUTH_FAKE;
  if (fake === '1' || fake === 'true') {
    return true;
  }
  return Boolean(process.env.EXPO_PUBLIC_NAVER_URL_SCHEME);
}
