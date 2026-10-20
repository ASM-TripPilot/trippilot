package com.trippilot.planbdetection.contract

import com.trippilot.planbdetection.adapter.out.external.AiOpportunitiesRequest
import com.trippilot.planbdetection.adapter.out.external.AiOpportunitiesResponse
import com.trippilot.planbdetection.adapter.out.external.AiOpportunity
import com.trippilot.planbdetection.adapter.out.external.AiOpportunityCoord
import com.trippilot.planbdetection.adapter.out.external.AiOpportunityRequestMeta
import com.trippilot.planbdetection.adapter.out.external.AiOpportunitySlot
import com.trippilot.planbdetection.adapter.out.external.HttpOpportunityAdapter
import com.trippilot.planbdetection.adapter.out.external.OpportunityConfiguration
import com.trippilot.planbdetection.application.OpportunityService
import com.trippilot.planbdetection.domain.OpportunityGate
import com.trippilot.planbdetection.domain.OpportunityKind
import com.trippilot.testsupport.ContractShape
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import tools.jackson.databind.JsonNode
import java.io.File
import java.time.Instant
import java.time.LocalDate

/**
 * 기회 경계(`POST /ai/v1/planb/opportunities`)의 계약 게이트 — `ai/docs/openapi.json` 을 그 자리에서 읽는다.
 *
 * **요청·응답 키를 정확 일치로 본다.** 선택 필드라 안전하다는 판단은 이 리포에서 두 번 틀렸다 — 상대가 필드를 하나 더하거나
 * 바꾸면 여기서 깨져야 판단이 기록에 남는다(AiBoundaryOpenApiTest 와 같은 이유). 이름이 같고 모양이 다른 경우는
 * [ContractShape] 가 본다(알림 `slots` 를 문자열 배열로 보내다 422 를 맞은 자리).
 *
 * ⚠ 이 게이트는 이름·모양을 지키지 수용을 보증하지 않는다(minItems·업무 규칙은 실호출만 안다). 그래서 생산 상수
 * (보내는 슬롯 상한·계획 POI 상한·응답 상한·종류 집합)를 계약의 제약과 직접 맞대 본다.
 *
 * 테스트 태스크가 계약 파일을 입력으로 선언한다(`build.gradle.kts`) — 없으면 계약만 바뀐 변경에서 이 게이트가 UP-TO-DATE 로 건너뛴다.
 */
class OpportunityBoundaryOpenApiTest : StringSpec({

    val mapper = OpportunityConfiguration.boundaryMapper()
    val contract = mapper.readTree(aiContractFile())
    val schemas = requireNotNull(contract["components"]?.get("schemas")) { "계약에 components.schemas 가 없습니다." }

    fun schema(name: String): JsonNode = requireNotNull(schemas[name]) { "계약에 $name 스키마가 없습니다." }

    fun props(name: String): List<String> = schema(name)["properties"].propertyNames().sorted()

    /** 우리 타입을 **경계 매퍼 그대로** 직렬화해 실제 와이어 키를 얻는다(이름 규칙을 흉내 내지 않는다). */
    fun wireKeys(value: Any): List<String> = mapper.readTree(mapper.writeValueAsString(value)).propertyNames().sorted()

    "우리가 부르는 경로가 전부 계약에 실재한다 — 목록은 어댑터가 실제로 부르는 상수다" {
        val paths = requireNotNull(contract["paths"]).propertyNames()
        HttpOpportunityAdapter.OPPORTUNITY_PATHS.forEach { paths shouldContain it }
        HttpOpportunityAdapter.OPPORTUNITY_PATHS shouldContainExactly listOf(HttpOpportunityAdapter.PATH)
    }

    "요청 키가 계약과 정확히 일치한다 — 중첩 타입까지" {
        wireKeys(sampleRequest) shouldContainExactly props("OpportunitiesRequest")
        wireKeys(sampleSlot) shouldContainExactly props("OpportunitySlotSchema")
        wireKeys(sampleSlot.coord) shouldContainExactly props("CoordSchema")
        wireKeys(sampleRequest.requestMeta) shouldContainExactly props("RequestMetaSchema")
    }

    "요청이 계약 필수 필드를 하나도 빠뜨리지 않는다" {
        val sent = wireKeys(sampleRequest)
        schema("OpportunitiesRequest")["required"].map { it.asString() }.forEach { sent shouldContain it }
    }

    "요청 본문의 값 모양이 계약과 일치한다 — 이름만으로는 못 본다" {
        ContractShape.mismatches(mapper, schemas, sampleRequest, "OpportunitiesRequest") shouldContainExactly emptyList()
    }

    /** 응답 키가 바뀌면 우리 읽기가 예외(필수)나 조용한 null(선택)이 된다 — 둘 다 여기서 먼저 깨진다. */
    "응답 키가 계약과 정확히 일치한다" {
        wireKeys(sampleResponse) shouldContainExactly props("OpportunitiesResponse")
        wireKeys(sampleOpportunity) shouldContainExactly props("OpportunitySchema")
        ContractShape.mismatches(mapper, schemas, sampleResponse, "OpportunitiesResponse") shouldContainExactly emptyList()
    }

    /** 상대가 우리가 필수로 읽는 필드를 선택으로 바꾸면 null 이 와서 매번 예외(빈 목록)다 — 필수 집합을 맞대 본다. */
    "우리가 필수로 읽는 응답 필드가 계약에서도 필수다" {
        schema("OpportunitySchema")["required"].map { it.asString() }.sorted() shouldContainExactly
            listOf("distance_label", "key", "kind", "near_slot_key", "poi_id", "poi_name")
    }

    /** 모르는 종류는 우리가 계약 위반(빈 목록)으로 읽는다 — 상대가 종류를 늘리면 앱 템플릿과 함께 여기부터 고친다. */
    "기회 종류 집합이 계약 enum 과 같다" {
        val contractKinds = schema("OpportunitySchema")["properties"]["kind"]["enum"].map { it.asString() }.toSet()
        OpportunityKind.entries.map { it.name }.toSet() shouldBe contractKinds
    }

    "보내는 슬롯·계획 POI 상한이 계약 maxItems 안이고, 응답 상한은 계약과 같다" {
        val request = schema("OpportunitiesRequest")["properties"]
        OpportunityService.MAX_SLOTS shouldBeLessThanOrEqual request["slots"]["maxItems"].asInt()
        OpportunityService.MAX_PLANNED shouldBeLessThanOrEqual request["planned_poi_ids"]["maxItems"].asInt()
        OpportunityGate.MAX_ITEMS shouldBe schema("OpportunitiesResponse")["properties"]["opportunities"]["maxItems"].asInt()
    }
})

/** 리포 안 계약 파일. 모듈 위치가 바뀌어도 견디도록 상대 깊이를 세지 않고 위로 올라가며 찾는다. */
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

/** 모든 필드를 채운 표본 — 하나라도 비우면 그 키가 직렬화에서 빠지거나 null 이 되어 대조가 헐거워진다. */
private val sampleSlot = AiOpportunitySlot(
    slotKey = "2026-10-20#e0000000-0000-4000-8000-000000000001",
    poiId = "e0000000-0000-4000-8000-000000000001",
    coord = AiOpportunityCoord(33.4587, 126.9427),
)

private val sampleRequest = AiOpportunitiesRequest(
    date = LocalDate.parse("2026-10-20"),
    slots = listOf(sampleSlot),
    plannedPoiIds = listOf("e0000000-0000-4000-8000-000000000001"),
    requestMeta = AiOpportunityRequestMeta("req-1", Instant.parse("2026-10-20T03:00:00Z"), 3_000),
)

private val sampleOpportunity = AiOpportunity(
    key = "event:tourapi-1",
    kind = "EVENT_VENUE",
    eventName = "제주 들불축제",
    start = LocalDate.parse("2026-10-18"),
    end = LocalDate.parse("2026-10-25"),
    poiId = "e0000000-0000-4000-8000-000000000012",
    poiName = "새별오름",
    nearSlotKey = sampleSlot.slotKey,
    distanceLabel = "약 1.0km",
)

private val sampleResponse = AiOpportunitiesResponse(opportunities = listOf(sampleOpportunity), notes = listOf("events_low"))
