package com.trippilot.trip.application

import com.trippilot.trip.api.TripPreferenceSnapshot

/**
 * `trip.preference_snapshot jsonb`(클라이언트 자유 맵) → api-safe [TripPreferenceSnapshot].
 *
 * **관용적으로 읽는다**: 모르는 키, 타입이 틀린 값, 목록 안 비문자열은 버린다. 자유 맵이라
 * 무엇이 올지 보증할 수 없고, 여기서 예외를 던지면 취향 하나 때문에 일정 생성 전체가 죽는다
 * (INV-4 — 조용한 실패가 아니라 **축 단위 강등**이다. 버려진 축은 소비처가 계정 취향으로 채운다).
 *
 * **빈 목록은 버리지 않는다**: 목록으로 온 이상 `[]` 는 "이 여행에선 고르지 않음"이라는 선택이고,
 * 키가 아예 없는 것(미설정)과 다르다. 접으면 사용자가 뺀 취향이 계정 값으로 되살아난다.
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

/** 목록이 아니면 **미설정**(`null`)이다 — 읽을 수 없는 값을 "고르지 않음"으로 단정하지 않는다. */
private fun Map<String, Any?>.strings(key: String): List<String>? =
    (this[key] as? Collection<*>)?.mapNotNull { it.asText() }

private fun Map<String, Any?>.text(key: String): String? = this[key].asText()

/** 숫자·불린을 문자열로 **승격하지 않는다** — 취향 어휘는 문자열이고, 승격하면 `1` 이 취향이 된다. */
private fun Any?.asText(): String? = (this as? String)?.trim()?.takeIf { it.isNotEmpty() }
