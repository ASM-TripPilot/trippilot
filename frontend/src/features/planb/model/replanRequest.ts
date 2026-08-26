import type { StartReplanRequest } from '@/shared/api/generated/schemas/startReplanRequest';
import type { StartReplanRequestScope } from '@/shared/api/generated/schemas/startReplanRequestScope';
import type { ReplanOrigin } from './replanOrigin';

/**
 * TRIP-439 · AC-1·AC-3 · D6 — i10 폼 값을 서버 `StartReplanRequest` 봉투로 조립하는 순수 빌더.
 *
 * 무엇을 보장하나(이 사이클의 헤드라인 = 드리프트⑤):
 *  - 위치 입력이 없어도 `originKind: null` 을 **생략이 아니라 명시**로 싣는다(codegen
 *    `required:[scope, originKind]`, 값 nullable). "생략(undefined)"이면 tsc·계약 위반이다.
 *  - `triggerId: null`(수동 진입)·`excludedPoiIds: []`('건너뛰기'가 채우는 필드, i10 아님)를 항상 싣는다.
 *  - 사유·방향을 하나도 안 골라도 조립된다(빈 배열이 막지 않음, BR-U4-12).
 *  - 빈 자유텍스트 `''` 는 `null` 로 접고, 내용이 있으면 그대로 싣는다(트림 안 함 — 과잉 명세 회피).
 */

/** 빌더의 입력 — 폼(스토어)이 든 값 4개. */
export interface ReplanFormValues {
  scope: StartReplanRequestScope;
  reasons: string[];
  directives: string[];
  freeText: string;
}

export function buildStartReplanRequest(
  form: ReplanFormValues,
  // TRIP-442 · additive optional origin. 미제공 시 아래 body 는 기존과 바이트 동일(originKind:null,
  // originLat/originLng 키 자체가 없음). origin 이 있으면(MANUAL 핀) originKind 를 그 값으로 싣고
  // 좌표 두 키를 덧붙인다 — `confirmLocked?`·`saveError?` 후방호환 선례(Seed §3-a).
  origin?: ReplanOrigin
): StartReplanRequest {
  const base = {
    scope: form.scope,
    // i10 엔 위치 입력이 없다 — 서버가 사다리로 정한다(BR-U4-19). 생략이 아니라 명시 null.
    originKind: origin ? origin.originKind : null,
    reasons: form.reasons,
    directives: form.directives,
    freeText: form.freeText === '' ? null : form.freeText,
    // '건너뛰기'가 채우는 필드 — i10 은 항상 빈 배열.
    excludedPoiIds: [],
    // 수동 진입이라 근거 트리거가 없다.
    triggerId: null,
  };
  // origin 미제공 = 기존 7키 그대로(좌표 키를 붙이지 않는다 — codegen originLat?/originLng? 는
  // "값 null"이 아니라 "키 부재"가 정본이라, 여기서 키를 안 만드는 것이 additive 불변이다).
  if (!origin) return base;
  return { ...base, originLat: origin.originLat, originLng: origin.originLng };
}
