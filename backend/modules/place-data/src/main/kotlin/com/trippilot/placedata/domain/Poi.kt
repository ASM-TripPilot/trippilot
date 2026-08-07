package com.trippilot.placedata.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.util.UUID

/** POI 카테고리(정본). DB CHECK와 동일 값. 경계 코드 매핑(SIGHT/FOOD/CAFE/NIGHT_VIEW/NATURE/SHOPPING/CULTURE/ACTIVITY)은 리버스 read 포트(BE-5). */
enum class PoiCategory { 명소, 맛집, 카페, 야경, 자연, 쇼핑, 문화, 액티비티 }

/** 수집 상태. 조회는 ACTIVE만(INV-U1-01). UNVERIFIED/LOST/CLOSED는 라이프사이클(후속). */
enum class DataStatus { ACTIVE, UNVERIFIED, LOST, CLOSED }

/** 출처. */
enum class PoiSource { KAKAO_LOCAL, TOURAPI, MANUAL }

/**
 * 데이터 완전성 등급(경계 계약 BE-5) — AI 후보풀 품질 필터·정렬 신호. **선언 순서 = 품질 내림차순**(정렬 키).
 * MINIMAL(영업시간 미확보)은 영업일 필터·HC1을 신뢰할 수 없어 AI가 후보에서 제외한다 — "문 닫은 곳이
 * 하드 제약 위반 없이 일정에 드는" 조용한 품질 저하를 막는 게 이 등급의 존재 이유(PR #104 협의).
 */
enum class DataQuality { FULL, PARTIAL, MINIMAL }

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
    val imageUrl: String? = null,   // NULL=미확보. 기본 이미지를 지어내지 않는다(TRIP-219)
    val tags: List<String> = emptyList(),   // 표시용 열린 집합. 미확보=빈 배열
) {
    /**
     * 완전성 등급 파생([DataQuality]) — 저장 컬럼이 아닌 기존 필드에서 유도.
     * 영업시간이 없으면 영업일 판정 자체가 불가하므로 MINIMAL(사진 유무 무관), 있으면 대표사진 유무로 FULL/PARTIAL.
     */
    fun dataQuality(): DataQuality = when {
        openingHours == null -> DataQuality.MINIMAL
        imageUrl == null -> DataQuality.PARTIAL
        else -> DataQuality.FULL
    }

    companion object {
        /**
         * 수집·정규화 결과로 POI 생성. 좌표는 non-null 타입이라 여기 도달=INV-U1-02 통과(게이트가 선판정).
         * imageUrl·tags 는 수집 게이트가 채우지 않는다 — [NormalizedPlace] 에 두 값이 없고 현재 어댑터가
         * 스텁뿐이라 채울 원본이 없다. 실 벤더 어댑터(라이선스·핫링크 정책 포함)가 붙는 티켓에서 정한다.
         */
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
            createdAt: Instant, updatedAt: Instant, imageUrl: String? = null, tags: List<String> = emptyList(),
        ): Poi = Poi(
            poiId, nameKo, lat, lng, category, region, openingHours, dataStatus, source, savedCount,
            createdAt, updatedAt, imageUrl, tags,
        )
    }
}
