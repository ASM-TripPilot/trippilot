package com.trippilot.recalculation.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/**
 * 세션 상태 전이(정본 §3.2).
 * `COLLECTING → SOLVING → DRAFT → APPLIED | CANCELED`, 실패는 `FAILED`(오류) · `NO_SOLUTION`(해 없음).
 *
 * 두 실패를 나눠 두는 이유: **사용자가 할 일이 다르다.** 오류는 재시도, 해 없음은 조건 완화다.
 * 하나로 뭉치면 화면이 어느 쪽 문구를 낼지 정할 수 없다.
 */
class ReplanSessionTest : StringSpec({

    val t0 = Instant.parse("2026-08-11T00:00:00Z")
    val t1 = Instant.parse("2026-08-11T00:00:30Z")
    val gps = ReplanOrigin(OriginKind.GPS, 33.45, 126.56)

    fun collecting() = ReplanSession.start(
        UUID.randomUUID(), UUID.randomUUID(), null, ReplanScope.PARTIAL_SLOTS, t0, gps,
        listOf("비"), listOf("실내로"), null, emptyList(), t0,
    )

    "정상 흐름 — COLLECTING → SOLVING → DRAFT → APPLIED" {
        val drafted = collecting().solving().drafted(mapOf("days" to emptyList<Any>()))
        drafted.status shouldBe ReplanStatus.DRAFT
        drafted.draft shouldBe mapOf("days" to emptyList<Any>())
        drafted.closedAt shouldBe null // 아직 열려 있다 — 사용자가 고르는 중

        val applied = drafted.applied(t1)
        applied.status shouldBe ReplanStatus.APPLIED
        applied.closedAt shouldBe t1
        applied.isOpen shouldBe false
    }

    "산출 전에는 draft 가 없다 — 확정 전 원 일정 무변경의 근거(INV-U4-05)" {
        collecting().draft shouldBe null
        collecting().solving().draft shouldBe null
    }

    "해 없음과 오류는 다른 상태다 — 사용자가 할 일이 다르다" {
        collecting().solving().noSolution(t1).status shouldBe ReplanStatus.NO_SOLUTION
        collecting().solving().failed(t1).status shouldBe ReplanStatus.FAILED
        // 오류는 산출 전에도 날 수 있다(입력 수집 중 외부 실패)
        collecting().failed(t1).status shouldBe ReplanStatus.FAILED
        // 해 없음은 풀어봤어야 말할 수 있다
        shouldThrow<IllegalArgumentException> { collecting().noSolution(t1) }
    }

    "취소는 열린 상태 어디서나 — 산출 중 이탈도 취소다" {
        collecting().canceled(t1).status shouldBe ReplanStatus.CANCELED
        collecting().solving().canceled(t1).status shouldBe ReplanStatus.CANCELED
        collecting().solving().drafted(emptyMap()).canceled(t1).status shouldBe ReplanStatus.CANCELED
    }

    "끝난 세션은 더 전이하지 않는다" {
        val applied = collecting().solving().drafted(emptyMap()).applied(t1)
        shouldThrow<IllegalArgumentException> { applied.canceled(t1) }
        shouldThrow<IllegalArgumentException> { applied.failed(t1) }
        shouldThrow<IllegalArgumentException> { collecting().canceled(t1).canceled(t1) }
        shouldThrow<IllegalArgumentException> { collecting().solving().drafted(emptyMap()).drafted(emptyMap()) }
        shouldThrow<IllegalArgumentException> { collecting().applied(t1) } // 제안 없이 확정 금지
    }

    "isOpen 은 COLLECTING·SOLVING·DRAFT — DB 부분 유니크 인덱스와 같은 집합이어야 한다" {
        collecting().isOpen shouldBe true
        collecting().solving().isOpen shouldBe true
        collecting().solving().drafted(emptyMap()).isOpen shouldBe true
        collecting().canceled(t1).isOpen shouldBe false
        collecting().solving().noSolution(t1).isOpen shouldBe false
        collecting().solving().failed(t1).isOpen shouldBe false
        collecting().solving().drafted(emptyMap()).applied(t1).isOpen shouldBe false
    }

    "닫힌 세션에는 닫힌 시각이 있고 열린 세션에는 없다 — DB CHECK 와 같은 규칙" {
        listOf(
            collecting(), collecting().solving(), collecting().solving().drafted(emptyMap()),
        ).forEach { it.closedAt shouldBe null }

        listOf(
            collecting().canceled(t1), collecting().failed(t1),
            collecting().solving().noSolution(t1), collecting().solving().drafted(emptyMap()).applied(t1),
        ).forEach { it.closedAt shouldBe t1 }
    }

    "GPS·수동 기준점에는 좌표가 필요하다 — 없으면 '어디서 출발하는지'를 모른다" {
        shouldThrow<IllegalArgumentException> { ReplanOrigin(OriginKind.GPS, null, null) }
        shouldThrow<IllegalArgumentException> { ReplanOrigin(OriginKind.MANUAL, 33.45, null) }
        // 마지막 방문지·숙소는 서버가 유도하므로 좌표 없이 올 수 있다
        ReplanOrigin(OriginKind.LAST_VISIT, null, null).kind shouldBe OriginKind.LAST_VISIT
        ReplanOrigin(OriginKind.STAY_ANCHOR, null, null).kind shouldBe OriginKind.STAY_ANCHOR
    }

    "GPS 가 아니면 추정 출발지 — 화면이 그 사실을 밝혀야 한다(US-PLANB-10)" {
        ReplanOrigin(OriginKind.GPS, 33.45, 126.56).isEstimated shouldBe false
        ReplanOrigin(OriginKind.MANUAL, 33.45, 126.56).isEstimated shouldBe true
        ReplanOrigin(OriginKind.LAST_VISIT, null, null).isEstimated shouldBe true
        ReplanOrigin(OriginKind.STAY_ANCHOR, null, null).isEstimated shouldBe true
    }
})
