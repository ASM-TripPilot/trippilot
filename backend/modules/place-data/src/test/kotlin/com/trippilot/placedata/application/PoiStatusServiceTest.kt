package com.trippilot.placedata.application

import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.api.PoiLifeStatus
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/**
 * POI 생애 상태(PBT-SA-13 · T-D3-P2 · BR-SA-17 ⑤) — 장소 감지의 폐업 재료.
 * 지키는 것: 폐업은 `CLOSED` 하나뿐이다(`LOST` 는 원본 목록에서 빠진 것일 뿐 폐업 증거가 아니다 — 오탐 폐업 알림),
 * 상태 무관으로 찾는다(ACTIVE 만 보면 폐업을 볼 수 없다), 없는 id 는 지어내지 않고 뺀다.
 */
class PoiStatusServiceTest : StringSpec({

    val at = Instant.parse("2026-10-19T00:00:00Z")

    fun poi(status: DataStatus) = Poi.reconstitute(
        UUID.randomUUID(), "장소", 33.5, 126.5, PoiCategory.카페, "제주", null, status, PoiSource.MANUAL, 0, at, at,
    )

    "결과 CLOSED ⇔ 상태 CLOSED · LOST·UNVERIFIED 는 OTHER · 없는 id 는 빠진다 (PBT-SA-13)" {
        checkAll(Arb.list(Arb.enum<DataStatus>(), 0..12), Arb.list(Arb.int(0..20), 0..16)) { statuses, picks ->
            val stored = statuses.map(::poi)
            val repo = InMemoryPoiRepository().apply { this.stored += stored }
            // 고른 번호가 저장분 안이면 그 POI, 밖이면 처음 보는 id — 중복 질의도 섞인다.
            val asked = picks.map { stored.getOrNull(it)?.poiId ?: UUID.nameUUIDFromBytes(byteArrayOf(it.toByte())) }

            val result = PoiStatusService(repo).statusOf(asked)

            result.keys shouldBe asked.filter { id -> stored.any { it.poiId == id } }.toSet()
            for ((id, life) in result) {
                val status = stored.single { it.poiId == id }.dataStatus
                (life == PoiLifeStatus.CLOSED) shouldBe (status == DataStatus.CLOSED)
                life shouldBe when (status) {
                    DataStatus.ACTIVE -> PoiLifeStatus.ACTIVE
                    DataStatus.CLOSED -> PoiLifeStatus.CLOSED
                    DataStatus.LOST, DataStatus.UNVERIFIED -> PoiLifeStatus.OTHER
                }
            }
        }
    }

    "빈 질의는 빈 결과다" {
        PoiStatusService(InMemoryPoiRepository().apply { stored += poi(DataStatus.CLOSED) }).statusOf(emptyList()).shouldBeEmpty()
    }
})
