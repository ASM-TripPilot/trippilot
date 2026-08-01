package com.trippilot.accommodationsearch.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** 지구 평균 반지름(km). 하버사인은 구면 근사라 이 값 하나면 된다(타원체 보정은 이 용도에 과하다). */
private const val EARTH_RADIUS_KM = 6371.0

/**
 * 두 위경도 사이의 대권(大圓) 거리(km) — 하버사인(haversine) 공식.
 *
 * 위경도 차를 그냥 빼면 안 되는 이유: 경도 1도의 실제 거리는 위도에 따라 줄어든다
 * (적도에서 111km, 제주 위도에서 약 93km, 극점에서 0). 하버사인은 구면 위 두 점의
 * 최단 호(弧) 길이를 구해 그 왜곡을 없앤다.
 */
fun distanceKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = sin(dLat / 2).pow(2) +
        cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
    // 부동소수 오차로 a 가 1을 아주 살짝 넘으면 sqrt→asin 이 NaN 이 된다. 그 지점만 잘라 낸다.
    return 2 * EARTH_RADIUS_KM * asin(sqrt(a).coerceAtMost(1.0))
}

/**
 * '내 주변' 좌표 스코프(US-STAY-01 정상 · BR-U1-11).
 *
 * **왜 필드 3개가 아니라 값 객체인가**: lat 과 lng 는 짝이어야만 뜻이 있다. 셋을 각각
 * nullable 필드로 두면 "lat 만 있는 질의"가 타입상 표현 가능해지고, 그 상태를 매번
 * 방어해야 한다. 조립을 [of] 한 곳으로 모으면 그 상태는 애초에 만들어지지 않는다.
 *
 * 좌표는 **필터가 아니라 스코프**다 — `filterZeroReasons`(완화 제안) 대상이 아니다.
 * 사용자가 '내 주변'을 고른 상태에서 "위치 조건을 빼보라"는 제안은 요청을 무르라는 말이다.
 */
data class Nearby(val lat: Double, val lng: Double, val radiusKm: Double) {

    /** 대상 좌표가 반경 안(경계 포함)인가. */
    fun covers(targetLat: Double, targetLng: Double): Boolean =
        distanceKm(lat, lng, targetLat, targetLng) <= radiusKm

    companion object {
        /**
         * 서버 기본 반경. '내 주변'은 걸어서/짧은 이동 거리 안의 숙소를 뜻하므로 5km 로 둔다.
         * 값을 바꾸면 API 계약이 바뀌므로 openapi.yaml 의 `radiusKm` default 도 함께 고친다.
         */
        const val DEFAULT_RADIUS_KM = 5.0

        /**
         * 쿼리 파라미터 3개를 좌표 스코프로 조립한다.
         *
         * - 셋 다 없음 → `null` ('내 주변'이 아닌 평범한 탐색)
         * - lat·lng 둘 다 있음 → [Nearby] (radiusKm 생략 시 [DEFAULT_RADIUS_KM])
         * - 그 외 전부 → [ValidationFailed] → 400
         *
         * 부분 좌표를 조용히 "좌표 없음"으로 접지 않는 것이 요점이다. 그러면 사용자는
         * '내 주변'을 눌렀는데 전국 목록을 받고, 아무 데서도 실패가 드러나지 않는다(INV-4).
         */
        fun of(lat: Double?, lng: Double?, radiusKm: Double?): Nearby? {
            val errors = mutableListOf<FieldError>()

            if (lat == null && lng == null) {
                if (radiusKm == null) return null
                errors += FieldError("lat", "반경만으로는 조회할 수 없습니다. 중심 좌표가 필요합니다.")
                errors += FieldError("lng", "반경만으로는 조회할 수 없습니다. 중심 좌표가 필요합니다.")
            } else {
                if (lat == null) errors += FieldError("lat", "위도가 필요합니다. 위경도는 함께 보내야 합니다.")
                if (lng == null) errors += FieldError("lng", "경도가 필요합니다. 위경도는 함께 보내야 합니다.")
            }

            if (errors.isEmpty()) {
                // 여기 도달했으면 lat·lng 는 둘 다 non-null. 신뢰 경계라 값 범위도 검증한다.
                // `!in` 은 NaN·무한대도 함께 걸러 낸다(NaN 은 어떤 범위에도 속하지 않는다).
                if (lat!! !in -90.0..90.0) errors += FieldError("lat", "위도는 -90 ~ 90 이어야 합니다.")
                if (lng!! !in -180.0..180.0) errors += FieldError("lng", "경도는 -180 ~ 180 이어야 합니다.")
                if (radiusKm != null && (!radiusKm.isFinite() || radiusKm <= 0.0)) {
                    errors += FieldError("radiusKm", "반경은 0보다 큰 값이어야 합니다.")
                }
            }

            if (errors.isNotEmpty()) throw ValidationFailed(errors)
            return Nearby(lat!!, lng!!, radiusKm ?: DEFAULT_RADIUS_KM)
        }
    }
}
