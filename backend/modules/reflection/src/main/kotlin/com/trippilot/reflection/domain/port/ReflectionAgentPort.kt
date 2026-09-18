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

/** 카드 생성 입력. 상대 계약(`ReflectionGenerateRequest`)이 요구하는 것만 담는다. */
data class ReflectionAgentInput(
    val kind: String,
    val region: String,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val visits: List<ReflectionVisit>,
    val personaSummary: String?,
    val weatherSummary: String?,
)

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
