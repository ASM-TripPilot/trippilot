package com.trippilot.notification.application

import com.trippilot.itinerarygeneration.api.PlannedPlaceView
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.PropTestConfig
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.long
import io.kotest.property.checkAll
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 리마인드 문구 **제자리 채우기**의 불변식 — 상대가 어떻게 답하든(일부만 주든, 아무것도 안 주든, 보낸 적 없는 키를 섞든)
 * 지켜져야 하는 것들. 예시 테스트는 시나리오 하나씩만 보지만, 이 규칙들은 **모든 응답 열**에서 성립해야 한다.
 *
 * 1. **행은 그대로다** — 채우기는 행을 지우고 다시 만들지 않는다(같은 id 집합).
 * 2. **앞서 붙은 문구는 안 바뀐다** — 나중 응답이 먼저 붙은 문구를 덮지 않는다(단조).
 * 3. **자기 키의 문구만 붙는다** — 엉뚱한 행에 붙으면 사용자 화면에 "다른 날 이야기"가 뜬다.
 * 4. **재료가 없는 행에는 안 붙는다** — 빈 재료로는 묻지도 않으니 문구가 생길 수 없다.
 * 5. **문구가 있는 행 수는 줄지 않는다.**
 */
class ReminderCopyFillPropertyTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC)
    val start = LocalDate.parse("2026-08-10")

    /**
     * 호출 k 번째 응답을 [script] 가 정한다. 실 어댑터처럼 **재료가 빈 항목은 건너뛴다.**
     * 줄 항목은 순번별 참/거짓(비어 있으면 전부 준다), [junk] 면 요청하지 않은 키의 문구를 하나 섞는다.
     */
    class Scripted(private val script: List<List<Boolean>>, private val junk: Boolean) : ReminderCopyPort {
        override val enabled = true
        private var call = 0
        val shownWithMaterial = mutableSetOf<String>()

        override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
            val k = call++
            val usable = items.filter { it.slots.isNotEmpty() }
            shownWithMaterial += usable.map { it.scheduleKey }
            val flags = script[k % script.size]
            val given = usable.withIndex()
                .filter { (j, _) -> flags.isEmpty() || flags[j % flags.size] }
                .associate { (_, item) -> item.scheduleKey to ReminderCopy("T$k-${item.scheduleKey}", "B$k-${item.scheduleKey}") }
            return if (junk) given + (UUID.randomUUID().toString() to ReminderCopy("남의 제목", "남의 본문")) else given
        }
    }

    "어떤 응답 열이 와도 채우기는 행을 안 바꾸고, 앞서 붙은 문구를 안 덮고, 자기 키·재료 있는 행에만 붙인다" {
        checkAll(
            PropTestConfig(iterations = 80),
            Arb.int(1..6),
            Arb.list(Arb.boolean(), 1..6),
            Arb.list(Arb.list(Arb.boolean(), 0..10), 1..6),
            Arb.boolean(),
        ) { days, material, script, junk ->
            val names = (0 until days).filter { material[it % material.size] }
                .associate { start.plusDays(it.toLong()) to listOf(PlannedPlaceView("곳$it", "SIGHT")) }
            val port = Scripted(script, junk)
            val schedules = FakeSchedules()
            val trips = FakeTripOwner().apply { put(tripId, acc, start, start.plusDays(days - 1L)) }
            val svc = NotificationScheduleService(trips, schedules, port, FakePlans(names), clock, ReminderCopyRetries(listOf(1L)), NoDeletionPending)

            svc.reload(tripId)
            var prev: Map<UUID, NotificationSchedule> = schedules.findPendingByTrip(tripId).associateBy { it.scheduleId }

            fun check(now: Map<UUID, NotificationSchedule>) {
                now.keys shouldBe prev.keys                                         // 1. 같은 행
                now.forEach { (id, row) ->
                    prev.getValue(id).takeIf { it.hasCopy }                          // 2. 앞서 붙은 문구 불변
                        ?.let { (row.title to row.body) shouldBe (it.title to it.body) }
                    if (row.hasCopy) {
                        row.title!!.endsWith(id.toString()) shouldBe true            // 3. 자기 키의 문구
                        (id.toString() in port.shownWithMaterial) shouldBe true      // 4. 재료 있는 행에만
                    }
                }
                (now.values.count { it.hasCopy } >= prev.values.count { it.hasCopy }) shouldBe true   // 5. 줄지 않는다
                prev = now
            }
            check(prev)
            repeat(6) {
                svc.fillMissing(tripId)
                check(schedules.findPendingByTrip(tripId).associateBy { it.scheduleId })
            }
        }
    }

    "재시도 대기열은 때가 되기 전엔 안 내놓고, 한 번 꺼낸 것은 다시 안 나온다" {
        checkAll(PropTestConfig(iterations = 100), Arb.list(Arb.long(1L..1_000_000L), 1..6), Arb.int(0..5)) { delays, attemptRaw ->
            val retries = ReminderCopyRetries(delays)
            val now = Instant.parse("2026-08-01T00:00:00Z")
            val attempt = attemptRaw % delays.size
            retries.later(tripId, now, attempt) shouldBe true

            val dueAt = now.plusMillis(delays[attempt])
            retries.takeDue(dueAt.minusMillis(1)) shouldBe emptyList()                       // 때 전엔 없다
            retries.takeDue(dueAt) shouldBe listOf(ReminderCopyRetries.Due(tripId, attempt)) // 때가 되면 정확히 하나
            retries.takeDue(dueAt.plusMillis(10_000_000)) shouldBe emptyList()               // 한 번 꺼낸 것은 다시 안 나온다
            retries.later(tripId, now, delays.size) shouldBe false                           // 횟수를 다 쓰면 걸리지 않는다
        }
    }
})
