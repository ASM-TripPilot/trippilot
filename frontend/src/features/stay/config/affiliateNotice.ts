/**
 * 제휴 고지 시트(l07 · TRIP-781)의 "다시 보지 않기" 저장 키와 [이동] 버튼 라벨 사전.
 *
 * 키 이름은 윗층(여기)이 갖는다 — `shared/storage/flag`는 키 뜻을 모른다. l05 토글(TRIP-778)이
 * 같은 키를 되돌릴 때 이 상수를 import 한다.
 *
 * 라벨 사전은 01b 가 이름으로 적은 코드만 매핑한다. 모르는 코드(`LOCALDATA`·`STUB` 등 내부 코드값)는
 * 화면에 그대로 내보이지 않고 폴백으로 접는다 — 계약에 없는 OTA 이름은 지어내지 않는다.
 */

export const AFFILIATE_NOTICE_DISMISSED_KEY = 'stay.affiliateNotice.dismissed';

// Map — 객체 리터럴이면 `constructor` 같은 코드값이 프로토타입 멤버를 집어 온다(서버 문자열이 신뢰 경계).
const OTA_CONFIRM_LABELS: ReadonlyMap<string, string> = new Map([
  ['NAVER', '네이버로 이동'],
  ['AGODA', '아고다로 이동'],
]);

export function otaConfirmLabel(externalSource: string): string {
  return OTA_CONFIRM_LABELS.get(externalSource) ?? '외부 사이트로 이동';
}
