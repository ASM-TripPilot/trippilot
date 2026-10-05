package com.trippilot.itinerarygeneration.application

import com.trippilot.profile.api.PreferenceSnapshot
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.orNull
import io.kotest.property.arbitrary.string
import io.kotest.property.arbitrary.subsequence
import io.kotest.property.checkAll

/**
 * 여행 취향 덮기(BR-U1-38) — "키가 있으면 그 값(빈 값 포함), 없으면 계정 값"이 축마다 독립으로 성립한다.
 */
class PreferenceOverlayPropertyTest : StringSpec({
    val words = Arb.list(Arb.string(0, 4), 0..3)
    val snapshot = Arb.bind(words, words, words, words, Arb.string(0, 3).orNull(), words, Arb.boolean(), Arb.string(0, 3).orNull()) {
            s, a, f, t, p, c, pet, b -> PreferenceSnapshot(s, a, f, t, p, c, pet, b)
    }
    val keys = listOf("styles", "activities", "foodTastes", "transportModes", "pace", "companionTypes", "petFriendly", "budgetTier")

    fun PreferenceSnapshot.axes(): Map<String, Any?> = mapOf(
        "styles" to styles, "activities" to activities, "foodTastes" to foodTastes, "transportModes" to transportModes,
        "pace" to pace, "companionTypes" to companionTypes, "petFriendly" to petFriendly, "budgetTier" to budgetTier,
    )

    "실린 축은 여행 값, 안 실린 축은 계정 값" {
        checkAll(snapshot, snapshot, Arb.subsequence(keys)) { account, trip, present ->
            val tripMap = trip.axes().filterKeys { it in present }

            val result = account.overriddenBy(tripMap).axes()

            keys.forEach { k -> result[k] shouldBe if (k in present) trip.axes()[k] else account.axes()[k] }
        }
    }

    "모양이 틀린 값은 빈 값으로 읽는다 — 자유 맵이라 지어내지 않는다" {
        val account = PreferenceSnapshot(listOf("미식"), emptyList(), emptyList(), emptyList(), "알차게", emptyList(), true, "고급")
        val result = account.overriddenBy(mapOf("styles" to "미식", "pace" to 3, "petFriendly" to "yes", "activities" to listOf("야경", 1)))
        result.styles shouldBe emptyList()
        result.pace shouldBe null
        result.petFriendly shouldBe false
        result.activities shouldBe listOf("야경")
        result.budgetTier shouldBe "고급"
    }
})
