package com.trippilot.itinerarygeneration.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.LocalTime

/** 밤 늦게 만든 오늘은 익일 01:00 까지(2026-10-20 사용자) — 새벽 끝은 다음 날, 그 밖의 거꾸로 된 창은 모순. */
class TodayWindowTest : StringSpec({
    fun t(s: String) = LocalTime.parse(s)

    "지금부터 2시간이 23:59 안이면 종전대로, 넘으면 익일 01:00" {
        TodayWindow.generationEnd(t("21:00"), t("21:00")) shouldBe t("23:00")
        TodayWindow.generationEnd(t("21:30"), t("21:00")) shouldBe t("23:30")
        TodayWindow.generationEnd(t("22:00"), t("21:00")) shouldBe t("01:00")
        TodayWindow.generationEnd(t("23:30"), t("21:00")) shouldBe t("01:00")
    }

    "새벽 끝만 다음 날로 읽는다 — 낮의 거꾸로 된 창은 열린 창이 아니다" {
        TodayWindow.isOvernight(t("23:00"), t("01:00")) shouldBe true
        TodayWindow.isOpen(t("23:00"), t("01:00")) shouldBe true
        TodayWindow.isOpen(t("10:00"), t("09:00")) shouldBe false
        TodayWindow.isOpen(t("21:00"), t("21:00")) shouldBe false // 닫힌 날(길이 0)
    }

    "창 길이는 다음 날 끝까지 센다" {
        TodayWindow.spanMinutes(t("23:00"), t("01:00")) shouldBe 120
        TodayWindow.spanMinutes(t("09:00"), t("21:00")) shouldBe 720
        TodayWindow.spanMinutes(t("21:00"), t("21:00")) shouldBe 0
    }
})
