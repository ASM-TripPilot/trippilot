package com.trippilot.accommodationsearch.domain

import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.doubles.shouldBeGreaterThan
import io.kotest.matchers.doubles.shouldBeLessThan
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe

/**
 * TRIP-202 — '내 주변' 좌표 스코프(US-STAY-01 정상 · BR-U1-11).
 *
 * [Nearby] 가 지키는 것은 둘이다.
 *  1. **조립 단계의 all-or-nothing** — lat·lng 는 짝이어야 한다. 한쪽만 온 요청을 조용히
 *     "좌표 없음"으로 접으면 사용자는 '내 주변'을 눌렀는데 전국 목록을 받는다(INV-4 침묵 실패 금지).
 *  2. **반경 포함 판정** — 지구는 구면이라 위경도 차를 그대로 빼면 위도에 따라 실제 거리가
 *     달라진다. 하버사인(haversine)은 두 위경도 사이의 대권(大圓) 거리를 구하는 공식이다.
 */
class NearbyTest : StringSpec({

    // ── 조립: 셋 다 없거나, lat·lng 가 모두 있거나 — 그 사이는 없다 ──

    "셋 다 없으면 좌표 스코프가 없다(null) — '내 주변'이 아닌 평범한 탐색" {
        Nearby.of(null, null, null).shouldBeNull()
    }

    "lat 만 오면 400 — 부분 좌표를 무시하고 전체 조회로 넘어가지 않는다" {
        val ex = shouldThrow<ValidationFailed> { Nearby.of(33.5, null, null) }
        ex.fieldErrors.map { it.field } shouldBe listOf("lng")
    }

    "lng 만 와도 400" {
        val ex = shouldThrow<ValidationFailed> { Nearby.of(null, 126.5, null) }
        ex.fieldErrors.map { it.field } shouldBe listOf("lat")
    }

    "radiusKm 만 오면 400 — 중심 없는 반경은 의미가 없다" {
        shouldThrow<ValidationFailed> { Nearby.of(null, null, 3.0) }
    }

    "radiusKm 을 안 주면 서버 기본 반경을 적용한다" {
        Nearby.of(33.5, 126.5, null)!!.radiusKm shouldBe Nearby.DEFAULT_RADIUS_KM
    }

    // ── 범위: 신뢰 경계라 값 자체를 검증한다 ──

    "위도가 ±90 을 넘으면 400" {
        shouldThrow<ValidationFailed> { Nearby.of(90.1, 126.5, null) }
        shouldThrow<ValidationFailed> { Nearby.of(-90.1, 126.5, null) }
    }

    "경도가 ±180 을 넘으면 400" {
        shouldThrow<ValidationFailed> { Nearby.of(33.5, 180.1, null) }
        shouldThrow<ValidationFailed> { Nearby.of(33.5, -180.1, null) }
    }

    "반경이 0 이하면 400 — 아무것도 못 찾는 조회를 성공으로 돌려주지 않는다" {
        shouldThrow<ValidationFailed> { Nearby.of(33.5, 126.5, 0.0) }
        shouldThrow<ValidationFailed> { Nearby.of(33.5, 126.5, -1.0) }
    }

    "경계값은 통과한다(±90 · ±180)" {
        Nearby.of(90.0, 180.0, 1.0)!!.radiusKm shouldBe 1.0
        Nearby.of(-90.0, -180.0, 1.0)!!.radiusKm shouldBe 1.0
    }

    // ── 거리: 실측 좌표로 눈금을 맞춘다 ──

    "하버사인 거리 — 제주시청↔중문은 약 30.5km" {
        val d = distanceKm(33.4996, 126.5312, 33.2440, 126.4120)
        d shouldBeGreaterThan 30.0
        d shouldBeLessThan 31.0
    }

    "같은 점 사이의 거리는 0" {
        distanceKm(33.5, 126.5, 33.5, 126.5) shouldBe 0.0
    }

    "거리는 방향과 무관하다(대칭)" {
        val ab = distanceKm(33.4996, 126.5312, 33.2440, 126.4120)
        val ba = distanceKm(33.2440, 126.4120, 33.4996, 126.5312)
        ab shouldBe ba
    }

    "covers — 반경 안은 포함, 밖은 제외" {
        // 제주시청↔중문 = 30.50km — 반경 31 은 품고 30 은 못 품는다
        Nearby.of(33.4996, 126.5312, 31.0)!!.covers(33.2440, 126.4120) shouldBe true
        Nearby.of(33.4996, 126.5312, 30.0)!!.covers(33.2440, 126.4120) shouldBe false
    }

    "covers — 중심 자기 자신은 언제나 포함" {
        Nearby.of(33.4996, 126.5312, 0.1)!!.covers(33.4996, 126.5312) shouldBe true
    }
})
