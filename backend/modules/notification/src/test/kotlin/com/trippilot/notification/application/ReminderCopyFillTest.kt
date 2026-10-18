package com.trippilot.notification.application

import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.itinerarygeneration.api.PlannedPlaceView
import com.trippilot.notification.domain.ReminderCopyRequest
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldNotBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 리마인드 문구 AI 채움(TRIP-836).
 *
 * **이 스펙이 지키는 것은 둘이다.**
 *
 * 하나, **못 받아도 리마인드가 살아 있다.** 문구는 부가 정보인데 그것 때문에 예약 적재가 실패하면
 * 리마인드가 통째로 사라진다 — 밋밋한 문구보다 훨씬 나쁘다(INV-4). 상대가 죽거나 느리거나
 * 엉뚱한 것을 줘도 예약 수는 그대로여야 한다.
 *
 * 둘, **맞물림은 `scheduleKey` 하나다.** 상대가 보낸 적 없는 키를 돌려주면 엉뚱한 예약에 문구가
 * 붙는데, 그 오류는 사용자 화면에 "다른 날 이야기"로 나타나 원인을 되짚기 가장 어렵다.
 */
class ReminderCopyFillTest : StringSpec({

    fun place(name: String, code: String) = PlannedPlaceView(name, code)

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC)

    /** 요청받은 키에 그대로 문구를 달아 주는 상대. */
    class Echo(private val prefix: String = "AI") : ReminderCopyPort {
        override val enabled = true
        var seen: List<ReminderCopyRequest> = emptyList()
        override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
            seen = items
            return items.associate { it.scheduleKey to ReminderCopy("$prefix 제목", "$prefix 본문") }
        }
    }

    /** 여행 3일(8/10~8/12) 전부에 갈 곳이 있는 일정. 재료가 있어야 문구를 묻는다. */
    val plannedNames = mapOf(
        LocalDate.parse("2026-08-10") to listOf(place("성산일출봉", "SIGHT"), place("섭지코지", "NATURE")),
        LocalDate.parse("2026-08-11") to listOf(place("우도", "NATURE")),
        LocalDate.parse("2026-08-12") to listOf(place("카페 이름", "CAFE")),
    )

    fun serviceWith(
        port: ReminderCopyPort,
        names: Map<LocalDate, List<PlannedPlaceView>> = plannedNames,
        retries: ReminderCopyRetries = ReminderCopyRetries(RETRY_DELAY_MS),
    ): Pair<NotificationScheduleService, FakeSchedules> {
        val schedules = FakeSchedules()
        val trips = FakeTripOwner().apply {
            put(tripId, acc, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"))
        }
        return NotificationScheduleService(trips, schedules, port, FakePlans(names), clock, retries) to schedules
    }

    "받은 문구가 예약에 붙고, 발화가 그것을 쓴다" {
        val (svc, schedules) = serviceWith(Echo())

        svc.reload(tripId)

        val rows = schedules.findPendingByTrip(tripId)
        rows.forEach { it.title shouldBe "AI 제목" }
        // 저장만 되고 발화가 안 쓰면 아무 의미가 없다 — 실제로 알림 문구가 되는지까지 본다.
        rows.first().toNotification(clock.instant()).title shouldBe "AI 제목"
    }

    "요청 키는 예약을 가리킨다 — 상대가 돌려줄 키가 우리 행과 맞물린다" {
        val echo = Echo()
        val (svc, schedules) = serviceWith(echo)

        svc.reload(tripId)

        val ids = schedules.findPendingByTrip(tripId).map { it.scheduleId.toString() }.toSet()
        echo.seen.map { it.scheduleKey }.toSet() shouldBe ids
    }

    /**
     * **보낸 적 없는 키는 버린다.** 안 버리면 엉뚱한 예약에 문구가 붙고, 증상이 "다른 날 이야기"라
     * 사용자도 우리도 원인을 못 찾는다. (이 거르기는 HTTP 어댑터가 하지만, 여기서는 그런 응답이
     * 와도 **예약 자체는 멀쩡하다**는 것을 본다.)
     */
    "모르는 키만 돌려주면 문구 없이 그대로 간다" {
        val stranger = object : ReminderCopyPort {
            override val enabled = true
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>) =
                mapOf("남의-키" to ReminderCopy("엉뚱한 제목", "엉뚱한 본문"))
        }
        val (svc, schedules) = serviceWith(stranger)

        svc.reload(tripId)

        val rows = schedules.findPendingByTrip(tripId)
        rows.shouldSurviveWithoutCopy()
    }

    "상대가 터져도 예약은 그대로 적재된다 — 문구 때문에 리마인드가 사라지면 안 된다" {
        val broken = object : ReminderCopyPort {
            override val enabled = true
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Nothing =
                error("상대가 죽었다")
        }
        val (svc, schedules) = serviceWith(broken)

        svc.reload(tripId)

        schedules.findPendingByTrip(tripId).shouldSurviveWithoutCopy()
    }

    "경계를 안 켜면 부르지도 않는다 — 꺼진 환경에서 헛도는 조립이 없다" {
        var called = false
        val off = object : ReminderCopyPort {
            override val enabled = false
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>):
                Map<String, ReminderCopy> {
                called = true
                return emptyMap()
            }
        }
        val (svc, schedules) = serviceWith(off)

        svc.reload(tripId)

        called shouldBe false
        schedules.findPendingByTrip(tripId).shouldSurviveWithoutCopy()
    }

    /** 제목만 오고 본문이 없으면 섞지 않는다 — AI 제목에 상수 본문이 붙으면 문장이 따로 논다. */
    "한쪽만 온 문구는 쓰지 않는다" {
        val schedule = com.trippilot.notification.domain.NotificationSchedule.pending(
            acc, tripId, NotificationKind.TRIP_DAY, Instant.parse("2026-08-10T23:00:00Z"),
        ).copy(title = "AI 제목", body = null)

        schedule.toNotification(clock.instant()).title shouldBe "오늘의 일정"
    }
    /**
     * **재료가 실린다**(TRIP-883). 이게 없으면 상대는 빈 일정을 받고 *"오늘은 정해진 일정이 없으니…"*
     * 를 지어낸다 — 일정이 있는 날에 나가면 거짓말이라, 어댑터가 빈 재료를 아예 거른다.
     * 즉 재료를 안 채우면 **문구가 한 건도 안 나온다**(예외도 로그도 없이).
     */
    "그 날 갈 곳이 요청에 실린다 — 방문 순서 그대로" {
        val echo = Echo()
        val (svc, _) = serviceWith(echo)

        svc.reload(tripId)

        val day1 = echo.seen.single { it.kind == NotificationKind.TRIP_DAY && it.date == LocalDate.parse("2026-08-10") }
        day1.slots.map { it.name } shouldBe listOf("성산일출봉", "섭지코지")
    }

    /**
     * **`TRIP_PRE` 는 하루 전에 울리면서 "내일은 …" 을 말한다.** 그래서 재료는 **여행 첫날**의 것이고
     * 날짜도 첫날이다. 발화일(D-1)을 그대로 쓰면 아직 시작도 안 한 날을 묻게 돼 재료가 비고,
     * 그 예약만 조용히 문구 없이 나간다 — 증상이 "가끔 문구가 안 붙는다"라 원인을 못 짚는다.
     *
     * 상대 프롬프트가 `[날짜]` 와 `[오늘 일정]` 을 나란히 놓으므로 둘은 같은 날이어야 한다.
     */
    "여행 전날 알림은 첫날을 말한다 — 발화일이 아니라" {
        val echo = Echo()
        val (svc, _) = serviceWith(echo)

        svc.reload(tripId)

        val pre = echo.seen.single { it.kind == NotificationKind.TRIP_PRE }
        pre.date shouldBe LocalDate.parse("2026-08-10")   // 발화는 8/9, 말하는 날은 8/10
        pre.slots.map { it.name } shouldBe listOf("성산일출봉", "섭지코지")
    }

    /**
     * 재료가 없어도 **예약은 그대로 적재된다.** 문구는 부가 정보이고, 그것 때문에 리마인드가
     * 사라지면 밋밋한 문구보다 훨씬 나쁘다(INV-4). 빈 재료를 거르는 것은 어댑터 몫이다.
     */
    "일정 이름을 못 얻어도 예약 수는 그대로다" {
        val echo = Echo()
        val (svc, schedules) = serviceWith(echo, names = emptyMap())

        svc.reload(tripId)

        schedules.findPendingByTrip(tripId).shouldNotBeEmpty()
        echo.seen.forEach { it.slots shouldBe emptyList() }
    }

    /**
     * **카테고리는 경계 코드로 나간다.** 상대 사전(`_CATEGORY_LABELS`)이 `FOOD`·`CAFE` 를 키로 쓰는데
     * 한글 정본(`맛집`)을 보내면 **사전에 없어 조용히 이름만 렌더된다** — 422 도 로그도 없이
     * 카테고리만 사라지는, 가장 안 보이는 실패다. 그래서 한글이 새지 않는 것까지 못 박는다.
     */
    "카테고리가 경계 코드로 실린다 — 한글이 새지 않는다" {
        val echo = Echo()
        val (svc, _) = serviceWith(echo)

        svc.reload(tripId)

        val day1 = echo.seen.single { it.kind == NotificationKind.TRIP_DAY && it.date == LocalDate.parse("2026-08-10") }
        day1.slots.map { it.category } shouldBe listOf("SIGHT", "NATURE")
        // 한글 정본이 섞이면 조용히 무효가 된다 — 값 자체를 막는다.
        day1.slots.mapNotNull { it.category }.none { it.any { c -> c.code in 0xAC00..0xD7A3 } } shouldBe true
    }

    /**
     * **콜드스타트 재시도.** 학생 모델(Bedrock)은 5분 무호출이면 내려가 첫 호출이 곧바로 실패한다.
     * 하나도 못 받은 적재는 몇 분 뒤 한 번 더 묻고, 그때 받은 문구가 예약에 붙어야 한다 — 안 그러면
     * 트래픽이 드문 환경에서 문구가 거의 늘 상수로 굳는다.
     */
    "하나도 못 받으면 잠시 뒤 한 번 더 묻고, 그때 받은 문구가 붙는다" {
        val coldThenWarm = object : ReminderCopyPort {
            override val enabled = true
            var calls = 0
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                calls++
                return if (calls == 1) emptyMap() else items.associate { it.scheduleKey to ReminderCopy("AI 제목", "AI 본문") }
            }
        }
        val retries = ReminderCopyRetries(RETRY_DELAY_MS)
        val (svc, schedules) = serviceWith(coldThenWarm, retries = retries)

        svc.reload(tripId)
        schedules.findPendingByTrip(tripId).shouldSurviveWithoutCopy()

        // 때가 되기 전에는 꺼내지 않는다 — 모델이 올라오기 전에 다시 두드리면 또 실패한다.
        retries.takeDue(clock.instant().plusMillis(RETRY_DELAY_MS - 1)) shouldBe emptyList()
        ReminderCopyRetryPoller(retries, svc, Clock.offset(clock, Duration.ofMillis(RETRY_DELAY_MS))).retryDue()

        coldThenWarm.calls shouldBe 2
        schedules.findPendingByTrip(tripId).forEach { it.title shouldBe "AI 제목" }
    }

    "재시도도 못 받으면 더 묻지 않는다 — 상수 문구로 둔다" {
        val alwaysCold = object : ReminderCopyPort {
            override val enabled = true
            var calls = 0
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                calls++
                return emptyMap()
            }
        }
        val retries = ReminderCopyRetries(RETRY_DELAY_MS)
        val (svc, schedules) = serviceWith(alwaysCold, retries = retries)

        svc.reload(tripId)
        ReminderCopyRetryPoller(retries, svc, Clock.offset(clock, Duration.ofMillis(RETRY_DELAY_MS))).retryDue()
        ReminderCopyRetryPoller(retries, svc, Clock.offset(clock, Duration.ofMillis(RETRY_DELAY_MS * 10))).retryDue()

        // 상대가 아예 죽었을 때 계속 두드리지 않는다 — 처음 1번 + 재시도 1번이 전부다.
        alwaysCold.calls shouldBe 2
        schedules.findPendingByTrip(tripId).shouldSurviveWithoutCopy()
    }

    "받았거나 물을 재료가 없었으면 다시 묻지 않는다" {
        val retries = ReminderCopyRetries(RETRY_DELAY_MS)
        val nothing = object : ReminderCopyPort {
            override val enabled = true
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>) =
                emptyMap<String, ReminderCopy>()
        }

        serviceWith(Echo(), retries = retries).first.reload(tripId)
        // 재료가 없으면 어댑터가 애초에 안 묻는다 — 못 받은 것이 아니니 재시도할 이유도 없다.
        serviceWith(nothing, names = emptyMap(), retries = retries).first.reload(tripId)

        retries.takeDue(clock.instant().plusMillis(RETRY_DELAY_MS * 10)) shouldBe emptyList()
    }

})

/**
 * 예약은 **살아 있고** 문구만 없다. 두 조건을 한 함수로 묶는 이유는 하나만 보면 놓치기 때문이다 —
 * "문구가 null 이다"만 보면 **예약이 통째로 사라진 경우도 통과**한다(빈 목록의 forEach 는 참이다).
 */
private fun List<com.trippilot.notification.domain.NotificationSchedule>.shouldSurviveWithoutCopy() {
    shouldNotBeEmpty()
    forEach { it.title.shouldBeNull() }
}

private const val RETRY_DELAY_MS = 180_000L
