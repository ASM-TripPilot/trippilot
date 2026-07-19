package com.trippilot.profile.adapter.`in`.web

import com.fasterxml.jackson.databind.JsonNode
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.profile.application.Patch
import com.trippilot.profile.application.PreferencePatch
import com.trippilot.profile.application.PreferenceService
import com.trippilot.profile.domain.PreferenceView
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal

/**
 * 취향 7축 조회·부분 저장(Bearer). 조회는 항상 완전 응답(중립 기본값 파생 + isNeutralDefault).
 * PUT 은 축별 tri-state: 생략=미변경 · null=미설정 초기화 · 값=설정. 본문을 JsonNode 로 받아 키 존재로 구분하고,
 * 필드 타입이 스키마와 다르면 400 으로 거부(조용한 강제 방지).
 */
@RestController
@RequestMapping("/api/v1/me/preferences")
class PreferenceController(
    private val preferences: PreferenceService,
) {
    @GetMapping
    fun get(principal: Principal): PreferenceResponse =
        PreferenceResponse.from(preferences.get(principal.accountId()))

    @PutMapping
    fun update(principal: Principal, @RequestBody body: JsonNode): PreferenceResponse =
        PreferenceResponse.from(preferences.update(principal.accountId(), body.toPatch()))
}

/** JsonNode → PreferencePatch. 키 없음=Keep, null=SetTo(null), 값=SetTo(v). 타입 불일치는 400. */
private fun JsonNode.toPatch(): PreferencePatch = PreferencePatch(
    styles = stringListPatch("styles"),
    budgetTier = stringPatch("budgetTier"),
    budgetRawAmount = longPatch("budgetRawAmount"),
    companionTypes = stringListPatch("companionTypes"),
    petFlag = boolPatch("petFlag"),
    activities = stringListPatch("activities"),
    transportModes = stringListPatch("transportModes"),
    foodTastes = stringListPatch("foodTastes"),
    pace = stringPatch("pace"),
)

private fun JsonNode.stringListPatch(field: String): Patch<List<String>> =
    typedPatch(field, { it.isArray }, "문자열 배열") { node ->
        node.map { element ->
            if (!element.isTextual) throw ValidationFailed(listOf(FieldError(field, "문자열 배열이어야 합니다")))
            element.asText()
        }
    }

private fun JsonNode.stringPatch(field: String): Patch<String> =
    typedPatch(field, { it.isTextual }, "문자열") { it.asText() }

private fun JsonNode.longPatch(field: String): Patch<Long> =
    typedPatch(field, { it.isIntegralNumber }, "정수") { it.asLong() }

private fun JsonNode.boolPatch(field: String): Patch<Boolean> =
    typedPatch(field, { it.isBoolean }, "불리언") { it.asBoolean() }

private fun <T> JsonNode.typedPatch(
    field: String,
    typeOk: (JsonNode) -> Boolean,
    typeName: String,
    extract: (JsonNode) -> T,
): Patch<T> {
    if (!has(field)) return Patch.Keep
    val node = get(field)
    if (node.isNull) return Patch.SetTo(null)
    if (!typeOk(node)) throw ValidationFailed(listOf(FieldError(field, "$typeName 형식이어야 합니다")))
    return Patch.SetTo(extract(node))
}
