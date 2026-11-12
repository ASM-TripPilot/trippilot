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
        retries: ReminderCopyRetries = ReminderCopyRetries(RETRY_DELAYS_MS),
    ): Pair<NotificationScheduleService, FakeSchedules> {
        val schedules = FakeSchedules()
        val trips = FakeTripOwner().apply {
            put(tripId, acc, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"))
        }
        return NotificationScheduleService(trips, schedules, port, FakePlans(names), clock, retries, NoDeletionPending) to schedules
    }

    "받은 문구가 예약에 붙고, 발화가 그것을 쓴다" {
        val (svc, schedules) = serviceWith(Echo())

        svc.reload(tripId)

        val rows = schedules.findPendingByTrip(tripId)
        rows.forEach { it.title shouldBe "AI 제목" }
        // 저장만 되고 발화가 안 쓰면 아무 의미가 없다 — 실제로 알림 문구가 되는지까지 본다.
        rows.first().toNotification(clock.instant()).title shouldBe "AI 제목"
    }

    /**
     * **문구에는 그것을 만들 때 본 일정의 지문이 같이 붙는다.** 발화가 지금 일정과 대조해 편집으로 어긋난 문구를 거르는 근거다 —
     * 지문 없이 문구만 저장하면 그 대조가 불가능하다. 적재 때도, 재시도(제자리 채우기)로 뒤늦게 붙을 때도 마찬가지다.
     */
    "붙은 문구에는 그 날 장소 목록의 지문이 같이 붙는다 — 적재 때도 제자리 채우기 때도" {
        val coldThenWarm = object : ReminderCopyPort {
            override val enabled = true
            var calls = 0
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                calls++
                return if (calls == 1) items.take(1).associate { it.scheduleKey to ReminderCopy("첫 제목", "첫 본문") }
                else items.associate { it.scheduleKey to ReminderCopy("나중 제목", "나중 본문") }
            }
        }
        val retries = ReminderCopyRetries(RETRY_DELAYS_MS)
        val (svc, schedules) = serviceWith(coldThenWarm, retries = retries)

        svc.reload(tripId)
        pollerAt(retries, svc, RETRY_DELAYS_MS[0]).retryDue()

        val rows = schedules.findPendingByTrip(tripId)
        rows.all { it.hasCopy } shouldBe true
        rows.forEach { row ->
            row.copyBasis shouldBe com.trippilot.notification.domain.CopyBasis.of(plannedNames.getValue(row.subjectDate()).map { it.nameKo })
        }
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
     * 하나도 못 받은 적재는 잠시 뒤 **제자리에서** 다시 묻고, 그때 받은 문구가 예약에 붙어야 한다 — 안 그러면
     * 트래픽이 드문 환경에서 문구가 거의 늘 상수로 굳는다.
     */
    "하나도 못 받으면 잠시 뒤 제자리에서 다시 묻고, 그때 받은 문구가 붙는다" {
        val coldThenWarm = object : ReminderCopyPort {
            override val enabled = true
            var calls = 0
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                calls++
                return if (calls == 1) emptyMap() else items.associate { it.scheduleKey to ReminderCopy("AI 제목", "AI 본문") }
            }
        }
        val retries = ReminderCopyRetries(RETRY_DELAYS_MS)
        val (svc, schedules) = serviceWith(coldThenWarm, retries = retries)

        svc.reload(tripId)
        schedules.findPendingByTrip(tripId).shouldSurviveWithoutCopy()
        val idsBefore = schedules.findPendingByTrip(tripId).map { it.scheduleId }

        // 때가 되기 전에는 꺼내지 않는다 — 모델이 올라오기 전에 다시 두드리면 또 실패한다.
        retries.takeDue(clock.instant().plusMillis(RETRY_DELAYS_MS[0] - 1)) shouldBe emptyList()
        pollerAt(retries, svc, RETRY_DELAYS_MS[0]).retryDue()

        coldThenWarm.calls shouldBe 2
        schedules.findPendingByTrip(tripId).forEach { it.title shouldBe "AI 제목" }
        // **제자리**다 — 행을 지우고 다시 만들지 않았다(같은 id).
        schedules.findPendingByTrip(tripId).map { it.scheduleId } shouldBe idsBefore
    }

    /**
     * **일부만 받아도 이어 채운다.** 종전엔 일부를 받으면 재시도가 없어 빠진 행이 영영 상수였고, 하나도 못 받은 적재의 재시도는
     * 행을 통째로 다시 만들어 앞서 받은 문구를 잃을 수 있었다. 제자리 채우기는 **빠진 행만** 묻고, 이미 붙은 문구는 건드리지 않는다.
     */
    "일부만 받았으면 빠진 행만 다시 묻고, 이미 받은 문구는 그대로 둔다" {
        val onlyFirstThenAll = object : ReminderCopyPort {
            override val enabled = true
            val asked = mutableListOf<List<String>>()
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                asked += items.map { it.scheduleKey }
                return if (asked.size == 1) {
                    items.take(1).associate { it.scheduleKey to ReminderCopy("첫 제목", "첫 본문") }
                } else {
                    items.associate { it.scheduleKey to ReminderCopy("나중 제목", "나중 본문") }
                }
            }
        }
        val retries = ReminderCopyRetries(RETRY_DELAYS_MS)
        val (svc, schedules) = serviceWith(onlyFirstThenAll, retries = retries)

        svc.reload(tripId)
        val first = schedules.findPendingByTrip(tripId)
        first.count { it.hasCopy } shouldBe 1
        val firstCopied = first.single { it.hasCopy }

        pollerAt(retries, svc, RETRY_DELAYS_MS[0]).retryDue()

        val after = schedules.findPendingByTrip(tripId)
        after.all { it.hasCopy } shouldBe true
        // 이미 받은 문구는 바뀌지 않았고, 두 번째 호출은 **빠진 행만** 물었다(이미 붙은 행의 키가 없다).
        after.single { it.scheduleId == firstCopied.scheduleId }.title shouldBe "첫 제목"
        onlyFirstThenAll.asked[1].toSet() shouldBe (first.map { it.scheduleId.toString() }.toSet() - firstCopied.scheduleId.toString())
    }

    /**
     * **다일 여행은 1차 저장(첫날만) 직후에 적재가 돈다** — 그때 2일차 이후는 일정이 없어 재료가 비고(어댑터가 안 묻는다),
     * 첫날 문구만 받으면 종전엔 재시도도 없어 나머지가 영구 상수였다. 이제 재료가 뒤늦게 생긴 날도 재시도가 메운다.
     */
    "적재 때 일정이 없던 날도 나중에 일정이 생기면 채운다" {
        val day1Only = mutableMapOf(LocalDate.parse("2026-08-10") to listOf(place("성산일출봉", "SIGHT")))
        // 실 어댑터처럼 **재료가 빈 항목은 건너뛰고** 나머지에만 문구를 단다(어댑터가 빈 재료를 거른다).
        val echo = object : ReminderCopyPort {
            override val enabled = true
            var seen: List<ReminderCopyRequest> = emptyList()
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                seen = items
                return items.filter { it.slots.isNotEmpty() }.associate { it.scheduleKey to ReminderCopy("AI 제목", "AI 본문") }
            }
        }
        val retries = ReminderCopyRetries(RETRY_DELAYS_MS)
        val (svc, schedules) = serviceWith(echo, names = day1Only, retries = retries)

        svc.reload(tripId)
        // 첫날·여행 전날(첫날을 말한다)만 문구가 있고 2·3일차는 재료가 없어 비어 있다.
        schedules.findPendingByTrip(tripId).count { it.hasCopy } shouldBe 2
        schedules.findPendingByTrip(tripId).count { !it.hasCopy } shouldBe 2

        // 2차 생성이 끝났다 — 2·3일차 일정이 생겼다.
        day1Only[LocalDate.parse("2026-08-11")] = listOf(place("우도", "NATURE"))
        day1Only[LocalDate.parse("2026-08-12")] = listOf(place("카페 이름", "CAFE"))
        pollerAt(retries, svc, RETRY_DELAYS_MS[0]).retryDue()

        schedules.findPendingByTrip(tripId).all { it.hasCopy } shouldBe true
        // 다시 물은 것은 **빠졌던 두 날뿐**이다 — 이미 받은 날은 안 묻는다.
        echo.seen.map { it.date }.toSet() shouldBe setOf(LocalDate.parse("2026-08-11"), LocalDate.parse("2026-08-12"))
    }

    /**
     * **재시도는 횟수가 정해져 있다.** 상대가 아예 죽었을 때 계속 두드리지 않는다 — 다 쓰면 포기하고 **한 줄 남긴다**
     * (조용한 포기 금지, INV-4). 남은 행은 상수 문구로 발화한다.
     */
    "횟수를 다 쓰면 포기하고 한 줄 남긴다 — 더는 묻지 않는다" {
        val alwaysCold = object : ReminderCopyPort {
            override val enabled = true
            var calls = 0
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                calls++
                return emptyMap()
            }
        }
        val retries = ReminderCopyRetries(RETRY_DELAYS_MS)
        val (svc, schedules) = serviceWith(alwaysCold, retries = retries)

        val warns = warnsFrom(ReminderCopyRetryPoller::class.java) {
            svc.reload(tripId)
            // 시간을 충분히 흘려 보내며 폴러를 여러 번 돌린다 — 매번 때가 된 것만 처리된다.
            repeat(RETRY_DELAYS_MS.size + 3) { i ->
                pollerAt(retries, svc, RETRY_DELAYS_MS.sum() * (i + 1)).retryDue()
            }
        }

        // 처음 1번 + 재시도 횟수만큼이 전부다 — 그 뒤로는 안 묻는다.
        alwaysCold.calls shouldBe 1 + RETRY_DELAYS_MS.size
        schedules.findPendingByTrip(tripId).shouldSurviveWithoutCopy()
        warns.count { "끝내 못 채웠습니다" in it } shouldBe 1
    }

    /**
     * 남은 행이 **전부 재료 없음**이면(그 날 일정에 장소가 없다) 포기해도 경고가 아니다 — 못 받은 것이 아니라 물을 것이 없었다.
     * 11-04 운영 첫 08:00 에는 장소 없는 날만 남은 여행 3개가 파드마다 WARN 을 남겨, 상대가 죽어 못 받은 진짜 경고와 섞였다.
     * 줄 자체는 남긴다(조용한 포기 금지) — 수준만 INFO 다.
     */
    "남은 행이 전부 재료 없음이면 포기해도 경고가 아니다 — 같은 줄이 INFO 로 남는다" {
        val port = object : ReminderCopyPort {
            override val enabled = true
            var calls = 0
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                calls++
                return emptyMap()
            }
        }
        val retries = ReminderCopyRetries(RETRY_DELAYS_MS)
        val (svc, _) = serviceWith(port, names = emptyMap(), retries = retries)

        val lines = linesFrom(ReminderCopyRetryPoller::class.java) {
            svc.reload(tripId)
            repeat(RETRY_DELAYS_MS.size + 3) { i ->
                pollerAt(retries, svc, RETRY_DELAYS_MS.sum() * (i + 1)).retryDue()
            }
        }

        // 적재 때 한 번 물었을 뿐이다 — 재시도는 재료가 없는 행을 아예 안 묻는다.
        port.calls shouldBe 1
        val giveUp = lines.filter { "끝내 못 채웠습니다" in it.second }
        giveUp.map { it.first } shouldBe listOf(ch.qos.logback.classic.Level.INFO)
    }

    /** 채움이 예외로 끝나도 사슬이 끊기지 않는다 — 다음 기회에 다시 한다(일시적인 조회 실패가 문구를 영구히 포기시키지 않는다). */
    "채움이 터져도 다음 기회에 다시 한다" {
        var failNext = true
        val plans = object : com.trippilot.itinerarygeneration.api.ItineraryPlanFacade {
            override fun findPlanSlots(accountId: UUID, tripId: UUID) = emptyList<com.trippilot.itinerarygeneration.api.PlannedSlotView>()
            override fun findPlannedPlaces(accountId: UUID, tripId: UUID): Map<LocalDate, List<PlannedPlaceView>> {
                if (failNext) { failNext = false; error("일시적인 조회 실패") }
                return plannedNames
            }
        }
        val cold = object : ReminderCopyPort {
            override val enabled = true
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>) = emptyMap<String, ReminderCopy>()
        }
        val schedules = FakeSchedules()
        val trips = FakeTripOwner().apply { put(tripId, acc, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12")) }
        val retries = ReminderCopyRetries(RETRY_DELAYS_MS)
        val svc = NotificationScheduleService(trips, schedules, cold, plans, clock, retries, NoDeletionPending)

        // reload 의 첫 문구 호출이 조회 실패로 끝나도 예약은 적재되고, 재시도가 걸린다.
        svc.reload(tripId)
        schedules.findPendingByTrip(tripId).shouldSurviveWithoutCopy()

        pollerAt(retries, svc, RETRY_DELAYS_MS[0]).retryDue()      // 조회는 이제 성공하고, 상대는 여전히 못 준다
        // 다음 시도가 걸려 있다 — 사슬이 이어졌다.
        retries.takeDue(clock.instant().plusMillis(RETRY_DELAYS_MS.sum())).map { it.attempt } shouldBe listOf(1)
    }

    /**
     * **채우는 사이 재적재가 행을 바꿔도** 옛 id 의 문구가 새 행에 붙지 않는다 — 조건부 쓰기가 지워진 행엔 아무 일도 안 한다.
     * (붙으면 "다른 날 이야기"가 되고 원인을 되짚기 가장 어렵다.)
     */
    "채우는 사이 재적재가 행을 새로 만들었으면 옛 문구는 어디에도 붙지 않는다" {
        val schedulesHolder = FakeSchedules()
        val replacing = object : ReminderCopyPort {
            override val enabled = true
            var calls = 0
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                calls++
                if (calls == 1) return emptyMap()   // 첫 적재는 못 받는다 → 재시도가 걸린다
                // 재시도 중(AI 호출 도중)에 다른 적재가 같은 여행의 행을 새로 만들었다.
                schedulesHolder.replacePending(tripId, schedulesHolder.findPendingByTrip(tripId).map { it.copy(scheduleId = UUID.randomUUID()) })
                return items.associate { it.scheduleKey to ReminderCopy("옛 제목", "옛 본문") }
            }
        }
        val trips = FakeTripOwner().apply { put(tripId, acc, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12")) }
        val retries = ReminderCopyRetries(RETRY_DELAYS_MS)
        val svc = NotificationScheduleService(trips, schedulesHolder, replacing, FakePlans(plannedNames), clock, retries, NoDeletionPending)

        svc.reload(tripId)
        val countBefore = schedulesHolder.findPendingByTrip(tripId).size
        pollerAt(retries, svc, RETRY_DELAYS_MS[0]).retryDue()

        schedulesHolder.findPendingByTrip(tripId).size shouldBe countBefore
        schedulesHolder.findPendingByTrip(tripId).shouldSurviveWithoutCopy()   // 옛 문구는 새 행에 안 붙었다
    }

    /** 시각이 이미 지난 행은 채우지 않는다 — 발화기가 곧 집는다(그리고 늦으면 취소한다). */
    "발화 시각이 지난 행은 채우지 않는다" {
        val echo = Echo()
        val (svc, schedules) = serviceWith(echo)
        svc.reload(tripId)
        // 모든 행이 이미 시각이 지났다고 가정하고(시계를 크게 앞당김) 제자리 채우기를 직접 부른다.
        val late = NotificationScheduleService(
            FakeTripOwner().apply { put(tripId, acc, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12")) },
            schedules, echo, FakePlans(plannedNames), Clock.offset(clock, Duration.ofDays(30)), ReminderCopyRetries(RETRY_DELAYS_MS), NoDeletionPending,
        )
        echo.seen = emptyList()
        schedules.stored.replaceAll { it.copy(title = null, body = null) }

        late.fillMissing(tripId) shouldBe FillOutcome.Done
        echo.seen shouldBe emptyList()
    }

    "받았거나 물을 재료가 없었으면 AI 를 다시 부르지 않는다" {
        val retries = ReminderCopyRetries(RETRY_DELAYS_MS)
        var calls = 0
        val nothing = object : ReminderCopyPort {
            override val enabled = true
            override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
                calls++
                return emptyMap()
            }
        }

        // 전부 받았다 — 채울 것이 없어 재시도 자체가 안 걸린다.
        serviceWith(Echo(), retries = retries).first.reload(tripId)
        retries.takeDue(clock.instant().plusMillis(RETRY_DELAYS_MS.sum())) shouldBe emptyList()

        // 재료가 없다 — 재시도는 걸리지만(일정이 뒤늦게 생길 수 있다) 비어 있는 동안은 **AI 를 부르지 않는다**.
        val (svc, _) = serviceWith(nothing, names = emptyMap(), retries = retries)
        svc.reload(tripId)
        val callsAfterReload = calls
        pollerAt(retries, svc, RETRY_DELAYS_MS[0]).retryDue()
        calls shouldBe callsAfterReload
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

private val RETRY_DELAYS_MS = listOf(180_000L, 300_000L, 480_000L)

/** 시각 기준 [offsetMs] 뒤에 도는 재시도 폴러. */
private fun pollerAt(retries: ReminderCopyRetries, svc: NotificationScheduleService, offsetMs: Long) =
    ReminderCopyRetryPoller(retries, svc, Clock.offset(Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC), Duration.ofMillis(offsetMs)))

/** [loggerClass] 의 모든 줄을 (수준, 메시지) 로 모은다 — 같은 줄의 수준이 상황에 따라 갈리는지 볼 때 쓴다. */
private fun linesFrom(loggerClass: Class<*>, block: () -> Unit): List<Pair<ch.qos.logback.classic.Level, String>> {
    val appender = ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>().apply { start() }
    val logger = org.slf4j.LoggerFactory.getLogger(loggerClass) as ch.qos.logback.classic.Logger
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.map { it.level to it.formattedMessage }
}

/** [loggerClass] 의 WARN 줄을 모은다. */
private fun warnsFrom(loggerClass: Class<*>, block: () -> Unit): List<String> {
    val appender = ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>().apply { start() }
    val logger = org.slf4j.LoggerFactory.getLogger(loggerClass) as ch.qos.logback.classic.Logger
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.filter { it.level == ch.qos.logback.classic.Level.WARN }.map { it.formattedMessage }
}
