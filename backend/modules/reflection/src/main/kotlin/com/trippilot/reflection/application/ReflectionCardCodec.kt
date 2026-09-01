package com.trippilot.reflection.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.reflection.domain.ReflectionCard
import org.springframework.stereotype.Component

/**
 * 카드 원문(JSON) ↔ [ReflectionCard]. **백엔드가 카드를 읽는 유일한 지점이다**(DEC-U5-14).
 *
 * 파서를 하나로 두는 이유: 웹(사용자 수정본)과 영속(저장된 카드)이 각자 파싱하면 "무엇을 제목으로
 * 보는가"가 두 벌이 되고, 한쪽만 고치면 목록과 상세가 다른 제목을 그린다.
 *
 * **`cover` 밖은 보지 않는다.** `scenes`·`hashtags` 는 통과시킨다 — 우리가 재검증하면 상대가
 * 템플릿을 하나 늘릴 때마다 우리 마이그레이션이 된다.
 */
@Component
class ReflectionCardCodec(private val mapper: ObjectMapper) {

    /**
     * 사용자·상대가 준 카드 원문을 읽는다.
     *
     * 형식이 아니거나 `cover.title` 이 비면 **400 이다**(PBT-U5-F1). 통과시키면 목록에 빈 줄이
     * 그려지고 어디서 비었는지 추적할 근거가 사라진다 — 조용히 틀린 값이 된다.
     */
    fun read(payload: String): ReflectionCard {
        val node = runCatching { mapper.readTree(payload) }.getOrNull()
            ?: throw ValidationFailed(listOf(FieldError("card", "카드를 해석할 수 없습니다")))
        if (!node.isObject) throw ValidationFailed(listOf(FieldError("card", "카드는 객체여야 합니다")))

        val title = node.path("cover").path("title").asText("").trim()
        if (title.isBlank()) throw ValidationFailed(listOf(FieldError("card.cover.title", "카드 제목이 필요합니다")))

        return ReflectionCard(
            templateId = node.path("template_id").asText("").ifBlank { USER_TEMPLATE },
            format = node.path("format").asText("").ifBlank { "CARD" },
            title = title,
            subtitle = node.path("cover").path("subtitle").asText("").trim(),
            payload = mapper.writeValueAsString(node),
        )
    }

    companion object {
        /** 사용자가 손으로 고친 카드에 `template_id` 가 없을 때 붙인다 — 누가 만든 카드인지 남는다. */
        const val USER_TEMPLATE = "user.edit.v1"
    }
}
