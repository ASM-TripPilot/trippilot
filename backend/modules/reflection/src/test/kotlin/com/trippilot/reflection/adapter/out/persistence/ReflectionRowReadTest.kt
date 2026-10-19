package com.trippilot.reflection.adapter.out.persistence

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.Reflection
import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.ReflectionStats
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * reflection 행 ↔ 도메인. 백엔드가 카드를 해석하는 **유일한 지점**이다(DEC-U5-14).
 *
 * - 근거 수치(`stats`)는 방어적으로 읽는다 — 옛 행에 없는 필드를 단정 캐스팅하면 그 여행의 회고가 영구히 500 이다.
 * - 카드의 템플릿은 **카드 자신의 payload** 에서 읽는다 — 컬럼(초안 값)을 쓰면 사용자가 고친 카드가 규칙 카드로 둔갑한다.
 * - 제목 없는 카드는 조용히 통과시키지 않는다(PBT-U5-F1).
 */
class ReflectionRowReadTest : StringSpec({

    val mapper = ObjectMapper()
    val trip = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-01")
    val t0 = Instant.parse("2026-08-01T12:00:00Z")

    fun entity(
        draft: Map<String, Any?> = mapOf("template_id" to "backend.rule.daily.v1", "format" to "CARD", "cover" to mapOf("title" to "초안", "subtitle" to "부")),
        edited: Map<String, Any?>? = null,
        stats: Map<String, Any?> = mapOf("visitCount" to 3, "distanceKm" to 4.5, "distanceSource" to "ROUTE", "photoCount" to 2),
        templateColumn: String = "backend.rule.daily.v1",
    ) = ReflectionEntity(
        UUID.randomUUID(), trip, day, draft, edited, templateColumn, "CARD", "RULE", stats, t0, t0,
    )

    fun read(e: ReflectionEntity): Reflection? {
        val jpa = mockk<ReflectionJpaRepository>()
        every { jpa.findByTripIdAndDayDate(trip, day) } returns e
        return ReflectionRepositoryAdapter(jpa, mapper).find(trip, day)
    }

    "근거 수치가 비었거나 타입이 틀린 옛 행은 0·VISIT_LINE 으로 읽는다 — 예외 없음" {
        read(entity(stats = emptyMap()))!!.stats shouldBe ReflectionStats.empty()
        read(entity(stats = mapOf("visitCount" to "3", "distanceKm" to "x", "distanceSource" to "TELEPORT", "photoCount" to null)))!!
            .stats shouldBe ReflectionStats.empty()
        read(entity(stats = mapOf("distanceSource" to 1)))!!.stats.distanceSource shouldBe DistanceSource.VISIT_LINE
    }

    "정상 수치는 그대로 읽힌다" {
        read(entity())!!.stats shouldBe ReflectionStats(3, 4.5, DistanceSource.ROUTE, 2)
    }

    "고친 카드의 템플릿은 컬럼(초안 값)이 아니라 고친 카드 payload 에서 온다" {
        // 컬럼을 두 카드 어느 쪽과도 다른 값으로 — 같으면 초안이 컬럼에서 읽어도 단정이 구분하지 못한다.
        val r = read(entity(
            edited = mapOf("template_id" to "user.edit.v1", "format" to "CARD", "cover" to mapOf("title" to "내 하루")),
            templateColumn = "column.only.v0",
        ))!!
        r.card.templateId shouldBe "user.edit.v1"
        r.card.title shouldBe "내 하루"
        r.draftCard.templateId shouldBe "backend.rule.daily.v1"
    }

    "템플릿·형식·부제가 없으면 빈 문자열로 읽는다 — 제목만 있으면 카드는 성립한다" {
        val card = read(entity(draft = mapOf("cover" to mapOf("title" to "제목만"))))!!.draftCard
        card.templateId shouldBe ""
        card.format shouldBe ""
        card.subtitle shouldBe ""
        card.title shouldBe "제목만"
    }

    "cover 가 없거나 객체가 아니면 제목이 비어 카드 생성이 실패한다 — 빈 줄을 목록에 그리지 않는다" {
        shouldThrow<IllegalArgumentException> { read(entity(draft = mapOf("template_id" to "x"))) }
        shouldThrow<IllegalArgumentException> { read(entity(draft = mapOf("cover" to "제목"))) }
    }

    "없는 하루는 null 이다" {
        val jpa = mockk<ReflectionJpaRepository>()
        every { jpa.findByTripIdAndDayDate(trip, day) } returns null
        ReflectionRepositoryAdapter(jpa, mapper).find(trip, day) shouldBe null
    }

    "기존 행이 있으면 그 행을 고친다 — id·처음 만든 시각은 그대로, 카드·형식·수정본·수치·메모는 새 값" {
        val existing = entity(edited = mapOf("template_id" to "user.edit.v1", "format" to "CARD", "cover" to mapOf("title" to "옛 수정본")))
            .apply { cardFormat = "LEGACY" }
        val jpa = mockk<ReflectionJpaRepository>()
        val saved = slot<ReflectionEntity>()
        every { jpa.findByTripIdAndDayDate(trip, day) } returns existing
        every { jpa.save(capture(saved)) } answers { saved.captured }

        val card = ReflectionCard("ai.daily.v2", "STORY", "새 초안", "", """{"template_id":"ai.daily.v2","format":"STORY","cover":{"title":"새 초안"}}""")
        val edited = ReflectionCard("user.edit.v1", "CARD", "새 수정본", "", """{"template_id":"user.edit.v1","format":"CARD","cover":{"title":"새 수정본"}}""")
        val incoming = Reflection.of(trip, day, card, ReflectionSource.AI, ReflectionStats(1, 0.5, DistanceSource.VISIT_LINE, 0), t0.plusSeconds(3600))
            .copy(mood = "happy", shortMemo = "좋았다", editedCard = edited)
        val out = ReflectionRepositoryAdapter(jpa, mapper).upsert(incoming)

        saved.captured shouldBe existing
        out.reflectionId shouldBe existing.reflectionId
        out.generatedAt shouldBe t0
        out.updatedAt shouldBe t0.plusSeconds(3600)
        out.draftCard.templateId shouldBe "ai.daily.v2"
        existing.templateId shouldBe "ai.daily.v2"
        existing.cardFormat shouldBe "STORY"
        out.editedCard!!.title shouldBe "새 수정본"
        out.source shouldBe ReflectionSource.AI
        out.stats shouldBe ReflectionStats(1, 0.5, DistanceSource.VISIT_LINE, 0)
        out.mood shouldBe "happy"
        out.shortMemo shouldBe "좋았다"
    }
})
