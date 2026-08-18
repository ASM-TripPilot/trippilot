package com.trippilot.placedata.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.util.UUID

/**
 * POI 카테고리(정본). DB CHECK 와 같은 값.
 *
 * 경계(AI)는 영문 코드로 말한다 — 매핑은 **여기 한 곳에 양방향으로** 둔다. 읽기(BE-5)와 쓰기(등록 제안 수신)가
 * 각자 표를 들면 한쪽만 고쳐져 조용히 갈라진다. AI 쪽 `PoiCategory` 주석도 이 표를 정본으로 인용하고 있다.
 */
enum class PoiCategory {
    명소, 맛집, 카페, 야경, 자연, 쇼핑, 문화, 액티비티 ;

    /** 한글 정본 → AI 경계 코드. 1:1, 전 값 커버. */
    val boundaryCode: String
        get() = when (this) {
            명소 -> "SIGHT"
            맛집 -> "FOOD"
            카페 -> "CAFE"
            야경 -> "NIGHT_VIEW"
            자연 -> "NATURE"
            쇼핑 -> "SHOPPING"
            문화 -> "CULTURE"
            액티비티 -> "ACTIVITY"
        }

    companion object {
        /**
         * AI 경계 코드 → 한글 정본. **모르는 코드는 null** — 지어내지 않는다.
         *
         * AI 에는 우리에게 없는 `STAY`(내부 전용)가 있다. 그런 값을 임의로 가까운 카테고리에 밀어 넣으면
         * 후보풀에 엉뚱한 성격의 장소가 섞이고, DB CHECK 에서 터지거나(운이 좋으면) 조용히 잘못 분류된다.
         */
        fun fromBoundaryCode(code: String?): PoiCategory? =
            entries.firstOrNull { it.boundaryCode == code }
    }
}

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
    val imageUrl: String? = null,   // NULL=미확보. 기본 이미지를 지어내지 않는다(TRIP-219)
    val tags: List<String> = emptyList(),   // 표시용 열린 집합. 미확보=빈 배열
    /** 출처가 준 원본 식별자. 수동 등록분은 null — 그때는 멱등 판정 대상이 아니다. */
    val sourceRef: String? = null,
) {
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
            sourceRef: String? = null,
            tags: List<String> = emptyList(),
        ): Poi {
            if (nameKo.isBlank()) throw ValidationFailed(listOf(FieldError("nameKo", "POI 이름은 필수입니다.")))
            return Poi(
                UUID.randomUUID(), nameKo, lat, lng, category, region, openingHours, dataStatus, source, 0,
                now, now, tags = tags, sourceRef = sourceRef,
            )
        }

        /**
         * 이미 아는 POI 를 같은 출처의 새 수집분으로 갱신한다 — **행을 새로 만들지 않는다**.
         *
         * 유지하는 것: [poiId](참조가 붙어 있다) · [savedCount](사용자 행동) · [createdAt](처음 안 시점).
         * 갱신하는 것: 벤더가 다시 준 값들. 이름·좌표가 바뀌는 일이 실제로 있다(이전·개명).
         */
        @Suppress("LongParameterList")
        fun refreshed(
            existing: Poi, nameKo: String, lat: Double, lng: Double, category: PoiCategory,
            region: String?, openingHours: String?, now: Instant, tags: List<String> = emptyList(),
        ): Poi = Poi(
            existing.poiId, nameKo, lat, lng, category, region, openingHours,
            // 상태는 **유지한다**. 폐업(CLOSED)·미검증은 사람이 내린 판단이거나 라이프사이클 결과인데,
            // 매일 도는 대량 수집이 그걸 덮으면 손으로 정리한 것이 하룻밤에 되돌아간다.
            existing.dataStatus, existing.source, existing.savedCount, existing.createdAt, now,
            // 이미지는 아직 받지 않는다(수집 경로가 채우지 않음) — 기존 값을 지우지 않도록 그대로 잇는다.
            existing.imageUrl,
            // 태그는 갱신한다 — 벤더가 분류를 고치는 일이 있고, 표시용이라 최신이 맞다.
            tags.ifEmpty { existing.tags },
            existing.sourceRef,
        )

        @Suppress("LongParameterList")
        fun reconstitute(
            poiId: UUID, nameKo: String, lat: Double, lng: Double, category: PoiCategory, region: String?,
            openingHours: String?, dataStatus: DataStatus, source: PoiSource, savedCount: Long,
            createdAt: Instant, updatedAt: Instant, imageUrl: String? = null, tags: List<String> = emptyList(),
            sourceRef: String? = null,
        ): Poi = Poi(
            poiId, nameKo, lat, lng, category, region, openingHours, dataStatus, source, savedCount,
            createdAt, updatedAt, imageUrl, tags, sourceRef,
        )
    }
}
