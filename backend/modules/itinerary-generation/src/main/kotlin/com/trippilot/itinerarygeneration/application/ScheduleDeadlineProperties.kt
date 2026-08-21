package com.trippilot.itinerarygeneration.application

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/**
 * 생성이 쓰는 **시간 예산** 일체(TRIP-474).
 *
 * 2026-08-21 팀 결정으로 시간제약을 **일단 해제**한다 — FE 연동에서 시간 때문에 규칙 폴백으로
 * 강등되는 것을 먼저 걷어내기 위함이다. AI 는 `deadline_ms` 를 선택 필드로 바꿨고(TRIP-473),
 * **미지정 = 시간제약 없음**이다. 9월 재도입은 [enforced] 를 켜는 것뿐이다(TRIP-475).
 *
 * **값을 지우지 않고 끄는 이유**가 그것이다. 지우면 재도입이 재작업이 된다.
 *
 * ## 왜 한 클래스가 넷을 다 갖고 있나
 *
 * 이 값들은 **서로 물려 있다.** 따로 두면 한쪽만 옮긴 절반 설정이 나오고, 그때 증상은
 * "AI 를 붙였는데 전부 폴백" 이라 원인이 보이지 않는다. 그래서 파생 가능한 것은 파생시킨다 —
 * 손으로 맞춰야 하는 값이 적을수록 어긋날 자리가 적다.
 *
 * @property enforced AI 에 시한을 실을지. **기본 false = 안 싣는다(무제한).**
 * @property day1Ms day1 조기 노출(1차 호출) 예산. [enforced] 일 때만 쓰인다.
 * @property totalMs 전체(2차 호출) 예산. [enforced] 일 때만 쓰인다.
 * @property unenforcedWaitMs 시한을 안 걸 때 **우리가 기다려 주는** 상한. 기본 610초 —
 *   AI 미들웨어의 행 방지 백스톱(600초)보다 커야 우리가 먼저 끊지 않는다.
 */
@ConfigurationProperties(prefix = "trippilot.ai.schedule.deadline")
data class ScheduleDeadlineProperties(
    val enforced: Boolean = false,
    val day1Ms: Long = 5_000,
    val totalMs: Long = 20_000,
    val unenforcedWaitMs: Long = 610_000,
) {
    /** 1차 호출에 실을 시한. null = 안 싣는다. */
    fun day1Budget(): Long? = day1Ms.takeIf { enforced }

    /** 2차 호출에 실을 시한. null = 안 싣는다. */
    fun totalBudget(): Long? = totalMs.takeIf { enforced }

    /** 한 번의 호출을 **기다려 주는** 상한. 소켓 read 상한이 여기서 파생된다. */
    val waitCeilingMs: Long get() = if (enforced) totalMs else unenforcedWaitMs

    /**
     * **멈춘 생성으로 보는 시간** — 중단된 PARTIAL 정리와 계정 동시 생성 제한이 함께 본다.
     *
     * 기다려 주기로 한 시간보다 길어야 한다. 짧으면 **살아 있는 2차를 죽은 것으로 보고 잘라내고**,
     * 그 뒤 도착한 결과는 조건부 쓰기에 걸려 조용히 버려진다(수 분어치 LLM 작업이 사라진다).
     * 같은 이유로 계정 제한도 풀려 진짜 동시 생성 2건이 돈다.
     *
     * 하한 [MIN_STALE_AFTER] 는 시한을 걸던 시절의 값이다 — 그 모드에서 기준을 조이지 않는다.
     */
    val staleAfter: Duration
        get() = maxOf(MIN_STALE_AFTER, Duration.ofMillis(waitCeilingMs + STALE_MARGIN_MS))

    private companion object {
        /** 시한을 걸 때(20초)의 기존 기준. 이 모드의 동작을 바꾸지 않는다. */
        private val MIN_STALE_AFTER: Duration = Duration.ofMinutes(5)
        private const val STALE_MARGIN_MS = 60_000L
    }
}
