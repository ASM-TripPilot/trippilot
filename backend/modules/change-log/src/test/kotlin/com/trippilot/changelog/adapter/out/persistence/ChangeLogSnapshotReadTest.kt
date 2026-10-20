package com.trippilot.changelog.adapter.out.persistence

import com.trippilot.changelog.domain.ChangeLogEntry
import com.trippilot.changelog.domain.ChangeSource
import com.trippilot.changelog.domain.DaySnapshot
import com.trippilot.changelog.domain.ItinerarySnapshot
import com.trippilot.changelog.domain.SlotSnapshot
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
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
 * 변경 이력 스냅숏 읽기(`findByTrip`)가 보장하는 것 — 이력은 append-only 라 옛 형태 행을 고칠 수 없다:
 * - 저장한 스냅숏은 JSON 왕복 뒤에도 같은 값으로 읽힌다.
 * - `days`·`slots` 가 없거나 리스트가 아니면 빈 스냅숏·빈 날이다.
 * - 날의 `date`, 슬롯의 `poiId`·`startAt`·`endAt` 가 없거나 타입이 틀리거나 파싱되지 않으면 그 날·슬롯만 버리고 나머지를 돌려준다.
 * - V2.8 이전 행처럼 `isFixed`·`endsNextDay` 가 없거나 타입이 틀리면 false 다.
 *
 * JPA 는 대역이라 Hibernate 가 jsonb 를 엔티티 필드 타입으로 읽어 낸 **뒤의** 어댑터 해석만 본다.
 * 이 테스트가 보장하지 않는 읽기 실패(깨진·범위 밖·모르는 값 → 500)는 TRIP-1476 이 정본으로 모은다 — 여기 목록을 두지 않는다.
 */
class ChangeLogSnapshotReadTest : StringSpec({

    val tripId = UUID.randomUUID()
    val poi = UUID.randomUUID()
    val at = Instant.parse("2026-08-14T00:00:00Z")

    fun entity(before: Map<String, Any>, after: Map<String, Any> = emptyMap()) = ChangeLogEntryEntity(
        changeLogEntryId = 1L, tripId = tripId, actor = "u", sourceType = "MANUAL", reason = null,
        beforeSnapshot = before, afterSnapshot = after, at = at,
    )

    fun read(before: Map<String, Any>): ItinerarySnapshot {
        val jpa = mockk<ChangeLogJpaRepository>()
        every { jpa.findByTripIdOrderByAtDescChangeLogEntryIdDesc(tripId, any()) } returns listOf(entity(before))
        return ChangeLogRepositoryAdapter(jpa).findByTrip(tripId, 10).single().before
    }

    val goodSlot = mapOf<String, Any>(
        "poiId" to poi.toString(), "startAt" to "10:00", "endAt" to "11:00", "isFixed" to true, "endsNextDay" to true,
    )

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

    "days 가 없거나 리스트가 아니면 빈 스냅숏 — 예외 없음" {
        read(emptyMap()).days.shouldBeEmpty()
        read(mapOf("days" to "garbage")).days.shouldBeEmpty()
    }

    "날짜가 없거나 문자열이 아니거나 파싱 안 되는 날은 버리고 나머지 날은 남긴다" {
        val days = read(
            mapOf(
                "days" to listOf(
                    mapOf("slots" to listOf(goodSlot)),
                    mapOf("date" to 20260801, "slots" to listOf(goodSlot)),
                    mapOf("date" to "2026-13-40", "slots" to listOf(goodSlot)),
                    mapOf("date" to "2026-08-02", "slots" to listOf(goodSlot)),
                ),
            ),
        ).days
        days.map { it.date } shouldBe listOf(LocalDate.parse("2026-08-02"))
        days.single().slots.single().poiId shouldBe poi
    }

    "slots 가 없거나 리스트가 아닌 날은 빈 날로 남는다" {
        val days = read(mapOf("days" to listOf(mapOf("date" to "2026-08-01"), mapOf("date" to "2026-08-02", "slots" to 3)))).days
        days.map { it.date } shouldBe listOf(LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-02"))
        days.forEach { it.slots.shouldBeEmpty() }
    }

    "poiId·startAt·endAt 중 하나라도 없거나 깨진 슬롯은 버리고 성한 슬롯만 남는다" {
        val broken = listOf(
            goodSlot - "poiId",
            goodSlot + ("poiId" to "not-a-uuid"),
            goodSlot + ("poiId" to 42),
            goodSlot - "startAt",
            goodSlot + ("startAt" to "25:99"),
            goodSlot - "endAt",
            goodSlot + ("endAt" to "noon"),
        )
        val slots = read(mapOf("days" to listOf(mapOf("date" to "2026-08-01", "slots" to broken + listOf(goodSlot))))).days.single().slots
        slots shouldBe listOf(SlotSnapshot(poi, LocalTime.parse("10:00"), LocalTime.parse("11:00"), isFixed = true, endsNextDay = true))
    }

    "V2.8 이전 행처럼 isFixed·endsNextDay 가 없거나 타입이 틀리면 false 로 읽는다" {
        val slots = listOf(
            goodSlot - "endsNextDay" + ("isFixed" to "yes"),
            goodSlot - "isFixed" + ("endsNextDay" to "yes"),
        )
        val read = read(mapOf("days" to listOf(mapOf("date" to "2026-08-01", "slots" to slots)))).days.single().slots
        read.size shouldBe 2
        read.forEach {
            it.isFixed shouldBe false
            it.endsNextDay shouldBe false
        }
    }
})
