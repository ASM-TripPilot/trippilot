package com.trippilot.placedata.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/**
 * 재수집(`Poi.refreshed`)이 상태를 어떻게 다루는가(TRIP-1227).
 *
 * LOST 는 "원본 문서에서 빠짐"(미포함 정리)이다 — 문서에 다시 나타난 것이 곧 반증이라 되살린다. 되살리지 않으면
 * 공백 해소·병합으로 빠졌던 식당이 다시 뽑혀도 후보에서 영구히 빠진다.
 * CLOSED(폐업 판정)·UNVERIFIED 는 사람·판정이 내린 값이라 매일 도는 수집이 덮지 않는다.
 */
class PoiRefreshedTest : StringSpec({

    val t0 = Instant.parse("2026-10-01T00:00:00Z")

    fun refreshedFrom(status: DataStatus): DataStatus = Poi.refreshed(
        existing = Poi.reconstitute(
            poiId = UUID.randomUUID(), nameKo = "식당", lat = 35.11, lng = 129.04, category = PoiCategory.맛집,
            region = "동구", openingHours = null, dataStatus = status, source = PoiSource.LOCALDATA, savedCount = 3,
            createdAt = t0, updatedAt = t0, sourceRef = "R-1",
        ),
        nameKo = "식당", lat = 35.11, lng = 129.04, category = PoiCategory.맛집, region = "동구", openingHours = null,
        now = Instant.parse("2026-11-01T00:00:00Z"),
    ).dataStatus

    "원본에서 빠졌던(LOST) 장소가 다시 오면 ACTIVE 로 되살린다" {
        refreshedFrom(DataStatus.LOST) shouldBe DataStatus.ACTIVE
    }

    "폐업(CLOSED)·미검증(UNVERIFIED)은 다시 와도 그대로다 — 사람·판정이 내린 값을 수집이 덮지 않는다" {
        refreshedFrom(DataStatus.CLOSED) shouldBe DataStatus.CLOSED
        refreshedFrom(DataStatus.UNVERIFIED) shouldBe DataStatus.UNVERIFIED
        refreshedFrom(DataStatus.ACTIVE) shouldBe DataStatus.ACTIVE
    }
})
