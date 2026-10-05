package com.trippilot.trip.application

import com.trippilot.trip.api.TripPreferenceSnapshot

/**
 * `trip.preference_snapshot jsonb`(클라이언트 자유 맵) → api-safe [TripPreferenceSnapshot].
 *
 * **관용적으로 읽는다**: 모르는 키, 타입이 틀린 값, 목록 안 비문자열은 버린다. 자유 맵이라
 * 무엇이 올지 보증할 수 없고, 여기서 예외를 던지면 취향 하나 때문에 일정 생성 전체가 죽는다
 * (INV-4 — 조용한 실패가 아니라 **축 단위 강등**이다. 버려진 축은 소비처가 계정 취향으로 채운다).
 */
internal fun Map<String, Any?>.toTripPreferences(): TripPreferenceSnapshot =
    TripPreferenceSnapshot(
        styles = strings("styles"),
        activities = strings("activities"),
        foodTastes = strings("foodTastes"),
        transportModes = strings("transportModes"),
        companionTypes = strings("companionTypes"),
        pace = text("pace"),
        budgetTier = text("budgetTier"),
        petFriendly = this["petFriendly"] as? Boolean,
    )

private fun Map<String, Any?>.strings(key: String): List<String> =
    (this[key] as? Collection<*>).orEmpty().mapNotNull { it.asText() }

private fun Map<String, Any?>.text(key: String): String? = this[key].asText()

/** 숫자·불린을 문자열로 **승격하지 않는다** — 취향 어휘는 문자열이고, 승격하면 `1` 이 취향이 된다. */
private fun Any?.asText(): String? = (this as? String)?.trim()?.takeIf { it.isNotEmpty() }
