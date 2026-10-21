package com.trippilot.reflection.domain.port

import com.trippilot.reflection.domain.ReflectionCard
import java.time.LocalDate
import java.util.UUID

/** 카드 생성에 넘길 방문 하나. 근거 데이터 밖은 싣지 않는다(BR-U5-31 환각 금지). */
data class ReflectionVisit(
    val poiId: UUID,
    val date: LocalDate,
    val poiName: String,
    val category: String,
    val orderInDay: Int,
    val photoCount: Int,
)

/**
 * 그날 있었던 일 하나(계약 `TripEventRecordSchema`). [kind] 는 상대가 아는 둘뿐이다 — [SKIPPED] · [PLAN_B].
 * [detail] 은 짧은 한국어 한 줄이고 **건너뛴 장소의 이름은 넣지 않는다**(아래 [SKIPPED] 참고).
 */
data class ReflectionEvent(val kind: String, val date: LocalDate, val detail: String) {
    companion object {
        /**
         * 들르지 못한 곳이 있었다. 상대 프롬프트가 "그 장소의 이름은 쓰지 말라"고 하고 [com.trippilot.reflection.application.HallucinationGate]
         * 가 뒤에서 그 이름을 막는다 — 이름을 실어 보내면 모델이 그 이름을 쓸 기회만 늘고, 쓰면 카드 전체가 규칙 카드로 내려간다.
         */
        const val SKIPPED = "SKIPPED"

        /** 그날 일정을 재계획으로 바꿨다(적용된 재계획만 — 열었다 닫은 세션은 일정이 그대로라 사건이 아니다). */
        const val PLAN_B = "PLAN_B"
    }
}

/** 카드 생성 입력. 상대 계약(`ReflectionGenerateRequest`)이 요구하는 것만 담는다. */
data class ReflectionAgentInput(
    val kind: String,
    val region: String,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val visits: List<ReflectionVisit>,
    val personaSummary: String?,
    val weatherSummary: String?,
    val events: List<ReflectionEvent>,
) {
    companion object {
        /**
         * 상대가 받아 줄 입력인가 — `region` 필수 · `visits` 1건 이상(minItems 1). 아니면 422 가 확정이라 부르지 않는다.
         *
         * **규칙은 여기 한 곳이다.** 어댑터가 호출 직전에 이것으로 막고(계약 가드), 서비스는 재료를 조회하기 **전에** 같은 것으로 묻는다 —
         * 부르지도 않을 호출을 위해 취향·변경 이력을 읽지 않게(개발 서버 회고 호출의 절반이 방문 0곳인 날이었다 — TRIP-1463 댓글).
         */
        fun callable(region: String, visits: List<ReflectionVisit>): Boolean = region.isNotBlank() && visits.isNotEmpty()
    }
}

/**
 * 회고 카드 생성 경계(O-U5-6 = `http` · G-U5-4 해소).
 *
 * **못 만들면 `null` 이다 — 예외를 던지지 않는다.** 폴백 3단(AI → 규칙 → 기본)에서 이 포트는 맨 위 단이고,
 * 아래 두 단은 항상 답을 낸다(BR-U5-32). 실패를 예외로 올리면 호출측이 그것을 잡아 다시 폴백해야 해서
 * 판단이 두 곳에 흩어진다 — "못 만들었다"는 정상 결과다.
 *
 * 그렇다고 **조용히** 넘어가지는 않는다: 구현이 사유를 로그로 남긴다(INV-4 침묵 실패 금지).
 */
interface ReflectionAgentPort {
    /**
     * 이 경계가 켜져 있는가.
     *
     * **입력 조립이 공짜가 아니라서 있다.** [ReflectionAgentInput.region] 은 여행 컨텍스트 조회를
     * 필요로 하는데, 기본 모드(`rule`)에서는 그 조회가 **항상 null 을 줄 호출을 위해** 돈다.
     * 회고 생성뿐 아니라 편집 경로도 같은 값을 치른다.
     */
    val enabled: Boolean

    fun generate(input: ReflectionAgentInput): ReflectionCard?
}
