package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.PersonalizationHints
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.trip.api.TripPreferenceSnapshot
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 취향 세 출처의 합성 — 여행별 > 계정 > 기록(보탬).
 *
 * 이 규칙이 깨졌을 때의 증상이 조용하다: 일정은 정상적으로 나오고 오류도 없는데 **사용자가 고른
 * 취향만 반영되지 않는다**. 실제로 그 상태로 출하돼 AI 쪽에서 먼저 발견됐다(2026-10-05).
 */
class PreferenceProfilesTest : StringSpec({

    val account = PreferenceSnapshot(
        styles = listOf("휴양"),
        activities = listOf("산책"),
        foodTastes = listOf("해산물"),
        transportModes = listOf("대중교통"),
        pace = "BALANCED",
        companionTypes = listOf("친구"),
        petFriendly = false,
        budgetTier = "MID",
    )

    "여행에서 고른 취향이 계정 취향을 이긴다 — 여덟 축 전부" {
        val trip = TripPreferenceSnapshot(
            styles = listOf("액티비티"),
            activities = listOf("등산"),
            foodTastes = listOf("고기"),
            transportModes = listOf("렌터카"),
            companionTypes = listOf("연인"),
            pace = "PACKED",
            budgetTier = "HIGH",
            petFriendly = true,
        )

        val profile = account.toProfile(PersonalizationHints.NONE, trip)

        profile.styles shouldBe listOf("액티비티")
        profile.activities shouldBe listOf("등산")
        profile.foodTastes shouldBe listOf("고기")
        profile.transportModes shouldBe listOf("렌터카")
        profile.companionTypes shouldBe listOf("연인")
        profile.pace shouldBe "PACKED"
        profile.budgetTier shouldBe "HIGH"
        profile.petFriendly shouldBe true
    }

    "축을 전부 해제한 것은 선택이다 — 뺀 취향이 계정 값으로 되살아나지 않는다" {
        // 취향 시트에서 칩을 모두 끄면 클라이언트가 `[]` 를 명시적으로 싣는다(FE togglePrefStyle).
        val trip = TripPreferenceSnapshot(styles = emptyList())

        val profile = account.toProfile(PersonalizationHints.NONE, trip)

        profile.styles shouldBe emptyList()
        profile.activities shouldBe listOf("산책")   // 건드리지 않은 축은 계정 값 그대로
    }

    "여행이 고르지 않은 축은 계정 취향으로 채운다 — 한 축을 골랐다고 평소 취향 전부가 사라지지 않는다" {
        val trip = TripPreferenceSnapshot(styles = listOf("액티비티"))

        val profile = account.toProfile(PersonalizationHints.NONE, trip)

        profile.styles shouldBe listOf("액티비티")
        profile.activities shouldBe listOf("산책")
        profile.foodTastes shouldBe listOf("해산물")
        profile.transportModes shouldBe listOf("대중교통")
        profile.pace shouldBe "BALANCED"
        profile.companionTypes shouldBe listOf("친구")
        profile.petFriendly shouldBe false
        profile.budgetTier shouldBe "MID"
    }

    "여행별 취향이 없으면 종전과 같다 — 스냅숏 이전에 만든 여행이 달라지지 않는다" {
        val profile = account.toProfile(PersonalizationHints.NONE, TripPreferenceSnapshot.EMPTY)

        profile shouldBe account.toProfile(PersonalizationHints.NONE)
    }

    "기록 기반 개인화는 여행별 취향도 뒤집지 못한다 — 보태기만 한다" {
        val trip = TripPreferenceSnapshot(activities = listOf("등산"), pace = "PACKED")
        val hints = PersonalizationHints(activities = listOf("카페"), pace = "RELAXED")

        val profile = account.toProfile(hints, trip)

        profile.activities shouldBe listOf("등산", "카페")   // 고른 것이 앞, 기록은 뒤에 보탬
        profile.pace shouldBe "PACKED"                      // 스칼라는 고른 값이 이긴다
    }

    "스칼라 축도 여행별이 우선이고, 없으면 계정 → 기록 순으로 내려간다" {
        val empty = PreferenceSnapshot(
            styles = emptyList(), activities = emptyList(), foodTastes = emptyList(),
            transportModes = emptyList(), pace = null, companionTypes = emptyList(),
            petFriendly = false, budgetTier = null,
        )
        val hints = PersonalizationHints(activities = emptyList(), pace = "RELAXED")

        empty.toProfile(hints, TripPreferenceSnapshot(pace = "PACKED")).pace shouldBe "PACKED"
        empty.toProfile(hints, TripPreferenceSnapshot.EMPTY).pace shouldBe "RELAXED"
        account.toProfile(hints, TripPreferenceSnapshot.EMPTY).pace shouldBe "BALANCED"
    }
})
