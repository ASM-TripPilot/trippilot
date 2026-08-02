package com.trippilot.placedata.domain

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** 위경도 거리(하버사인, m) — 순수. */
object Haversine {
    private const val EARTH_M = 6_371_000.0

    fun meters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * EARTH_M * asin(min(1.0, sqrt(a)))
    }
}

/**
 * 원(중심·반경)을 감싸는 위경도 상자 — 반경 검색의 프리필터. **상위집합 보장**(원 안 점을 절대 빠뜨리지 않음).
 * 여유 배율 + 더 극단 위도의 cos 사용으로 경계 오차를 흡수(정밀 컷은 하버사인이).
 */
data class BoundingBox(val latMin: Double, val latMax: Double, val lngMin: Double, val lngMax: Double) {
    fun contains(lat: Double, lng: Double): Boolean = lat in latMin..latMax && lng in lngMin..lngMax

    companion object {
        private const val M_PER_DEG_LAT = 111_320.0
        private const val MARGIN = 1.2 // 코너·cos 근사 오차 여유(상위집합 유지)

        fun around(lat: Double, lng: Double, radiusM: Double): BoundingBox {
            val latDelta = radiusM / M_PER_DEG_LAT * MARGIN
            // 상자 안 가장 극단 위도(적도에서 먼)의 cos → lngDelta 넉넉히
            val cosLat = cos(Math.toRadians(abs(lat) + latDelta)).coerceAtLeast(0.01)
            val lngDelta = radiusM / (M_PER_DEG_LAT * cosLat) * MARGIN
            return BoundingBox(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta)
        }
    }
}
