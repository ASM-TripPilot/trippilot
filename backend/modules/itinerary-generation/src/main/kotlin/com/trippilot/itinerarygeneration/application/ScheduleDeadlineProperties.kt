package com.trippilot.itinerarygeneration.application

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/**
 * 생성이 쓰는 **시간 예산** 일체(TRIP-474 해제 → TRIP-1000 재도입).
 *
 * 2026-08-21 팀 결정으로 시간제약을 일단 해제했다가(FE 연동에서 규칙 폴백 강등을 걷어내려고),
 * **2026-09-28 다시 켰다(TRIP-1000, TRIP-475 를 앞당김)** — 시한 없는 2차에 AI 가 600초를
 * 대입해, 몰아 재시도가 겹치면 10분짜리 생성이 되고 그동안 화면이 잠겼다(QA #073 실측:
 * day1 12:02 준비 · 2차 12:12 도착). `deadline_ms` 는 선택 필드 그대로라(TRIP-473)
 * [enforced] 를 끄면 언제든 무제한으로 돌아간다.
 *
 * ## 왜 한 클래스가 넷을 다 갖고 있나
 *
 * 이 값들은 **서로 물려 있다.** 따로 두면 한쪽만 옮긴 절반 설정이 나오고, 그때 증상은
 * "AI 를 붙였는데 전부 폴백" 이라 원인이 보이지 않는다. 그래서 파생 가능한 것은 파생시킨다 —
 * 손으로 맞춰야 하는 값이 적을수록 어긋날 자리가 적다.
 *
 * @property enforced AI 에 시한을 실을지. **기본 true(TRIP-1000).** 끄면 무제한 — AI 가 600초를 대입한다.
 * @property day1Ms day1 조기 노출(1차 호출) 예산. [enforced] 일 때만 쓰인다. 종전 5초는 상위 티어
 *   모델이 사실상 못 타는 값이었다(슬롯 후보 3초→15초와 같은 실측 계열) — 15초로 재도입한다.
 * @property totalMs 전체(2차 호출) 예산. [enforced] 일 때만 쓰인다. 종전 20초는 1박2일 기준
 *   옛값 — 재도입 값 60초는 "무제한(600초 대입)보다 한 자리 짧게, 정상 2차(수십 초 실측)는
 *   자르지 않게"다. 넘으면 결정론 폴백으로 닫힌다(INV-4) — 10분 잠금이 최악이지 폴백이 최악이 아니다.
 * @property unenforcedWaitMs 시한을 안 걸 때 **우리가 기다려 주는** 상한. 기본 610초 —
 *   AI 미들웨어의 행 방지 백스톱(600초)보다 커야 우리가 먼저 끊지 않는다.
 * @property editWaitMs 편집 요청 **안에서** 도는 호출(validate·repair)의 상한. 생성용과 나눠야 하는
 *   이유는 [editWait] 참고.
 */
@ConfigurationProperties(prefix = "trippilot.ai.schedule.deadline")
data class ScheduleDeadlineProperties(
    val enforced: Boolean = true,
    val day1Ms: Long = 15_000,
    val totalMs: Long = 60_000,
    val unenforcedWaitMs: Long = 610_000,
    val editWaitMs: Long = 60_000,
) {
    /** 1차 호출에 실을 시한. null = 안 싣는다. */
    fun day1Budget(): Long? = day1Ms.takeIf { enforced }

    /** 2차 호출에 실을 시한. null = 안 싣는다. */
    fun totalBudget(): Long? = totalMs.takeIf { enforced }

    /** 한 번의 호출을 **기다려 주는** 상한. 소켓 read 상한이 여기서 파생된다. */
    val waitCeilingMs: Long get() = if (enforced) totalMs else unenforcedWaitMs

    /**
     * **편집 경로의 상한** — 생성용을 같이 쓰지 않는다.
     *
     * 편집(PUT)은 `validate` 를 요청 안에서 동기로 부른다. "AI 가 죽어도 편집은 막지 않는다"가 설계
     * 의도인데(`Revalidation`), 그 회복은 **소켓이 끊긴 다음에야** 작동한다. 생성용 상한(시간제약을
     * 풀면 610초)을 공유하면 AI 가 응답을 멈췄을 때 편집이 10분간 막혀 의도가 뒤집힌다.
     *
     * 값이 시한(3초·5초)이 아니라 그 열 배인 이유: **시한은 SLO 이지 하드 제약이 아니다.**
     * 실측(2026-08-21 실 AI 왕복)에서 validate 20.1초 · repair 20.7초가 나왔다. 종전 상한 22초는
     * 여기서 2초 차이라 **정상 재검증이 수시로 잘린다** — 잘리면 편집은 되지만 위반 표시를 잃는다.
     */
    val editWait: Duration get() = Duration.ofMillis(editWaitMs)

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
