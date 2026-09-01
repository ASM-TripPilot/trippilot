package com.trippilot.reflection.adapter.out.external

import java.time.Instant
import java.time.LocalDate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/**
 * `ai/` 회고 경계의 와이어 타입(G-U5-4 해소 · business-logic-model §5.3).
 *
 * **정본은 `ai/docs/openapi.json` 이다** — AI CI 가 실행 앱과의 일치를 강제한다. 여기 타입은 그 계약과
 * 이름이 맞아야 하고, 그 일치는 `ReflectionBoundaryOpenApiTest` 가 지킨다.
 *
 * 응답 본문은 **파싱하지 않는다.** `cover` 밖은 [JsonNode] 로 통과시킨다(DEC-U5-14) — 우리가 재검증하면
 * 상대가 템플릿을 하나 늘릴 때마다 우리 마이그레이션이 된다.
 */
internal data class AiReflectionVisitRef(val date: LocalDate, val poiId: String)

internal data class AiReflectionVisit(
    val ref: AiReflectionVisitRef,
    val poiName: String,
    val category: String,
    val orderInDay: Int,
    val photoCount: Int,
)

internal data class AiReflectionGenerateRequest(
    val requestMeta: AiReflectionRequestMeta,
    val kind: String,
    val region: String,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val visits: List<AiReflectionVisit>,
    val personaSummary: String,
    val events: List<String>,
    val weatherSummary: String,
)

internal data class AiReflectionRequestMeta(
    val requestId: String,
    val requestedAt: Instant,
    val deadlineMs: Long?,
)

internal data class AiReflectionCover(val title: String, val subtitle: String, val photoSlot: String?)

internal data class AiReflectionGenerateResponse(
    val templateId: String,
    val kind: String,
    val format: String,
    val generatedAt: Instant,
    val isFallback: Boolean,
    val cover: AiReflectionCover,
    /** 장면 목록. **안쪽을 모델링하지 않는다**(DEC-U5-14) — 그대로 카드 원문에 실려 나간다. */
    val scenes: List<JsonNode>,
    val hashtags: List<String>,
)

/**
 * **이 목록이 계약 게이트의 입력이다.** 손으로 관리하는 목록을 테스트가 따로 또 들고 있으면 둘이
 * 갈라진다 — 일정 경계에서 `explanations` 가 그렇게 게이트 밖에 있었다(#435 실측).
 */
internal object AiReflectionPaths {
    const val GENERATE = "/ai/v1/reflection/generate"

    /**
     * `nudge` 는 **여기 없다.** 상대는 열었으나 여행 전 넛지 화면이 U5 범위 밖이라 우리가 부르지
     * 않는다(G-U5-16). 부르지 않는 경로를 게이트에 넣으면 "우리가 쓰는 것"의 뜻이 흐려진다.
     */
    val CALLED = listOf(GENERATE)
}

/**
 * 경계 매퍼 — 상대는 snake_case 다. Jackson 3(`tools.jackson`)을 쓴다: 일정 경계와 같은 관례이고
 * java.time 이 내장이라 모듈을 따로 달지 않아도 된다. **이 매퍼로 직렬화한 것이 곧 와이어 이름**이라, 필드명을 리팩터하면
 * 계약이 조용히 깨진다. 그 자리를  가 지킨다.
 */
internal object ReflectionBoundaryMapper {
    fun create(): JsonMapper = JsonMapper.builder()
        .addModule(KotlinModule.Builder().build())
        .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
        .build()
}
