package com.trippilot.planbdetection.application

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.planbdetection.domain.Opportunity
import com.trippilot.planbdetection.domain.OpportunityKind
import com.trippilot.planbdetection.domain.OpportunityReply
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.slf4j.LoggerFactory
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 기회 조회(BR-SA-22 · PBT-SA-20 의 예시 짝) — 무엇을 AI 에 묻고, 언제 묻지 않으며, 받은 답을 언제 버리는가.
 *
 * 묻지 않아야 할 때를 셀 때는 **그 이유 하나만 남긴다** — 나머지 조건(소유·켜짐·남은 슬롯)은 모두 충족한 채로 둔다.
 * 그래야 그 가드를 지웠을 때 AI 호출 수가 바로 늘어난다(다른 가드가 대신 막아 주는 거짓 초록을 피한다).
 */
class OpportunityServiceTest : StringSpec({

    val owner = UUID.fromString("0d7f17ab-5c4b-4d6d-a7f7-484ba11dda46")
    val tripId = UUID.fromString("7a3c1e2b-0000-4000-8000-000000000001")
    val start = LocalDate.parse("2026-10-19")
    val end = LocalDate.parse("2026-10-22")
    val today = LocalDate.parse("2026-10-20")
    val noon = LocalTime.of(12, 0)

    fun service(
        port: RecordingOpportunityPort? = RecordingOpportunityPort(),
        plans: OpportunityPlans = OpportunityPlans(listOf(plannedSlot(today, 0, LocalTime.of(14, 0), LocalTime.of(15, 0)))),
        clock: Clock = kstClock(today, noon),
        period: TripPeriod = TripPeriod(start, end),
    ) = OpportunityService(OpportunityTrips(owner, tripId, period), plans, opportunityPorts(port), clock)

    fun trending(near: String, poi: UUID = UUID.randomUUID()) =
        Opportunity("trending:$poi", OpportunityKind.TRENDING, null, null, null, poi, "월정리 카페거리", near, "약 400m")

    "남의 여행·없는 여행은 404 다 — 꺼져 있어도 존재를 숨긴다" {
        val port = RecordingOpportunityPort()
        shouldThrow<ResourceNotFound> { service(port).list(UUID.randomUUID(), tripId, today) }
        shouldThrow<ResourceNotFound> { service(port).list(owner, UUID.randomUUID(), today) }
        shouldThrow<ResourceNotFound> { service(port = null).list(UUID.randomUUID(), tripId, today) }
        port.queries.shouldBeEmpty()
    }

    "꺼져 있으면 일정도 AI 도 부르지 않고 빈 목록이다" {
        val plans = OpportunityPlans(listOf(plannedSlot(today, 0, LocalTime.of(14, 0), LocalTime.of(15, 0))))

        service(port = null, plans = plans).list(owner, tripId, today).shouldBeEmpty()

        plans.reads shouldBe 0
    }

    "여행 전(D-1 포함)에는 묻지 않는다 — 트리거 없는 다시 짜기는 전날 창에서도 409 라 막다른 카드가 된다" {
        val port = RecordingOpportunityPort()
        val dayBefore = start.minusDays(1)
        val plans = OpportunityPlans(listOf(plannedSlot(start, 0, LocalTime.of(10, 0), LocalTime.of(11, 0))))

        service(port, plans, kstClock(dayBefore, noon)).list(owner, tripId, start).shouldBeEmpty()

        port.queries.shouldBeEmpty()
    }

    "지난 날짜·종료 뒤 날짜는 일정도 AI 도 부르지 않는다" {
        val port = RecordingOpportunityPort()
        val plans = OpportunityPlans(
            listOf(
                plannedSlot(today.minusDays(1), 0, LocalTime.of(20, 0), LocalTime.of(21, 0)),
                plannedSlot(end.plusDays(1), 0, LocalTime.of(10, 0), LocalTime.of(11, 0)),
            ),
        )

        service(port, plans).list(owner, tripId, today.minusDays(1)).shouldBeEmpty()
        service(port, plans).list(owner, tripId, end.plusDays(1)).shouldBeEmpty()

        port.queries.shouldBeEmpty()
        plans.reads shouldBe 0 // 날짜 범위는 일정을 읽기 전에 가른다
    }

    "종료일(체크아웃일)까지는 묻는다 — 일정은 종료일을 포함한다" {
        val port = RecordingOpportunityPort()
        val plans = OpportunityPlans(listOf(plannedSlot(end, 0, LocalTime.of(10, 0), LocalTime.of(11, 0))))

        service(port, plans).list(owner, tripId, end)

        port.queries shouldHaveSize 1
    }

    "그 날 끝나지 않고 좌표가 있는 슬롯만 방문 순서대로 8개까지 보내고, 일정 전체의 장소를 계획 POI 로 싣는다" {
        val port = RecordingOpportunityPort()
        val ended = plannedSlot(today, 0, LocalTime.of(9, 0), LocalTime.of(10, 0))
        val endsNow = plannedSlot(today, 1, LocalTime.of(11, 0), noon) // 끝 시각 = 지금 → 끝났다
        val nowOn = plannedSlot(today, 2, noon, LocalTime.of(13, 0))
        val noCoord = plannedSlot(today, 3, LocalTime.of(13, 0), LocalTime.of(14, 0), lat = null, lng = null)
        val later = (4..12).map { plannedSlot(today, it, LocalTime.of(10 + it, 0), LocalTime.of(10 + it, 30)) }
        val yesterday = plannedSlot(today.minusDays(1), 0, LocalTime.of(10, 0), LocalTime.of(11, 0))
        val tomorrow = plannedSlot(today.plusDays(1), 0, LocalTime.of(10, 0), LocalTime.of(11, 0))
        // 저장 순서를 일부러 섞는다 — 보내는 순서는 방문 순서(orderIndex)다.
        val all = listOf(tomorrow) + later.reversed() + listOf(noCoord, nowOn, endsNow, ended, yesterday)

        service(port, OpportunityPlans(all)).list(owner, tripId, today)

        val query = port.queries.single()
        query.date shouldBe today
        query.slots.map { it.slotKey } shouldContainExactly (listOf(nowOn) + later.take(7)).map { it.slotKey }
        query.slots.first().let { listOf(it.poiId, it.lat, it.lng) } shouldBe listOf(nowOn.poiId, nowOn.lat, nowOn.lng)
        // 끝난 칸·좌표 없는 칸·다른 날 칸의 장소도 '이미 일정에 있는 곳'이다 — 카드에 다시 오면 안 된다.
        query.plannedPoiIds shouldHaveSize all.size
        query.plannedPoiIds shouldContainAll all.map { it.poiId }
    }

    "자정을 넘기는 슬롯은 오늘 안에 끝나지 않는다" {
        val port = RecordingOpportunityPort()
        val late = plannedSlot(today, 0, LocalTime.of(22, 0), LocalTime.of(1, 0), endsNextDay = true)
        val done = plannedSlot(today, 1, LocalTime.of(21, 0), LocalTime.of(23, 0))

        service(port, OpportunityPlans(listOf(late, done)), kstClock(today, LocalTime.of(23, 30))).list(owner, tripId, today)

        port.queries.single().slots.map { it.slotKey } shouldContainExactly listOf(late.slotKey)
    }

    "다른 날을 보면 그 날 슬롯이 모두 남은 슬롯이다" {
        val port = RecordingOpportunityPort()
        val morning = plannedSlot(today.plusDays(1), 0, LocalTime.of(9, 0), LocalTime.of(10, 0))

        service(port, OpportunityPlans(listOf(morning)), kstClock(today, LocalTime.of(22, 0))).list(owner, tripId, today.plusDays(1))

        port.queries.single().slots.map { it.slotKey } shouldContainExactly listOf(morning.slotKey)
    }

    "남은 슬롯이 없으면 묻지 않는다 — 빈 재료로는 상대가 422(minItems 1)를 내거나 지어낸다" {
        val port = RecordingOpportunityPort()
        val plans = OpportunityPlans(
            listOf(
                plannedSlot(today, 0, LocalTime.of(9, 0), LocalTime.of(10, 0)),
                plannedSlot(today, 1, LocalTime.of(14, 0), LocalTime.of(15, 0), lat = null, lng = null),
                plannedSlot(today.plusDays(1), 0, LocalTime.of(14, 0), LocalTime.of(15, 0)),
            ),
        )

        service(port, plans).list(owner, tripId, today).shouldBeEmpty()

        port.queries.shouldBeEmpty()
    }

    "계획 POI 가 300을 넘으면 그 날에 가까운 날의 장소부터 300개다 — 일정 순서대로 자르면 끝 무렵 날짜가 통째로 빠진다" {
        val port = RecordingOpportunityPort()
        val longEnd = start.plusDays(40)
        val days = (0L..40L).map { start.plusDays(it) }
        val all = days.flatMap { d -> (0..7).map { plannedSlot(d, it, LocalTime.of(9 + it, 0), LocalTime.of(9 + it, 30)) } }
        val date = longEnd // 마지막 날 — 일정 순서로 앞 300개를 자르면 37일차까지만 남는다
        val clock = kstClock(start.plusDays(1), noon)

        service(port, OpportunityPlans(all), clock, TripPeriod(start, longEnd)).list(owner, tripId, date)

        val planned = port.queries.single().plannedPoiIds
        all.size shouldBe 328
        planned shouldHaveSize 300
        // 그 날과 그 앞날의 장소는 반드시 실린다 — 잘리면 다녀온 곳·내일 갈 곳이 카드로 되돌아올 수 있다.
        planned shouldContainAll all.filter { it.date == date || it.date == date.minusDays(1) }.map { it.poiId }
        // 잘린 것은 가장 먼 날(첫날 쪽)이다.
        planned.none { p -> all.first { it.poiId == p }.date == start } shouldBe true
    }

    /** 응답은 '기회 없음'과 같은 200 빈 목록이라 실패를 드러내는 것은 WARN 한 줄뿐이다(RES-SA-09 · INV-4 — 운영 관측 원천은 로그). */
    "AI 가 실패하면 빈 목록 + 사유를 담은 WARN 1줄이다 — 카드는 선택 사항이라 허브를 막지 않는다" {
        val port = RecordingOpportunityPort { error("상대 503") }

        val warns = serviceWarns { service(port).list(owner, tripId, today).shouldBeEmpty() }

        port.queries shouldHaveSize 1
        warns shouldHaveSize 1
        warns.single() shouldContain "기회 조회 실패"
        warns.single() shouldContain "상대 503"
        warns.single() shouldContain "$tripId"
    }

    "AI 답이 게이트에 걸리면 통째로 버리고 사유를 담은 WARN 1줄이다 — 일부만 그리면 순위·날짜당 1장이 상대 판정과 달라진다" {
        val port = RecordingOpportunityPort { q ->
            val near = q.slots.first().slotKey
            OpportunityReply(listOf(trending(near), trending(near, poi = q.plannedPoiIds.first())), emptyList())
        }

        val warns = serviceWarns { service(port).list(owner, tripId, today).shouldBeEmpty() }

        warns shouldHaveSize 1
        warns.single() shouldContain "계약에 어긋나"
        warns.single() shouldContain "이미 일정에 있는 장소"
        warns.single() shouldContain "$tripId"
    }

    "통과한 답은 받은 순서 그대로 낸다 — notes 는 막지 않는다" {
        lateinit var sent: List<Opportunity>
        val port = RecordingOpportunityPort { q ->
            sent = listOf(trending(q.slots.first().slotKey), trending(q.slots.first().slotKey))
            OpportunityReply(sent, listOf("events_unwired"))
        }

        val out = service(port).list(owner, tripId, today)

        out shouldBe sent
    }

    "오늘은 KST 로 정한다 — UTC 15시가 자정이다" {
        val firstDay = today.plusDays(1)
        val plans = OpportunityPlans(listOf(plannedSlot(firstDay, 0, LocalTime.of(10, 0), LocalTime.of(11, 0))))
        val period = TripPeriod(firstDay, end)

        val before = RecordingOpportunityPort()
        service(before, plans, utcClock("2026-10-20T14:59:59Z"), period).list(owner, tripId, firstDay)
        before.queries.shouldBeEmpty() // KST 10-20 23:59:59 — 아직 여행 전날이다

        val after = RecordingOpportunityPort()
        service(after, plans, utcClock("2026-10-20T15:00:00Z"), period).list(owner, tripId, firstDay)
        after.queries shouldHaveSize 1 // KST 10-21 00:00 — 첫날이다
    }
})

/** [block] 동안 기회 조회가 남긴 WARN 문장. */
private fun serviceWarns(block: () -> Unit): List<String> {
    val logger = LoggerFactory.getLogger(OpportunityService::class.java) as Logger
    val appender = ListAppender<ILoggingEvent>().also { it.start() }
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.filter { it.level == Level.WARN }.map { it.formattedMessage }
}
