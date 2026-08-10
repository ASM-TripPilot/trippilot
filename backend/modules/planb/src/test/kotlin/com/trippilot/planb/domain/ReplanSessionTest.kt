package com.trippilot.planb.domain

import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/**
 * 재계획 세션 상태 전이. `LOADING → PROPOSED → COMMITTED | CANCELED`, `COMMITTED → UNDONE`.
 * 전이를 도메인이 막지 않으면 영속 계층이 CHECK 로만 걸러 500 이 되고, 화면은 이유를 못 받는다.
 */
class ReplanSessionTest : StringSpec({

    val t0 = Instant.parse("2026-08-11T00:00:00Z")
    val t1 = Instant.parse("2026-08-11T00:00:30Z")
    fun loading() = ReplanSession.start(UUID.randomUUID(), ReplanReason.WEATHER, ReplanMode.AI, t0)

    "대안이 있으면 사유 없이 PROPOSED" {
        val s = loading().proposed(alternativeCount = 3, emptyReason = null, at = t1)
        s.status shouldBe ReplanStatus.PROPOSED
        s.emptyReason shouldBe null
        s.updatedAt shouldBe t1
    }

    "대안이 0건이면 사유가 있어야 한다 — 없으면 화면이 '로딩 중'과 구분하지 못한다" {
        shouldThrow<ValidationFailed> { loading().proposed(alternativeCount = 0, emptyReason = null, at = t1) }

        val s = loading().proposed(0, EmptyReason.NOT_AVAILABLE, t1)
        s.status shouldBe ReplanStatus.PROPOSED // 0건도 결과다 — LOADING 에 머물지 않는다
        s.emptyReason shouldBe EmptyReason.NOT_AVAILABLE
    }

    "대안이 있는데 사유가 들어오면 버린다 — 둘이 동시에 참일 수 없다" {
        loading().proposed(2, EmptyReason.NO_CANDIDATES, t1).emptyReason shouldBe null
    }

    "확정·취소·되돌리기는 허용된 상태에서만" {
        val proposed = loading().proposed(1, null, t1)
        proposed.committed(t1).status shouldBe ReplanStatus.COMMITTED
        proposed.canceled(t1).status shouldBe ReplanStatus.CANCELED
        loading().canceled(t1).status shouldBe ReplanStatus.CANCELED // 산출 중 취소도 가능

        shouldThrow<IllegalArgumentException> { loading().committed(t1) }          // 제안 전 확정 금지
        shouldThrow<IllegalArgumentException> { proposed.undone(t1) }              // 확정 전 되돌리기 금지
        shouldThrow<IllegalArgumentException> { proposed.committed(t1).canceled(t1) } // 확정 후 취소 금지
        shouldThrow<IllegalArgumentException> { proposed.proposed(1, null, t1) }   // 제안은 한 번
    }

    "되돌린 뒤에도 세션은 남는다 — 이력이 곧 근거다" {
        val undone = loading().proposed(1, null, t1).committed(t1).undone(t1)
        undone.status shouldBe ReplanStatus.UNDONE
        undone.isTerminal shouldBe true
        shouldThrow<IllegalArgumentException> { undone.undone(t1) } // 두 번 되돌리지 않는다
    }

    "종료 상태만 isTerminal — 새 세션을 열 수 있는지 판단하는 기준" {
        loading().isTerminal shouldBe false
        loading().proposed(1, null, t1).isTerminal shouldBe false // 사용자가 고르는 중이다
        loading().canceled(t1).isTerminal shouldBe true
        loading().proposed(1, null, t1).committed(t1).isTerminal shouldBe true
    }
})
