package com.trippilot.reflection.domain.port

import com.trippilot.reflection.domain.ReflectionCard
import java.time.Duration
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

        /** 여행 전체 요약 회고(TRIP-1488) — 여행 기간 전부가 입력이다. 마감 없이·긴 read 상한으로 부른다(어댑터). */
        const val KIND_TRIP_SUMMARY = "TRIP_SUMMARY"
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

    /**
     * 여행 요약 회고(`TRIP_SUMMARY`) 한 번을 기다리는 상한 — 연결 상한 + 소켓 read 상한. 요약 회고 스윕(TRIP-1488)이 이만큼(+ 여유) 지나기 전에는
     * 같은 여행을 다시 선점하지 않는다 — 다른 파드가 아직 기다리는 호출을 중복하지 않게. 경계가 꺼져 있으면 쓰이지 않는다.
     *
     * **총 소요의 엄밀한 상한은 아니다** — 소켓 read 상한은 바이트 사이 무응답 상한이고 DNS 조회는 들지 않는다. 총 소요를 실제로 묶는 것은 상대
     * 백스톱(마감 없는 요청 605초 — 넘기면 상대가 504 로 끊는다)이고, read 상한(610초)이 그보다 길어 그 응답을 받는다.
     */
    val summaryCallTimeout: Duration get() = Duration.ZERO

    fun generate(input: ReflectionAgentInput): ReflectionCard?
}
