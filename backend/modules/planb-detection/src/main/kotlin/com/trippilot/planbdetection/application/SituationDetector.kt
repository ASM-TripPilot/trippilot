package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.TriggerKind
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 상황 감지기 — 출처 하나(단기예보·특보·대기질·장소)가 (여행, 날짜) 하나를 보는 계약(설계서 §4.1 · CD1).
 *
 * 감지기는 **보기만 한다** — 저장·이벤트를 하지 않는다(캐시 외 부작용 없음). 쓰기 경로는 스윕이 부르는
 * `TriggerService.reconcile` 하나다. 스윕이 트랜잭션 밖에서 부르므로 외부 HTTP 가 쓰기 트랜잭션을 붙잡지 않는다.
 *
 * 실패를 말하는 법이 셋이다:
 * - **그 대상만의 모름**(자료 없음·보류·판정 시각 값 결측)은 [Detection.Unknown] 으로 돌려준다.
 * - **출처 전체의 모름** — 게이트웨이 오류(HTTP 401·403 · returnReasonCode 20·22·30·31·32 = 접근 거부·한도·키 미등록·
 *   기한 만료·IP — RES-SA-02)도 [Detection.Unknown] 이지만, **그 회차의 남은 대상은 부르지 않는다**: [SweepTarget.round] 로
 *   회차를 묶어 기억하고 다음 회차에 다시 묻는다(캐시하지 않음 · 출처별 회차당 1~2콜 — COST-SA-05). 기억하지 않으면
 *   회차마다 '여행 수 × 날짜'만큼 게이트웨이를 불러 일일 한도(에어코리아 개발 500)를 태운다 — 관찰 전용 출처도 매 여행 부른다.
 * - **인프라 실패**(시한 초과·5xx·형식 깨짐)는 예외로 던진다 — 스윕이 그 (출처, 여행, 날짜)만 모름으로 격리하고,
 *   한 회차에서 같은 출처가 연속 3번 던지면 남은 여행은 그 출처를 부르지 않는다(회로 차단). 실패한 격자는 감지기가
 *   [SweepTarget.round] 로 그 회차 동안 기억해 다시 부르지 않는다(RES-SA-04 · BR-SA-03 ⑤).
 *
 * 회차 범위 기억(위 둘)은 감지기 몫이다 — 스윕은 격자·게이트웨이를 모른다. 상태는 회차 키가 바뀌면 버린다(저장 없음).
 */
interface SituationDetector {
    /** 출처 이름 = 해제 자격(`payload.detector`). 닫힌 집합 [com.trippilot.planbdetection.domain.SweepSource]. */
    val source: String

    /** 이 감지기가 내는 신호의 종류 — 관측(Observation)의 kind 가 된다. */
    val kind: TriggerKind

    /**
     * 이 회차 단계·날짜에 부를지(CD2) — 비싼 감지기만 덜 부른다(장소 = 아침의 오늘·저녁의 내일).
     * [dayOffset] 은 회차의 오늘에서 보는 날짜까지의 일수(0 = 오늘, 1 = 내일).
     */
    fun wants(phase: SweepPhase, dayOffset: Int): Boolean = true

    /**
     * false = 부르지 않는다 = 모름(예: 날씨 모드가 가짜). 회차마다 한 번, 그리고 조회 API 가 감시 상태·회수 필터를 그릴 때마다
     * 묻는다 — 외부를 부르지 말고 설정·빈 유무만으로 가볍게 답한다.
     */
    fun isLive(): Boolean

    fun detect(target: SweepTarget): Detection
}

/** 회차 단계(BR-SA-01) — 07시 아침(오늘) · 08~19시 낮(오늘) · 20시 저녁(오늘 + 지평이 열면 내일). */
enum class SweepPhase { MORNING, DAYTIME, EVENING }

/**
 * 감지기가 보는 (여행, 날짜) 하나.
 *
 * @property round 회차 키 = 회차 시각(스윕이 받은 시각). 한 회차의 대상은 모두 같은 값이고 회차마다 다르다 — 감지기의
 *   회차 범위 기억(게이트웨이 오류·실패 격자)을 이 값으로 묶는다. [now] 는 회차 안에서도 흘러 그 일을 못 한다.
 * @property slots 그 날 **끝나지 않은** 계획 슬롯(이름·카테고리·좌표·고정·위반 표시 포함). 빈 날은 감지기를 부르지 않는다.
 * @property active 이 출처가 그 날 띄운 ACTIVE 트리거 — 해제 판단(`Detection.Checked.checked`)의 재료.
 * @property now 판정 시각 — 회차 시작 시각에 회차가 흐른 시간을 더한 값이다.
 */
data class SweepTarget(
    val tripId: UUID,
    val accountId: UUID,
    val date: LocalDate,
    val phase: SweepPhase,
    val round: Instant,
    val now: Instant,
    val slots: List<PlannedSlotView>,
    val active: List<PlanBTrigger>,
)
