package com.trippilot.itinerarygeneration.contract

import com.trippilot.itinerarygeneration.adapter.out.external.AiDay
import com.trippilot.itinerarygeneration.adapter.out.external.AiExplanationsRequest
import com.trippilot.itinerarygeneration.adapter.out.external.AiExplanationsResponse
import com.trippilot.itinerarygeneration.adapter.out.external.AiFreshness
import com.trippilot.itinerarygeneration.adapter.out.external.AiRequestMeta
import com.trippilot.itinerarygeneration.adapter.out.external.AiScheduleResponse
import com.trippilot.itinerarygeneration.adapter.out.external.AiSlot
import com.trippilot.itinerarygeneration.adapter.out.external.AiUnplacedMustVisit
import com.trippilot.itinerarygeneration.adapter.out.external.AiViolation
import com.trippilot.itinerarygeneration.adapter.out.external.ScheduleAgentConfiguration
import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldNotContain
import io.kotest.matchers.shouldBe
import tools.jackson.databind.JsonNode
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * AI 경계 계약 게이트(TRIP-334 · 결정4 백엔드 절반).
 *
 * AI 쪽은 `ai/docs/openapi.json` 을 정본으로 커밋하고, **AI CI 가 "실행 앱 스키마 == 커밋된 계약 파일"** 을
 * 비교한다(PR #138). 즉 이 파일은 항상 실서버와 일치한다 — 그러니 우리가 그 파일과 어긋나지 않는지만 보면
 * 경계 드리프트가 잡힌다.
 *
 * **계약 파일을 복사하지 않고 그 자리에서 읽는다.** 픽스처처럼 테스트 리소스로 복사해 두면 갱신을 사람이
 * 기억해야 하고, 그 순간 이 게이트가 막으려던 드리프트를 게이트 자신이 만든다.
 *
 * 여기서만 드러나는 것 — 기존 픽스처 테스트([AiResponseFixtureTest])는 **AI 가 준 표본 하나**를 읽을 뿐이라
 * 표본에 없는 필드의 이름이 바뀌거나 요청 필수 필드가 늘어난 것은 못 본다. 그 두 가지가 실제 사고 모양이다:
 * - 우리가 읽는 필드 이름이 상대에서 바뀌면 → 값이 **조용히 null** 이 되어 화면만 빈약해진다(예외가 없다).
 * - 상대 요청 필수 필드가 늘면 → 매 호출 422 → **전 사용자가 결정론 폴백**을 받는다(INV-4 는 도는데 품질만 떨어진다).
 *
 * **키 비교를 느슨하게(포함 관계로) 두지 않은 것은 의도다.** 상대가 필드를 *추가*만 해도 여기서 깨진다 —
 * 시끄럽지만, 느슨하게 두면 "새로 생긴 필드를 우리가 안 읽고 있다"를 영원히 모른다. 깨졌을 때 할 일은
 * 둘 중 하나다: 와이어 타입에 그 필드를 더하거나, 안 읽기로 하고 이 테스트에서 명시적으로 제외한다.
 * 어느 쪽이든 **판단이 기록에 남는다**는 것이 이 게이트의 값이다.
 */
class AiBoundaryOpenApiTest : StringSpec({

    val mapper = ScheduleAgentConfiguration.boundaryMapper()
    val contract = mapper.readTree(aiContractFile())
    val schemas = requireNotNull(contract["components"]?.get("schemas")) { "계약에 components.schemas 가 없습니다." }

    /** 계약 스키마의 프로퍼티 이름(정렬). */
    fun props(name: String): List<String> {
        val s = requireNotNull(schemas[name]) { "계약에 스키마가 없습니다: $name" }
        return s["properties"]?.propertyNames()?.sorted().orEmpty()
    }

    fun required(name: String): List<String> =
        schemas[name]?.get("required")?.map { it.asString() }?.sorted().orEmpty()

    /** 우리 타입을 **경계 매퍼 그대로** 직렬화해 실제 와이어 키를 얻는다(이름 규칙을 흉내내지 않는다). */
    fun wireKeys(value: Any): List<String> = mapper.readTree(mapper.writeValueAsString(value)).propertyNames().sorted()

    // ───────────────────────── 경로 ─────────────────────────

    /**
     * **넷이다.** 오래도록 `explanations` 가 이 목록에서 빠져 있었다 — 어댑터는 부르는데
     * 이름 게이트는 셋만 봤다(2026-09-01 실측). 상대가 그 경로의 필드를 바꿔도 우리는
     * 런타임에서야 안다. `explanations` 는 실패를 삼키고 빈 맵을 돌려주므로(부가 정보라)
     * **드리프트가 화면의 근거 공백으로만 나타나 원인이 안 보인다.**
     */
    "우리가 부르는 네 경로가 계약에 실재한다" {
        val paths = requireNotNull(contract["paths"]).propertyNames()
        listOf(
            "/ai/v1/itinerary/generate",
            "/ai/v1/itinerary/validate",
            "/ai/v1/itinerary/repair",
            "/ai/v1/itinerary/explanations",
        ).forEach { paths shouldContain it }
    }

    "explanations 요청 키가 계약과 정확히 일치한다" {
        wireKeys(sampleExplanationsRequest) shouldContainExactly props("ExplanationsRequest")
    }

    /**
     * 응답도 본다. 상대가 필드를 개명하면 우리 기본값(빈 맵·false)이 조용히 이깁니다 —
     * 예외도 로그도 없이 "근거가 없는 일정"이 된다.
     */
    "explanations 응답 키가 계약과 정확히 일치한다" {
        wireKeys(sampleExplanationsResponse) shouldContainExactly props("ExplanationsResponse")
    }

    // ───────────────────────── 요청(우리가 보낸다) ─────────────────────────

    /**
     * 요청 본문은 **도메인 타입을 그대로** 직렬화한다(`HttpScheduleAgentAdapter.generate`).
     * 그래서 도메인 필드명을 리팩터하는 순간 와이어 이름이 바뀌는데, 지금까지 그걸 잡을 것이 없었다.
     */
    "generate 요청 키가 계약과 정확히 일치한다 — 도메인 필드명이 곧 와이어 이름이다" {
        wireKeys(sampleInput) shouldContainExactly props("GenerateItineraryRequest")
    }

    "generate 요청이 계약 필수 필드를 하나도 빠뜨리지 않는다" {
        val sent = wireKeys(sampleInput)
        required("GenerateItineraryRequest").forEach { sent shouldContain it }
    }

    "중첩 요청 타입도 계약과 키가 일치한다 — 안쪽이 어긋나도 겉은 멀쩡해 보인다" {
        wireKeys(sampleInput.tripContext) shouldContainExactly props("TripContextSchema")
        wireKeys(sampleInput.timeWindows.single()) shouldContainExactly props("TimeWindowSchema")
        wireKeys(sampleInput.anchors.single()) shouldContainExactly props("DayAnchorSchema")
        wireKeys(sampleInput.fixedBlocks.single()) shouldContainExactly props("FixedBlockSchema")
        wireKeys(sampleInput.preferenceProfile) shouldContainExactly props("PreferenceProfileSchema")
        wireKeys(sampleInput.requestMeta) shouldContainExactly props("RequestMetaSchema")
    }

    /**
     * `MANUAL`(직접 만들기)은 **상대 어휘에 없다** — 경계로 나가면 422 다. 그래서
     * `GenerateItineraryService` 가 MANUAL 을 호출 경로에 아예 들여보내지 않는다.
     * 그 분기가 왜 필요한지의 근거가 여기 잠긴다. 상대가 MANUAL 을 추가하면 이 테스트가 깨지고,
     * 그때 비로소 분기를 걷어낼 수 있다.
     */
    "AI 의 generation_mode 어휘는 우리 것의 부분집합이고 MANUAL 이 없다" {
        val aiModes = requireNotNull(schemas["GenerationMode"]?.get("enum")).map { it.asString() }
        val ours = GenerationMode.entries.map { it.name }
        aiModes.forEach { ours shouldContain it }
        aiModes shouldNotContain "MANUAL"
    }

    // ───────────────────────── 응답(우리가 읽는다) ─────────────────────────

    /**
     * 와이어 타입은 응답 수신형이자(생성) 요청 본문형이다(검증·수리에 그대로 되돌려 보낸다) — 그래서
     * **양방향 모두** 계약과 같아야 한다. 한쪽만 맞으면 생성은 되는데 재검증이 422 로 죽는 식이 된다.
     */
    "일정 본문 키가 계약과 정확히 일치한다 — 생성 응답이자 검증·수리 요청 본문이다" {
        wireKeys(samplePayload) shouldContainExactly props("ItineraryPayload")
        wireKeys(samplePayload.days.single()) shouldContainExactly props("DayScheduleSchema")
        wireKeys(samplePayload.days.single().slots.single()) shouldContainExactly props("VisitSlotDisplaySchema")
        wireKeys(samplePayload.unplacedMustVisits.single()) shouldContainExactly props("UnplacedMustVisitSchema")
        wireKeys(requireNotNull(samplePayload.freshness)) shouldContainExactly props("FreshnessMetaSchema")
    }

    "위반 키가 계약과 정확히 일치한다 — day_index·slot_index 수퍼셋 포함(PR #138)" {
        wireKeys(sampleViolation) shouldContainExactly props("ViolationSchema")
    }

    /**
     * `candidates_summary` 만 타입을 고정하지 않고 [JsonNode] 로 받아 **손으로 읽는다**(형태 미확정 시절의 결정).
     * 손으로 읽는 키는 컴파일러가 지켜 주지 않으므로 여기서 계약과 맞춘다 — 이름이 어긋나면 배너 근거가
     * 조용히 사라지고 "후보가 충분했다"로 보인다.
     */
    "손으로 읽는 candidates_summary 키가 계약에 전부 있다" {
        val declared = props("CandidatesSummarySchema")
        listOf("level", "pool_size", "shortfall_categories").forEach { declared shouldContain it }
    }
})

/**
 * 리포 안 계약 파일. 모듈 위치가 바뀌어도 견디도록 **상대 깊이를 세지 않고** 위로 올라가며 찾는다.
 * 못 찾으면 통과가 아니라 실패다 — 파일이 사라진 채 초록이면 게이트가 없는 것과 같다.
 */
private fun aiContractFile(): File {
    var dir: File? = File(System.getProperty("user.dir"))
    while (dir != null) {
        val candidate = File(dir, "ai/docs/openapi.json")
        if (candidate.isFile) return candidate
        dir = dir.parentFile
    }
    error("AI 계약 파일(ai/docs/openapi.json)을 찾지 못했습니다. user.dir=${System.getProperty("user.dir")}")
}

private fun JsonNode.propertyNames(): List<String> = properties().map { it.key }

private val sampleInput = ScheduleAgentInput(
    tripId = UUID.randomUUID(),
    generationMode = GenerationMode.FULLY_AI,
    tripContext = TripContext(listOf("제주"), LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-03"), "친구", "표준"),
    anchors = listOf(DayAnchor(LocalDate.parse("2026-08-01"), 33.45, 126.56)),
    timeWindows = listOf(TimeWindow(LocalDate.parse("2026-08-01"), LocalTime.parse("09:00"), LocalTime.parse("21:00"))),
    fixedBlocks = listOf(FixedBlock(UUID.randomUUID(), LocalDate.parse("2026-08-01"), LocalTime.parse("12:00"), 90)),
    preferenceProfile = PreferenceProfile(
        listOf("미식"), listOf("야경"), listOf("한식"), listOf("렌터카"), "알차게", listOf("친구"), true, "고급",
    ),
    recommendationStrength = "STANDARD",
    requestMeta = RequestMeta(UUID.randomUUID().toString(), Instant.parse("2026-08-01T00:00:00Z"), 20_000L),
    excludedPoiIds = listOf(UUID.randomUUID()),
)

/** 모든 필드를 채운 표본 — 하나라도 비우면 그 키가 직렬화에서 빠져 비교가 헐거워진다. */
private val samplePayload = AiScheduleResponse(
    days = listOf(
        AiDay(
            LocalDate.parse("2026-08-01"),
            listOf(
                AiSlot(
                    UUID.randomUUID(), LocalTime.parse("10:00"), LocalTime.parse("11:00"),
                    endsNextDay = false, distanceRange = "약 1.2km · 도보 추정", isFixed = true,
                ),
            ),
        ),
    ),
    day1ReadyAt = Instant.parse("2026-08-01T00:00:05Z"),
    explanations = mapOf("2026-08-01#poi" to "취향에 맞는 곳이에요"),
    candidatesSummary = null, // 형태 미확정이라 JsonNode 로 받는다 — 키 검증은 아래 별도 테스트가 맡는다
    solveMode = "OR_TOOLS",
    isFallback = false,
    freshness = AiFreshness("kakao", Instant.parse("2026-08-01T00:00:00Z"), cacheHit = true, ttlSec = 600, stale = false),
    unplacedMustVisits = listOf(AiUnplacedMustVisit(UUID.randomUUID().toString(), "NO_FEASIBLE_SLOT")),
)

private val sampleRequestMeta =
    AiRequestMeta(UUID.randomUUID().toString(), Instant.parse("2026-08-01T00:00:00Z"), 20_000L)

private val sampleExplanationsRequest =
    AiExplanationsRequest(UUID.randomUUID().toString(), samplePayload, sampleRequestMeta)

/** 모든 필드를 채운다 — 비우면 그 키가 직렬화에서 빠져 비교가 헐거워진다. */
private val sampleExplanationsResponse =
    AiExplanationsResponse(mapOf("2026-08-01#poi" to "근거"), isFallback = true, reason = "LLM_TIMEOUT")

private val sampleViolation = AiViolation("HC1", slotRef = "2026-08-01#poi", detail = "영업시간 밖", dayIndex = 0, slotIndex = 1)
