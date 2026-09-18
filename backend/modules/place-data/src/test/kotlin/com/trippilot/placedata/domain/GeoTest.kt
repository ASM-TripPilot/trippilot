package com.trippilot.placedata.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.shouldBe

/** 하버사인·bounding-box 순수 로직. */
class GeoTest : StringSpec({

    "하버사인 — 위도 1도 ≈ 111km" {
        Haversine.meters(35.0, 129.0, 36.0, 129.0) shouldBe (111_000.0 plusOrMinus 700.0)
    }

    "하버사인 — 같은 점은 0" {
        Haversine.meters(35.1, 129.0, 35.1, 129.0) shouldBe 0.0
    }

    "bounding-box는 반경 방향 극점을 포함(원 상위집합)" {
        val lat = 35.0
        val lng = 129.0
        val r = 5000.0
        val box = BoundingBox.around(lat, lng, r)
        // 정북·정동 방향으로 r 떨어진 점(하버사인 ≈ r)이 박스 안이어야 함
        val north = lat + r / 111_320.0
        val east = lng + r / (111_320.0 * Math.cos(Math.toRadians(lat)))
        box.contains(north, lng) shouldBe true
        box.contains(lat, east) shouldBe true
    }
})
