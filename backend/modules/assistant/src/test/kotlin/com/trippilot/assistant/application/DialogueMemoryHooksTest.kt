package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.MemoryItem
import com.trippilot.savedaccommodation.api.DayBaseStayView
import com.trippilot.savedaccommodation.api.TripBaseStayFacade
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripListFacade
import com.trippilot.trip.api.TripPeriod
import com.trippilot.trip.api.TripSummaryView
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 상대 세션 메모리의 파기 3호출 + 내보내기(assistant-orchestrator DE §4.1 · BR-AO-10). 백엔드 대화가 사라지는 길마다
 * 상대 요약도 같이 가야 한다 — 안 가면 "지웠는데 기억한다"가 90일(상대 TTL) 남는다.
 */
class DialogueMemoryHooksTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val now = Instant.parse("2026-10-17T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? = null
        override fun findGenerationContext(accountId: UUID, id: UUID) =
            if (accountId == acc && id == tripId) TripGenerationContext(LocalDate.parse("2026-11-01"), LocalDate.parse("2026-11-03"), emptyList(), "친구", null, emptyList()) else null
    }
    val stays = object : TripBaseStayFacade {
        override fun findBaseStays(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayBaseStayView>()
    }
    val tripList = object : TripListFacade {
        override fun findTripsOf(accountId: UUID, limit: Int) = listOf(TripSummaryView(tripId, "부산", LocalDate.parse("2026-11-01"), LocalDate.parse("2026-11-03"), listOf("부산")))
        override fun hasAnyTrip(accountId: UUID) = true
    }

    fun sessionService(sessions: FakeSessions, memory: FakeDialogueMemory) =
        AssistantSessionService(sessions, FakeMessages(), TripContextReader(trips, stays), tripList, AssistantProperties(), memory, clock)

    "이력 지우기는 지운 대화의 상대 메모리도 지운다 — 남의 요청·없는 대화는 상대도 건드리지 않는다" {
        val sessions = FakeSessions()
        val memory = FakeDialogueMemory()
        val svc = sessionService(sessions, memory)
        val id = svc.open(acc, null).session.sessionId

        svc.clear(UUID.randomUUID(), id) // 남의 요청 — 세션 id 를 안다고 남의 기억을 지우게 두지 않는다
        memory.deleted shouldBe emptyList()

        svc.clear(acc, id)
        memory.deleted shouldContainExactly listOf("session:$id")
        svc.clear(acc, id) // 재시도 — 지울 대화가 없으니 상대도 부르지 않는다
        memory.deleted.size shouldBe 1
    }

    "이력 지우기·여행 삭제의 메모리 파기 실패는 삼킨다 — 대화는 지워지고 상대 TTL 이 백스톱이다" {
        val sessions = FakeSessions()
        val memory = FakeDialogueMemory().apply { fail = true }
        val svc = sessionService(sessions, memory)
        val id = svc.open(acc, tripId).session.sessionId

        svc.clear(acc, id)
        sessions.rows shouldBe emptyList()

        svc.open(acc, tripId)
        svc.deleteForTrip(tripId) shouldBe 1
        sessions.rows shouldBe emptyList()
    }

    "여행 삭제는 그 여행의 상대 메모리를 지운다 — 대화가 이미 없어도 부른다(앞선 파기가 실패했을 수 있다)" {
        val memory = FakeDialogueMemory()
        val svc = sessionService(FakeSessions(), memory)

        svc.deleteForTrip(tripId) shouldBe 0

        memory.deleted shouldContainExactly listOf("trip:$tripId")
    }

    "계정 삭제는 상대 메모리까지 지우고, 실패하면 예외로 올려 아웃박스가 재시도한다" {
        val sessions = FakeSessions().apply { rows += AssistantSession(UUID.randomUUID(), acc, null, now, now, now.plusSeconds(10)) }
        val memory = FakeDialogueMemory()
        val retention = AssistantRetention(sessions, FakeUsage(), AssistantProperties(), memory, clock)

        retention.purgeAccount(acc) shouldBe 1
        memory.deleted shouldContainExactly listOf("account:$acc")

        memory.fail = true
        shouldThrow<IllegalStateException> { retention.purgeAccount(acc) }
    }

    "내보내기는 요약 한 줄이 한 행이다 — 못 읽으면 비우고 잘렸다고 표시한다" {
        val s1 = UUID.randomUUID()
        val memory = FakeDialogueMemory(
            listOf(
                MemoryItem(s1.toString(), tripId.toString(), listOf("조용한 카페를 좋아한다", "둘째 날 저녁은 비웠다"), now),
                MemoryItem(UUID.randomUUID().toString(), null, emptyList(), now),
            ),
        )
        val contributor = AssistantMemoryExportContributor(memory)

        val section = contributor.export(acc, limit = 10)

        section.section shouldBe "assistantMemory"
        memory.exported shouldContainExactly listOf(acc.toString())
        section.items.map { it["line"] } shouldContainExactly listOf("조용한 카페를 좋아한다", "둘째 날 저녁은 비웠다")
        section.items.first().keys shouldBe setOf("sessionId", "tripId", "line", "updatedAt")
        section.items.first()["tripId"] shouldBe tripId.toString()
        section.truncated shouldBe false
        contributor.export(acc, limit = 1).truncated shouldBe true

        memory.fail = true
        val failed = contributor.export(acc, limit = 10)
        failed.items shouldBe emptyList()
        failed.truncated shouldBe true // 조용히 비우지 않는다 — 받은 것이 전부가 아니라고 값으로 말한다
    }
})
