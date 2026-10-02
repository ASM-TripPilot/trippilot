package com.trippilot.app.persistence

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate

/**
 * 약관 시드 재발 잠금(TRIP-1004). "약관 본문이 전부 플레이스홀더" 가 실화면 QA 에서 **두 회차 연속**
 * 발견됐다(2026-09-25 #028 → 09-26 #003) — 시드는 고쳐도 이런 게이트가 없으면 또 조용히 돌아온다.
 *
 * R__ 시드는 체크섬이 바뀔 때 재실행되므로, 이 IT 는 "커밋된 시드가 실제로 본문을 심는다"를
 * 마이그레이션 직후 DB 에서 직접 확인한다.
 */
@SpringBootTest
class TermsSeedIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var jdbc: JdbcTemplate

    @Test
    fun `약관 6종 전부 실본문이 심겨 있다 - 플레이스홀더 0건`() {
        val required = setOf(
            "TERMS_OF_SERVICE", "PRIVACY_POLICY", "LOCATION_TERMS",
            "MARKETING", "GPS_RECORDING", "PERSONALIZATION",
        )
        val rows = jdbc.queryForList(
            "SELECT terms_type, body FROM terms_version WHERE version = '1.0'",
        ).associate { it["terms_type"] as String to it["body"] as String }

        rows.keys shouldBe required
        rows.forEach { (type, body) ->
            // "[플레이스홀더]" 가 본문 어디에도 없어야 한다 — 접두가 아니라 전체를 훑는다(부분 방치 차단).
            body.contains("플레이스홀더") shouldBe false
            // 실본문 하한 — 한 줄짜리 대체 문구로 게이트를 속이지 못하게. 가장 짧은 초안(개인화 동의)도 이보다 길다.
            withClue(type) { body.length shouldBeGreaterThan 500 }
        }
    }

    /**
     * md 정본 ↔ 시드 발효본 동기 게이트. 길이·플레이스홀더 검사는 **둘이 갈라지는 것**을 못 잡는다 —
     * 실화가 있다: #776 이 시드를 실은 다음 날 #767 이 md 에만 클릭 기록 행을 추가해, 발효본이
     * 클릭 수집을 고지하지 않는 채로 사흘 갔다(2026-10-02 발견). 수집 항목처럼 표로 적히는 내용이
     * 가장 잘 갈라지므로, **md 본문(검토용 절 이전)의 표 행 전부가 시드 본문에 그대로 있어야 한다.**
     */
    @Test
    fun `시드 발효본은 md 정본의 표 행을 전부 담는다 - 한쪽만 고치면 깨진다`() {
        val files = mapOf(
            "privacy-policy.md" to "PRIVACY_POLICY",
            "location-terms.md" to "LOCATION_TERMS",
            "terms-of-service.md" to "TERMS_OF_SERVICE",
            "gps-recording-consent.md" to "GPS_RECORDING",
            "marketing-consent.md" to "MARKETING",
            "personalization-consent.md" to "PERSONALIZATION",
        )
        val seeded = jdbc.queryForList(
            "SELECT terms_type, body FROM terms_version WHERE version = '1.0'",
        ).associate { it["terms_type"] as String to it["body"] as String }

        files.forEach { (file, type) ->
            val md = repoFile("backend/docs/legal/$file").readText()
                .substringBefore("[초안 검토용") // 대조표 절은 시드에 싣지 않는 것이 변환 규칙이다
            val tableRows = md.lines()
                .map(String::trim)
                .filter { it.startsWith("|") }
                // 구분선(|---|)과 머리행 장식은 내용이 아니다
                .filterNot { row -> row.all { it == '|' || it == '-' || it == ':' || it.isWhitespace() } }
            val body = seeded.getValue(type)
            tableRows.forEach { row ->
                withClue("$file 의 표 행이 시드($type)에 없다 — md 를 고쳤으면 시드도 고쳐라: $row") {
                    body.contains(row) shouldBe true
                }
            }
        }
    }

    /**
     * 리포 안 파일 — 실행 cwd 에 매이지 않게 위로 올라가며 찾는다.
     * `Paths.get("..", …)` 상대경로는 cwd 가정이 깨지는 순간 조용히 깨진다 —
     * 선례(`SeedDemoScriptIT.repoFile` · `StalePoiMigrationTest.repoRoot`)와 같은 형태로 맞췄다.
     */
    private fun repoFile(relative: String): java.io.File {
        var dir: java.io.File? = java.io.File(System.getProperty("user.dir"))
        while (dir != null) {
            val candidate = java.io.File(dir, relative)
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        error("파일을 찾지 못했습니다: $relative")
    }

    private fun withClue(clue: String, block: () -> Unit) = io.kotest.assertions.withClue(clue, block)
}
