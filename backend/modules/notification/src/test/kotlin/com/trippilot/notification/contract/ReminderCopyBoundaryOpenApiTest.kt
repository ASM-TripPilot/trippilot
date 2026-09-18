package com.trippilot.notification.contract

import com.trippilot.notification.adapter.out.external.AiReminderCopy
import com.trippilot.notification.adapter.out.external.AiReminderCopyItem
import com.trippilot.notification.adapter.out.external.AiReminderCopyRequest
import com.trippilot.notification.adapter.out.external.AiReminderCopyResponse
import com.trippilot.notification.adapter.out.external.AiReminderRequestMeta
import com.trippilot.notification.adapter.out.external.AiReminderSlot
import com.trippilot.notification.adapter.out.external.HttpReminderCopyAdapter
import com.trippilot.notification.adapter.out.external.ReminderCopyConfiguration
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
import java.util.UUID

/**
 * 리마인드 문구 경계의 **이름 게이트**(TRIP-836).
 *
 * 이 게이트가 없으면 상대가 필드를 개명해도 런타임에서야 안다 — 그리고 문구 채움은 실패를
 * **상수 문구로 삼키므로**(INV-4), 드리프트가 *"AI 를 켰는데 늘 상수 문구"* 로만 나타나 원인이
 * 보이지 않는다. 일정 경계의 `explanations` 와 회고 경계가 정확히 그 형태였다.
 *
 * ⚠ **이 게이트는 이름을 지키지 제약을 지키지 않는다.** `minItems`·`maxItems` 같은 것은 실호출로만 드러난다.
 *
 * ⚠ **2026-09-16 — 이름만 봐서 네 가지를 놓쳤다.** 실 왕복을 태워 보니 매 호출이 422 였다:
 * `trip_title` 에 `null`(계약은 nullable 이 아니다) · `slots` 를 문자열 배열로(계약은 객체 배열) ·
 * 계약 enum 밖 종류 · `maxItems: 30` 초과. **`slots` 라는 이름은 양쪽에 다 있어서** 게이트가 통과했다.
 * 그래서 아래에 **타입 대조**를 더했다 — 이름이 같고 모양이 다른 경우를 잡는다.
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
    /**
     * **이름이 같고 모양이 다른 경우를 잡는다.** 배열 원소가 문자열인지 객체인지, 그 객체의 키가
     * 무엇인지까지 본다 — `slots` 를 문자열 배열로 보내다 실 왕복에서 422 를 맞은 자리다.
     */
    "배열 필드의 원소 모양이 계약과 일치한다" {
        val sent = mapper.readTree(mapper.writeValueAsString(sampleItem))["slots"]
        val contractSlots = requireNotNull(schemas["ReminderCopyItemSchema"])["properties"]["slots"]
        val ref = requireNotNull(contractSlots["items"]?.get("\$ref")) {
            "계약의 slots 가 \$ref 가 아니다 — 원소가 원시값으로 바뀌었는지 확인하라."
        }.asString().substringAfterLast('/')

        // 계약이 객체를 요구하면 우리도 객체여야 한다.
        sent.first().isObject shouldBe true
        sent.first().propertyNames().sorted() shouldContainExactly props(ref)
    }

    /**
     * **enum 밖 값을 보내면 그 한 건 때문에 요청 전체가 422 다.** 우리 알림 종류는 여덟인데
     * 상대가 받는 것은 둘뿐이라, 어댑터가 거르는 집합이 계약과 같은지 잠근다.
     */
    "우리가 보내기로 한 종류 집합이 계약 enum 과 같다" {
        val contractKinds = requireNotNull(schemas["ReminderCopyItemSchema"])["properties"]["kind"]["enum"]
            .map { it.asString() }.toSet()

        HttpReminderCopyAdapter.aiKinds() shouldBe contractKinds
    }

    /** 나눠 보내는 상한이 계약보다 크면 나누는 의미가 없다. */
    "묶음 상한이 계약 maxItems 를 넘지 않는다" {
        val maxItems = requireNotNull(schemas["ReminderCopyRequest"])["properties"]["items"]["maxItems"].asInt()

        HttpReminderCopyAdapter.maxItems() shouldBeLessThanOrEqual maxItems
    }

    /** 전 필드 모양 대조 — 위 배열 검사가 `slots` 한 자리를 보는 반면 이쪽은 본문 전체를 훑는다. */
    "요청 본문의 값 모양이 계약과 일치한다" {
        ContractShape.mismatches(mapper, schemas, sampleRequest, "ReminderCopyRequest") shouldContainExactly emptyList()
    }

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
    slots = listOf(AiReminderSlot("성산일출봉", "명소")),
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
