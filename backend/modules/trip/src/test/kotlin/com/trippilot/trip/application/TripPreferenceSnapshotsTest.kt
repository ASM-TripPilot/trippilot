package com.trippilot.trip.application

import com.trippilot.trip.api.TripPreferenceSnapshot
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 자유 jsonb → api-safe 취향 정제.
 *
 * 이 정제가 없어서 소비처가 캐스팅을 떠안았고, 그 부담이 "타입 보증이 없다"는 이유로 값을
 * **통째로 안 읽는 선택**을 낳았다(재계획 설계 §2 이탈). 여기서 관용적으로 읽어 그 이유를 없앤다.
 */
class TripPreferenceSnapshotsTest : StringSpec({

    "클라이언트가 보낸 축을 읽는다 — 여덟 키 전부" {
        val snapshot = mapOf<String, Any?>(
            "styles" to listOf("액티비티", "휴양"),
            "activities" to listOf("등산"),
            "foodTastes" to listOf("고기"),
            "transportModes" to listOf("렌터카"),
            "companionTypes" to listOf("연인"),
            "pace" to "PACKED",
            "budgetTier" to "HIGH",
            "petFriendly" to true,
        ).toTripPreferences()

        snapshot shouldBe TripPreferenceSnapshot(
            styles = listOf("액티비티", "휴양"),
            activities = listOf("등산"),
            foodTastes = listOf("고기"),
            transportModes = listOf("렌터카"),
            companionTypes = listOf("연인"),
            pace = "PACKED",
            budgetTier = "HIGH",
            petFriendly = true,
        )
    }

    "빈 목록은 미설정이 아니다 — 전부 해제한 선택을 보존한다" {
        val snapshot = mapOf<String, Any?>("styles" to emptyList<String>()).toTripPreferences()

        snapshot.styles shouldBe emptyList()   // 고르지 않음(선택)
        snapshot.activities shouldBe null      // 미설정(키 부재)
    }

    "빈 맵은 빈 스냅숏 — 취향을 고르지 않은 여행이 정상이다" {
        emptyMap<String, Any?>().toTripPreferences() shouldBe TripPreferenceSnapshot.EMPTY
    }

    "타입이 틀린 값은 버린다 — 취향 하나 때문에 일정 생성이 죽지 않는다" {
        val snapshot = mapOf<String, Any?>(
            "styles" to "액티비티",          // 목록이어야 하는데 스칼라 → 읽을 수 없으니 미설정
            "pace" to listOf("PACKED"),     // 스칼라여야 하는데 목록
            "petFriendly" to "true",        // 불린이어야 하는데 문자열
        ).toTripPreferences()

        snapshot shouldBe TripPreferenceSnapshot.EMPTY
    }

    "목록인데 내용이 전부 쓸 수 없으면 빈 선택으로 남는다 — 목록을 보낸 것 자체는 사실이다" {
        mapOf<String, Any?>("activities" to listOf(1, 2)).toTripPreferences().activities shouldBe emptyList()
    }

    "모르는 키는 무시하고 아는 축만 남긴다" {
        val snapshot = mapOf<String, Any?>(
            "styles" to listOf("휴양"),
            "주술회전" to listOf("무엇이든"),
        ).toTripPreferences()

        snapshot shouldBe TripPreferenceSnapshot(styles = listOf("휴양"))
    }

    "빈 문자열·공백은 선택으로 치지 않는다 — 소비처가 계정 취향으로 보충하게 둔다" {
        val snapshot = mapOf<String, Any?>(
            "styles" to listOf("휴양", "  ", ""),
            "pace" to "   ",
        ).toTripPreferences()

        snapshot.styles shouldBe listOf("휴양")
        snapshot.pace shouldBe null
    }

    "목록 안 혼합은 문자열만 살린다" {
        val snapshot = mapOf<String, Any?>("activities" to listOf("등산", 3, null, "산책")).toTripPreferences()

        snapshot.activities shouldBe listOf("등산", "산책")
    }
})
