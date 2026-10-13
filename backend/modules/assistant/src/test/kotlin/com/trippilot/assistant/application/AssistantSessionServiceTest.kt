package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.QuickReplyAction
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.savedaccommodation.api.DayBaseStayView
import com.trippilot.savedaccommodation.api.TripBaseStayFacade
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripListFacade
import com.trippilot.trip.api.TripPeriod
import com.trippilot.trip.api.TripSummaryView
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 도우미 세션 규칙(US-ASSIST-01·05). DB 가 보장하는 것(여행당 하나·CASCADE)은 `AssistantApiIT` 가 실 DB 로 재고,
 * 여기서는 **서비스가 정하는 것**을 본다 — 누구에게 열어 주는가, 무엇을 함께 돌려주는가, 어디서 끊는가.
 */
class AssistantSessionServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-11-01")
    val now = Instant.parse("2026-10-13T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)

    /** 실 어댑터와 같은 규칙의 대역 — (계정, 여행)당 하나. */
    class Sessions : AssistantSessionRepository {
        val rows = mutableListOf<AssistantSession>()
        override fun openOrGet(candidate: AssistantSession) =
            rows.firstOrNull { it.accountId == candidate.accountId && it.tripId == candidate.tripId } ?: candidate.also { rows += it }
        override fun findOwned(accountId: UUID, sessionId: UUID) = rows.firstOrNull { it.sessionId == sessionId && it.accountId == accountId }
        override fun findByAccount(accountId: UUID, now: Instant, limit: Int) =
            rows.filter { it.accountId == accountId && it.expiresAt > now }.sortedByDescending { it.lastTurnAt }.take(limit)
        override fun delete(accountId: UUID, sessionId: UUID): Int {
            val before = rows.size
            rows.removeAll { it.sessionId == sessionId && it.accountId == accountId }
            return before - rows.size
        }
    }

    class Messages(private val bySession: Map<UUID, List<AssistantMessage>> = emptyMap()) : AssistantMessageRepository {
        override fun findPage(sessionId: UUID, beforeSeq: Long?, limit: Int) =
            bySession[sessionId].orEmpty().filter { beforeSeq == null || it.seq < beforeSeq }.sortedBy { it.seq }.takeLast(limit)
    }

    fun message(seq: Long) = AssistantMessage(
        UUID.randomUUID(), seq, MessageRole.USER, MessageKind.TEXT, "말 $seq", null, emptyList(), emptyList(), null, now,
    )

    fun trips(nights: Long = 2) = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? = null
        override fun findGenerationContext(accountId: UUID, id: UUID) =
            if (accountId == acc && id == tripId) {
                TripGenerationContext(d1, d1.plusDays(nights), listOf(TripDestinationRef("부산", null, nights.toInt())), "친구", null, emptyList())
            } else {
                null
            }
    }
    fun stays(vararg names: String) = object : TripBaseStayFacade {
        override fun findBaseStays(tripId: UUID, startDate: LocalDate, endDate: LocalDate) =
            names.mapIndexed { i, n -> DayBaseStayView(startDate.plusDays(i.toLong()), UUID.randomUUID(), n) }.reversed() // 순서에 기대지 않게
    }
    val tripList = object : TripListFacade {
        override fun findTripsOf(accountId: UUID, limit: Int) =
            if (accountId == acc) listOf(TripSummaryView(tripId, "부산 먹방", d1, d1.plusDays(2), listOf("부산"))) else emptyList()
        override fun hasAnyTrip(accountId: UUID) = true
    }

    fun service(
        sessions: Sessions = Sessions(),
        messages: Messages = Messages(),
        trips: TripFacade = trips(),
        stays: TripBaseStayFacade = stays("서면 호텔", "해운대 호텔"),
    ) = AssistantSessionService(sessions, messages, TripContextReader(trips, stays), tripList, AssistantProperties(retentionDays = 90), clock)

    "여행 대화를 열면 컨텍스트 칩과 시작 빠른 답이 온다 — 칩은 첫 숙박일의 숙소를 말한다" {
        val opened = service().open(acc, tripId)

        opened.session.tripId shouldBe tripId
        opened.session.expiresAt shouldBe now + Duration.ofDays(90)
        opened.contextChip shouldBe "부산 2박 3일 · 등록 숙소 서면 호텔"
        opened.quickReplies.map { it.id } shouldContainExactly listOf("qr-review", "qr-next", "qr-weather", "qr-capabilities")
        opened.quickReplies.first().action shouldBe QuickReplyAction.REVIEW
    }

    "칩은 없는 것을 말하지 않는다 — 숙소가 없으면 빼고, 당일 여행은 '당일'이다" {
        service(stays = stays()).open(acc, tripId).contextChip shouldBe "부산 2박 3일"
        service(trips = trips(nights = 0), stays = stays()).open(acc, tripId).contextChip shouldBe "부산 당일"
    }

    /** 여행이 없다고 막지 않는다(BR-U8-05). '내가 할 수 있는 것 보기'는 어느 쪽이든 서버가 발급한다(BR-U8-04). */
    "여행 없이 열면 일반 대화다 — 칩이 없고 빠른 답이 다르다" {
        val opened = service().open(acc, null)

        opened.session.tripId shouldBe null
        opened.contextChip shouldBe null
        opened.quickReplies.map { it.id } shouldContainExactly listOf("qr-new-trip", "qr-stay", "qr-capabilities")
        opened.quickReplies.last().action shouldBe QuickReplyAction.SHOW_CAPABILITIES
    }

    "다시 열면 같은 대화다 — 여행 대화와 일반 대화는 따로다" {
        val sessions = Sessions()
        val svc = service(sessions)

        val first = svc.open(acc, tripId).session.sessionId
        svc.open(acc, tripId).session.sessionId shouldBe first
        svc.open(acc, null).session.sessionId shouldNotBe first
        sessions.rows.size shouldBe 2
    }

    "남의 여행·없는 여행으로는 열지 않는다(404) — 세션도 만들지 않는다" {
        val sessions = Sessions()

        shouldThrow<ResourceNotFound> { service(sessions).open(UUID.randomUUID(), tripId) }
        shouldThrow<ResourceNotFound> { service(sessions).open(acc, UUID.randomUUID()) }
        sessions.rows shouldBe emptyList()
    }

    /** 청소가 아직 안 돌았을 뿐 지워졌어야 할 대화다 — 이어 열면 보존 기간이 지난 발화가 되살아난다(DATA-U8-01). */
    "보존 기간이 지난 대화는 이어 열지 않고 새로 만든다" {
        val sessions = Sessions()
        val stale = AssistantSession(UUID.randomUUID(), acc, tripId, now.minusSeconds(100), now.minusSeconds(100), expiresAt = now)
        sessions.rows += stale

        val opened = service(sessions, Messages(mapOf(stale.sessionId to listOf(message(1))))).open(acc, tripId)

        opened.session.sessionId shouldNotBe stale.sessionId
        opened.messages shouldBe emptyList()
        sessions.rows.map { it.sessionId } shouldContainExactly listOf(opened.session.sessionId)
    }

    "목록은 최근 대화순이고 여행 제목을 붙인다 — 만료된 것과 남의 것은 없다" {
        val sessions = Sessions()
        val general = AssistantSession(UUID.randomUUID(), acc, null, now, now.minusSeconds(60), now.plusSeconds(10))
        val trip = AssistantSession(UUID.randomUUID(), acc, tripId, now, now.minusSeconds(5), now.plusSeconds(10))
        sessions.rows += listOf(
            general, trip,
            AssistantSession(UUID.randomUUID(), acc, UUID.randomUUID(), now, now, expiresAt = now), // 만료
            AssistantSession(UUID.randomUUID(), UUID.randomUUID(), null, now, now, now.plusSeconds(10)), // 남의 것
        )

        service(sessions).list(acc).map { it.session.sessionId to it.tripTitle } shouldContainExactly
            listOf(trip.sessionId to "부산 먹방", general.sessionId to null)
    }

    "메시지는 오래된 것부터 한 페이지 — 더 있으면 그 페이지의 첫 줄이 다음 커서다" {
        val sessions = Sessions()
        val svc = service(sessions)
        val id = svc.open(acc, null).session.sessionId
        val paged = service(sessions, Messages(mapOf(id to (1L..5L).map { message(it) })))

        val latest = paged.messages(acc, id, before = null, limit = 2)
        latest.messages.map { it.seq } shouldContainExactly listOf(4L, 5L)
        latest.nextBefore shouldBe "4"

        val older = paged.messages(acc, id, before = latest.nextBefore, limit = 3)
        older.messages.map { it.seq } shouldContainExactly listOf(1L, 2L, 3L)
        older.nextBefore shouldBe null // 정확히 떨어져도 "더 있다"고 하지 않는다
    }

    "남의 대화의 메시지는 404 다 — 잘못된 커서·쪽 크기는 400 이다" {
        val sessions = Sessions()
        val svc = service(sessions)
        val id = svc.open(acc, null).session.sessionId

        shouldThrow<ResourceNotFound> { svc.messages(UUID.randomUUID(), id, null, null) }
        shouldThrow<ValidationFailed> { svc.messages(acc, id, "abc", null) }
        shouldThrow<ValidationFailed> { svc.messages(acc, id, null, 0) }
        shouldThrow<ValidationFailed> { svc.messages(acc, id, null, 101) }
        svc.messages(acc, id, null, 100).messages shouldBe emptyList()
    }

    "지우기는 본인 것만 지우고, 없어도 조용히 끝난다" {
        val sessions = Sessions()
        val svc = service(sessions)
        val id = svc.open(acc, null).session.sessionId

        svc.clear(UUID.randomUUID(), id) // 남의 요청 — 아무 일도 없다
        sessions.rows.size shouldBe 1
        svc.clear(acc, id)
        svc.clear(acc, id) // 재시도
        sessions.rows shouldBe emptyList()
    }
})
