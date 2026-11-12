package com.trippilot.reflection.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.ReflectionStats
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldStartWith
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.of
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll

/**
 * 규칙 카드의 목적격 조사(TRIP-1815). AI 가 실패하면 이 문장이 실사용자에게 간다 — 「064바당 을(를) 다녀왔어요」처럼
 * 병기 원문을 보이지 않는다. 읽는 법을 아는 끝 글자(한글 음절)에서만 고르고, 모르면 틀린 조사 대신 병기를 남긴다.
 */
class ReflectionNarratorParticleTest : StringSpec({

    val stats = ReflectionStats(visitCount = 1, photoCount = 0, distanceKm = 0.0, distanceSource = DistanceSource.VISIT_LINE)

    /** 음절 코드 = 0xAC00 + (초성 × 21 + 중성) × 28 + 종성. 종성 0 이 받침 없음이다. */
    fun syllable(cho: Int, jung: Int, jong: Int) = (0xAC00 + (cho * 21 + jung) * 28 + jong).toChar()

    val nonHangulEndings = Arb.of('0', '9', 'a', 'Z', ')', '.', 'ㅋ', 'ㅏ', '!', '☕')

    "한글로 끝나면 종성이 있을 때 을, 없을 때 를 — 병기를 남기지 않는다" {
        checkAll(Arb.string(0..8), Arb.int(0..18), Arb.int(0..20), Arb.int(0..27)) { head, cho, jung, jong ->
            val name = head + syllable(cho, jung, jong)
            val particle = if (jong == 0) "를" else "을"

            ReflectionNarrator.daily(listOf(name), stats) shouldStartWith "$name$particle 다녀왔어요."
        }
    }

    "한글 음절로 끝나지 않으면 읽는 법을 몰라 을(를) 을 유지한다" {
        checkAll(Arb.string(0..8), nonHangulEndings) { head, end ->
            val name = "$head$end"

            ReflectionNarrator.daily(listOf(name), stats) shouldStartWith "$name" + "을(를) 다녀왔어요."
        }
    }

    "여러 곳을 · 로 이으면 마지막 이름이 조사를 정한다" {
        checkAll(Arb.of("성산일출봉", "제주바다", "CGV"), Arb.int(0..27)) { first, jong ->
            val last = "카" + syllable(0, 0, jong)
            val particle = if (jong == 0) "를" else "을"

            ReflectionNarrator.daily(listOf(first, last), stats) shouldStartWith "$first·$last$particle 다녀왔어요."
        }
    }

    "넷 이상이면 끝말이 외 N곳 이라 을 이다" {
        ReflectionNarrator.daily(listOf("가", "나", "다", "라", "마"), stats) shouldStartWith "가·나·다 외 2곳을 다녀왔어요."
    }

    "이름을 모르면 N곳 이라 을 이다" {
        ReflectionNarrator.daily(emptyList(), stats.copy(visitCount = 3)) shouldStartWith "3곳을 다녀왔어요."
    }

    "장면 캡션도 장소마다 같은 규칙이다" {
        val card = ReflectionNarrator.dailyCard(listOf("064바당", "제주바다", "CGV"), stats.copy(visitCount = 3))

        val captions = ObjectMapper().readTree(card.payload)["scenes"].map { it["caption"].asText() }

        captions shouldBe listOf("064바당을 다녀왔어요.", "제주바다를 다녀왔어요.", "CGV을(를) 다녀왔어요.")
    }
})
