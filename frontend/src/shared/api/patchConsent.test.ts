// mutator 의 인증 계층이 expo-secure-store 를 정적으로 물어(=@/shared/storage), 목 없이 실물을
// 로드하면 테스트가 죽는다. auto-mock 으로 그 로드를 끊는다(TRIP-610 ★E, patchConsent 는 storage 미사용).
jest.mock('@/shared/storage');

import * as api from '@/shared/api';

/**
 * TRIP-612 · patchConsent 와이어 body 계약(AC-7) — D5 드리프트 잠금.
 *
 * 무엇을 보장하나:
 *  - `PATCH /me/consents/{termsType}` — termsType 은 **URL 경로**에만 들어간다.
 *  - body 는 **`{action, termsVersion}` 두 필드만**. 티켓 서술의 `{termsType, ...}` body 는 틀렸고
 *    (openapi 승, §5-C) body 에 termsType 이 실리면 계약 위반이라 red 여야 한다.
 *
 * 왜 이 층인가: 페이지 통합테스트(T3)는 patchConsent 를 목으로 두고 **호출 인자**만 잠근다 — body 형태는
 *  실 함수를 태워야 보인다. 여기선 export 된 axios 인스턴스 `authedClient.patch` 를 스파이로 바꿔
 *  실 HTTP 없이 (URL, body) 인자를 관측한다(§5-F).
 *
 * (개념) `jest.spyOn(obj,'m').mockResolvedValue(v)`: 메서드 m 을 v 로 resolve 하는 가짜로 교체.
 *  `toHaveBeenCalledWith(...)`: 인자 깊은 동등 비교(2번째 인자에 여분 키가 있으면 실패).
 */

describe('TRIP-612 · patchConsent — 와이어 body(AC-7)', () => {
  it('GRANT: termsType 은 경로, body 는 {action, termsVersion} 두 필드만', async () => {
    // 준비: authedClient.patch 를 스파이로 교체(실 HTTP 미발생, 200 흉내).
    const patchSpy = jest
      .spyOn(api.authedClient, 'patch')
      .mockResolvedValue({ data: undefined });

    // 실행.
    await api.patchConsent('PERSONALIZATION', 'v9', 'GRANT');

    // 단언: URL 에 termsType, body 는 정확히 2필드.
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith('/me/consents/PERSONALIZATION', {
      action: 'GRANT',
      termsVersion: 'v9',
    });
    // 급소: body 에 termsType 잉여가 없다(D5 — 실리면 계약 위반).
    expect(patchSpy.mock.calls[0][1]).not.toHaveProperty('termsType');

    patchSpy.mockRestore();
  });

  it('REVOKE 짝: 같은 body 형태로 action 만 바뀐다', async () => {
    const patchSpy = jest
      .spyOn(api.authedClient, 'patch')
      .mockResolvedValue({ data: undefined });

    await api.patchConsent('PERSONALIZATION', 'v9', 'REVOKE');

    expect(patchSpy).toHaveBeenCalledWith('/me/consents/PERSONALIZATION', {
      action: 'REVOKE',
      termsVersion: 'v9',
    });

    patchSpy.mockRestore();
  });
});
