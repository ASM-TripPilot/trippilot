package com.trippilot.trip.domain

import java.util.UUID

/** 여행 영속 포트. 소프트삭제는 save(deletedAt 설정)로. 소유 스코프 인가는 서비스가 판정. */
interface TripRepository {
    fun save(trip: Trip): Trip
    fun findById(tripId: UUID): Trip?
    fun findByAccount(accountId: UUID): List<Trip>
}
