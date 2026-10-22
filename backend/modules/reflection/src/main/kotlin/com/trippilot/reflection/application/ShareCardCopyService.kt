package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionVisit
import com.trippilot.reflection.domain.port.ShareCardCopy
import com.trippilot.reflection.domain.port.ShareCardCopyPort
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * j06 공유 카드 문구(US-REC-13 · TRIP-1411) — 캡션 한 문단과 해시태그.
 *
 * **저장하지 않는다.** 카드는 기기에서 그려지고(BR-U5-46) 문구는 공유할 때마다 새로 받는다 — 저장할 사실이 없다.
 *
 * **트랜잭션을 열지 않는다.** 쓰는 것이 없고, AI 호출(최대 `readTimeoutMs`)을 기다리는 동안 DB 커넥션을 쥐지 않기 위해서다(TRIP-1463 교훈).
 * 각 퍼사드가 자기 읽기 트랜잭션을 열고 닫는다.
 *
 * **늘 답이 있다**(INV-4). AI 를 못 부르거나, 못 받거나, 상대가 자기 폴백으로 답하거나, 안 간 곳을 말하면 [ruleCopy] 로 간다 —
 * 이 경우 `isFallback=true` 다. 사유는 로그로 남는다.
 */
@Service
class ShareCardCopyService(
    private val trips: TripFacade,
    private val archive: ArchiveRecordFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val summaries: TripSummaryRepository,
    private val materials: ReflectionMaterials,
    private val copier: ShareCardCopyPort,
) {
    fun copy(accountId: UUID, tripId: UUID): ShareCardCopy {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        // 공유는 여행이 끝나 요약이 생긴 뒤다(BR-U5-48). 화면이 진입점을 막지만, 서버도 같은 규칙을 지킨다 — 진행 중 여행의 문구는
        // "다녀왔다"고 말하게 된다.
        if (!summaries.exists(tripId)) throw ConflictDetected(message = "여행이 끝나 요약이 생긴 뒤에 공유할 수 있어요.")
        val destinations = ctx.destinationRefs.map { it.name.trim() }.filter(String::isNotEmpty).distinct()
        val rule = ruleCopy(destinations)
        if (!copier.enabled) return rule

        val days = archive.findDailyVisits(tripId)
        val surfaces = poiSurfaces.findSurfaces(days.flatMap { d -> d.visits.map { it.poiId } })
        // 건너뛴 방문은 싣지 않는다 — 안 간 곳이 문구가 되면 안 된다(BR-U5-31). 순서는 그날 안의 순서다.
        val shown = days.flatMap { day ->
            day.visits.filterNot { it.skipped }.mapIndexedNotNull { index, v ->
                surfaces[v.poiId]?.let { ReflectionVisit(v.poiId, day.date, it.nameKo, it.category, index + 1, v.photoCount) }
            }
        }
        // 지역은 **첫 목적지 하나**다. 상대 게이트는 해시태그가 지역·방문지 이름을 부분으로 담아야 통과시키는데(`_tag_allowed`),
        // 목적지를 이어 붙인 "서울·부산"은 `#서울여행` 어디에도 들어가지 않아 지역 태그가 전부 위반이 된다. 다목적지 여행의 둘째
        // 목적지 태그는 그래서 상대가 거를 수 있다 — 거르면 아래 규칙 문구(목적지마다 태그)로 간다.
        val region = destinations.firstOrNull().orEmpty()
        if (!ReflectionAgentInput.callable(region, shown)) return rule

        val ai = copier.copy(
            ReflectionAgentInput(
                kind = KIND,
                region = region,
                startDate = ctx.startDate,
                endDate = ctx.endDate,
                visits = shown,
                personaSummary = materials.personaOf(accountId, ctx),
                // 날씨는 비운다 — 근거가 예보뿐이다([ReflectionMaterials] KDoc). 사건도 싣지 않는다: 공개 게시글 문구에 "들르지 못한 곳"·
                // "일정을 바꿨다"는 재료가 아니고, 싣지 않으면 변경 이력(최대 500행) 조회를 공유마다 하지 않아도 된다.
                weatherSummary = null,
                events = emptyList(),
            ),
        ) ?: return rule // 사유는 어댑터가 남겼다
        if (ai.isFallback || ai.caption.isBlank()) {
            // 상대의 폴백은 지역 하나로 짠 문구라(목적지가 여럿이어도 태그 하나) 우리 규칙 문구가 낫다. 빈 캡션은 상대 게이트가 막지만
            // 계약상 막혀 있지 않다 — 빈 문구를 화면에 내리지 않는다.
            log.info("공유 문구 AI 가 폴백·빈 캡션으로 답해 규칙 문구로 갑니다. tripId={} 폴백={}", tripId, ai.isFallback)
            return rule
        }
        val skipped = days.flatMap { it.visits }.filter { it.skipped }.mapNotNull { surfaces[it.poiId]?.nameKo }
        val offending = HallucinationGate.offendingPlaces(
            payload = (listOf(ai.caption) + ai.hashtags).joinToString("\n"),
            bannedPlaceNames = skipped,
            visitedPlaceNames = shown.map { it.poiName },
        )
        if (offending.isNotEmpty()) {
            // 강등 지표(ReflectionMetrics)에는 더하지 않는다 — 그 수치는 회고 카드의 환각률이고, AI 를 계속 켤지의 근거다.
            log.warn("공유 문구 AI 가 안 간 장소를 말해 규칙 문구로 갑니다. tripId={} 장소={}", tripId, offending)
            return rule
        }
        return ai
    }

    companion object {
        private val log = LoggerFactory.getLogger(ShareCardCopyService::class.java)

        /** 상대 요청의 `kind` — 여행 전체가 재료다. */
        private const val KIND = "TRIP_SUMMARY"

        /**
         * 규칙 문구 — 앱이 지금 기기에서 짓는 꼴과 같다(캡션 `… 여행의 기록` · 목적지마다 `#{지역}여행`).
         * 앱은 캡션 앞에 **여행 제목**을 쓰는데, 서버 여행 컨텍스트에는 제목이 없어 목적지 이름으로 쓴다. 태그는 공백을 못 담아 지운다.
         */
        internal fun ruleCopy(destinations: List<String>): ShareCardCopy = ShareCardCopy(
            caption = if (destinations.isEmpty()) "여행의 기록" else "${destinations.joinToString("·")} 여행의 기록",
            hashtags = destinations.map { "#${it.filterNot(Char::isWhitespace)}여행" }.distinct(),
            isFallback = true,
        )
    }
}
