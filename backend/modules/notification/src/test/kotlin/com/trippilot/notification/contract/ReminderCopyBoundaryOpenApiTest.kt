package com.trippilot.notification.contract

import com.trippilot.notification.adapter.out.external.AiReminderCopy
import com.trippilot.notification.adapter.out.external.AiReminderCopyItem
import com.trippilot.notification.adapter.out.external.AiReminderCopyRequest
import com.trippilot.notification.adapter.out.external.AiReminderCopyResponse
import com.trippilot.notification.adapter.out.external.AiReminderRequestMeta
import com.trippilot.notification.adapter.out.external.ReminderCopyConfiguration
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldContainExactly
import tools.jackson.databind.JsonNode
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 리마인드 문구 경계의 **이름 게이트**(TRIP-836).
 *
 * 이 게이트가 없으면 상대가 필드를 개명해도 런타임에서야 안다 — 그리고 문구 채움은 실패를
 * **상수 문구로 삼키므로**(INV-4), 드리프트가 *"AI 를 켰는데 늘 상수 문구"* 로만 나타나 원인이
 * 보이지 않는다. 일정 경계의 `explanations` 와 회고 경계가 정확히 그 형태였다.
 *
 * ⚠ **이 게이트는 이름을 지키지 제약을 지키지 않는다.** `minItems` 같은 것은 실호출로만 드러난다.
 */
class ReminderCopyBoundaryOpenApiTest : StringSpec({

    val mapper = ReminderCopyConfiguration.boundaryMapper()
    val contract = mapper.readTree(aiContractFile())
    val schemas = requireNotNull(contract["components"]?.get("schemas")) { "계약에 components.schemas 가 없습니다." }

    fun props(name: String): List<String> =
        requireNotNull(schemas[name]) { "계약에 $name 스키마가 없습니다." }["properties"].propertyNames().sorted()

    /** 우리 타입을 **경계 매퍼 그대로** 직렬화해 실제 와이어 키를 얻는다(이름 규칙을 흉내내지 않는다). */
    fun wireKeys(value: Any): List<String> =
        mapper.readTree(mapper.writeValueAsString(value)).propertyNames().sorted()

    "우리가 부르는 경로가 계약에 실재한다" {
        requireNotNull(contract["paths"]).propertyNames() shouldContain "/ai/v1/notification/copies"
    }

    "요청 키가 계약과 정확히 일치한다" {
        wireKeys(sampleRequest) shouldContainExactly props("ReminderCopyRequest")
    }

    "요청이 계약 필수 필드를 하나도 빠뜨리지 않는다" {
        val required = requireNotNull(schemas["ReminderCopyRequest"])["required"].map { it.asText() }
        val sent = wireKeys(sampleRequest)
        required.forEach { sent shouldContain it }
    }

    "중첩 항목 타입도 키가 일치한다 — 안쪽이 어긋나도 겉은 멀쩡해 보인다" {
        wireKeys(sampleItem) shouldContainExactly props("ReminderCopyItemSchema")
    }

    /**
     * 응답도 본다. 상대가 `degraded` 를 개명하면 우리 기본값(`false`)이 조용히 이기고,
     * **상대가 규칙 문구로 내려간 것을 AI 문구로 저장**하게 된다 — 품질 관측이 통째로 거짓이 된다.
     */
    "응답 키가 계약과 정확히 일치한다" {
        wireKeys(sampleResponse) shouldContainExactly props("ReminderCopyResponse")
        wireKeys(sampleCopy) shouldContainExactly props("ReminderCopySchema")
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

/** 모든 필드를 채운 표본 — 하나라도 비우면 그 키가 직렬화에서 빠져 비교가 헐거워진다. */
private val sampleItem = AiReminderCopyItem(
    scheduleKey = UUID.randomUUID().toString(),
    kind = "TRIP_DAY",
    date = LocalDate.parse("2026-08-10").toString(),
    slots = listOf("성산일출봉"),
)

private val sampleRequest = AiReminderCopyRequest(
    requestMeta = AiReminderRequestMeta(UUID.randomUUID().toString(), Instant.parse("2026-08-01T00:00:00Z"), 8_000L),
    items = listOf(sampleItem),
    tripTitle = "제주 3박 4일",
)

private val sampleCopy = AiReminderCopy(
    scheduleKey = sampleItem.scheduleKey, title = "오늘은 성산일출봉", body = "해 뜨는 시간에 맞춰 가 보세요.",
)

private val sampleResponse = AiReminderCopyResponse(
    copies = listOf(sampleCopy), degraded = false, fallbackMode = "rule",
)
