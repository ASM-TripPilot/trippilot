package com.trippilot.recalculation.application

import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.itinerarygeneration.api.ReplanSlot
import com.trippilot.recalculation.adapter.`in`.web.ReplanDiffEntryResponse
import com.trippilot.recalculation.adapter.`in`.web.ReplanDiffResponse
import com.trippilot.recalculation.adapter.`in`.web.ReplanDiffSlotResponse
import com.trippilot.recalculation.adapter.`in`.web.ReplanImpactResponse
import com.trippilot.recalculation.domain.ReplanDiff
import com.trippilot.recalculation.domain.ReplanStatus
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import io.kotest.core.spec.style.StringSpec
import io.mockk.every
import io.mockk.mockk
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 확정 전 전후 비교(US-PLANB-08 · BR-U4-25·29 · TRIP-559).
 *
 * 여기서 지키는 것은 셋이다:
 * - **초안이 나오기 전에는 비교가 없다**(INV-U4-05) — 404 가 아니라 `ready=false`
 * - **빠진 항목이 조용히 사라지지 않는다**(BR-U4-25) — `REMOVED` 로 실린다
 * - **소요시간 필드가 없다**(INV-3) — 전후 스냅숏은 시각·순서만
 */
class ReplanDiffServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-11")
    val kept = UUID.randomUUID()
    val dropped = UUID.randomUUID()
    val added = UUID.randomUUID()

    fun slotKey(poi: UUID) = "$day#$poi"

    fun planned(poi: UUID, start: String, end: String, order: Int) = PlannedSlotView(
        slotKey = slotKey(poi), date = day, poiId = poi, orderIndex = order,
        startAt = LocalTime.parse(start), endAt = LocalTime.parse(end), endsNextDay = false,
    )

    fun draftSlot(poi: UUID, start: String, end: String, fixed: Boolean = false) = ReplanSlot(
        poiId = poi, startAt = LocalTime.parse(start), endAt = LocalTime.parse(end),
        isFixed = fixed, endsNextDay = false, distanceRange = "가까움", placementReason = null,
    )


    /**
     * 세션 하나. `ReplanSessionService` 는 final 이라 상속 대역을 만들 수 없고, 그 안의 소유 검증을
     * 테스트가 다시 구현하면 규칙이 두 곳이 된다 — 그래서 목으로 그 경계만 끊는다.
     */
    fun session(status: ReplanStatus, draft: Map<String, Any>?) = ReplanSession.start(
        tripId = tripId, itineraryId = UUID.randomUUID(), triggerId = null,
        scope = ReplanScope.FULL_DAY, fromInstant = Instant.parse("2026-08-11T01:00:00Z"),
        origin = ReplanOrigin(OriginKind.STAY_ANCHOR, null, null),
        reasons = listOf("WEATHER"), directives = emptyList(), freeText = null,
        excludedPoiIds = emptyList(), at = Instant.parse("2026-08-11T01:00:00Z"),
    ).copy(status = status, draft = draft)

    fun sessionsOf(status: ReplanStatus, draft: Map<String, Any>?): ReplanSessionService =
        mockk<ReplanSessionService>().also {
            every { it.get(any(), any(), any()) } returns session(status, draft)
        }

    fun plansOf(vararg slots: PlannedSlotView) = object : ItineraryPlanFacade {
        override fun findPlanSlots(accountId: UUID, tripId: UUID) = slots.toList()
    }

    "초안이 나오기 전에는 비교가 없다 — 404 가 아니라 ready=false(INV-U4-05)" {
        listOf(ReplanStatus.COLLECTING, ReplanStatus.SOLVING).forEach { status ->
            val view = ReplanDiffService(sessionsOf(status, null), plansOf()).diff(acc, tripId, UUID.randomUUID())

            view.ready shouldBe false
            view.date shouldBe null
            view.result shouldBe null
            // 화면은 오류가 아니라 진행 상태를 그린다 — 그 판단의 근거가 status 다.
            view.status shouldBe status
        }
    }

    "확정·취소한 세션은 초안을 들고 있어도 비교하지 않는다" {
        val proposal = ReplanProposal(UUID.randomUUID(), day, listOf(draftSlot(kept, "10:00", "11:00")))

        // 확정·취소해도 `draft` jsonb 는 남는다(이력). 상태를 안 보면 **끝난 세션의 초안**이
        // 살아 있는 비교로 나간다 — APPLIED 는 이미 반영돼 before 와 같아 "바뀐 게 없다"는
        // 거짓 요약이 되고, CANCELED 는 사용자가 버린 안을 다시 들이민다.
        listOf(ReplanStatus.APPLIED, ReplanStatus.CANCELED).forEach { status ->
            val view = ReplanDiffService(
                sessionsOf(status, proposal.toMap()),
                plansOf(planned(kept, "10:00", "11:00", 0)),
            ).diff(acc, tripId, UUID.randomUUID())

            view.ready shouldBe false
            view.after.shouldBeEmpty()
            view.status shouldBe status
        }
    }

    "DRAFT 라도 초안이 비어 있으면 비교하지 않는다" {
        val svc = ReplanDiffService(
            sessionsOf(ReplanStatus.NO_SOLUTION, null),
            plansOf(planned(kept, "10:00", "11:00", 0)),
        )

        val view = svc.diff(acc, tripId, UUID.randomUUID())

        view.ready shouldBe false
        view.before.shouldBeEmpty()
        view.after.shouldBeEmpty()
    }

    "빠진 항목이 REMOVED 로 실린다 — 조용히 사라지지 않는다(BR-U4-25)" {
        val proposal = ReplanProposal(
            itineraryId = UUID.randomUUID(), date = day,
            slots = listOf(draftSlot(kept, "10:00", "11:00"), draftSlot(added, "13:00", "14:00")),
        )
        val svc = ReplanDiffService(
            sessionsOf(ReplanStatus.DRAFT, proposal.toMap()),
            plansOf(planned(kept, "10:00", "11:00", 0), planned(dropped, "15:00", "16:00", 1)),
        )

        val view = svc.diff(acc, tripId, UUID.randomUUID())

        view.ready shouldBe true
        view.date shouldBe day
        val changes = view.result!!.entries.associate { it.slotKey to it.change }
        changes[slotKey(kept)] shouldBe ReplanDiff.Change.UNCHANGED
        changes[slotKey(added)] shouldBe ReplanDiff.Change.ADDED
        changes[slotKey(dropped)] shouldBe ReplanDiff.Change.REMOVED
    }

    "다른 날짜의 계획은 비교에 섞이지 않는다 — 지표가 여행 전체 값이 되면 과장된다" {
        val other = UUID.randomUUID()
        val proposal = ReplanProposal(UUID.randomUUID(), day, listOf(draftSlot(kept, "10:00", "11:00")))
        val svc = ReplanDiffService(
            sessionsOf(ReplanStatus.DRAFT, proposal.toMap()),
            plansOf(
                planned(kept, "10:00", "11:00", 0),
                planned(other, "10:00", "11:00", 0).copy(date = day.plusDays(1), slotKey = "${day.plusDays(1)}#$other"),
            ),
        )

        val view = svc.diff(acc, tripId, UUID.randomUUID())

        view.before.map { it.slotKey } shouldContainExactly listOf(slotKey(kept))
        // 다른 날을 섞었다면 REMOVED 가 하나 더 생겨 "한 곳이 빠졌다"는 거짓 요약이 된다.
        view.result!!.entries.none { it.change == ReplanDiff.Change.REMOVED } shouldBe true
    }

    "거리를 모르면 총 이동 변화는 null 이다 — 0 으로 채우지 않는다" {
        val proposal = ReplanProposal(UUID.randomUUID(), day, listOf(draftSlot(kept, "10:00", "11:00")))
        val svc = ReplanDiffService(
            sessionsOf(ReplanStatus.DRAFT, proposal.toMap()),
            plansOf(planned(kept, "10:00", "11:00", 0)),
        )

        val impact = svc.diff(acc, tripId, UUID.randomUUID()).result!!.impact

        // 초안은 거리를 구간 문구로만 들고 있어 미터를 모른다 — 모른다고 말하는 것이 정답이다.
        impact.totalDistanceDeltaM shouldBe null
        impact.visitCountDelta shouldBe 0
    }

    "거리를 아는 쪽이 생겨도 다른 쪽을 모르면 총합은 여전히 null 이다" {
        val proposal = ReplanProposal(UUID.randomUUID(), day, listOf(draftSlot(kept, "10:00", "11:00")))
        val svc = ReplanDiffService(sessionsOf(ReplanStatus.DRAFT, proposal.toMap()), plansOf(planned(kept, "10:00", "11:00", 0)))

        val view = svc.diff(acc, tripId, UUID.randomUUID())

        // 이 서비스는 **양쪽 모두** 거리를 모른다고 싣는다(초안·계획 어느 쪽도 미터를 들고 있지 않다).
        // 한쪽이라도 0 으로 채우면 총합이 0 으로 나와 "거리가 그대로다"라는 없는 사실이 생긴다.
        view.before.all { it.distanceM == null } shouldBe true
        view.after.all { it.distanceM == null } shouldBe true
        view.result!!.impact.totalDistanceDeltaM shouldBe null
    }

    "INV-3 응답 어디에도 소요시간 필드가 없다" {
        val forbidden = listOf("duration", "durationMin", "travelTime", "eta", "dwell")
        val fields = listOf(
            ReplanDiffResponse::class, ReplanDiffSlotResponse::class,
            ReplanDiffEntryResponse::class, ReplanImpactResponse::class,
        ).flatMap { it.java.declaredFields.map { f -> f.name } }

        val hits = fields.filter { f -> forbidden.any { f.contains(it, ignoreCase = true) } }

        // `returnTimeDeltaMinutes` 는 이동 소요가 아니라 **복귀 시각이 밀린 정도**라 걸리지 않는다.
        hits.shouldBeEmpty()
    }
})
