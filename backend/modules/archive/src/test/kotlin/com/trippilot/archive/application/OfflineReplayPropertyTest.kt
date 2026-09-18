package com.trippilot.archive.application

import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/** 클라이언트가 오프라인에서 쌓는 조작. [slotIndex] 로 몇 개의 슬롯을 오가는지 흔든다. */
private sealed interface Op {
    val slotIndex: Int
    data class Arrive(override val slotIndex: Int) : Op
    data class Complete(override val slotIndex: Int) : Op
    data class Skip(override val slotIndex: Int) : Op
}

/**
 * 오프라인 큐 재생의 **블로킹 게이트**(PBT-U5-2 · PBT-U5-3).
 *
 * 큐 자체는 기기 로컬이다(BR-U5-17) — 서버가 책임지는 것은 "재생이 안전한가" 둘뿐이다.
 * 예시 몇 개로는 부족하다: 재생 순서·중복·상태 조합이 곱해져 손으로 고른 케이스가 늘 성긴다.
 */
class OfflineReplayPropertyTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-11")
    val base = Instant.parse("2026-08-11T03:00:00Z")

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12")) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    class Visits : VisitCheckRepository {
        val stored = mutableListOf<VisitCheck>()
        override fun save(check: VisitCheck) = check.also {
            stored.removeAll { s -> s.visitCheckId == check.visitCheckId }; stored += it
        }
        override fun findById(visitCheckId: UUID) = stored.firstOrNull { it.visitCheckId == visitCheckId }
        override fun findByTrip(tripId: UUID) = stored.filter { it.tripId == tripId }
        override fun findBySlot(tripId: UUID, slotKey: String) =
            stored.firstOrNull { it.tripId == tripId && it.slotKey == slotKey }
    }

    class Sink : DomainEventPublisher {
        override fun publish(event: DomainEvent) = Unit
    }

    /** 매 호출마다 1초 진행 — 재생마다 `updatedAt` 이 달라져 "상태가 같다"를 시각으로 속일 수 없다. */
    fun ticking() = object : Clock() {
        private var t = base
        override fun instant(): Instant = t.also { t = t.plusSeconds(1) }
        override fun getZone(): ZoneOffset = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId) = this
    }

    /** 아무 순서나 — 서버가 **어떤 입력에도** 금지 상태를 만들지 않는지 보는 데 쓴다(PBT-U5-2). */
    val opArb: Arb<Op> = arbitrary {
        val slot = Arb.int(0, 2).bind()
        when (Arb.element("arrive", "complete", "skip").bind()) {
            "arrive" -> Op.Arrive(slot)
            "complete" -> Op.Complete(slot)
            else -> Op.Skip(slot)
        }
    }

    /**
     * **클라이언트가 실제로 만들 수 있는 큐**(PBT-U5-3 용).
     *
     * 멱등을 아무 순서에나 요구하면 안 된다 — `Complete` 가 `Arrive` 앞에 오는 큐는 사용자가 만들 수
     * 없고(도착을 눌러야 완료 버튼이 생긴다), BR-U5-18 은 큐를 **입력 순서대로** 재생한다고 정한다.
     * 그런 입력으로 재면 서버가 아니라 **테스트 모델이 틀린 것**을 잡게 된다.
     *
     * 대신 진짜 위험한 두 가지는 그대로 흔든다 — 재시도로 **같은 조작이 두 번** 쌓이는 것과,
     * 여러 슬롯이 **임의로 뒤섞이는** 것. 슬롯 안의 상대 순서만 지킨다.
     */
    val wellFormedQueueArb: Arb<List<Op>> = arbitrary {
        val slotCount = Arb.int(1, 3).bind()
        val perSlot = (0 until slotCount).map { i ->
            val ops = mutableListOf<Op>(Op.Arrive(i))
            if (Arb.boolean().bind()) ops += Op.Arrive(i) // 재시도 중복
            when (Arb.element("complete", "skip", "none").bind()) {
                "complete" -> {
                    ops += Op.Complete(i)
                    if (Arb.boolean().bind()) ops += Op.Complete(i)
                }
                "skip" -> {
                    ops += Op.Skip(i)
                    if (Arb.boolean().bind()) ops += Op.Skip(i)
                }
            }
            ops
        }
        val merged = mutableListOf<Op>()
        while (perSlot.any { it.isNotEmpty() }) {
            val idx = Arb.element(perSlot.indices.filter { perSlot[it].isNotEmpty() }).bind()
            merged += perSlot[idx].removeAt(0)
        }
        merged
    }

    /**
     * 큐를 순서대로 재생한다(BR-U5-18). **409 는 실패가 아니다**(BR-U5-20) — 그중
     * `VISIT_ALREADY_RECORDED` 는 원하던 상태가 이미 있다는 뜻이라 클라이언트가 수렴시킨다.
     * 여기서는 그 클라이언트를 흉내 내 삼킨다. 나머지 거절은 그대로 흘려보낸다.
     */
    fun replay(svc: VisitCheckService, visits: Visits, queue: List<Op>) {
        queue.forEach { op ->
            val slotKey = "$day#slot-${op.slotIndex}"
            val poi = UUID.nameUUIDFromBytes(slotKey.toByteArray())
            runCatching {
                when (op) {
                    is Op.Arrive -> svc.arrive(acc, tripId, slotKey, poi, CheckSource.AUTO_GEOFENCE)
                    is Op.Complete -> visits.findBySlot(tripId, slotKey)
                        ?.let { svc.complete(acc, tripId, it.visitCheckId) }
                    is Op.Skip -> visits.findBySlot(tripId, slotKey)
                        ?.let { svc.skip(acc, tripId, it.visitCheckId) }
                }
            }.onFailure { e ->
                // 수렴 가능한 409 만 삼킨다. 다른 거절이 섞여 들어오면 그 자리에서 드러나야 한다.
                val code = (e as? ConflictDetected)?.errorCode
                if (code != ErrorCode.VISIT_ALREADY_RECORDED && code != ErrorCode.VISIT_CONFLICT &&
                    code != ErrorCode.CONFLICT
                ) throw e
            }
        }
    }

    /** 상태 비교에서 id·시각은 뺀다 — 재생마다 달라지는 것이 당연하고, 물어야 할 것은 **결과**다. */
    fun outcome(visits: Visits) = visits.findByTrip(tripId)
        .map { Triple(it.slotKey, it.poiId, Triple(it.arrivedAt != null, it.completedAt != null, it.skippedAt != null)) }
        .toSet()

    // ── PBT-U5-3 ──────────────────────────────────────────────────────
    "PBT-U5-3 같은 큐를 두 번 재생해도 서버 상태가 같다 (멱등)" {
        checkAll(30, wellFormedQueueArb) { queue ->
            val visits = Visits()
            val svc = VisitCheckService(trips, visits, Sink(), ticking())

            replay(svc, visits, queue)
            val afterFirst = outcome(visits)
            replay(svc, visits, queue)

            outcome(visits) shouldBe afterFirst
        }
    }

    "PBT-U5-3 재생을 세 번 해도 두 번째 이후로는 아무것도 늘지 않는다" {
        checkAll(30, wellFormedQueueArb) { queue ->
            val visits = Visits()
            val svc = VisitCheckService(trips, visits, Sink(), ticking())

            replay(svc, visits, queue)
            val rows = visits.stored.size
            replay(svc, visits, queue)
            replay(svc, visits, queue)

            visits.stored.size shouldBe rows
        }
    }

    // ── PBT-U5-2 ──────────────────────────────────────────────────────
    // 임의의 (도착·완료·건너뜀) 조합에서 금지된 상태가 **절대** 만들어지지 않아야 한다.
    "PBT-U5-2 완료<도착 · 완료&건너뜀 동시는 어떤 조작 순서로도 만들어지지 않는다" {
        checkAll(50, Arb.list(opArb, 1..10), Arb.boolean()) { queue, reversed ->
            val visits = Visits()
            val svc = VisitCheckService(trips, visits, Sink(), ticking())

            replay(svc, visits, if (reversed) queue.reversed() else queue)

            visits.findByTrip(tripId).forEach { v ->
                // 완료는 도착 이후여야 한다 — 아니면 파생 체류가 음수가 된다(BR-U5-05).
                if (v.completedAt != null) {
                    (v.arrivedAt != null) shouldBe true
                    (v.completedAt!! < v.arrivedAt!!) shouldBe false
                }
                // "갔다"와 "안 갔다"가 동시에 참일 수 없다.
                (v.completedAt != null && v.skippedAt != null) shouldBe false
            }
        }
    }
})
