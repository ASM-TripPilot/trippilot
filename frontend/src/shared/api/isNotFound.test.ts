import { AxiosError } from 'axios';

import { isNotFound, retryUnlessNotFound } from './isNotFound';

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

/**
 * TRIP-986 5-c(03b 경고-1) — 404 는 다시 물어도 답이 같다. 이 함수가 TanStack Query `retry` 자리에
 * 들어가 **앱 전역 기본값**(`app/_layout.tsx`)과 방식 선택(h04)이 함께 쓴다.
 *
 * *(개념)* `retry(failureCount, error)` — 요청이 실패할 때마다 TanStack 이 부르는 함수다.
 *   `failureCount` 는 "이미 몇 번 다시 물었나"(첫 실패 뒤엔 0), true 를 내면 한 번 더 묻는다.
 *   TanStack 기본값은 3회(`failureCount < 3`)라, 404 만 빼고 기본과 똑같아야 한다.
 */
describe('retryUnlessNotFound — 404 만 다시 묻지 않고, 나머지는 기본(3회)과 같다 (TRIP-986)', () => {
  it('🔴 404 는 첫 실패(0회차)부터 다시 묻지 않는다', () => {
    // 준비 — 서버가 "없다"고 분명히 답한 오류.
    const notFound = httpError(404);

    // 실행·단언 — 몇 회차든 false. 0회차가 핵심이다(여기서 true 면 1초 뒤 한 번 더 묻는다).
    expect(retryUnlessNotFound(0, notFound)).toBe(false);
    expect(retryUnlessNotFound(1, notFound)).toBe(false);
    expect(retryUnlessNotFound(2, notFound)).toBe(false);
  });

  it('🔴 500 은 기본처럼 0·1·2회차엔 다시 묻고 3회차에 멈춘다 (retry:false 오답 차단)', () => {
    const serverError = httpError(500);

    expect(retryUnlessNotFound(0, serverError)).toBe(true);
    expect(retryUnlessNotFound(1, serverError)).toBe(true);
    expect(retryUnlessNotFound(2, serverError)).toBe(true);
    // 경계 — 3회 다 물었으면 멈춘다(무한 재시도 오답 차단).
    expect(retryUnlessNotFound(3, serverError)).toBe(false);
  });

  it('🔴 응답 없는 네트워크 오류도 기본처럼 3회까지 다시 묻는다 — "모른다"는 "없다"가 아니다', () => {
    const network = transportError('ERR_NETWORK');

    expect(retryUnlessNotFound(0, network)).toBe(true);
    expect(retryUnlessNotFound(2, network)).toBe(true);
    expect(retryUnlessNotFound(3, network)).toBe(false);
  });
});
