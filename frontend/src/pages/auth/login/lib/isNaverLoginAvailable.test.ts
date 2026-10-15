import { sandboxEnv } from '@/test-support/envSandbox';

import { isNaverLoginAvailable } from './isNaverLoginAvailable';

/**
 * TRIP-1371 — 네이버 버튼 노출 판정. 서버가 네이버 code 경로를 닫았으므로(#1072) 네이버는 SDK
 * 토큰 경로뿐이다. SDK 키(URL 스킴)가 없는 빌드에는 버튼 자체를 두지 않는다.
 * 3동작: 준비(env) → 실행(판정) → 단언(불리언).
 */
sandboxEnv(['EXPO_PUBLIC_AUTH_FAKE', 'EXPO_PUBLIC_NAVER_URL_SCHEME']);

describe('isNaverLoginAvailable', () => {
  it('실 빌드 · URL 스킴 없음 → 숨긴다', () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '';
    process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = '';

    expect(isNaverLoginAvailable()).toBe(false);
  });

  it('실 빌드 · URL 스킴 있음 → 보인다(SDK 토큰 경로)', () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '';
    process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = 'trippilot-naver';

    expect(isNaverLoginAvailable()).toBe(true);
  });

  it('dev fake 인가 → 스킴이 없어도 보인다(fake 는 개발용 가짜 인가)', () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '1';
    process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = '';

    expect(isNaverLoginAvailable()).toBe(true);
  });
});
