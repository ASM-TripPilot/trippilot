package com.trippilot.savedaccommodation.domain

import java.util.UUID

/** 저장 숙소 영속 포트. 소유 계정 스코프 조회는 서비스가 인가 판정에 사용. */
interface SavedStayRepository {
    fun save(stay: SavedStay): SavedStay
    fun findById(savedStayId: UUID): SavedStay?
    fun findByAccount(accountId: UUID): List<SavedStay>
    fun delete(stay: SavedStay)
}

/** 구간 거점 배정 영속 포트. 여행 소유 스코프 인가는 서비스가 TripFacade 로 판정. */
interface BaseAssignmentRepository {
    fun save(base: BaseAssignment): BaseAssignment
    fun findByTrip(tripId: UUID): List<BaseAssignment>
    fun findById(baseAssignmentId: UUID): BaseAssignment?
    fun delete(base: BaseAssignment)

    /** 숙소가 거점으로 사용 중인지 — 숙소 삭제·좌표 해제 차단(INV-U1-08). */
    fun existsByStayId(savedStayId: UUID): Boolean
}

/**
 * 등록용 장소 검색·좌표 해석 포트(지도검색 경로). 벤더(카카오 로컬) 어댑터가 구현(1차 스텁).
 * 실 연동 시 키는 서버 프록시(SEC-U1-05). 실패 시 핀 지정 폴백(BR-U1-23)은 클라이언트 UX.
 */
interface PlaceSearchPort {
    fun geocode(query: String): List<GeocodeCandidate>

    /** 좌표 → 주소(핀 지정). 주소가 없는 좌표면 null, 조회 실패는 예외. */
    fun reverseGeocode(lat: Double, lng: Double): String?
}

/** 지오코딩 후보 — multi-candidate 시 사용자 선택(e05). */
data class GeocodeCandidate(
    val name: String,
    val address: String,
    val lat: Double,
    val lng: Double,
)
