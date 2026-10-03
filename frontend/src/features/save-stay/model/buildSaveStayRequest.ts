import type {
  RegisterSavedStayRequest,
  StayItem,
} from '@/shared/api/generated/schemas';

/**
 * 검색결과 `StayItem` → `POST /saved-stays` 요청 본문 조립(TRIP-417 AC-1 · 01b Seed Q2·Q3).
 *
 * 무엇을 보장하나: OTA 검색결과를 위시리스트로 담을 때 보내는 본문이 정확히 이 7키다 —
 * `registerRoute:'MAP_SEARCH'`(정본 공백을 오케가 결정, 좌표 출처에 최근접)와
 * `coordConfirmed:true`(검색결과 `StayItem`은 `lat`/`lng`가 required라 신뢰 가능한 좌표를 이미
 * 가진다 — TRIP-600 A안 "좌표 존재=확정", INV-U1-08 재정의)를 이 함수 한 곳에 박아 화면·훅
 * 어디서도 다시 정하지 않게 한다. 검색결과엔 날짜·메모가 없으므로 checkIn/checkOut/memo 키는
 * 아예 붙이지 않는다(키 부재와 null 전송은 서버에 다른 뜻).
 */
export function buildSaveStayRequest(item: StayItem): RegisterSavedStayRequest {
  return {
    name: item.name,
    registerRoute: 'MAP_SEARCH',
    coordConfirmed: true,
    externalSource: item.externalSource,
    externalId: item.externalId,
    lat: item.lat,
    lng: item.lng,
  };
}
