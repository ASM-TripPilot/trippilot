import type { StartReplanRequest } from '@/shared/api/generated/schemas/startReplanRequest';
import type { StartReplanRequestScope } from '@/shared/api/generated/schemas/startReplanRequestScope';

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
  form: ReplanFormValues
): StartReplanRequest {
  return {
    scope: form.scope,
    // i10 엔 위치 입력이 없다 — 서버가 사다리로 정한다(BR-U4-19). 생략이 아니라 명시 null.
    originKind: null,
    reasons: form.reasons,
    directives: form.directives,
    freeText: form.freeText === '' ? null : form.freeText,
    // '건너뛰기'가 채우는 필드 — i10 은 항상 빈 배열.
    excludedPoiIds: [],
    // 수동 진입이라 근거 트리거가 없다.
    triggerId: null,
  };
}
