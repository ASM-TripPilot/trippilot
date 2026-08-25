package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.reflection.domain.CategoryShare
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleAnalysisRepository
import com.trippilot.reflection.domain.StyleOutcome
import com.trippilot.reflection.domain.StylePreview
import com.trippilot.reflection.domain.TraitGauges
import com.trippilot.trip.api.TripListFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.util.UUID
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 여행 스타일 분석(US-REC-09 · `j05`).
 *
 * ## 임계가 이 서비스의 전부다
 *
 * 누적 방문 10곳 미만이면 **정식 분석을 만들지 않는다**(BR-U5-40 · INV-U5-09). 3곳 다녀온 사람에게
 * "당신은 미식가입니다"라고 말하면 그 말이 틀렸을 뿐 아니라, 다음에 맞는 말을 해도 믿지 않는다.
 * 미만에서는 온보딩 취향으로 미리보기를 그리되 **저장하지 않는다**(BR-U5-41) — 저장하면 정식과
 * 구분이 사라진다. 타입이 갈려 있어(`StylePreview`) 실수로 저장할 경로 자체가 없다.
 *
 * ## 읽을 때 다시 계산한다
 *
 * 스케줄러를 두지 않았다. 방문이 늘 때마다 재분석을 걸면 배선이 하나 더 생기는데, 이 계산은
 * 계정 하나치 실적 훑기라 조회 시점에 해도 된다. 표는 "마지막 갱신"(`j05`)의 근거이자 U6 이
 * 재계산 없이 읽을 자리다.
 */
@Service
class StyleAnalysisService(
    private val trips: TripListFacade,
    private val archive: ArchiveRecordFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val preferences: PreferenceFacade,
    private val analyses: StyleAnalysisRepository,
    private val clock: Clock,
) {
    @Transactional
    fun analyze(accountId: UUID): StyleOutcome {
        val perTrip = trips.findTripsOf(accountId, SAMPLE_TRIPS).map { archive.findDailyVisits(it.tripId) }
        val days = perTrip.flatten()
        val visits = days.flatMap { d -> d.visits.filter { !it.skipped } }

        if (visits.size < StyleAnalysis.MIN_VISITS) return StyleOutcome.Preview(previewOf(accountId, visits.size))

        val surfaces = poiSurfaces.findSurfaces(visits.map { it.poiId })
        val breakdown = breakdownOf(visits, surfaces)
        val placesPerDay = round2(visits.size.toDouble() / days.count { d -> d.visits.any { !it.skipped } })
        val radiusKm = round2(avgRadiusKm(days, surfaces))
        val gauges = gaugesOf(placesPerDay, breakdown, radiusKm)
        return StyleOutcome.Official(
            analyses.upsert(
                StyleAnalysis(
                    accountId = accountId,
                    descriptors = descriptorsOf(breakdown, gauges),
                    traitGauges = gauges,
                    categoryBreakdown = breakdown,
                    avgPlacesPerDay = placesPerDay,
                    avgRadiusKm = radiusKm,
                    avgDwellMinutes = avgDwellMinutes(visits),
                    // 방문이 하나라도 있는 여행만 샘플이다 — 만들어만 두고 안 간 여행은 근거가 아니다.
                    sampleTripCount = perTrip.count { ds -> ds.any { d -> d.visits.any { !it.skipped } } },
                    sampleVisitCount = visits.size,
                    updatedAt = clock.instant(),
                ),
            ),
        )
    }

    /** 저장된 정식 분석. 없으면 null — 조회만 하고 만들지 않는다(U6 가 읽는 자리). */
    @Transactional(readOnly = true)
    fun find(accountId: UUID): StyleAnalysis? = analyses.find(accountId)

    /**
     * **O-U5-7 결정(잠정 아님 — 서버 몫만 정한다).**
     *
     * 화면은 `카페·자연·미식·기타` 4줄인데 `poi.category` 코드 8종에 `미식` 은 없고 `맛집` 이 있다.
     * 둘 중 서버가 정할 수 있는 것만 정했다:
     *
     * - **코드를 그대로 낸다.** 표시 라벨(`맛집`→`미식`)은 화면 몫이고 매핑표는 디자인 확인이
     *   남았다. 라벨로 저장하면 라벨이 바뀔 때 **저장된 과거 분석이 전부 틀린 말이 된다.**
     * - **4줄 접기는 서버가 한다.** 비율 합이 1이 되도록 묶는 산술이라 클라이언트가 각자 반올림하면
     *   값이 갈린다(업무 규칙 권위는 서버, 루트 CLAUDE.md).
     * - 정렬은 비율 내림차순, **동률이면 코드 오름차순** — 결정론이 없으면 같은 데이터에 화면이
     *   매번 다르게 그려진다.
     *
     * 카테고리를 모르는 방문(표면을 못 찾음)은 분모에서도 뺀다 — `기타` 로 넣으면 "기타를 많이
     * 다녔다"는 없는 사실이 생긴다(BR-U5-31).
     */
    private fun breakdownOf(visits: List<ArchiveVisitView>, surfaces: Map<UUID, PoiSurfaceView>): List<CategoryShare> {
        val counted = visits.mapNotNull { surfaces[it.poiId]?.category }
        if (counted.isEmpty()) return emptyList()
        val ranked = counted.groupingBy { it }.eachCount().entries
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        val top = ranked.take(CategoryShare.TOP_N).map { CategoryShare(it.key, it.value.toDouble() / counted.size) }
        val restCount = ranked.drop(CategoryShare.TOP_N).sumOf { it.value }
        return if (restCount == 0) top else top + CategoryShare(CategoryShare.OTHER, restCount.toDouble() / counted.size, isOther = true)
    }

    /**
     * **O-U5-9 결정(잠정).**
     *
     * 정본이 축은 화면(`여유로움·미식취향·활동성`)을 따르되 산출식은 U6 마이페이지 설계와 함께
     * 확정하라고 열어 뒀다. 지금 필요한 것은 화면을 그릴 수 있는 값이라 **실적으로 관측 가능한
     * 것만으로** 잠정 식을 세웠다. 세 축이 서로 겹치지 않는 것을 고른다 — 밀도·구성·범위:
     *
     * | 축 | 무엇에서 | 0 | 5 |
     * |---|---|---|---|
     * | 여유로움 | 하루 평균 방문 수 | 7곳 이상 | 2곳 이하 |
     * | 미식취향 | 맛집+카페 비중 | 0% | 50% 이상 |
     * | 활동성 | 하루 평균 이동 반경 | 0km | 5km 이상 |
     *
     * 스토리 원문의 "밀도·반경"은 각각 여유로움·활동성에 흡수된다 — 버린 것이 아니다.
     * **확정되면 이 함수만 바꾼다**(축의 의미는 [TraitGauges] 에 적어 뒀다).
     */
    private fun gaugesOf(placesPerDay: Double, breakdown: List<CategoryShare>, radiusKm: Double): TraitGauges {
        val foodRatio = breakdown.filter { it.category in FOOD_CATEGORIES }.sumOf { it.ratio }
        return TraitGauges(
            easygoing = scale(BUSY_PLACES_PER_DAY - placesPerDay, BUSY_PLACES_PER_DAY - CALM_PLACES_PER_DAY),
            foodAffinity = scale(foodRatio, FOOD_RATIO_FULL),
            activeness = scale(radiusKm, ACTIVE_RADIUS_KM),
        )
    }

    /**
     * 저장 정밀도(`numeric(_,2)`)에 맞춰 **산출 시점에** 접는다.
     *
     * 접지 않으면 방금 만든 응답은 `3.6205…`, 다음 조회는 `3.62` 가 된다 — 같은 화면이 새로고침에
     * 값이 바뀌는 것으로 보인다. DB 가 쓰기에서 반올림하는데 `save()` 는 메모리 객체를 그대로
     * 돌려주기 때문이다(실 DB IT 로 잡았다).
     */
    private fun round2(v: Double): Double = kotlin.math.round(v * 100) / 100

    /** 0~[full] 을 0~5 로. 범위를 벗어나면 끝값으로 붙인다 — 게이지는 넘칠 수 없다. */
    private fun scale(value: Double, full: Double): Int =
        min(TraitGauges.MAX.toDouble(), (value.coerceAtLeast(0.0) / full) * TraitGauges.MAX).roundToInt()

    /**
     * 하루 방문점들이 **중심에서 얼마나 퍼져 있나**(`j05` `평균 이동 반경 1.2km`).
     *
     * 좌표를 아는 점이 2개 미만인 날은 반경이 정의되지 않아 분모에서 뺀다 — 0 으로 세면
     * "한 곳만 간 날"이 반경을 끌어내려 실제보다 좁아 보인다.
     */
    private fun avgRadiusKm(days: List<ArchiveDayView>, surfaces: Map<UUID, PoiSurfaceView>): Double {
        val perDay = days.mapNotNull { day ->
            val pts = day.visits.filter { !it.skipped }.mapNotNull { surfaces[it.poiId] }
            if (pts.size < 2) return@mapNotNull null
            val cLat = pts.sumOf { it.lat } / pts.size
            val cLng = pts.sumOf { it.lng } / pts.size
            pts.sumOf { haversineKm(cLat, cLng, it.lat, it.lng) } / pts.size
        }
        return if (perDay.isEmpty()) 0.0 else perDay.average()
    }

    /** 두 시각이 다 있는 방문만. 없으면 null — 0 으로 채우면 "0분 머물렀다"는 거짓말이 된다. */
    private fun avgDwellMinutes(visits: List<ArchiveVisitView>): Int? {
        val minutes = visits.mapNotNull { v ->
            val from = v.arrivedAt ?: return@mapNotNull null
            val to = v.completedAt ?: return@mapNotNull null
            Duration.between(from, to).toMinutes().takeIf { it >= 0 }
        }
        return if (minutes.isEmpty()) null else minutes.average().roundToInt()
    }

    /** 근거 안에서만 만든다(BR-U5-31) — 실제 다닌 카테고리와 계산된 게이지에서만 나온다. */
    private fun descriptorsOf(breakdown: List<CategoryShare>, gauges: TraitGauges): List<String> {
        val top = breakdown.filter { !it.isOther }.take(2).map { "#${it.category}" }
        val pace = if (gauges.easygoing >= TraitGauges.MAX / 2) "#느긋" else "#부지런"
        return (top + pace).ifEmpty { listOf(pace) }
    }

    /**
     * 임계 미만의 미리보기. **온보딩 취향에서만** 만든다 — 실적이 부족해 실적으로는 만들 수 없고,
     * 그래서 화면이 "정식 아님"을 명시해야 한다(BR-U5-40).
     *
     * 취향도 비어 있으면 디스크립터가 빈 목록이다. 없는 것을 지어내지 않는다 — 화면은 진행도
     * (`현재 N곳/필요 10곳`)만 그린다.
     */
    private fun previewOf(accountId: UUID, current: Int): StylePreview {
        val p = preferences.findPreferences(accountId)
        return StylePreview(
            descriptors = (p.styles + p.foodTastes).distinct().take(PREVIEW_DESCRIPTORS).map { "#$it" },
            current = current,
            required = StyleAnalysis.MIN_VISITS,
        )
    }

    private fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = kotlin.math.sin(dLat / 2) * kotlin.math.sin(dLat / 2) +
            kotlin.math.cos(Math.toRadians(lat1)) * kotlin.math.cos(Math.toRadians(lat2)) *
            kotlin.math.sin(dLng / 2) * kotlin.math.sin(dLng / 2)
        return 2 * EARTH_RADIUS_KM * kotlin.math.asin(kotlin.math.min(1.0, kotlin.math.sqrt(a)))
    }

    private companion object {
        /** 훑는 여행 수 상한. 전량 조회는 없다(`/places` 선례) — 최신 여행이 스타일을 더 잘 말한다. */
        private const val SAMPLE_TRIPS = 20

        /** 미리보기 칩 수. 화면(`l03`)의 칩 줄이 3개다. */
        private const val PREVIEW_DESCRIPTORS = 3

        /** 게이지 잠정 식의 끝값들(O-U5-9). 바뀔 값이라 이름을 붙여 한 곳에 모은다. */
        private const val CALM_PLACES_PER_DAY = 2.0
        private const val BUSY_PLACES_PER_DAY = 7.0
        private const val FOOD_RATIO_FULL = 0.5
        private const val ACTIVE_RADIUS_KM = 5.0

        /** `미식취향` 의 근거가 되는 코드들 — 화면 라벨 `미식` 이 아니라 코드다(O-U5-7). */
        private val FOOD_CATEGORIES = setOf("맛집", "카페")

        private const val EARTH_RADIUS_KM = 6371.0
    }
}
