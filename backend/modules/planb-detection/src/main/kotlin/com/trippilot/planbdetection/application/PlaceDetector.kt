package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.DayCheck
import com.trippilot.itinerarygeneration.api.HoursVerdict
import com.trippilot.itinerarygeneration.api.ItineraryDayCheckFacade
import com.trippilot.placedata.api.PoiLifeStatus
import com.trippilot.placedata.api.PoiStatusFacade
import com.trippilot.planbdetection.domain.ClosureRules
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerLifecycle
import com.trippilot.planbdetection.domain.TriggerVariant
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 장소 감지기(설계서 §4.3 · BR-SA-17) — 휴무·영업시간 밖·폐업. 아침(07:15)에 오늘, 저녁(20:15·20:40)에 내일 슬롯을 다시 본다.
 *
 * 재료는 둘이다: 하루 점검(C8 — AI 하루 검증의 영업시간 판정)과 장소 상태(C7 — 폐업). 판정은 [ClosureRules] 한 곳이고,
 * 여기는 재료를 모으고 실패를 감지 계약으로 옮긴다(설계서 §4.3 실패·모름 표):
 * - 하루 점검 null(비소유·일정 없음·그 날 없음) → 모름
 * - AI 보류·모드가 http 아님 → 영업시간은 모름(하루 점검이 UNKNOWN 으로 준다), 폐업 판정은 그대로.
 *   보류가 한 회차에서 연속 3번이면 그 회차의 남은 여행은 AI 를 부르지 않는다([HoursCircuit])
 * - 상태 조회 예외 → 폐업 발견 0 · 확인 비움(영업시간 발견은 그대로)
 * - 아무것도 알아내지 못했으면 모름 — 빈 확인으로 내면 감시 상태가 '확인됨'이 된다(RES-SA-01)
 *
 * 저장·이벤트를 하지 않는다 — 쓰기는 판정(`TriggerService.reconcile`) 하나다. 외부 호출(AI)이 있어 스윕이 트랜잭션 밖에서 부른다.
 * **늘 live 다** — AI 스케줄 모드가 http 가 아니면 영업시간만 모름이고 폐업 판정은 돈다(tech-stack-decisions 델타 6 ·
 * BLM §6.2). 가짜 검증의 빈 목록을 판정으로 쓰지 않는 일은 하루 점검이 UNKNOWN 으로 한다.
 */
@Component
class PlaceDetector(
    private val days: ItineraryDayCheckFacade,
    private val places: PoiStatusFacade,
) : SituationDetector {
    override val source: String = SweepSource.PLACE
    override val kind: TriggerKind = TriggerKind.CLOSURE

    /** 아침의 오늘 · 저녁의 내일만 — AI 검증(실측 20.1s)이라 매시 보지 않고 하루 두 번으로 묶는다(BR-SA-01). */
    override fun wants(phase: SweepPhase, dayOffset: Int): Boolean =
        (phase == SweepPhase.MORNING && dayOffset == 0) || (phase == SweepPhase.EVENING && dayOffset == 1)

    override fun isLive(): Boolean = true

    private val hours = HoursCircuit()

    override fun detect(target: SweepTarget): Detection {
        val judgeHours = hours.allows(target.round)
        val day = days.checkDay(target.accountId, target.tripId, target.date, judgeHours) ?: return Detection.Unknown(NO_DAY)
        if (judgeHours) hours.record(day)
        val status = statusOf(day.slots.map { it.poiId }.distinct(), target)
        // 공휴일 휴무는 감지기가 해제하지 않는다 — 달력을 못 읽은 회차의 '정상'이 진짜 휴무를 지우지 않게(시간·일정 만료로만 닫힌다).
        val holiday = target.active.filter { it.variant == TriggerVariant.HOLIDAY }.mapNotNull { it.slotKey }.toSet()
        val verdict = ClosureRules.judge(target.date, target.now, day.slots, status, holiday)
        if (verdict.blind) {
            return Detection.Unknown(
                when {
                    !day.judged -> WITHHELD
                    status == null -> STATUS_ERROR
                    else -> NO_EVIDENCE
                },
            )
        }
        val today = LocalDate.ofInstant(target.now, TriggerLifecycle.TRAVEL_ZONE)
        return Detection.Checked(
            verdict.checked,
            verdict.findings.map { f ->
                DetectionSignal(
                    kind = TriggerKind.CLOSURE,
                    affectedDate = target.date,
                    slotKey = f.slotKey,
                    payload = mapOf(PlanBTrigger.PAYLOAD_POI_ID to f.poiId.toString()),
                    reason = f.reason,
                    scope = TriggerLifecycle.sweepScope(target.date, today),
                    variant = f.variant,
                    dataSource = f.dataSource,
                )
            },
        )
    }

    /** 장소 상태 — 실패는 null(폐업을 모른다). 예외는 종류만 적는다 — DB 오류 메시지에 접속 정보가 실릴 수 있다. */
    private fun statusOf(poiIds: List<UUID>, target: SweepTarget): Map<UUID, PoiLifeStatus>? = try {
        places.statusOf(poiIds)
    } catch (e: Exception) {
        log.warn(
            "장소 상태를 못 읽었습니다 — 폐업 판정 없이 영업시간만 봅니다. tripId={} date={} 예외={}",
            target.tripId, target.date, e.javaClass.name,
        )
        null
    }

    /**
     * AI 영업시간 판정의 회차 범위 회로(RES-SA-04 · BR-SA-03 ⑤ · PERF-SA-04). 하루 점검은 AI 불통·5xx·시한을 예외 없이
     * 보류(`judged=false`)로 접어 주므로 스윕의 회로(감지기 예외만 센다)에 잡히지 않는다 — 그대로 두면 AI 장애 동안 회차의
     * 모든 여행이 여행마다 소켓 상한(62초)까지 기다리고, 예산이 남은 여행의 날씨 감지까지 굶기며, 장애 중인 AI 에 부하를 준다.
     * 그래서 연속 보류가 [HOURS_CIRCUIT_LIMIT] 에 닿으면 그 회차의 남은 여행은 AI 를 부르지 않는다 — 영업시간은 모름이고
     * 폐업 판정은 그대로다(BLM §6.2 '보류 → 폐업 판정은 동작'). AI 가 답하면 0 으로 되돌리고, AI 를 부르지 않은 날(모드가
     * http 아님·영업시간을 아는 슬롯 없음)은 세지 않는다. 회차 키가 바뀌면 처음부터다(저장 없음 — 스윕의 회로와 같은 수명).
     * 여행 단위 병렬이라 잠근다.
     */
    private class HoursCircuit {
        private var round: Instant? = null
        private var withheld = 0
        private var open = false

        @Synchronized
        fun allows(at: Instant): Boolean {
            if (round != at) {
                round = at
                withheld = 0
                open = false
            }
            return !open
        }

        @Synchronized
        fun record(day: DayCheck) {
            when {
                !day.judged -> if (++withheld == HOURS_CIRCUIT_LIMIT) {
                    open = true // 이미 물은 다른 여행의 늦은 보류가 더 와도 다시 알리지 않는다(== 라 한 번)
                    log.warn(
                        "장소 감지 — AI 영업시간 판정이 연속 {}번 보류됐습니다. 이 회차의 남은 여행은 AI 검증 없이 폐업만 봅니다(영업시간은 모름). round={}",
                        HOURS_CIRCUIT_LIMIT, round,
                    )
                }
                day.slots.any { it.hours != HoursVerdict.UNKNOWN } -> withheld = 0 // AI 가 답했다
            }
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(PlaceDetector::class.java)

        /** 연속 보류 몇 번에 AI 를 그만 부르는가 — 스윕의 회로와 같은 수(RES-SA-04 '연속 3번'). */
        private const val HOURS_CIRCUIT_LIMIT = 3

        // 모름의 이유(요약 로그용).
        private const val NO_DAY = "no-day"
        private const val WITHHELD = "hours-withheld"
        private const val STATUS_ERROR = "status-error"
        private const val NO_EVIDENCE = "no-evidence"
    }
}
