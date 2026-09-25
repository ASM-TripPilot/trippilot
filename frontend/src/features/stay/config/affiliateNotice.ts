/**
 * 제휴 고지 시트(l07 · TRIP-781)의 [이동] 버튼 라벨 사전. ("다시 보지 않기" 저장은 TRIP-778 로
 * 서버 `/me/settings` 로 옮겨 기기 저장 키가 없다.)
 *
 * 라벨 사전은 01b 가 이름으로 적은 코드만 매핑한다. 모르는 코드(`LOCALDATA`·`STUB` 등 내부 코드값)는
 * 화면에 그대로 내보이지 않고 폴백으로 접는다 — 계약에 없는 OTA 이름은 지어내지 않는다.
 */

// Map — 객체 리터럴이면 `constructor` 같은 코드값이 프로토타입 멤버를 집어 온다(서버 문자열이 신뢰 경계).
const OTA_CONFIRM_LABELS: ReadonlyMap<string, string> = new Map([
  ['NAVER', '네이버로 이동'],
  ['AGODA', '아고다로 이동'],
]);

export function otaConfirmLabel(externalSource: string): string {
  return OTA_CONFIRM_LABELS.get(externalSource) ?? '외부 사이트로 이동';
}
