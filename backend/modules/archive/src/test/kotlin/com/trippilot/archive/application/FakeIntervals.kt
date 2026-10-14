package com.trippilot.archive.application

import com.trippilot.archive.domain.IntervalKind
import com.trippilot.archive.domain.LocationAutomationInterval
import com.trippilot.archive.domain.LocationAutomationIntervalRepository
import java.util.UUID

/** 자동화 구간 저장소 대역 — 조건부 닫기(열려 있을 때만)를 실물과 같게 흉내 낸다. */
internal class FakeIntervals : LocationAutomationIntervalRepository {
    val rows = linkedMapOf<UUID, LocationAutomationInterval>()
    override fun find(intervalId: UUID) = rows[intervalId]
    override fun insertIfAbsent(interval: LocationAutomationInterval): Boolean {
        if (interval.intervalId in rows) return false
        rows[interval.intervalId] = interval
        return true
    }
    override fun closeIfOpen(closed: LocationAutomationInterval): Boolean {
        if (rows[closed.intervalId]?.isOpen != true) return false
        rows[closed.intervalId] = closed
        return true
    }
    override fun findByTrip(tripId: UUID, kind: IntervalKind) = rows.values.filter { it.tripId == tripId && it.kind == kind }
    override fun findOpenByAccount(accountId: UUID) = rows.values.filter { it.accountId == accountId && it.isOpen }
    override fun findOpen() = rows.values.filter { it.isOpen }
}
