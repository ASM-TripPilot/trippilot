package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.UnverifiedSlot
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlot
import org.slf4j.LoggerFactory
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 편집·되돌리기의 **재검증 결과**. AI 가 답을 못 주는 경우를 "위반 없음"과 구분하려고 타입으로 둔다.
 *
 * 편집은 사용자의 의도라 AI 가 죽었다고 막지 않는다(그러면 AI 장애가 곧 편집 불가가 된다).
 * 그렇다고 빈 목록으로 넘기면 **"검증했더니 깨끗하다"는 거짓말**이 되어, 화면에서 위반 배지가 조용히 꺼진다
 * (INV-2 는 검증되지 않은 값을 확정된 것처럼 보이지 말라고 정한다).
 *
 * 그래서 판정을 못 했으면 [Withheld] — 직전에 표시하던 위반을 그대로 잇는다. 새로 생긴 슬롯은 이력이 없어
 * 표시가 없지만, 이는 원래 기본값이라 새 거짓을 만들지 않는다.
 */
internal sealed interface Revalidation {

    /**
     * AI 가 판정했다. **[violations] 가 비었다고 통과는 아니다** — 상대 계약은 "위반 0 + [unverified] 비어
     * 있음"을 통과로 정한다(TRIP-537). HC1·HC2 는 POI 정본을 못 찾은 슬롯을 건너뛰는데, 그 스킵을
     * 안 보면 "검증했더니 깨끗하다"는 위 문단의 거짓말을 **AI 가 살아 있을 때도** 하게 된다.
     */
    data class Judged(
        val violations: List<Violation>,
        val unverified: List<UnverifiedSlot> = emptyList(),
    ) : Revalidation

    /** AI 를 못 불렀다(장애·시한). 아무것도 주장하지 않는다. */
    data object Withheld : Revalidation

    companion object {
        private val log = LoggerFactory.getLogger(Revalidation::class.java)

        /**
         * 재검증을 시도하고 실패는 [Withheld] 로 접는다. 침묵 금지(INV-4) — 실패는 반드시 로그로 드러낸다.
         * 외부 호출이라 **트랜잭션 밖**에서 부른다(DB 커넥션을 물지 않게, generate 와 동일).
         */
        fun attempt(agent: ScheduleAgentPort, output: ScheduleAgentOutput, tripId: UUID): Revalidation =
            runCatching {
                val outcome = agent.validate(output)
                // 침묵 금지(INV-4) — 판정 못 한 슬롯은 로그로도 드러낸다. 화면 표시는 reshape 가 한다.
                if (outcome.unverified.isNotEmpty()) {
                    log.warn(
                        "재검증이 일부 슬롯을 판정하지 못했습니다 — 통과로 읽지 않습니다. tripId={} 미판정={}",
                        tripId, outcome.unverified.map { "${it.poiId}:${it.reasonCode}" },
                    )
                }
                Judged(outcome.violations, outcome.unverified)
            }
                .getOrElse { e ->
                    log.warn(
                        "일정 재검증 실패 — 직전 위반 표시를 유지한 채 진행합니다(판정 보류). tripId={}",
                        tripId, e,
                    )
                    Withheld
                }

        /** 판정된 위반만. 보류면 빈 목록(경고·집계 대상이 아니다). */
        fun Revalidation.violations(): List<Violation> = when (this) {
            is Judged -> violations
            Withheld -> emptyList()
        }

        /**
         * 판정 못 한 슬롯의 poiId. **보류([Withheld])는 빈 집합**이다 — 그쪽은 이미 직전 표시를
         * 잇는 경로라, 여기서 또 "미판정"을 얹으면 같은 사실에 표시가 두 벌 붙는다.
         */
        fun Revalidation.unverifiedPoiIds(): Set<String> = when (this) {
            is Judged -> unverified.map { it.poiId }.toSet()
            Withheld -> emptySet()
        }
    }
}

/**
 * 직전 일정의 위반 표시를 (날짜, poiId) 로 찾아 잇기 위한 색인.
 * poiId 만으로 묶으면 같은 장소가 여러 날 있을 때 뭉개진다(복원 쪽 고정 블록 색인과 같은 이유).
 */
internal class PriorViolations(previous: Itinerary) {
    private val bySlot: Map<Pair<LocalDate, UUID>, VisitSlot> =
        previous.days.flatMap { d -> d.slots.map { (d.date to it.sourcePoiId) to it } }.toMap()

    fun flagOf(date: LocalDate, poiId: UUID): Boolean = bySlot[date to poiId]?.hasViolation ?: false

    /**
     * 사유 승계 — **시각이 그대로일 때만**(TRIP-1030 결정 3). 판정 보류 중 시각을 옮긴 슬롯에
     * 옛 사유를 그대로 붙이면 바뀐 시각에 대해 참이 아닐 수 있는 문장이 나간다(QA 관측).
     * 플래그는 유지한 채(위반이 풀렸다고 말하지 않는다 — 거짓 음성 회피) 문구만 중립으로 바꾼다.
     */
    fun reasonOf(date: LocalDate, poiId: UUID, startAt: LocalTime, endAt: LocalTime): String? {
        val prior = bySlot[date to poiId] ?: return null
        if (!prior.hasViolation) return prior.violationReason
        return if (prior.startAt == startAt && prior.endAt == endAt) prior.violationReason else STALE_REASON
    }

    companion object {
        /** 보류 중 시각이 바뀐 슬롯의 중립 문구 — 재검증이 돌면 실제 판정으로 대체된다. */
        const val STALE_REASON = "시간이 바뀌어 다시 확인이 필요해요"
    }
}
