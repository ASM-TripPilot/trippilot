package com.trippilot.recalculation.application

import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * 출발 기준점 사다리(US-PLANB-10 · BR-U4-19 · 정본 §5).
 *
 * `실측(GPS) → 수동 입력 → 마지막 완료 방문지 → 등록 숙소 앵커` 순으로 내려간다.
 * **차단하지 않는 것이 핵심이다** — 위치를 못 잡았다고 재계획을 막으면, 정작 위치가 불안정한
 * 지하·실내에서 재계획이 가장 필요한데 그때 못 쓴다. 대신 **어떤 가정을 썼는지 밝힌다**
 * ([ReplanOrigin.isEstimated] → 화면의 "추정 출발지" 표기).
 */
@Component
class OriginResolver(private val anchors: BaseAnchorFacade) {

    /**
     * @param requested 클라이언트가 알려준 기준점. GPS·수동 좌표가 있으면 그대로 쓴다.
     * @param lastVisitLat 마지막 완료 방문지 좌표. 방문 실적(`visit_check`)이 아직 없어 지금은 항상 null 이다.
     */
    fun resolve(
        tripId: UUID,
        tripStart: LocalDate,
        tripEnd: LocalDate,
        today: LocalDate,
        requested: ReplanOrigin?,
        lastVisitLat: Double? = null,
        lastVisitLng: Double? = null,
    ): ReplanOrigin {
        // 1·2단: 클라이언트가 좌표를 줬으면 그게 가장 정확하다.
        if (requested != null && requested.lat != null && requested.lng != null) return requested

        // 3단: 마지막 완료 방문지. visit_check(U4 후속)가 도착하면 값이 실린다 —
        // 지금은 자리만 두고, 없으면 조용히 다음 단으로 내려간다.
        if (lastVisitLat != null && lastVisitLng != null) {
            return ReplanOrigin(OriginKind.LAST_VISIT, lastVisitLat, lastVisitLng)
        }

        // 4단: 등록 숙소 앵커. 오늘 밤 숙소가 없으면(체크아웃일) 전날 거점으로 파생한다 —
        // 그 날 사용자는 아직 그 숙소 권역에 있다.
        val stay = anchors.findStayNightAnchors(tripId, tripStart, tripEnd)
            .filter { it.date <= today }
            .maxByOrNull { it.date }
        if (stay != null) return ReplanOrigin(OriginKind.STAY_ANCHOR, stay.lat, stay.lng)

        // 사다리 끝 — 숙소도 없다(숙소 0건 여행은 정상이다, BR-U4-10).
        // **차단하지 않는다.** 좌표 없는 STAY_ANCHOR 로 두고, 재계획 경계가 앵커 없이 푼다.
        log.info("출발 기준점을 좌표로 정하지 못했습니다 — 앵커 없이 진행합니다. tripId={}", tripId)
        return ReplanOrigin(OriginKind.STAY_ANCHOR, null, null)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(OriginResolver::class.java)
    }
}
