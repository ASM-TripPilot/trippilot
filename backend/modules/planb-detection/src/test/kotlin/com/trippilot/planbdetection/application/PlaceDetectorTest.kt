package com.trippilot.planbdetection.application

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.itinerarygeneration.api.CheckedSlot
import com.trippilot.itinerarygeneration.api.DayCheck
import com.trippilot.itinerarygeneration.api.HoursVerdict
import com.trippilot.itinerarygeneration.api.ItineraryDayCheckFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.placedata.api.PoiLifeStatus
import com.trippilot.placedata.api.PoiStatusFacade
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerVariant
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.kotest.matchers.types.shouldBeInstanceOf
import org.slf4j.LoggerFactory
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

private val KST: ZoneId = ZoneId.of("Asia/Seoul")
private val TODAY: LocalDate = LocalDate.parse("2026-10-20") // 화요일
private val TOMORROW: LocalDate = TODAY.plusDays(1)

/** 하루 점검 대역 — 정해 둔 답을 내고 받은 질의를 적는다. */
private class FakeDays(private val answer: DayCheck?) : ItineraryDayCheckFacade {
    val asked = mutableListOf<Triple<UUID, UUID, LocalDate>>()
    override fun checkDay(accountId: UUID, tripId: UUID, date: LocalDate, judgeHours: Boolean): DayCheck? {
        asked += Triple(accountId, tripId, date)
        return answer
    }
}

/**
 * 영업시간을 물을 때마다 대본의 답을 하나씩 내는 하루 점검 — true = AI 가 답했다(OK) · false = 보류 · null = AI 를 부르지
 * 않은 날(보류 아님 · 영업시간 모름 — 모드가 http 아님·영업시간을 아는 슬롯 없음). 빼라고 하면(judgeHours=false) AI 없는
 * 점검을 낸다. [hoursAsked] = 호출마다 영업시간을 물었는가.
 */
private class ScriptedDays(private val slot: CheckedSlot, vararg script: Boolean?) : ItineraryDayCheckFacade {
    private val script = ArrayDeque(script.toList())
    val hoursAsked = mutableListOf<Boolean>()
    override fun checkDay(accountId: UUID, tripId: UUID, date: LocalDate, judgeHours: Boolean): DayCheck {
        hoursAsked += judgeHours
        val answer = if (judgeHours) script.removeFirst() else null
        return DayCheck(answer != false, listOf(slot.copy(hours = if (answer == true) HoursVerdict.OK else HoursVerdict.UNKNOWN)))
    }
}

/** 상태 조회 대역 — 실물처럼 실패는 예외다(DB 오류). 메시지에 비밀처럼 보이는 값을 실어 로그에 새는지 본다. */
private class FakeStatus(private val answer: Map<UUID, PoiLifeStatus> = emptyMap(), private val fail: Boolean = false) : PoiStatusFacade {
    val asked = mutableListOf<Collection<UUID>>()
    override fun statusOf(poiIds: Collection<UUID>): Map<UUID, PoiLifeStatus> {
        asked += poiIds
        if (fail) throw IllegalStateException("jdbc:postgresql://db?password=s3cret")
        return answer
    }
}

/**
 * 장소 감지기(T-D3-U · BR-SA-17 · 설계서 §4.3 실패·모름 표) — 하루 점검·장소 상태를 감지 계약(Detection)으로 옮긴다.
 * 판정 규칙 자체는 [com.trippilot.planbdetection.domain.ClosureRules] PBT 가 잰다. 여기는 배선·실패 갈래·신호 모양이다.
 */
class PlaceDetectorTest : StringSpec({

    val tripId = UUID.randomUUID()
    val accountId = UUID.randomUUID()
    val poiA = UUID.nameUUIDFromBytes("a".toByteArray())
    val poiB = UUID.nameUUIDFromBytes("b".toByteArray())

    fun at(date: LocalDate, hhmm: String): Instant = date.atTime(LocalTime.parse(hhmm)).atZone(KST).toInstant()

    fun checked(date: LocalDate, poi: UUID, start: String, hours: HoursVerdict = HoursVerdict.OK, warned: Boolean = false, name: String? = "성산일출봉") =
        CheckedSlot("$date#$poi", poi, name, LocalTime.parse(start), hours, null, warned)

    fun planned(date: LocalDate, poi: UUID, start: String) = PlannedSlotView(
        "$date#$poi", date, poi, 0, LocalTime.parse(start), LocalTime.parse(start).plusHours(1),
        isFixed = false, endsNextDay = false, hasViolation = false,
    )

    fun target(date: LocalDate, now: Instant, phase: SweepPhase, active: List<PlanBTrigger> = emptyList()) =
        SweepTarget(tripId, accountId, date, phase, round = now, now = now, slots = listOf(planned(date, poiA, "10:00")), active = active)

    fun detector(days: ItineraryDayCheckFacade, status: PoiStatusFacade = FakeStatus()) = PlaceDetector(days, status)

    "출처는 place · 종류는 CLOSURE 다 — 해제 자격 이름과 감시 상태 묶음(closure)이 이 이름이다" {
        val d = detector(FakeDays(null))
        d.source shouldBe SweepSource.PLACE
        d.kind shouldBe TriggerKind.CLOSURE
    }

    "아침의 오늘 · 저녁의 내일만 본다 — AI 검증이라 하루 두 번으로 묶는다(BR-SA-01)" {
        val d = detector(FakeDays(null))
        val wanted = SweepPhase.entries.flatMap { phase -> (0..2).filter { d.wants(phase, it) }.map { phase to it } }
        wanted shouldContainExactly listOf(SweepPhase.MORNING to 0, SweepPhase.EVENING to 1)
    }

    "늘 산다 — AI 스케줄 모드가 http 가 아니어도 폐업은 본다(영업시간 모름은 하루 점검이 낸다 · tech-stack 델타 6 · BLM §6.2)" {
        detector(FakeDays(null)).isLive() shouldBe true
    }

    "하루 점검이 null(비소유·일정 없음·그 날 없음)이면 모름이다 — 상태도 묻지 않는다" {
        val status = FakeStatus()
        val days = FakeDays(null)

        detector(days, status).detect(target(TOMORROW, at(TODAY, "20:15"), SweepPhase.EVENING)).shouldBeInstanceOf<Detection.Unknown>()

        days.asked shouldContainExactly listOf(Triple(accountId, tripId, TOMORROW))
        status.asked.shouldBeEmpty()
    }

    "폐업이 영업시간보다 우선한다 — 신호 모양: 슬롯 대상 · 위험 · payload 는 POI 하나 · 원천은 장소 상태" {
        val day = DayCheck(true, listOf(checked(TOMORROW, poiA, "10:00", HoursVerdict.VIOLATED, name = "[폐업] 사라진 카페")))
        val status = FakeStatus(mapOf(poiA to PoiLifeStatus.CLOSED))

        val d = detector(FakeDays(day), status).detect(target(TOMORROW, at(TODAY, "20:15"), SweepPhase.EVENING))

        val signal = d.shouldBeInstanceOf<Detection.Checked>().signals.single()
        d.checked.shouldBeEmpty()
        status.asked.single().toList() shouldContainExactly listOf(poiA)
        signal.kind shouldBe TriggerKind.CLOSURE
        signal.affectedDate shouldBe TOMORROW
        signal.slotKey shouldBe "$TOMORROW#$poiA"
        signal.variant shouldBe TriggerVariant.PERMANENTLY_CLOSED
        signal.severity shouldBe TriggerSeverity.RISK
        signal.dataSource shouldBe DataSource.PLACE_STATUS
        signal.payload shouldBe mapOf(PlanBTrigger.PAYLOAD_POI_ID to poiA.toString())
        signal.poiIds.shouldBeEmpty() // 영향 POI 는 slotKey 가 말한다 — payload 키를 늘리지 않는다
        signal.scope shouldBe TriggerScope.FULL_DAY // 미래일(판정이 다시 교정한다)
        signal.reason shouldBe "10월 21일(수) ‘[폐업] 사라진 카페’는 폐업한 곳으로 확인됐어요"
    }

    "영업시간 위반은 AI 검증 원천의 HOURS_MISMATCH 다 — 편집 때 이미 본 경고는 다시 알리지 않는다" {
        val day = DayCheck(
            true,
            listOf(
                checked(TODAY, poiA, "10:00", HoursVerdict.VIOLATED),
                checked(TODAY, poiB, "12:00", HoursVerdict.VIOLATED, warned = true),
            ),
        )
        val status = FakeStatus(mapOf(poiA to PoiLifeStatus.ACTIVE, poiB to PoiLifeStatus.ACTIVE))

        val d = detector(FakeDays(day), status).detect(target(TODAY, at(TODAY, "07:15"), SweepPhase.MORNING))

        val signal = d.shouldBeInstanceOf<Detection.Checked>().signals.single()
        d.checked.shouldBeEmpty()
        signal.slotKey shouldBe "$TODAY#$poiA"
        signal.variant shouldBe TriggerVariant.HOURS_MISMATCH
        signal.dataSource shouldBe DataSource.AI_VALIDATE
        signal.scope shouldBe TriggerScope.PARTIAL_SLOTS
        signal.reason shouldBe "계획한 시간엔 ‘성산일출봉’ 영업하지 않는 것으로 나와요"
    }

    "오늘은 시작이 지난 슬롯을 보지 않는다 — 07:00 위반은 무발화, 10:00 은 확인" {
        val day = DayCheck(true, listOf(checked(TODAY, poiA, "07:00", HoursVerdict.VIOLATED), checked(TODAY, poiB, "10:00")))
        val status = FakeStatus(mapOf(poiA to PoiLifeStatus.ACTIVE, poiB to PoiLifeStatus.ACTIVE))

        val d = detector(FakeDays(day), status).detect(target(TODAY, at(TODAY, "07:15"), SweepPhase.MORNING))

        d.shouldBeInstanceOf<Detection.Checked>().signals.shouldBeEmpty()
        d.checked shouldBe setOf("$TODAY#$poiB")
    }

    "공휴일 휴무가 떠 있는 슬롯은 OK 여도 확인하지 않는다 — 감지기가 HOLIDAY 를 해제하지 않는다" {
        val day = DayCheck(true, listOf(checked(TOMORROW, poiA, "10:00"), checked(TOMORROW, poiB, "12:00")))
        val status = FakeStatus(mapOf(poiA to PoiLifeStatus.ACTIVE, poiB to PoiLifeStatus.ACTIVE))
        val now = at(TODAY, "20:15")
        val holiday = PlanBTrigger.active(
            tripId, UUID.randomUUID(), TriggerKind.CLOSURE, TOMORROW, "$TOMORROW#$poiA",
            mapOf(PlanBTrigger.PAYLOAD_VARIANT to TriggerVariant.HOLIDAY.name, PlanBTrigger.PAYLOAD_DETECTOR to SweepSource.PLACE),
            TriggerScope.FULL_DAY, "공휴일이라 ‘성산일출봉’ 쉬는 날로 나와요", now,
        )
        val mismatch = holiday.copy(
            triggerId = UUID.randomUUID(), slotKey = "$TOMORROW#$poiB",
            payload = mapOf(PlanBTrigger.PAYLOAD_VARIANT to TriggerVariant.HOURS_MISMATCH.name, PlanBTrigger.PAYLOAD_DETECTOR to SweepSource.PLACE),
        )

        val d = detector(FakeDays(day), status).detect(target(TOMORROW, now, SweepPhase.EVENING, active = listOf(holiday, mismatch)))

        d.shouldBeInstanceOf<Detection.Checked>().checked shouldBe setOf("$TOMORROW#$poiB")
    }

    "상태 조회가 실패하면 확인을 비운다 — 영업시간 위반은 그대로 내고, 로그에는 예외 종류만 남긴다" {
        val day = DayCheck(true, listOf(checked(TOMORROW, poiA, "10:00", HoursVerdict.VIOLATED), checked(TOMORROW, poiB, "12:00")))
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(PlaceDetector::class.java) as Logger
        logger.addAppender(appender)
        val d = try {
            detector(FakeDays(day), FakeStatus(fail = true)).detect(target(TOMORROW, at(TODAY, "20:15"), SweepPhase.EVENING))
        } finally {
            logger.detachAppender(appender)
        }

        d.shouldBeInstanceOf<Detection.Checked>().checked.shouldBeEmpty()
        d.signals.map { it.variant } shouldContainExactly listOf(TriggerVariant.HOURS_MISMATCH)
        appender.list.single().formattedMessage.let {
            it shouldNotContain "s3cret"
            it shouldNotContain "jdbc:"
        }
        appender.list.single().throwableProxy shouldBe null
    }

    "상태 조회가 실패하고 영업시간 위반도 없으면 모름이다 — 빈 확인으로 내면 감시 상태가 '확인됨'이 된다" {
        val day = DayCheck(true, listOf(checked(TOMORROW, poiA, "10:00")))

        detector(FakeDays(day), FakeStatus(fail = true)).detect(target(TOMORROW, at(TODAY, "20:15"), SweepPhase.EVENING))
            .shouldBeInstanceOf<Detection.Unknown>()
    }

    "AI 판정 보류면 영업시간은 모름이다 — 폐업은 그대로 알리고, 폐업도 없으면 모름" {
        val withheld = DayCheck(false, listOf(checked(TOMORROW, poiA, "10:00", HoursVerdict.UNKNOWN), checked(TOMORROW, poiB, "12:00", HoursVerdict.UNKNOWN)))
        val now = at(TODAY, "20:15")

        val closed = detector(FakeDays(withheld), FakeStatus(mapOf(poiA to PoiLifeStatus.CLOSED, poiB to PoiLifeStatus.ACTIVE)))
            .detect(target(TOMORROW, now, SweepPhase.EVENING))
        val nothing = detector(FakeDays(withheld), FakeStatus(mapOf(poiA to PoiLifeStatus.ACTIVE, poiB to PoiLifeStatus.ACTIVE)))
            .detect(target(TOMORROW, now, SweepPhase.EVENING))

        closed.shouldBeInstanceOf<Detection.Checked>().signals.map { it.variant } shouldContainExactly listOf(TriggerVariant.PERMANENTLY_CLOSED)
        closed.checked.shouldBeEmpty()
        nothing.shouldBeInstanceOf<Detection.Unknown>()
    }

    "LOST·UNVERIFIED 는 폐업이 아니라 모름이다 — 신호도 확인도 없다" {
        val day = DayCheck(true, listOf(checked(TOMORROW, poiA, "10:00"), checked(TOMORROW, poiB, "12:00")))
        val status = FakeStatus(mapOf(poiA to PoiLifeStatus.OTHER)) // poiB 는 없는 POI — 키가 빠졌다

        detector(FakeDays(day), status).detect(target(TOMORROW, at(TODAY, "20:15"), SweepPhase.EVENING))
            .shouldBeInstanceOf<Detection.Unknown>()
    }

    "볼 슬롯이 없으면(빈 날) 신호·확인 없이 확인으로 낸다 — 모를 것이 없다" {
        val d = detector(FakeDays(DayCheck(true, emptyList())), FakeStatus()).detect(target(TOMORROW, at(TODAY, "20:15"), SweepPhase.EVENING))

        d.shouldBeInstanceOf<Detection.Checked>().signals.shouldBeEmpty()
        d.checked.shouldBeEmpty()
    }

    "AI 영업시간 판정이 한 회차에서 연속 3번 보류되면 남은 여행은 AI 를 부르지 않는다 — 폐업은 계속 알리고, WARN 은 열 때 1번 (RES-SA-04)" {
        val days = ScriptedDays(checked(TOMORROW, poiA, "10:00", name = "[폐업] 사라진 카페"), false, false, false)
        val d = detector(days, FakeStatus(mapOf(poiA to PoiLifeStatus.CLOSED)))
        val round = at(TODAY, "20:15")
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(PlaceDetector::class.java) as Logger
        logger.addAppender(appender)
        val seen = try {
            List(5) { d.detect(target(TOMORROW, round, SweepPhase.EVENING)) }
        } finally {
            logger.detachAppender(appender)
        }

        days.hoursAsked shouldContainExactly listOf(true, true, true, false, false)
        seen.forEach { it.shouldBeInstanceOf<Detection.Checked>().signals.map { s -> s.variant } shouldContainExactly listOf(TriggerVariant.PERMANENTLY_CLOSED) }
        appender.list.count { it.level == Level.WARN } shouldBe 1
    }

    "회차가 바뀌면 다시 묻는다 — 회로는 그 회차 안에서만 열린다" {
        val days = ScriptedDays(checked(TOMORROW, poiA, "10:00"), false, false, false, true)
        val d = detector(days, FakeStatus(mapOf(poiA to PoiLifeStatus.ACTIVE)))

        repeat(4) { d.detect(target(TOMORROW, at(TODAY, "20:15"), SweepPhase.EVENING)) }
        val next = d.detect(target(TOMORROW, at(TODAY, "20:40"), SweepPhase.EVENING))

        days.hoursAsked shouldContainExactly listOf(true, true, true, false, true)
        next.shouldBeInstanceOf<Detection.Checked>().checked shouldBe setOf("$TOMORROW#$poiA")
    }

    "AI 가 한 번 답하면 연속 보류를 0 으로 되돌린다 — 띄엄띄엄 보류는 회로를 열지 않는다" {
        val days = ScriptedDays(checked(TOMORROW, poiA, "10:00"), false, false, true, false, false, false)
        val d = detector(days, FakeStatus(mapOf(poiA to PoiLifeStatus.ACTIVE)))

        repeat(7) { d.detect(target(TOMORROW, at(TODAY, "20:15"), SweepPhase.EVENING)) }

        days.hoursAsked shouldContainExactly listOf(true, true, true, true, true, true, false)
    }

    "AI 를 부르지 않은 날(보류 아님 · 영업시간 모름)은 보류로 세지도, 0 으로 되돌리지도 않는다" {
        val days = ScriptedDays(checked(TOMORROW, poiA, "10:00"), false, false, null, false)
        val d = detector(days, FakeStatus(mapOf(poiA to PoiLifeStatus.ACTIVE)))

        repeat(5) { d.detect(target(TOMORROW, at(TODAY, "20:15"), SweepPhase.EVENING)) }

        days.hoursAsked shouldContainExactly listOf(true, true, true, true, false)
    }
})
