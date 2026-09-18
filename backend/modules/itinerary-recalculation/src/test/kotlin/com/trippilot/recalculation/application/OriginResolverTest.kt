package com.trippilot.recalculation.application

import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.LocalDate
import java.util.UUID

/**
 * 출발 기준점 사다리(BR-U4-19 · 정본 §5): 실측 → 수동 → 마지막 완료 방문지 → 숙소 앵커.
 *
 * **차단하지 않는 것이 핵심이다.** 위치를 못 잡았다고 재계획을 막으면, 정작 위치가 불안정한
 * 지하·실내에서 재계획이 가장 필요한데 그때 못 쓴다.
 */
class OriginResolverTest : StringSpec({

    val tripId = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-10")
    val end = LocalDate.parse("2026-08-12")
    val today = LocalDate.parse("2026-08-11")

    fun resolver(vararg anchors: DayAnchorView) = OriginResolver(
        object : BaseAnchorFacade {
            override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = anchors.toList()
        },
    )

    "실측 좌표가 있으면 그대로 쓴다 — 가장 정확하다" {
        val gps = ReplanOrigin(OriginKind.GPS, 33.45, 126.56)
        resolver().resolve(tripId, start, end, today, gps) shouldBe gps
    }

    "수동 핀도 그대로 쓴다 — 다만 추정 출발지로 표기된다" {
        val manual = ReplanOrigin(OriginKind.MANUAL, 35.1, 129.0)
        val resolved = resolver().resolve(tripId, start, end, today, manual)
        resolved shouldBe manual
        resolved.isEstimated shouldBe true
    }

    "좌표가 없으면 마지막 완료 방문지로 내려간다" {
        val resolved = resolver().resolve(
            tripId, start, end, today, requested = null, lastVisitLat = 37.5, lastVisitLng = 127.0,
        )
        resolved.kind shouldBe OriginKind.LAST_VISIT
        resolved.lat shouldBe 37.5
        resolved.isEstimated shouldBe true
    }

    "방문지도 없으면 숙소 앵커 — 오늘까지의 가장 최근 숙박일을 쓴다" {
        val resolved = resolver(
            DayAnchorView(LocalDate.parse("2026-08-10"), 33.1, 126.1),
            DayAnchorView(LocalDate.parse("2026-08-11"), 33.2, 126.2),
            DayAnchorView(LocalDate.parse("2026-08-12"), 33.3, 126.3), // 미래 숙박일은 쓰지 않는다
        ).resolve(tripId, start, end, today, requested = null)

        resolved.kind shouldBe OriginKind.STAY_ANCHOR
        resolved.lat shouldBe 33.2
    }

    "체크아웃일에는 전날 거점을 쓴다 — 그 날 사용자는 아직 그 권역에 있다" {
        val resolved = resolver(DayAnchorView(LocalDate.parse("2026-08-11"), 33.2, 126.2))
            .resolve(tripId, start, end, LocalDate.parse("2026-08-12"), requested = null)
        resolved.lat shouldBe 33.2
    }

    "숙소가 하나도 없어도 막지 않는다 — 좌표 없이 진행한다(BR-U4-10)" {
        val resolved = resolver().resolve(tripId, start, end, today, requested = null)
        resolved.kind shouldBe OriginKind.STAY_ANCHOR
        resolved.lat shouldBe null
        resolved.isEstimated shouldBe true
    }

    "좌표 없는 요청은 사다리를 그대로 탄다 — 종류만 보내고 좌표를 못 준 경우" {
        val resolved = resolver(DayAnchorView(today, 33.2, 126.2))
            .resolve(tripId, start, end, today, requested = ReplanOrigin(OriginKind.LAST_VISIT, null, null))
        resolved.kind shouldBe OriginKind.STAY_ANCHOR // 좌표가 없으면 그 단은 쓸 수 없다
    }
})
