package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.PersonalizationHints
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

    // ── 기록 기반 개인화(toProfile)와의 합성 — 여행에서 명시적으로 비운 축은 개인화도 채우지 않는다 ──
    val hints = PersonalizationHints(listOf("야경", "시장"), "여유")
    val empty = PreferenceSnapshot(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null)

    "비운 축 — 개인화 힌트가 있어도 빈 값" {
        val trip = mapOf<String, Any?>("activities" to emptyList<String>(), "pace" to null)
        val profile = empty.overriddenBy(trip).toProfile(hints, trip.keys)
        profile.activities shouldBe emptyList()
        profile.pace shouldBe null
    }

    "키 없는 축 — 종전대로 개인화 보충" {
        val trip = mapOf<String, Any?>("styles" to listOf("미식"))
        val profile = empty.overriddenBy(trip).toProfile(hints, trip.keys)
        profile.activities shouldBe listOf("야경", "시장")
        profile.pace shouldBe "여유"
    }

    "값 있는 축 — 종전(활동은 고른 것 앞 합집합, 속도는 고른 값)" {
        val trip = mapOf<String, Any?>("activities" to listOf("시장", "등산"), "pace" to "알차게")
        val profile = empty.overriddenBy(trip).toProfile(hints, trip.keys)
        profile.activities shouldBe listOf("시장", "등산", "야경")
        profile.pace shouldBe "알차게"
    }

    "속성: 임의의 키 조합에서 명시된 빈 축은 항상 빈 값" {
        val hintArb = Arb.bind(words, Arb.string(0, 3).orNull()) { a, p -> PersonalizationHints(a, p) }
        checkAll(snapshot, snapshot, Arb.subsequence(keys), hintArb) { account, trip, present, view ->
            val tripMap = trip.axes().filterKeys { it in present }

            val profile = account.overriddenBy(tripMap).toProfile(view, tripMap.keys)

            if ("activities" in present && trip.activities.isEmpty()) profile.activities shouldBe emptyList()
            if ("pace" in present && trip.pace == null) profile.pace shouldBe null
        }
    }
})
