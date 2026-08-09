import { AxiosError } from 'axios';

import { isAlreadyRegistered } from './isAlreadyRegistered';

/**
 * 409 접기 판정 — **"이미 그 여행에 있다"는 실패가 아니다**(INV-U1-18 · BR-U1-50).
 * 목표 상태(그 장소가 필수 방문지에 있다)와 결과 상태가 같으므로 실패 건수로 세지 않는다.
 *
 * 왜 `shared/api` 인가(01b D9): 지금 이 판정이 리포에 **두 벌** 있다 —
 * `pages/trip-new-step1/ui/TripNewStep1Page.tsx` 의 비-export 지역 함수와
 * `features/explore/model/savedPlaces.ts` 의 인라인. 이 칸이 세 번째 사용처가 되면서
 * README 승격 규칙("두 개 이상의 feature 가 쓰게 된 로직은 `shared/` 로 승격")이 충족됐다.
 * 승격의 값은 사용처 개수가 아니라 **판정이 한 군데에만 있다**는 것이다.
 *
 * 3동작 뼈대: 준비=오류 객체를 만든다 → 실행=판정 → 단언=참/거짓.
 */

/** `isAxiosError` 가 true 여야 판정이 도는 경로를 탄다(`TripNewStep2Page.test.tsx` 선례). */
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

describe('C15 · D9 · INV-U1-18 — 409만 "이미 등록됨"으로 접는다', () => {
  it('409 는 true 다 (긍정 앵커)', () => {
    expect(isAlreadyRegistered(httpError(409))).toBe(true);
  });

  it('C15-b 다른 상태 코드는 실패 그대로다 — 409만 특별하다', () => {
    // 400·404·500 을 삼키면 사용자가 원인을 모르는 채 성공했다고 믿는다(INV-4 침묵 실패 금지).
    expect(isAlreadyRegistered(httpError(400))).toBe(false);
    expect(isAlreadyRegistered(httpError(404))).toBe(false);
    expect(isAlreadyRegistered(httpError(500))).toBe(false);
  });

  it('C15-c 응답이 아예 없는 네트워크 오류는 false 다', () => {
    // 응답이 없으면 서버가 무엇을 했는지 알 수 없다 — "이미 있다"고 단정할 근거가 없다.
    expect(isAlreadyRegistered(new AxiosError('Network Error'))).toBe(false);
  });

  it('C15-d axios 오류가 아닌 것은 false 다', () => {
    expect(isAlreadyRegistered(new Error('boom'))).toBe(false);
    expect(isAlreadyRegistered(undefined)).toBe(false);
    expect(isAlreadyRegistered(null)).toBe(false);
    // 모양만 흉내 낸 평범한 객체가 통과하면 판정이 타입 검사가 아니라 오리 검사가 된다.
    expect(isAlreadyRegistered({ response: { status: 409 } })).toBe(false);
  });
});
