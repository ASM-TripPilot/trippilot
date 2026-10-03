package com.trippilot.recalculation.application

import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.itinerarygeneration.api.ReplanSlot
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
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
import io.kotest.property.Arb
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.pair
import io.kotest.property.checkAll
import io.mockk.every
import io.mockk.mockk
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Duration
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

    fun planned(
        poi: UUID,
        start: String,
        end: String,
        order: Int,
        fixed: Boolean = false,
        endsNextDay: Boolean = false,
    ) = PlannedSlotView(
        slotKey = slotKey(poi), date = day, poiId = poi, orderIndex = order,
        startAt = LocalTime.parse(start), endAt = LocalTime.parse(end),
        isFixed = fixed, endsNextDay = endsNextDay,
    )

    fun draftSlot(poi: UUID, start: String, end: String, fixed: Boolean = false, endsNextDay: Boolean = false) =
        ReplanSlot(
            poiId = poi, startAt = LocalTime.parse(start), endAt = LocalTime.parse(end),
            isFixed = fixed, endsNextDay = endsNextDay, distanceRange = "가까움", placementReason = null,
            hasViolation = false, violationReason = null,
        )


    /**
     * 세션 하나. `ReplanSessionService` 는 final 이라 상속 대역을 만들 수 없고, 그 안의 소유 검증을
     * 테스트가 다시 구현하면 규칙이 두 곳이 된다 — 그래서 목으로 그 경계만 끊는다.
     */
    fun session(status: ReplanStatus, draft: Map<String, Any>?) = ReplanSession.start(
        tripId = tripId, itineraryId = UUID.randomUUID(), triggerId = null,
        scope = ReplanScope.FULL_DAY, targetDate = LocalDate.of(2026, 8, 11),
        fromInstant = Instant.parse("2026-08-11T01:00:00Z"),
        origin = ReplanOrigin(OriginKind.STAY_ANCHOR, null, null),
        reasons = listOf("WEATHER"), directives = emptyList(), freeText = null,
        excludedPoiIds = emptyList(), at = Instant.parse("2026-08-11T01:00:00Z"),
    ).copy(status = status, draft = draft)

    fun sessionsOf(status: ReplanStatus, draft: Map<String, Any>?): ReplanSessionService =
        mockk<ReplanSessionService>().also {
            every { it.get(any(), any(), any()) } returns session(status, draft)
        }

    /** 표면 대역 — 있는 poiId 만 돌려준다(정본에 없으면 표면 없음). 호출 횟수도 센다(N+1 금지 AC). */
    class FakeSurfaces(private val known: Map<UUID, PoiSurfaceView> = emptyMap()) : PoiSurfaceFacade {
        var calls = 0
        override fun findSurfaces(poiIds: Collection<UUID>): Map<UUID, PoiSurfaceView> {
            calls++
            return poiIds.mapNotNull { id -> known[id]?.let { id to it } }.toMap()
        }
        override fun findFrozenSurfaces(snapshotIds: Collection<UUID>) =
            error("초안 표면은 동결 조회 대상이 아니다(TRIP-1060)")
    }

    fun surface(id: UUID, name: String) = PoiSurfaceView(id, name, 34.64, 126.76, "명소", "SIGHT", null, "https://img/$name.jpg", emptyList())

    /** 표면 대역은 기본 빈 것 — 표면을 보는 스펙만 명시로 넣는다. */
    fun diffService(sessions: ReplanSessionService, plans: ItineraryPlanFacade, surfaces: PoiSurfaceFacade = FakeSurfaces()) =
        ReplanDiffService(sessions, plans, surfaces)

    fun plansOf(vararg slots: PlannedSlotView) = object : ItineraryPlanFacade {
        override fun findPlanSlots(accountId: UUID, tripId: UUID) = slots.toList()
        // 이 스펙들은 계획 시각만 본다 — 문구 재료(TRIP-883)는 쓰지 않는다.
        override fun findPlannedPlaces(accountId: UUID, tripId: UUID) =
            emptyMap<java.time.LocalDate, List<com.trippilot.itinerarygeneration.api.PlannedPlaceView>>()
    }

    "초안이 나오기 전에는 비교가 없다 — 404 가 아니라 ready=false(INV-U4-05)" {
        listOf(ReplanStatus.COLLECTING, ReplanStatus.SOLVING).forEach { status ->
            val view = diffService(sessionsOf(status, null), plansOf()).diff(acc, tripId, UUID.randomUUID())

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
            val view = diffService(
                sessionsOf(status, proposal.toMap()),
                plansOf(planned(kept, "10:00", "11:00", 0)),
            ).diff(acc, tripId, UUID.randomUUID())

            view.ready shouldBe false
            view.after.shouldBeEmpty()
            view.status shouldBe status
        }
    }

    "DRAFT 라도 초안이 비어 있으면 비교하지 않는다" {
        val svc = diffService(
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
        val svc = diffService(
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
        val svc = diffService(
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
        val svc = diffService(
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
        val svc = diffService(sessionsOf(ReplanStatus.DRAFT, proposal.toMap()), plansOf(planned(kept, "10:00", "11:00", 0)))

        val view = svc.diff(acc, tripId, UUID.randomUUID())

        // 이 서비스는 **양쪽 모두** 거리를 모른다고 싣는다(초안·계획 어느 쪽도 미터를 들고 있지 않다).
        // 한쪽이라도 0 으로 채우면 총합이 0 으로 나와 "거리가 그대로다"라는 없는 사실이 생긴다.
        view.before.all { it.distanceM == null } shouldBe true
        view.after.all { it.distanceM == null } shouldBe true
        view.result!!.impact.totalDistanceDeltaM shouldBe null
    }

    "원 일정의 고정 여부를 지어내지 않는다 — 계획이 아는 값을 그대로 싣는다" {
        val proposal = ReplanProposal(UUID.randomUUID(), day, listOf(draftSlot(kept, "10:00", "11:00")))
        val svc = diffService(
            sessionsOf(ReplanStatus.DRAFT, proposal.toMap()),
            plansOf(planned(kept, "10:00", "11:00", 0, fixed = true)),
        )

        // false 로 박아 두면 사용자가 못 박아 둔 슬롯이 "고정 아님"으로 보인다 — 거리 null 과 같은 규칙이다.
        svc.diff(acc, tripId, UUID.randomUUID()).before.single().isFixed shouldBe true
    }

    "자정 넘김이 양쪽 다 실린다 — 빠지면 복귀 시각 변화의 부호가 뒤집힌다(HC4)" {
        val proposal = ReplanProposal(
            UUID.randomUUID(), day,
            listOf(draftSlot(kept, "10:00", "19:00")),
        )
        val svc = diffService(
            sessionsOf(ReplanStatus.DRAFT, proposal.toMap()),
            // 원 일정은 익일 00:30 에 끝난다 — 진짜로는 5시간 30분 당겨진다.
            plansOf(
                planned(kept, "10:00", "11:00", 0),
                planned(added, "22:00", "00:30", 1, endsNextDay = true),
            ),
        )

        val view = svc.diff(acc, tripId, UUID.randomUUID())

        view.before.single { it.slotKey == slotKey(added) }.endsNextDay shouldBe true
        view.result!!.impact.returnTimeDelta shouldBe Duration.ofMinutes(-330)
    }

    /**
     * 초안의 이동 거리가 **응답까지 간다**(TRIP-854 B-5). 초안 jsonb 에만 담고 아무도 안 읽으면
     * 그 칸은 죽은 컬럼이고, `i08` 의 이동 지표는 여전히 나오지 않는다.
     *
     * 델타(`totalDistanceDeltaM`)는 **여전히 null 이다** — 원 일정 쪽에 미터 값이 없다. 그 사실을
     * 여기 못 박아 둔다: 절대값이 생겼다고 델타가 생긴 것처럼 읽히면 화면이 뺄셈을 시도한다.
     */
    "초안의 이동 거리가 비교 결과에 실린다 — 델타는 여전히 모른다" {
        val proposal = ReplanProposal(
            UUID.randomUUID(), day, listOf(draftSlot(kept, "10:00", "11:00")), totalDistanceKm = 6.9,
        )
        val svc = diffService(
            sessionsOf(ReplanStatus.DRAFT, proposal.toMap()),
            plansOf(planned(kept, "10:00", "11:00", 0)),
        )

        val view = svc.diff(acc, tripId, UUID.randomUUID())

        view.totalDistanceKm shouldBe 6.9
        ReplanDiffResponse.from(view).impact!!.totalDistanceKm shouldBe 6.9
        // 원 일정에 미터가 없어 뺄셈이 성립하지 않는다 — 0 으로 채우면 거짓 요약이 된다.
        ReplanDiffResponse.from(view).impact!!.totalDistanceDeltaM shouldBe null
    }

    // ─── POI 표면(TRIP-1060 · QA #045 — 재계획이 새로 넣은 7곳 전부 "이름 준비 중") ───

    "after 의 새 장소에 표면이 실린다 — 정본에 없는 것은 null, 조회는 한 번(N+1 금지)" {
        val proposal = ReplanProposal(
            UUID.randomUUID(), day,
            slots = listOf(draftSlot(added, "10:00", "11:00"), draftSlot(kept, "13:00", "14:00")),
        )
        val surfaces = FakeSurfaces(mapOf(added to surface(added, "가우도 출렁다리"))) // kept 는 정본에서 사라졌다
        val view = diffService(
            sessionsOf(ReplanStatus.DRAFT, proposal.toMap()),
            plansOf(),
            surfaces,
        ).diff(acc, tripId, UUID.randomUUID())

        val byKey = view.after.associateBy { it.slotKey }
        byKey.getValue(slotKey(added)).nameKo shouldBe "가우도 출렁다리"
        byKey.getValue(slotKey(added)).imageUrl shouldBe "https://img/가우도 출렁다리.jpg"
        byKey.getValue(slotKey(added)).category shouldBe "명소"
        byKey.getValue(slotKey(added)).lat shouldBe 34.64
        byKey.getValue(slotKey(added)).lng shouldBe 126.76
        // 정본에서 사라진 장소 — 이름을 지어내지 않되 항목은 빠지지 않는다(INV-1 · BR-U4-25)
        byKey.getValue(slotKey(kept)).nameKo shouldBe null
        byKey.getValue(slotKey(kept)).imageUrl shouldBe null
        surfaces.calls shouldBe 1
    }

    "before 의 표면은 C8 이 준 값 그대로다 — 동결 규칙이 두 응답에서 갈리지 않는다(INV-U1-03)" {
        val proposal = ReplanProposal(UUID.randomUUID(), day, listOf(draftSlot(kept, "10:00", "11:00")))
        val frozenNamed = planned(dropped, "15:00", "16:00", 1).copy(
            nameKo = "동결된 옛 이름", category = "맛집", imageUrl = null, lat = 34.0, lng = 126.0,
        )
        val view = diffService(
            sessionsOf(ReplanStatus.DRAFT, proposal.toMap()),
            plansOf(frozenNamed),
        ).diff(acc, tripId, UUID.randomUUID())

        val b = view.before.single()
        b.nameKo shouldBe "동결된 옛 이름"
        b.category shouldBe "맛집"
        b.lat shouldBe 34.0
    }

    "ready=false 면 표면 조회를 하지 않는다" {
        val surfaces = FakeSurfaces()
        diffService(sessionsOf(ReplanStatus.SOLVING, null), plansOf(), surfaces)
            .diff(acc, tripId, UUID.randomUUID())

        surfaces.calls shouldBe 0
    }

    /**
     * 표면 부착은 **장식**이다(TRIP-1060 AC-속성) — 비교의 뼈대(길이·순서·slotKey)를 절대 바꾸지 않고,
     * 표면이 붙는 항목은 정본에 있는 poiId 항목과 정확히 같다.
     */
    "임의 초안·계획에서 표면 부착이 길이·순서·slotKey 를 바꾸지 않고 부착 집합은 정본 집합과 같다" {
        checkAll(Arb.list(Arb.pair(Arb.int(0..9), Arb.boolean()), 0..12), Arb.list(Arb.int(0..9), 0..8)) { draftPicks, planPicks ->
            val pois = List(10) { UUID.randomUUID() }
            val known = draftPicks.filter { it.second }.map { pois[it.first] }.toSet()
            val slots = draftPicks.mapIndexed { i, (p, _) ->
                draftSlot(pois[p], "%02d:00".format(9 + (i % 12)), "%02d:30".format(9 + (i % 12)))
            }
            val proposal = ReplanProposal(UUID.randomUUID(), day, slots)
            val plannedSlots = planPicks.mapIndexed { i, p -> planned(pois[p], "%02d:00".format(9 + (i % 12)), "%02d:30".format(9 + (i % 12)), i) }

            val view = diffService(
                sessionsOf(ReplanStatus.DRAFT, proposal.toMap()),
                plansOf(*plannedSlots.toTypedArray()),
                FakeSurfaces(known.associateWith { surface(it, "n-$it") }),
            ).diff(acc, tripId, UUID.randomUUID())

            // (1) 뼈대 보존 — 길이·순서·slotKey
            view.after.map { it.slotKey } shouldBe slots.map { slotKey(it.poiId) }
            view.before.map { it.slotKey } shouldBe plannedSlots.map { it.slotKey }
            // (2) 부착 집합 = 정본 존재 집합
            view.after.filter { it.nameKo != null }.map { it.slotKey }.toSet() shouldBe
                slots.filter { it.poiId in known }.map { slotKey(it.poiId) }.toSet()
        }
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
