package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.SlotCandidatesEmptyReason
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.GroundedPlace
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * AI 없이 만드는 슬롯 교체 후보(DEC-U3-5 폴백).
 *
 * 여기서 지키는 것은 셋이다.
 * 1. **후보는 닫힌 풀에서만** 온다(INV-1) — 이미 일정에 있는 곳은 빠진다
 * 2. **0건이면 반경을 한 번 넓힌다** — 넓힌 사실을 `radiusMUsed` 로 돌려줘야 화면이 말할 수 있다
 * 3. **강등을 숨기지 않는다** — 순위가 AI 가 아니라는 사실이 값으로 나간다(INV-4)
 */
class LocalSlotCandidateSourceTest : StringSpec({

    val clock: Clock = Clock.fixed(Instant.parse("2026-08-20T03:00:00Z"), ZoneOffset.UTC)
    val near = UUID.randomUUID()
    val far = UUID.randomUUID()
    val excluded = UUID.randomUUID()

    /**
     * **교체 대상 슬롯의 장소**. 후보와 같은 id 로 두면 안 된다 — 실제 흐름에서 이 장소는 언제나
     * 현재 일정에 있으므로 후보가 될 수 없고, 섞어 두면 "자기 자신을 자기 대체로 제안"하는 실수를 못 잡는다.
     */
    val target = UUID.randomUUID()

    /** 반경이 넓어져야만 [far] 가 보이는 풀 — "넓히기"가 실제로 도는지 보려면 이 구분이 필요하다. */
    class Pool(private val wideOnly: UUID? = null, private val nearIds: List<Pair<UUID, Double>> = emptyList()) :
        CandidatePoolPort {
        override fun resolve(area: Area, categories: Set<String>): List<GroundedPlace> {
            val radius = (area as Area.Radius).radiusM
            val ids = nearIds.toMutableList()
            if (radius > 3_000 && wideOnly != null) ids += wideOnly to 9_000.0
            return ids.map { (id, d) -> GroundedPlace(id, "장소-$id", 33.45, 126.56, "카페", null, d) }
        }
        override fun ground(poiIds: List<UUID>) = emptyList<GroundedPlace>()
    }

    fun input(exclude: List<UUID> = emptyList(), radiusM: Int? = null) = SlotCandidatesInput(
        tripId = UUID.randomUUID(),
        slotKey = "2026-09-01#$target",
        neighborSlotKeys = emptyList(),
        centerLat = 33.45, centerLng = 126.56,
        radiusM = radiusM, concept = null, excludePoiIds = exclude,
        requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), 20_000L),
    )

    "가까운 순으로 후보를 돌려준다" {
        val out = LocalSlotCandidateSource(Pool(nearIds = listOf(far to 2_500.0, near to 300.0)), clock)
            .propose(input(), degraded = true)

        out.candidates.map { it.poiId } shouldBe listOf(near, far)
        out.candidates.first().distanceRange shouldBe "약 0.3km"
    }

    "이미 일정에 있는 장소는 후보에서 빠진다" {
        val out = LocalSlotCandidateSource(Pool(nearIds = listOf(near to 300.0, excluded to 400.0)), clock)
            .propose(input(exclude = listOf(excluded)), degraded = true)

        out.candidates.map { it.poiId } shouldBe listOf(near)
    }

    "교체 대상 자신은 후보가 아니다 — 자기 자리를 자기로 바꾸라고 제안하지 않는다" {
        val out = LocalSlotCandidateSource(Pool(nearIds = listOf(target to 0.0, near to 300.0)), clock)
            .propose(input(), degraded = true)

        out.candidates.map { it.poiId } shouldBe listOf(near)
    }

    /**
     * 0건의 **이유**가 갈려야 화면이 다른 말을 한다. 뭉뚱그리면 사용자가 반경만 계속 넓히며 헛돈다.
     */
    "주변이 비면 NO_NEARBY — 넓히기가 통한다는 뜻이다" {
        val out = LocalSlotCandidateSource(Pool(), clock).propose(input(), degraded = true)

        out.candidates shouldBe emptyList()
        out.emptyReason shouldBe SlotCandidatesEmptyReason.NO_NEARBY
    }

    "주변이 전부 일정에 있으면 ALL_IN_ITINERARY — 넓혀도 같은 결과다" {
        val out = LocalSlotCandidateSource(Pool(nearIds = listOf(excluded to 400.0)), clock)
            .propose(input(exclude = listOf(excluded)), degraded = true)

        out.candidates shouldBe emptyList()
        // 같은 0건이지만 사용자가 할 일이 정반대다.
        out.emptyReason shouldBe SlotCandidatesEmptyReason.ALL_IN_ITINERARY
    }

    "후보가 있으면 사유는 없다" {
        val out = LocalSlotCandidateSource(Pool(nearIds = listOf(near to 300.0)), clock)
            .propose(input(), degraded = true)

        out.emptyReason shouldBe null
    }

    /** 0건일 때 조용히 빈 목록을 주면 사용자가 반경을 넓혀도 왜 0건인지 알 수 없다(h15). */
    "후보가 0건이면 반경을 넓혀 다시 보고 그 반경을 알린다" {
        val out = LocalSlotCandidateSource(Pool(wideOnly = far), clock).propose(input(), degraded = true)

        out.candidates.map { it.poiId } shouldBe listOf(far)
        out.radiusMUsed shouldBe 12_000
    }

    /**
     * **이 값이 이 폴백의 존재 이유를 사용자에게 알리는 유일한 통로다.** 숨기면 취향이 반영된 줄 알고,
     * 우리는 TRIP-408 이 남았다는 사실을 잊는다.
     */
    "AI 순위가 아님을 결과에 싣는다" {
        val pool = Pool(nearIds = listOf(near to 300.0))
        LocalSlotCandidateSource(pool, clock).propose(input(), degraded = true)
            .freshness.degraded shouldBe true
        LocalSlotCandidateSource(pool, clock).propose(input(), degraded = false)
            .freshness.degraded shouldBe false
    }
})
