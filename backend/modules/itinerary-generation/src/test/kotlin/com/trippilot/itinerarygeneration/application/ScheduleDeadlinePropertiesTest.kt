package com.trippilot.itinerarygeneration.application

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.comparables.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import java.time.Duration

/**
 * 시간 예산은 **서로 물려 있다**(TRIP-474). 따로 두면 한쪽만 옮긴 절반 설정이 나오고, 그때 증상은
 * "AI 를 붙였는데 전부 폴백" 이라 원인이 안 보인다. 그래서 파생식을 여기서 못으로 박는다.
 */
class ScheduleDeadlinePropertiesTest : StringSpec({

    "기본은 시한을 싣지 않는다 — 값은 남아 있되 꺼져 있다" {
        val p = ScheduleDeadlineProperties()

        p.enforced shouldBe false
        p.day1Budget() shouldBe null
        p.totalBudget() shouldBe null
        // 지우지 않았다 — 9월 재도입이 재작업이 되지 않게(TRIP-475).
        p.day1Ms shouldBe 5_000L
        p.totalMs shouldBe 20_000L
    }

    "켜면 종전 값이 그대로 실린다" {
        val p = ScheduleDeadlineProperties(enforced = true)

        p.day1Budget() shouldBe 5_000L
        p.totalBudget() shouldBe 20_000L
    }

    /**
     * 시한을 안 걸면 **우리가 기다려 주는 시간**이 20초가 아니다. 예전 산식을 그대로 두면
     * 우리가 22초에 먼저 끊어, 제약을 푼 의미가 사라진다.
     */
    "시한을 안 걸면 대기 상한이 AI 백스톱(600초)보다 크다" {
        val p = ScheduleDeadlineProperties()

        p.waitCeilingMs shouldBeGreaterThan 600_000L
        ScheduleDeadlineProperties(enforced = true).waitCeilingMs shouldBe 20_000L
    }

    /**
     * **멈춘 생성 기준은 대기 상한보다 커야 한다.** 짧으면 스위퍼가 살아 있는 2차를 잘라내고,
     * 그 뒤 도착한 결과는 조건부 쓰기에 걸려 조용히 버려진다. 같은 값을 보는 계정 제한도 풀려
     * 진짜 동시 생성 2건이 돈다.
     */
    "멈춘 생성 기준은 언제나 대기 상한보다 크다" {
        listOf(
            ScheduleDeadlineProperties(),
            ScheduleDeadlineProperties(enforced = true),
            ScheduleDeadlineProperties(unenforcedWaitMs = 1_800_000),
        ).forEach { p ->
            p.staleAfter shouldBeGreaterThan Duration.ofMillis(p.waitCeilingMs)
        }
    }

    /** 시한을 거는 모드에서 기준을 **조이지 않는다** — 그 모드의 동작은 종전 그대로다. */
    "시한을 거는 모드의 기준은 종전 5분이다" {
        ScheduleDeadlineProperties(enforced = true).staleAfter shouldBe Duration.ofMinutes(5)
    }
})
