package com.trippilot.reflection.contract

import com.trippilot.reflection.adapter.out.external.AiReflectionCover
import com.trippilot.reflection.adapter.out.external.AiReflectionGenerateRequest
import com.trippilot.reflection.adapter.out.external.AiReflectionGenerateResponse
import com.trippilot.reflection.adapter.out.external.AiReflectionPaths
import com.trippilot.reflection.adapter.out.external.AiReflectionRequestMeta
import com.trippilot.reflection.adapter.out.external.AiReflectionVisit
import com.trippilot.reflection.adapter.out.external.AiReflectionVisitRef
import com.trippilot.reflection.adapter.out.external.ReflectionBoundaryMapper
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldContainExactly
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import tools.jackson.databind.JsonNode

/**
 * 회고 AI 경계의 **이름 게이트**(G-U5-4 해소).
 *
 * 이 게이트가 없으면 상대가 필드를 개명해도 우리는 런타임에서야 안다 — 그리고 회고 생성은 실패를
 * 규칙 카드로 삼키므로(BR-U5-32), 드리프트가 **"AI 가 한 번도 안 걸리는 상태"로만 나타나** 원인이
 * 보이지 않는다. 일정 경계의 `explanations` 가 정확히 그 형태였다(#435).
 */
class ReflectionBoundaryOpenApiTest : StringSpec({

    val mapper = ReflectionBoundaryMapper.create()
    val contract = mapper.readTree(aiContractFile())
    val schemas = requireNotNull(contract["components"]?.get("schemas")) { "계약에 components.schemas 가 없습니다." }

    fun props(name: String): List<String> =
        requireNotNull(schemas[name]) { "계약에 $name 스키마가 없습니다." }["properties"].propertyNames().sorted()

    /** 우리 타입을 **경계 매퍼 그대로** 직렬화해 실제 와이어 키를 얻는다(이름 규칙을 흉내내지 않는다). */
    fun wireKeys(value: Any): List<String> = mapper.readTree(mapper.writeValueAsString(value)).propertyNames().sorted()

    "우리가 부르는 경로가 전부 계약에 실재한다" {
        val paths = requireNotNull(contract["paths"]).propertyNames()
        AiReflectionPaths.CALLED.forEach { paths shouldContain it }
    }

    "generate 요청 키가 계약과 정확히 일치한다" {
        wireKeys(sampleRequest) shouldContainExactly props("ReflectionGenerateRequest")
    }

    "요청이 계약 필수 필드를 하나도 빠뜨리지 않는다" {
        val required = requireNotNull(schemas["ReflectionGenerateRequest"])["required"].map { it.asText() }
        val sent = wireKeys(sampleRequest)
        required.forEach { sent shouldContain it }
    }

    "중첩 방문 타입도 계약과 키가 일치한다 — 안쪽이 어긋나도 겉은 멀쩡해 보인다" {
        wireKeys(sampleVisit) shouldContainExactly props("VisitRecordSchema")
        wireKeys(sampleVisit.ref) shouldContainExactly props("VisitRefSchema")
        wireKeys(sampleRequest.requestMeta) shouldContainExactly props("RequestMetaSchema")
    }

    /**
     * 응답도 본다. 상대가 필드를 개명하면 우리 기본값이 조용히 이기고, 그 결과는 "AI 카드가 한 번도
     * 안 나온다"로만 보인다 — 예외도 로그도 없다.
     */
    "generate 응답 키가 계약과 정확히 일치한다" {
        wireKeys(sampleResponse) shouldContainExactly props("ReflectionGenerateResponse")
        wireKeys(sampleResponse.cover) shouldContainExactly props("CoverSchema")
    }
})

/** 리포 안 계약 파일. 모듈 위치가 바뀌어도 견디도록 **상대 깊이를 세지 않고** 위로 올라가며 찾는다. */
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

/** 모든 필드를 채운 표본 — 하나라도 비우면 그 키가 직렬화에서 빠져 비교가 헐거워진다. */
private val sampleVisit = AiReflectionVisit(
    ref = AiReflectionVisitRef(LocalDate.parse("2026-08-01"), UUID.randomUUID().toString()),
    poiName = "성산일출봉", category = "자연", orderInDay = 1, photoCount = 3,
)

private val sampleRequest = AiReflectionGenerateRequest(
    requestMeta = AiReflectionRequestMeta(UUID.randomUUID().toString(), Instant.parse("2026-08-01T00:00:00Z"), 20_000L),
    kind = "DAILY", region = "제주",
    startDate = LocalDate.parse("2026-08-01"), endDate = LocalDate.parse("2026-08-03"),
    visits = listOf(sampleVisit),
    personaSummary = "휴양 위주", events = listOf("불꽃축제"), weatherSummary = "맑음",
)

private val sampleResponse = AiReflectionGenerateResponse(
    templateId = "ai.daily.v1", kind = "DAILY", format = "CARD",
    generatedAt = Instant.parse("2026-08-01T09:00:00Z"), isFallback = false,
    cover = AiReflectionCover("제주 하루", "성산일출봉을 다녀왔어요", photoSlot = "cover"),
    scenes = emptyList(), hashtags = listOf("#제주"),
)
