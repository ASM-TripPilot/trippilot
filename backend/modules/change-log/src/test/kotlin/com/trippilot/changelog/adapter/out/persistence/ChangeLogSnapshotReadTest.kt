package com.trippilot.changelog.adapter.out.persistence

import com.trippilot.changelog.domain.ChangeLogEntry
import com.trippilot.changelog.domain.ChangeSource
import com.trippilot.changelog.domain.DaySnapshot
import com.trippilot.changelog.domain.ItinerarySnapshot
import com.trippilot.changelog.domain.SlotSnapshot
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import tools.jackson.databind.json.JsonMapper
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 변경 이력 스냅숏 읽기(`findByTrip`)가 보장하는 것:
 * - 저장한 스냅숏은 JSON 왕복 뒤에도 같은 값으로 읽힌다.
 *
 * JPA 는 대역이라 Hibernate 가 jsonb 를 엔티티 필드 타입으로 읽어 낸 **뒤의** 어댑터 해석만 본다.
 * 일부가 빠지거나 깨진 스냅숏을 어떻게 읽는지는 TRIP-1476(#1474)이 고정한다 — 여기서 단언하지 않는다.
 */
class ChangeLogSnapshotReadTest : StringSpec({

    val tripId = UUID.randomUUID()
    val poi = UUID.randomUUID()
    val at = Instant.parse("2026-08-14T00:00:00Z")

    "저장한 이력은 jsonb 를 거쳐도 그대로 다시 읽힌다 (저장 형식 왕복)" {
        val jpa = mockk<ChangeLogJpaRepository>()
        val saved = slot<ChangeLogEntryEntity>()
        every { jpa.save(capture(saved)) } answers { saved.captured.also { it.changeLogEntryId = 7L } }
        val before = ItinerarySnapshot(
            listOf(DaySnapshot(LocalDate.parse("2026-08-01"), listOf(SlotSnapshot(poi, LocalTime.parse("10:00"), LocalTime.parse("11:30"), isFixed = false, endsNextDay = false)))),
        )
        val after = ItinerarySnapshot(
            listOf(
                DaySnapshot(LocalDate.parse("2026-08-01"), listOf(SlotSnapshot(poi, LocalTime.parse("23:00"), LocalTime.parse("01:00"), isFixed = true, endsNextDay = true))),
                DaySnapshot(LocalDate.parse("2026-08-02"), emptyList()),
            ),
        )
        val adapter = ChangeLogRepositoryAdapter(jpa)
        adapter.append(ChangeLogEntry(null, tripId, "planb", ChangeSource.PLAN_B, "비", before, after, at)).entryId shouldBe 7L

        // jsonb 왕복을 흉내 낸다 — 메모리 Map 을 그대로 돌려주면 직렬화로 바뀌는 것(타입·키)이 안 보인다.
        val json = JsonMapper()
        @Suppress("UNCHECKED_CAST")
        fun viaJson(m: Map<String, Any>) = json.readValue(json.writeValueAsString(m), Map::class.java) as Map<String, Any>
        val row = saved.captured
        row.beforeSnapshot = viaJson(row.beforeSnapshot)
        row.afterSnapshot = viaJson(row.afterSnapshot)
        every { jpa.findByTripIdOrderByAtDescChangeLogEntryIdDesc(tripId, any()) } returns listOf(row)

        adapter.findByTrip(tripId, 10).single() shouldBe
            ChangeLogEntry(7L, tripId, "planb", ChangeSource.PLAN_B, "비", before, after, at)
    }
})
