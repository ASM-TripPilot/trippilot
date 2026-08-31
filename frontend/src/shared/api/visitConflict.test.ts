import { AxiosError } from 'axios';

import { resolveVisitConflict, VISIT_CONFLICT_CODES } from './visitConflict';

/**
 * TRIP-619 → **TRIP-613 shared 승격**(이동): `features/execution/model/visitConflict.{ts,test.ts}` 를
 * `shared/api/` 로 옮긴다. 근거: 409 분류기 정본 위치가 shared/api(`isNotFound`·`isAlreadyRegistered`
 * 이미 거기) · VISIT_CONFLICT 와이어 리터럴을 execution·record 두 곳에 복제하면 드리프트 → 단일 출처 ·
 * **프로덕션 소비처 0**(자기 테스트뿐, grep 실측)이라 이동 안전. record·execution 둘 다 shared 에서 문다.
 * 어셔션은 이동 전과 동일 — 파일 위치·import 경로만 바뀐다(`./visitConflict` 상대경로 유지).
 *
 * (원본 TRIP-619 요지) 방문 409 응답을 code 로 갈라 수렴(VISIT_ALREADY_RECORDED)과 해소필요
 * (VISIT_CONFLICT)를 **서로 다른 결과**로 분류한다. `features/itinerary/model/slotSwapError.ts` 선례 미러.
 *
 * 무엇을 보장하나: 409 는 상태코드만으론 못 가른다 — 전역 오류봉투(`ErrorResponse{error:{code}}`)의
 * `error.response.data.error.code` 로 두 갈래를 가르고, 모르는/없는 code·비-409·비-axios·네트워크는
 * 전부 안전한 폴백(`unknown`)으로 접는다(조용히 삼키지 않는다, INV-4).
 *
 * ★ 방문은 openapi 가 실코드를 문서화했다(895·931·2513 — `VISIT_CONFLICT` · `VISIT_ALREADY_RECORDED`).
 * 그래서 아래 케이스는 상수 대신 **문서화된 리터럴을 직접** 넣어 매핑을 계약값에 못박고(상수 뒤바뀜
 * 검출), V2 가 모듈 상수도 그 값과 같은지 별도로 잰다.
 *
 * 3동작 뼈대: 준비=오류 객체 → 실행=resolveVisitConflict → 단언=kind(.toBe 완전일치=Object.is).
 */

/**
 * `isAxiosError` 가 true 여야 판정이 도는 경로를 탄다(slotSwapError.test 선례 — 평범한 객체는 false).
 * code 를 주면 전역 봉투 `{error:{code,message}}` 로, 안 주면 code 필드 없는 봉투로.
 */
function httpError(status: number, code?: string): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: code === undefined ? {} : { error: { code, message: '서버 문구' } },
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

describe('🔴 resolveVisitConflict — 방문 409 code 분류 (AC-4 · BR-U5-20·21 · INV-4)', () => {
  it('V1 · 두 code 를 서로 다른 kind 로: 다른 장소=해소필요 vs 같은 장소=수렴', () => {
    // 문서화된 계약값을 직접 넣는다(발명 금지, openapi:895·931·2513).
    expect(resolveVisitConflict(httpError(409, 'VISIT_CONFLICT')).kind).toBe(
      'conflict'
    );
    expect(
      resolveVisitConflict(httpError(409, 'VISIT_ALREADY_RECORDED')).kind
    ).toBe('alreadyRecorded');

    // 헤드라인 — 두 결과가 서로 다르다(BR-U5-21 해소 ≠ BR-U5-20 멱등 수렴). "한 결과로 뭉개기" 차단.
    expect(
      resolveVisitConflict(httpError(409, 'VISIT_CONFLICT')).kind
    ).not.toBe(
      resolveVisitConflict(httpError(409, 'VISIT_ALREADY_RECORDED')).kind
    );
  });

  it('V2 · 모듈 상수 VISIT_CONFLICT_CODES 가 계약값과 일치한다 (단일 출처, 발명 금지)', () => {
    expect(VISIT_CONFLICT_CODES.conflict).toBe('VISIT_CONFLICT');
    expect(VISIT_CONFLICT_CODES.alreadyRecorded).toBe('VISIT_ALREADY_RECORDED');
  });

  it('V3 · 409 인데 모르는 code → unknown (계약 공백 방어, 침묵 금지)', () => {
    expect(resolveVisitConflict(httpError(409, '__NOPE__')).kind).toBe(
      'unknown'
    );
  });

  it('V4 · 409 인데 code 필드 자체가 없음 → unknown', () => {
    expect(resolveVisitConflict(httpError(409)).kind).toBe('unknown');
  });

  it('V5 · 비-409·네트워크·비-axios 는 전부 unknown, 어느 경우에도 침묵 안 함', () => {
    // 비-409(코드가 있어도 409 가 아니면 방문 충돌 판정 대상이 아니다).
    expect(resolveVisitConflict(httpError(404, 'VISIT_CONFLICT')).kind).toBe(
      'unknown'
    );
    expect(resolveVisitConflict(httpError(500)).kind).toBe('unknown');
    // 응답 자체가 없는 오류(네트워크).
    expect(resolveVisitConflict(new AxiosError('Network Error')).kind).toBe(
      'unknown'
    );
    // axios 오류가 아닌 것도 원인을 못 읽으니 안전한 폴백(삼키지 않는다).
    for (const input of [new Error('boom'), undefined, null]) {
      expect(resolveVisitConflict(input).kind).toBe('unknown');
    }
  });
});
