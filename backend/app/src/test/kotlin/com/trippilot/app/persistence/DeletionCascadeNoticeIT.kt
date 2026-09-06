package com.trippilot.app.persistence

import com.trippilot.auth.domain.CascadeSummary
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.withClue
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate

/**
 * 삭제 고지([CascadeSummary])가 **실 스키마와 함께 움직이는가**(BR-U6-25).
 *
 * 이 게이트가 생긴 이유: 고지 목록이 U1 시점에 동결된 채 **다섯 유닛이 지났다.** 원래 주석이
 * "새 유닛에서 개인정보 테이블을 추가하면 반드시 반영할 것"이라 경고했지만 아무도 못 봤다 —
 * 사람이 기억해야 하는 규칙은 지켜지지 않는다. 여기서는 information_schema 의 FK 를 직접 훑어,
 * **account 직결 CASCADE 테이블이 고지에 빠지면 마이그레이션을 넣은 그 PR 이 빨개진다.**
 */
@SpringBootTest
class DeletionCascadeNoticeIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var jdbc: JdbcTemplate

    /**
     * account 를 **직접** 참조하는 FK 와 delete 규칙. trip 연쇄 하위는 여기 안 잡힌다(별도 단언).
     *
     * information_schema 가 아니라 **pg_catalog 를 읽는다.** 처음 information_schema 3-뷰 조인으로
     * 짰을 때 이 질의가 **0행**을 돌려줬고, `빈 집합 − 고지 = 빈 집합` 이라 목록에서 테이블을 빼도
     * 테스트가 초록이었다(역검증 실측 — 이 리포가 반복해 겪는 "빈 질의 = 초록" 함정).
     * 아래 [accountFksAreVisible] 이 그 재발을 막는다.
     */
    private fun accountFks(): Map<String, String> = jdbc.queryForList(
        """
        SELECT conrelid::regclass::text AS table_name, confdeltype
        FROM pg_constraint
        WHERE contype = 'f' AND confrelid = 'account'::regclass
        """.trimIndent(),
    ).associate { (it["table_name"] as String) to (it["confdeltype"] as String) }

    /** 'c' = CASCADE (pg_constraint.confdeltype). */
    private fun Map<String, String>.cascading(): Set<String> = filterValues { it == "c" }.keys

    /**
     * **탐침 자체가 살아 있는가.** 질의가 조용히 0행이면 아래 모든 단정이 헛돈다 —
     * account 직결 FK 는 최소 열 개가 넘게 실재하므로, 그보다 적게 보이면 질의가 깨진 것이다.
     */
    @Test
    fun accountFksAreVisible() {
        withClue("account 직결 FK 질의가 ${accountFks().size}행 — 탐침이 스키마를 못 보고 있다") {
            (accountFks().size >= 10) shouldBe true
        }
    }

    @Test
    fun `account 직결 CASCADE 테이블은 전부 고지에 있다 — 파기 고지 누락은 법적 리스크다`() {
        val notice = CascadeSummary.forAccount().purgeScheduled.map { it.lowercase() }.toSet()
        val cascading = accountFks().cascading()

        val missing = cascading - notice - EXCLUDED
        withClue(
            "account 직결 CASCADE 인데 삭제 고지에 없는 테이블: $missing — " +
                "CascadeSummary.forAccount() 에 추가하거나, 고지 대상이 아니면 이 테스트의 EXCLUDED 에 " +
                "**사유와 함께** 넣으세요(BR-U6-25).",
        ) { missing shouldBe emptySet() }
    }

    @Test
    fun `법정 보존 테이블은 CASCADE 가 아니다 — 계정을 지워도 남아야 한다(INV-D3)`() {
        val fks = accountFks()
        CascadeSummary.forAccount().legallyRetained.map { it.lowercase() }.forEach { table ->
            // FK 자체가 없으면(계정과 물리 연결이 없으면) 그것도 보존이다 — CASCADE 만 아니면 된다.
            fks[table]?.let { rule ->
                withClue("$table 은 법정 보존인데 delete 규칙=$rule 이다('c'=CASCADE) — 계정 삭제가 증적을 지운다") {
                    (rule == "c") shouldBe false
                }
            }
        }
    }

    /**
     * trip 연쇄 하위는 위 질의에 안 잡힌다 — **고지는 사용자 기준**이라 BR-U6-25 가 명시한 범주가
     * 목록에 실제로 있는지 별도로 못 박는다. 이 단정이 없으면 "직결 FK 만 지키면 초록"이 되어
     * 방문 기록·회고류가 조용히 빠질 수 있다.
     */
    @Test
    fun `trip 연쇄 하위 범주도 고지에 있다 — BR-U6-25 의 열거 그대로`() {
        val notice = CascadeSummary.forAccount().purgeScheduled
        listOf("VISIT_CHECK", "VISIT_PHOTO_META", "VISIT_MEMO", "REFLECTION", "TRIP_SUMMARY", "ITINERARY")
            .forEach { notice shouldContain it }
    }

    private companion object {
        /**
         * 고지 대상이 아닌 account 직결 CASCADE — **넣을 때는 사유가 필수다.**
         * - refresh_session: 파기 "예약"이 아니라 삭제 요청 **즉시** 전 기기 폐기된다(TRIP-158)
         * - deletion_schedule: 삭제 절차 자체의 행 — 자기 자신을 고지할 이유가 없다
         */
        val EXCLUDED = setOf("refresh_session", "deletion_schedule")
    }
}
