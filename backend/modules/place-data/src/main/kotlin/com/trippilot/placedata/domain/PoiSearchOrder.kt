package com.trippilot.placedata.domain

/**
 * 탐색 목록의 정렬 재료(TRIP-1003 (A) · US-EXPL-04).
 *
 * - [sortKey]: 법인 접두("(주)"·"(사)"·"(구)"·"㈜"…)를 뗀 이름 — 가나다 정렬에서 괄호가
 *   ASCII 로 앞서 "(주)손으로만드는수공예"가 전국 첫 카드가 되던 결함(QA #023)의 처방.
 *   표기는 그대로 두고 **정렬 키에서만** 뗀다 — 이름을 고치면 정본 조작이다.
 * - [rank]: 검색어 관련도 — 정확(0) > 접두(1) > 부분(2). "명동" 검색에 "광명동굴 푸드코트"가
 *   "명동" 본체보다 앞서던 결함(#028 계열)의 처방. 검색어가 없으면 전부 0(관련도 축 없음).
 *
 * ⚠ **같은 식이 SQL(네이티브 쿼리)에도 있다** — keyset 페이지네이션은 DB 가 정렬하고 커서는
 * 여기서 만들기 때문이다. 한쪽만 고치면 이어받기에서 행이 중복·누락된다. 두 식의 일치는
 * `PlacesSearchOrderIT`(커서 연속성)가 잠근다.
 */
object PoiSearchOrder {

    private val CORP_PREFIX = Regex("""^\s*(\([^)]*\)|（[^）]*）|[㈜㈔㈗㈐])\s*""")

    fun sortKey(nameKo: String): String = nameKo.replace(CORP_PREFIX, "").ifBlank { nameKo }

    fun rank(query: String, nameKo: String): Int {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return 0
        val name = nameKo.lowercase()
        return when {
            name == q -> 0
            name.startsWith(q) -> 1
            else -> 2
        }
    }
}
