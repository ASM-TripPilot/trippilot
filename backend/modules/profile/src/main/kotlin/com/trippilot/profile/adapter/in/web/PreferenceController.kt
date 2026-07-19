package com.trippilot.profile.adapter.`in`.web

import com.fasterxml.jackson.databind.JsonNode
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
 * PUT 은 축별 tri-state: 생략=미변경 · null=미설정 초기화 · 값=설정. 본문을 JsonNode 로 받아 키 존재로 구분.
 */
@RestController
@RequestMapping("/api/v1/me/preferences")
class PreferenceController(
    private val preferences: PreferenceService,
) {
    @GetMapping
    fun get(principal: Principal): PreferenceView = preferences.get(principal.accountId())

    @PutMapping
    fun update(principal: Principal, @RequestBody body: JsonNode): PreferenceView =
        preferences.update(principal.accountId(), body.toPatch())
}

/** JsonNode → PreferencePatch. 키 없음=Keep, null=SetTo(null), 값=SetTo(v). */
private fun JsonNode.toPatch(): PreferencePatch = PreferencePatch(
    styles = patch("styles") { node -> node.map { it.asText() } },
    budgetTier = patch("budgetTier") { it.asText() },
    budgetRawAmount = patch("budgetRawAmount") { it.asLong() },
    companionTypes = patch("companionTypes") { node -> node.map { it.asText() } },
    petFlag = patch("petFlag") { it.asBoolean() },
    activities = patch("activities") { node -> node.map { it.asText() } },
    transportModes = patch("transportModes") { node -> node.map { it.asText() } },
    foodTastes = patch("foodTastes") { node -> node.map { it.asText() } },
    pace = patch("pace") { it.asText() },
)

private fun <T> JsonNode.patch(field: String, extract: (JsonNode) -> T): Patch<T> =
    if (!has(field)) Patch.Keep else Patch.SetTo(get(field).let { if (it.isNull) null else extract(it) })
