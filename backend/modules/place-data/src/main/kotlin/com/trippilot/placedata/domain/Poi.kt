package com.trippilot.placedata.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.util.UUID

/** POI 카테고리(정본). DB CHECK와 동일 값. */
enum class PoiCategory { 명소, 맛집, 카페, 야경, 자연, 쇼핑, 문화 }

/** 수집 상태. 조회는 ACTIVE만(INV-U1-01). UNVERIFIED/LOST/CLOSED는 라이프사이클(후속). */
enum class DataStatus { ACTIVE, UNVERIFIED, LOST, CLOSED }

/** 출처. */
enum class PoiSource { KAKAO_LOCAL, TOURAPI, MANUAL }

/**
 * POI 정본(C7). 다중 지도/장소 API를 단일 표준 스키마로 정규화한 결과.
 * 불변식: INV-U1-02 좌표 필수(lat·lng non-null 타입으로 강제). 이름 필수.
 * 조회 게이트 INV-U1-01(dataStatus=ACTIVE만)은 리포지토리·서비스가 집행.
 */
class Poi private constructor(
    val poiId: UUID,
    val nameKo: String,
    val lat: Double,
    val lng: Double,
    val category: PoiCategory,
    val region: String?,
    val openingHours: String?,   // NULL=미확인(허용, INV-U1 영업시간 분리)
    val dataStatus: DataStatus,
    val source: PoiSource,
    val savedCount: Long,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        /** 수집·정규화 결과로 POI 생성. 좌표는 non-null 타입이라 여기 도달=INV-U1-02 통과(게이트가 선판정). */
        fun collect(
            nameKo: String,
            lat: Double,
            lng: Double,
            category: PoiCategory,
            region: String?,
            openingHours: String?,
            source: PoiSource,
            dataStatus: DataStatus,
            now: Instant,
        ): Poi {
            if (nameKo.isBlank()) throw ValidationFailed(listOf(FieldError("nameKo", "POI 이름은 필수입니다.")))
            return Poi(UUID.randomUUID(), nameKo, lat, lng, category, region, openingHours, dataStatus, source, 0, now, now)
        }

        @Suppress("LongParameterList")
        fun reconstitute(
            poiId: UUID, nameKo: String, lat: Double, lng: Double, category: PoiCategory, region: String?,
            openingHours: String?, dataStatus: DataStatus, source: PoiSource, savedCount: Long,
            createdAt: Instant, updatedAt: Instant,
        ): Poi = Poi(poiId, nameKo, lat, lng, category, region, openingHours, dataStatus, source, savedCount, createdAt, updatedAt)
    }
}
