import { login } from '@react-native-seoul/kakao-login';

import type { AuthorizeResult } from '../model/useSocialLogin';

/**
 * 카카오 네이티브 SDK 인가 어댑터(TRIP-210 · AC-1 · AC-5). `login()`이 성공하면 accessToken만
 * 뽑아 `success-token`으로 정규화한다(refreshToken·idToken 등 여분은 서버로 새지 않는다 ·
 * SEC-AUTH). 이 파일만 카카오 SDK를 **정적** import한다 — makeAuthorize.ts가 이 파일을
 * `await import`로 지연 로드해서만 닿으므로, SDK가 앱 부팅 정적 그래프에 실리지 않는다
 * (AC-11 · Hermes 부팅 크래시 이력).
 *
 * ⚠️ 카카오 SDK는 취소와 진짜 실패를 **같은 reject 채널**로 보낸다 — 에러 코드는 항상
 * "RNKakaoLogins" 하나이고, 구분 정보는 message 고정 포맷(`describe()`)에만 있다. 사용자
 * 취소는 `ClientFailed(Cancelled): …` **접두어**로 실려 온다(SDK 소스 실측:
 * RNKakaoLogins.swift:85-118) — 판별은 이 접두어 위치만 본다. 콜론 뒤 `<msg>`는 카카오
 * 서버가 주는 **자유 문장**이라 `Cancelled`라는 낱말이 취소 아닌 에러 설명에도 섞여 들어올 수
 * 있으므로(예: `ApiFailed(Unknown): upstream request Cancelled by server`), 문자열 전체가
 * 아니라 접두어 포맷만 매칭한다. 그 외 reject(`ApiFailed`·`ClientFailed(TokenNotFound)` 등)는
 * 취소가 아니므로 그대로 다시 던져 INV-4(침묵 실패 금지)를 지킨다.
 *
 * 이 판별은 **iOS의 describe() 포맷 실측**에만 근거한다. Android(RNKakaoLoginsModule.kt)는
 * reject 호출 형태(`promise.reject("RNKakaoLogins", error.message, error)`)만 동형이고,
 * message 자체는 Kakao Android SDK가 만드는 원문을 그대로 넘겨 **포맷이 다르다** — 이 판별로
 * 덮이는지 미검증이다(실기 확인 전까지 Android 취소 판별은 별도 확인 필요).
 *
 * ponytail: 이 판별은 SDK가 만드는 message 접두어 문자열 매칭이다 — SDK가 describe() 포맷을
 * 바꾸면 조용히 깨진다(취소가 실패로 뜨거나 그 반대). 타입 있는 취소 신호가 SDK API에 없어
 * 현재로선 이것이 최선이고, 마지막 그물은 iOS dev build 실기 확인이다. SDK 업그레이드 시
 * RNKakaoLogins.swift의 describe()·Cancelled 판정을 다시 실측할 것.
 */
export async function kakaoAuthorize(): Promise<AuthorizeResult> {
  try {
    const token = await login();
    return { type: 'success-token', accessToken: token.accessToken };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 콜론 뒤 자유 문장이 아니라 접두어 포맷(`ClientFailed(Cancelled)`)만 취소로 본다.
    if (message.startsWith('ClientFailed(Cancelled)')) {
      return { type: 'cancel' };
    }
    throw error;
  }
}
