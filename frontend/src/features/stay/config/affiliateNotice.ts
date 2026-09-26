/**
 * 제휴 고지 시트(l07 · TRIP-781)의 OTA 표시명 사전 — 옵션 행 이름(TRIP-988)과 [이동] 버튼 라벨이
 * 같은 사전을 쓴다. ("다시 보지 않기" 저장은 TRIP-778 로 서버 `/me/settings` 로 옮겨 기기 저장 키가 없다.)
 *
 * 라벨 사전은 01b 가 이름으로 적은 코드만 매핑한다. 모르는 코드(`LOCALDATA`·`STUB` 등 내부 코드값)는
 * 화면에 그대로 내보이지 않고 폴백으로 접는다 — 계약에 없는 OTA 이름은 지어내지 않는다.
 */

// Map — 객체 리터럴이면 `constructor` 같은 코드값이 프로토타입 멤버를 집어 온다(서버 문자열이 신뢰 경계).
const OTA_NAMES: ReadonlyMap<string, string> = new Map([
  ['NAVER', '네이버'],
  ['AGODA', '아고다'],
]);

/** 옵션 행 표시명(TRIP-988 · BR-U1-31) — 모르는 코드는 "외부 사이트". */
export function otaDisplayName(externalSource: string): string {
  return OTA_NAMES.get(externalSource) ?? '외부 사이트';
}

// 조사 '로'는 받침 없는 이름에만 맞다 — 받침 있는 OTA 를 사전에 넣을 때 '으로' 분기를 함께 둔다.
export function otaConfirmLabel(externalSource: string): string {
  return `${otaDisplayName(externalSource)}로 이동`;
}
