import { AxiosError } from 'axios';

import { isNotFound } from './isNotFound';

/**
 * 404 판정 — **"없다"와 "모른다"를 가르는 관문**(TRIP-297 · 01b D8).
 *
 * 왜 이 함수에 심판이 필요한가: 이 판정이 틀리는 쪽으로 기울면 **되돌릴 수 없는 손실**이
 * 난다. h11 재생성은 확정된 일정에 보내면 확정이 풀리고 동결됐던 `poi_snapshot` 참조가
 * 사라지는데(확정 해제 API 가 없다), 조회가 실패해 상태를 모를 때 이 함수가 잘못 `true` 를
 * 내면 그 POST 가 그대로 나간다. 즉 **404 하나만 통과시키는 것**이 계약의 전부다.
 *
 * 가장 중요한 케이스는 아래 "응답이 아예 없는" 것들이다 — 네트워크가 끊기거나 타임아웃이면
 * 서버가 무엇을 갖고 있는지 알 길이 없고, 그때 안전한 답은 "없다"가 아니라 "모른다"다.
 *
 * 3동작 뼈대: 준비=오류 객체를 만든다 → 실행=판정 → 단언=참/거짓.
 * (형태는 같은 디렉토리의 `isAlreadyRegistered.test.ts` 선례를 그대로 따랐다.)
 */

/** `isAxiosError` 가 true 여야 판정이 도는 경로를 탄다(`isAlreadyRegistered.test.ts` 선례). */
function httpError(status: number): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

/** 응답 없이 코드만 있는 오류 — 네트워크 끊김·타임아웃·취소가 이 모양이다. */
function transportError(code: string): AxiosError {
  return new AxiosError('transport failed', code);
}

describe('404 만 "아직 없다" 로 읽는다 (TRIP-297)', () => {
  it('404 는 true 다 (긍정 앵커)', () => {
    // 서버가 "그건 없다"고 **분명히 답한** 유일한 경우다 — 만들어도 안전하고, 이 길이
    // 막히면 일정이 없는 사용자가 생성을 시작할 방법이 사라진다.
    expect(isNotFound(httpError(404))).toBe(true);
  });

  it('다른 상태 코드는 false 다 — 확정 일정일 수도 있다', () => {
    expect(isNotFound(httpError(500))).toBe(false);
    expect(isNotFound(httpError(503))).toBe(false);
    expect(isNotFound(httpError(401))).toBe(false);
    expect(isNotFound(httpError(400))).toBe(false);
    // 409 는 옆 판정(`isAlreadyRegistered`)의 몫이다 — 둘이 서로 침범하지 않는다.
    expect(isNotFound(httpError(409))).toBe(false);
  });

  it('🔴 응답이 아예 없는 오류는 false 다 — 이게 이 함수의 급소다', () => {
    // 네트워크가 죽으면 `response` 자체가 없다. `error.response?.status` 가 `undefined` 를
    // 내고 `=== 404` 가 거짓이 되어 막힌다 — 여기서 true 가 나오면 확정 일정에 재생성
    // POST 가 나간다.
    expect(isNotFound(new AxiosError('Network Error'))).toBe(false);
    expect(isNotFound(transportError('ERR_NETWORK'))).toBe(false);
    expect(isNotFound(transportError('ECONNABORTED'))).toBe(false); // 타임아웃
    expect(isNotFound(transportError('ERR_CANCELED'))).toBe(false); // 취소
  });

  it('axios 오류가 아닌 것은 false 다', () => {
    expect(isNotFound(new Error('boom'))).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
    expect(isNotFound(null)).toBe(false);
    // 모양만 흉내 낸 평범한 객체가 통과하면 판정이 타입 검사가 아니라 오리 검사가 된다.
    expect(isNotFound({ response: { status: 404 } })).toBe(false);
  });
});
