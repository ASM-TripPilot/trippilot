package com.trippilot.placedata.domain

/**
 * 공개 면(앱 API·일정 표면·도우미 뷰)에 내보내지 않는 태그를 걸러 낸다(TRIP-1537).
 *
 * `인기1`~`인기5`·`평점높음` 은 지도 앱 평판(리뷰 수·별점)에서 뽑은 **파생 구간**이다. AI 점수와 후보 선별이 쓰는 값이라
 * 저장은 `poi.tags` 에 하되, 사용자 화면에 `#인기5` 로 뜨거나 도우미 탐색이 그 태그로 거를 수 있게 두지 않는다.
 * 같은 규칙이 DB 뷰 `poi_public` 에도 걸려 있다(V2.80) — **둘을 함께 고친다.**
 *
 * AI 내부 읽기(`/internal/pois`)는 이 필터를 거치지 않는다 — AI 가 점수에 쓰기 때문이다.
 */
object PublicTags {
    private val INTERNAL = Regex("^인기[1-5]$")
    private const val HIGH_RATING = "평점높음"

    fun of(tags: List<String>): List<String> = tags.filterNot { INTERNAL.matches(it) || it == HIGH_RATING }
}
