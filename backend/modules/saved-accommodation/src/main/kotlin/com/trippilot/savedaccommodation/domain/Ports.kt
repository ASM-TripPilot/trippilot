package com.trippilot.savedaccommodation.domain

import java.util.UUID

/** 저장 숙소 영속 포트. 소유 계정 스코프 조회는 서비스가 인가 판정에 사용. */
interface SavedStayRepository {
    fun save(stay: SavedStay): SavedStay
    fun findById(savedStayId: UUID): SavedStay?
    fun findByAccount(accountId: UUID): List<SavedStay>
    fun delete(stay: SavedStay)
}

/**
 * 등록용 장소 검색·좌표 해석 포트(지도검색 경로). 벤더(카카오 로컬) 어댑터가 구현(1차 스텁).
 * 실 연동 시 키는 서버 프록시(SEC-U1-05). 실패 시 핀 지정 폴백(BR-U1-23)은 클라이언트 UX.
 */
interface PlaceSearchPort {
    fun geocode(query: String): List<GeocodeCandidate>
}

/** 지오코딩 후보 — multi-candidate 시 사용자 선택(e05). */
data class GeocodeCandidate(
    val name: String,
    val address: String,
    val lat: Double,
    val lng: Double,
)
