package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlot
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 위반 → 표시 문구·경고 판정.
 * 경고는 **위반 수**를 세야 한다 — 슬롯 수로 세면 한 슬롯에 여러 건이 붙었을 때 없는 문제를 알린다.
 */
class ViolationTextTest : StringSpec({

    val d1 = LocalDate.parse("2026-08-01")
    fun day(slots: Int) = ItineraryDay.of(
        d1, 0,
        (0 until slots).map { VisitSlot.of(UUID.randomUUID(), null, it, LocalTime.parse("10:00"), LocalTime.parse("11:00")) },
    )

    "타입을 사용자 문구로 번역하고 중복은 접는다(TRIP-1030) — detail 은 싣지 않는다" {
        ViolationText.reasonOf(
            listOf(
                Violation("HC2", 0, 0, "이동 54분 필요, 간격 -60분"),
                Violation("HC1", 0, 0, "영업시간 밖: 543~618"),
                Violation("TRAVEL_TIME", 0, 0, null), // HC2 와 같은 축 — 문구가 같아 접힌다
            ),
        ) shouldBe "앞 장소에서 이동할 시간이 빠듯해요 · 영업시간과 맞지 않아요"
    }

    "위반이 없으면 null — 빈 문자열을 저장하면 CHECK 와 화면 판정이 어긋난다" {
        ViolationText.reasonOf(emptyList()) shouldBe null
    }

    "모르는 타입도 한국어 일반 문구다 — 영문 코드·원시 detail 이 화면에 새지 않는다" {
        val reason = ViolationText.reasonOf(listOf(Violation("SOMETHING_NEW", 0, 0, "day window(540~1320) 밖")))!!
        reason shouldBe "일정 조건과 맞지 않아요"
        Regex("""\d|[A-Za-z_]""").containsMatchIn(reason) shouldBe false
    }

    "한 슬롯에 위반이 여러 건이어도 '범위 밖'으로 잘못 세지 않는다" {
        // 슬롯 수(1)로 세면 3 - 1 = 2건이 범위 밖으로 잡혀 없는 문제를 경고한다.
        val sameSlot = listOf(
            Violation("A", 0, 0, "x"), Violation("B", 0, 0, "y"), Violation("C", 0, 0, "z"),
        )
        ViolationText.countOutOfRange(sameSlot, listOf(day(2))) shouldBe 0
    }

    "인덱스가 실제 슬롯을 벗어나면 범위 밖으로 센다" {
        ViolationText.countOutOfRange(listOf(Violation("A", 0, 5, "x")), listOf(day(2))) shouldBe 1
        ViolationText.countOutOfRange(listOf(Violation("A", 3, 0, "x")), listOf(day(2))) shouldBe 1
    }

    "위치를 모르는 위반은 범위 밖이 아니라 '붙일 수 없음'이다" {
        ViolationText.countUnlocatable(listOf(Violation("A", null, null, "x"))) shouldBe 1
        ViolationText.countOutOfRange(listOf(Violation("A", null, null, "x")), listOf(day(2))) shouldBe 0
    }
})
