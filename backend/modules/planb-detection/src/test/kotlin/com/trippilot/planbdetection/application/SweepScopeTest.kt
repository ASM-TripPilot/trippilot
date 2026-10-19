package com.trippilot.planbdetection.application

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.choice
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.long
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * 회차 범위(설계서 규칙 1 · BR-SA-01 · INV-SA-5 · T-D1-P7) — 언제 돌고, 어느 날짜를 보고, 언제까지 쓰는가.
 * 밤(21:00~06:59 KST)에는 회차가 없고, 20시대 회차만 내일을 보며, 회차 안에서도 20:58 이후에는 쓰지 않는다.
 */
class SweepScopeTest : StringSpec({

    val kst = ZoneId.of("Asia/Seoul")
    val day = LocalDate.parse("2026-08-11")
    fun at(hhmm: String, date: LocalDate = day): Instant = date.atTime(LocalTime.parse(hhmm)).atZone(kst).toInstant()

    // 2026-01-01 ~ 2028-01-01 의 임의 시각(초 단위)에 경계 시각을 절반 섞는다. 균등 분포로는 특정 초를 1,000회에 1% 안팎으로만
    // 치고 edgecase(양 끝)는 KST 09:00 이다 — PBT-07 은 생성기가 KST 20:58·20:59·21:00·06:59·07:00 을 반드시 포함하라고 한다.
    val boundaries = listOf("06:59:59", "07:00", "20:57:59", "20:58", "20:58:59", "20:59", "20:59:59", "21:00").map(LocalTime::parse)
    val edges = Arb.bind(Arb.long(0L, 729L), Arb.element(boundaries)) { days, time ->
        LocalDate.parse("2026-01-01").plusDays(days).atTime(time).atZone(kst).toEpochSecond()
    }
    val instants = Arb.choice(Arb.long(1_767_225_600L, 1_830_297_600L), edges)

    "밤(21:00~06:59 KST)에는 회차가 없다 — 그 밖의 시각에는 있다(PBT)" {
        checkAll(instants, Arb.enum<SweepHorizon>()) { secs, horizon ->
            val now = Instant.ofEpochSecond(secs)
            val hour = now.atZone(kst).hour
            (scopeAt(now, horizon) == null) shouldBe (hour !in 7..20)
        }
    }

    "단계는 KST 시로 정한다 — 7시 아침·8~19시 낮·20시 저녁, 오늘은 여행지 날짜다(PBT)" {
        checkAll(instants, Arb.enum<SweepHorizon>()) { secs, horizon ->
            val now = Instant.ofEpochSecond(secs)
            val local = now.atZone(kst)
            val scope = scopeAt(now, horizon) ?: return@checkAll
            scope.today shouldBe local.toLocalDate()
            scope.phase shouldBe when (local.hour) {
                7 -> SweepPhase.MORNING
                20 -> SweepPhase.EVENING
                else -> SweepPhase.DAYTIME
            }
        }
    }

    "내일은 20시대 회차만 본다 — 지평이 tomorrow 이상일 때 진행 중 여행의 내일(PBT)" {
        checkAll(instants, Arb.enum<SweepHorizon>()) { secs, horizon ->
            val scope = scopeAt(Instant.ofEpochSecond(secs), horizon) ?: return@checkAll
            val today = scope.today
            val dates = scope.datesOf(today.minusDays(1), today.plusDays(1))
            val wantsTomorrow = scope.phase == SweepPhase.EVENING && horizon != SweepHorizon.TODAY
            dates shouldBe listOfNotNull(today, today.plusDays(1).takeIf { wantsTomorrow })
        }
    }

    "내일 시작하는 여행의 첫날은 20시대 회차 ∧ 지평 pre-trip 일 때만 본다 — 그때만 조회 구간이 내일까지다(PBT)" {
        checkAll(instants, Arb.enum<SweepHorizon>()) { secs, horizon ->
            val scope = scopeAt(Instant.ofEpochSecond(secs), horizon) ?: return@checkAll
            val tomorrow = scope.today.plusDays(1)
            val preTrip = scope.phase == SweepPhase.EVENING && horizon == SweepHorizon.PRE_TRIP
            scope.datesOf(tomorrow, tomorrow.plusDays(2)) shouldBe listOfNotNull(tomorrow.takeIf { preTrip })
            scope.queryTo shouldBe if (preTrip) tomorrow else scope.today
        }
    }

    "쓰기는 그 날 20:58 전까지만이다 — 회차가 20:40 에 시작해도 20:58 이후에는 쓰지 않는다(PBT)" {
        checkAll(instants, Arb.enum<SweepHorizon>()) { secs, horizon ->
            val now = Instant.ofEpochSecond(secs)
            val scope = scopeAt(now, horizon) ?: return@checkAll
            scope.writable(now) shouldBe now.atZone(kst).toLocalTime().isBefore(LocalTime.of(20, 58))
        }
    }

    "경계 — 06:59·21:00 은 회차 없음, 07:00 은 아침, 20:57:59 는 쓰고 20:58·20:59 는 회차는 있어도 쓰지 않는다" {
        scopeAt(at("06:59:59"), SweepHorizon.PRE_TRIP) shouldBe null
        scopeAt(at("21:00"), SweepHorizon.PRE_TRIP) shouldBe null
        scopeAt(at("07:00"), SweepHorizon.TODAY)!!.phase shouldBe SweepPhase.MORNING
        scopeAt(at("19:59:59"), SweepHorizon.TODAY)!!.phase shouldBe SweepPhase.DAYTIME
        val evening = scopeAt(at("20:57:59"), SweepHorizon.TOMORROW)!!
        evening.phase shouldBe SweepPhase.EVENING
        evening.writable(at("20:57:59")) shouldBe true
        evening.writable(at("20:58")) shouldBe false
        scopeAt(at("20:58"), SweepHorizon.TOMORROW) shouldNotBe null
        scopeAt(at("20:59:59"), SweepHorizon.TOMORROW)!!.writable(at("20:59:59")) shouldBe false
    }

    "오늘은 서버 UTC 가 아니라 여행지 날짜다 — UTC 23:30 은 KST 다음 날 아침이다" {
        val scope = scopeAt(Instant.parse("2026-08-10T23:30:00Z"), SweepHorizon.TODAY)!!
        scope.today shouldBe day
        scope.phase shouldBe SweepPhase.DAYTIME
    }

    "여행 구간 밖 날짜는 보지 않는다 — 어제 끝난 여행·모레 시작 여행은 빈 목록" {
        val scope = scopeAt(at("20:15"), SweepHorizon.PRE_TRIP)!!
        scope.datesOf(day.minusDays(3), day.minusDays(1)).shouldBeEmpty()
        scope.datesOf(day.plusDays(2), day.plusDays(3)).shouldBeEmpty()
        // 오늘 끝나는 여행은 오늘만 — 내일은 구간 밖이다.
        scope.datesOf(day.minusDays(2), day) shouldBe listOf(day)
    }
})
