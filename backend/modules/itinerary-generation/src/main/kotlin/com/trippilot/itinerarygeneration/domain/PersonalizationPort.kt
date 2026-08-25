package com.trippilot.itinerarygeneration.domain

import java.util.UUID

/**
 * 기록 기반 개인화 힌트(TRIP-556) — **일정 생성이 필요로 하는 것**을 자기 말로 선언한 포트.
 *
 * ## 왜 `reflection.api` 를 직접 부르지 않나
 *
 * 부르면 **순환이 생긴다**: `archive → itinerary-generation`(방문 실적이 계획 슬롯을 읽는다,
 * TRIP-544) 인데 `reflection → archive` 라서, 여기서 reflection 을 물면
 * `archive → itinerary-generation → reflection → archive` 로 닫힌다. Gradle 이 즉시 막는다.
 *
 * 순환을 푸는 방법은 **의존을 뒤집는 것**이다 — 필요한 모양을 이 모듈이 정의하고, 그것을 실제
 * 개인화(U5)에 연결하는 일은 **조립을 소유한 app** 이 한다(`OutboxSubscriber` 와 같은 꼴).
 * 이 모듈은 개인화가 어디서 오는지 모른다.
 *
 * ## 동의는 여기서 판정하지 않는다
 *
 * 게이트는 개인화 소유 모듈에 있다(BR-U5-44). 여기서 한 번 더 물으면 규칙이 두 곳에 흩어져
 * 한쪽만 고쳐도 아무도 모른다 — **동의가 없으면 빈 힌트가 온다**는 것이 이 포트의 계약이다.
 */
interface PersonalizationPort {
    fun hintsFor(accountId: UUID): PersonalizationHints
}

/**
 * 취향에 **보탤** 값. 비어 있으면 아무것도 보태지 않는다 — 동의가 없거나 근거가 모자란 경우다.
 *
 * 값은 `preference_snapshot` 어휘다(profile 7축). 그래야 AI 경계에 **새 필드를 요구하지 않고**
 * 실을 수 있다 — 경계 계약에는 과거 기록을 담을 자리가 아예 없다.
 */
data class PersonalizationHints(val activities: List<String>, val pace: String?) {
    companion object {
        val NONE = PersonalizationHints(emptyList(), null)
    }
}
