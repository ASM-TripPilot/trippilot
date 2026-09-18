package com.trippilot.placedata.api

/**
 * 지도·장소 검색 퍼사드(C7) — 숙소 등록의 지도검색 탭이 좌표를 얻을 때 쓴다(e05 · BR-U1-23).
 *
 * 카카오 로컬은 **place-data 소유**다("하나의 외부 API = 하나의 소유 모듈 = 하나의 어댑터 포트").
 * 숙소 모듈이 벤더를 직접 잡으면 같은 API 를 두 모듈이 들고, 쿼터·약관·키 교체가 두 곳으로 갈린다.
 *
 * **빈 목록과 실패는 다르다.** 못 찾은 것은 빈 목록, 벤더를 못 부른 것은 예외다 —
 * 둘을 같은 값으로 접으면 화면이 "결과 없음"을 그리고 사용자는 계속 다시 친다(BR-U1-23 침묵 실패 금지).
 */
interface PlaceLookupFacade {
    /**
     * 이름·주소로 장소를 찾는다. 사용자가 고를 수 있게 **여러 건**을 준다(multi-candidate, e05).
     *
     * @throws com.trippilot.core.error.UpstreamUnavailable 벤더를 부르지 못했을 때
     */
    fun search(query: String): List<PlaceCandidate>

    /**
     * 좌표 → 주소(핀 지정 탭 · e05). **null 은 "그 좌표에 주소가 없다"** — 바다·산·비주소 구역이다.
     *
     * 조회 실패는 null 이 아니라 예외다. 핀 지정은 지도 검색이 죽었을 때의 폴백 경로인데(BR-U1-23),
     * 여기서도 실패를 null 로 접으면 사용자는 "주소가 없나 보다" 하고 핀만 옮기다 끝난다.
     *
     * @throws com.trippilot.core.error.UpstreamUnavailable 벤더를 부르지 못했을 때
     */
    fun reverseGeocode(lat: Double, lng: Double): String?
}

/** 좌표 후보 한 건 — 사용자 선택용이라 이름·주소가 함께 간다. */
data class PlaceCandidate(
    val name: String,
    val address: String,
    val lat: Double,
    val lng: Double,
)
