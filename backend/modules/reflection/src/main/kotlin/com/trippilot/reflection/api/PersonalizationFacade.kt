package com.trippilot.reflection.api

import java.util.UUID

/**
 * 개인화 입력 조립(C13 · US-REC-10) — 공개 계약(R1, `..api..`).
 *
 * **과거 기록이 추천에 들어가는 유일한 문**이다. 동의 게이트(BR-U5-44)를 여기 한 곳에 두는 이유가
 * 그것이다 — 조립 지점이 둘이면 한쪽만 고쳐도 아무도 모른 채 동의 없는 기록이 흘러간다.
 *
 * 값은 **profile 취향 어휘**로 옮겨 나간다(`activities`·`pace`). 스타일 분석의 카테고리 코드를
 * 그대로 내보내면 받는 쪽이 모르는 어휘가 되고, AI 경계 계약에는 과거 기록을 실을 자리가 아예 없다.
 * 있는 것으로 표현할 수 있으면 상대에게 새 필드를 요구하지 않는다.
 */
interface PersonalizationFacade {
    fun deriveFor(accountId: UUID): PersonalizationView
}

/**
 * 개인화 입력 한 벌(api-safe).
 *
 * **적용되지 않은 이유를 값으로 낸다**(INV-4 결). 동의가 없어 빠진 것과 기록이 모자라 빠진 것은
 * 다르다 — 화면이 그 구분을 알아야 "동의하면 더 맞춰드려요"를 말할 수 있고, 근거 없이 말하면
 * 이미 동의한 사용자에게 같은 문구를 보인다.
 *
 * @property activities 추천에 보탤 활동 취향(profile 어휘). 미적용이면 **빈 목록**이다.
 * @property pace 추천에 보탤 여행 속도(profile 어휘). 미적용이면 null.
 * @property sharedItems 무엇을 어떤 목적으로 넘겼는가(BR-U5-45). **실제로 넘긴 것만** 담는다 —
 *   목록만 늘고 실제로는 안 쓰면 그 안내가 거짓말이 된다.
 */
data class PersonalizationView(
    val applied: Boolean,
    val reason: PersonalizationReason,
    val activities: List<String>,
    val pace: String?,
    val sharedItems: List<PersonalizationItem>,
)

enum class PersonalizationReason {
    /** 동의가 있고 근거도 충분해 실제로 반영됐다. */
    APPLIED,

    /** 개인화 활용에 동의하지 않았다 — 기본 추천만 나간다(BR-U5-44). */
    CONSENT_MISSING,

    /** 동의는 있으나 정식 스타일 분석이 아직 없다(누적 방문 10곳 미만, INV-U5-09). */
    NOT_ENOUGH_RECORDS,
}

/** 넘긴 항목 하나와 그 목적(BR-U5-45). 화면(U6 `l05`)이 이 목록을 그린다. */
data class PersonalizationItem(val item: String, val purpose: String)
