package com.trippilot.placedata.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/** 탐색 정렬 재료(TRIP-1003 (A)) — SQL 쪽 같은 식과의 일치는 `PlacesSearchOrderIT` 가 잠근다. */
class PoiSearchOrderTest : StringSpec({

    "관련도 — 정확 > 접두 > 부분, 대소문자 무시" {
        PoiSearchOrder.rank("명동", "명동") shouldBe 0
        PoiSearchOrder.rank("명동", "명동교자") shouldBe 1
        PoiSearchOrder.rank("명동", "광명동굴 푸드코트") shouldBe 2
        PoiSearchOrder.rank("cafe", "CAFE 온더플레이트") shouldBe 1
    }

    "검색어가 없으면 관련도 축이 없다 — 전부 0" {
        PoiSearchOrder.rank("", "아무 이름") shouldBe 0
        PoiSearchOrder.rank("  ", "아무 이름") shouldBe 0
    }

    "법인 접두를 정렬 키에서만 뗀다 — (주)·(사)·(구)·㈜·전각 괄호" {
        PoiSearchOrder.sortKey("(주)손으로만드는수공예") shouldBe "손으로만드는수공예"
        PoiSearchOrder.sortKey("(사) 국가무형유산 고성오광대보존회") shouldBe "국가무형유산 고성오광대보존회"
        PoiSearchOrder.sortKey("(구)인천일본제58은행지점") shouldBe "인천일본제58은행지점"
        PoiSearchOrder.sortKey("㈜ 카페온") shouldBe "카페온"
        PoiSearchOrder.sortKey("（유）전각괄호") shouldBe "전각괄호"
    }

    "접두가 아니면 건드리지 않고, 떼면 빈 이름이 될 때는 원래 이름을 쓴다" {
        PoiSearchOrder.sortKey("명동(본점)") shouldBe "명동(본점)"
        PoiSearchOrder.sortKey("(전부괄호)") shouldBe "(전부괄호)"
    }

    // ── 무작위 정렬(TRIP-1570) ─────────────────────────────────────────────
    // 기대값은 셸 `printf '%s' 'seed-a<uuid>' | md5` 로 따로 낸 것 — PostgreSQL `md5(seed || poi_id::text)` 와
    // 같은 바이트(UTF-8)·같은 표기(소문자 hex)여야 커서가 DB 정렬과 맞물린다. 실 DB 일치는 PlacesSearchOrderIT.
    "무작위 키 — md5(seed + poiId) 소문자 hex 그대로다" {
        PoiSearchOrder.randomKey("seed-a", java.util.UUID.fromString("11111111-1111-4111-8111-111111111111")) shouldBe
            "b72c49af271051b0dd25ee80708c03ef"
    }

    "정렬 키 — seed 가 없으면 이름 키, 있으면 무작위 키" {
        val id = java.util.UUID.fromString("11111111-1111-4111-8111-111111111111")
        PoiSearchOrder.key("(주)카페온", id, seed = null) shouldBe "카페온"
        PoiSearchOrder.key("(주)카페온", id, seed = "seed-a") shouldBe "b72c49af271051b0dd25ee80708c03ef"
    }
})
