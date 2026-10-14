package com.trippilot.archive.domain

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 인코딩 폴리라인(Google 형식, 정밀도 1e-5) 디코드와 길이.
 *
 * **상한을 넘으면 디코드를 멈춘다**(SEC-U10-07) — 끝까지 풀고 나서 세면, 상한의 목적(큰 입력으로 자원을 태우는 것을 막기)이
 * 무너진다. 좌표는 길이를 재는 데만 쓰고 어디에도 남기지 않는다.
 */
object Polyline {
    data class Point(val lat: Double, val lng: Double)

    /** 상한을 넘었다. */
    class TooManyPoints : RuntimeException()

    /** 형식이 깨졌다(잘린 문자열 · 범위 밖 문자 · 위경도 범위 밖). */
    class Malformed : RuntimeException()

    /** 점 목록으로 푼다. 이미 푼 점 수 [already] 와 합쳐 [limit] 를 넘으면 [TooManyPoints]. */
    fun decode(encoded: String, limit: Int, already: Int = 0): List<Point> {
        val points = mutableListOf<Point>()
        var index = 0
        var lat = 0
        var lng = 0
        while (index < encoded.length) {
            if (already + points.size >= limit) throw TooManyPoints()
            val (dLat, next) = value(encoded, index)
            val (dLng, after) = value(encoded, next)
            index = after
            lat += dLat
            lng += dLng
            val p = Point(lat / 1e5, lng / 1e5)
            if (p.lat !in -90.0..90.0 || p.lng !in -180.0..180.0) throw Malformed()
            points += p
        }
        return points
    }

    /** 인접 점 사이 대원 거리의 합(m). */
    fun lengthM(points: List<Point>): Double = points.zipWithNext { a, b -> haversineM(a, b) }.sum()

    private fun value(s: String, start: Int): Pair<Int, Int> {
        var result = 0
        var shift = 0
        var i = start
        while (true) {
            // 유효한 좌표는 덩이 6개(30비트)면 된다 — 일곱째부터는 비트가 잘려 부호가 뒤집힐 수 있으니 받지 않는다.
            if (i >= s.length || shift > 25) throw Malformed()
            val b = s[i++].code - 63
            if (b !in 0..63) throw Malformed()
            result = result or ((b and 0x1f) shl shift)
            shift += 5
            if (b < 0x20) break
        }
        return (if (result and 1 != 0) (result shr 1).inv() else result shr 1) to i
    }

    private fun haversineM(a: Point, b: Point): Double {
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLng = Math.toRadians(b.lng - a.lng)
        val h = sin(dLat / 2).pow(2) + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLng / 2).pow(2)
        return 2 * EARTH_RADIUS_M * asin(sqrt(minOf(1.0, h))) // 대척점 근처에서 반올림이 1 을 넘어 NaN 이 되지 않게
    }

    private const val EARTH_RADIUS_M = 6_371_008.8
}
