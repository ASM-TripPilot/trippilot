package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import tools.jackson.databind.json.JsonMapper
import java.io.File

/**
 * 폐업 POI 정리 마이그레이션의 **생성 대조**(TRIP-681).
 *
 * ## 이 방식의 유일한 위험은 생성 단계다
 *
 * 데이터를 API 가 아니라 마이그레이션으로 굳히기로 했으므로, 판정 자체는 AI 팀 것이고 우리 몫은
 * **그 판정을 빠뜨리거나 더하지 않고 옮겼는가** 하나다. 210건 중 200건만 붙여 넣어도 SQL 은
 * 멀쩡히 돌고 Flyway 도 초록이며, **빠진 10건은 계속 후보 풀에 남는다** — 아무도 모른다.
 *
 * 그래서 정본(`ai/data/poi_business_status.json`)과 SQL 의 id 집합을 **양방향으로** 견준다.
 * 한쪽만 보면(포함 관계) 더 넣은 것을 못 잡는데, 더 넣는 쪽이 더 나쁘다 — 멀쩡한 가게가 사라진다.
 *
 * ## 정본이 갱신되면 이 테스트가 깨진다 — 그게 맞다
 *
 * 월 1회 갱신마다 폐업 목록이 늘어난다. 그때 이 테스트가 빨개지는 것이 **다음 배치가 왔다는
 * 신호**다. 새 마이그레이션을 만들고 이 대조를 그쪽으로 옮긴다(또는 재발을 근거로 수신 경로를
 * 만든다 — V2.50 머리말의 판단).
 */
class StalePoiMigrationTest : StringSpec({

    val migration = File(repoRoot(), "backend/app/src/main/resources/db/migration/V2.50__close_stale_pois.sql")
        .also { require(it.isFile) { "마이그레이션을 찾지 못했습니다: $it" } }
        .readText()

    /** SQL 의 `IN (...)` 목록에 실린 id. 주석에 든 숫자가 섞이지 않게 **괄호 블록 안만** 본다. */
    val inSql: Set<String> = Regex("""source_ref IN \(([^)]*)\)""", RegexOption.DOT_MATCHES_ALL)
        .find(migration)!!
        .groupValues[1]
        .let { Regex("'([^']+)'").findAll(it).map { m -> m.groupValues[1] }.toSet() }

    val inSource: Set<String> = JsonMapper.builder().build()
        .readTree(File(repoRoot(), "ai/data/poi_business_status.json"))["status"]
        .properties()
        .filter { it.value["state"].asString() == "CLOSED" }
        .map { it.key }
        .toSet()

    "정본의 폐업 목록을 하나도 빠뜨리지 않는다" {
        (inSource - inSql).shouldBeEmpty()
    }

    /** 더 넣는 쪽이 더 나쁘다 — 멀쩡한 가게가 후보 풀에서 사라지고, 되돌릴 근거도 없다. */
    "정본에 없는 id 를 더하지 않는다" {
        (inSql - inSource).shouldBeEmpty()
    }

    /**
     * **`source` 를 반드시 좁힌다.** 조인 키는 TourAPI `content_id` 인데, 안 걸면 같은 숫자를
     * `source_ref` 로 쓰는 다른 벤더 수집분이 엉뚱하게 폐업 처리된다.
     */
    "TOURAPI 로 범위를 좁힌다" {
        migration.contains("source = 'TOURAPI'") shouldBe true
    }

    /** 건수를 머리말에도 적어 두는데, 목록과 어긋나면 읽는 사람이 틀린 수를 믿는다. */
    "머리말의 건수가 실제 목록과 같다" {
        migration.contains("폐업 POI ${inSql.size}건") shouldBe true
    }
})

/** 리포 루트 — 모듈 위치가 바뀌어도 견디도록 상대 깊이를 세지 않고 위로 올라가며 찾는다. */
private fun repoRoot(): File {
    var dir: File? = File(System.getProperty("user.dir"))
    while (dir != null) {
        if (File(dir, "ai/data/poi_business_status.json").isFile) return dir
        dir = dir.parentFile
    }
    error("리포 루트를 찾지 못했습니다. user.dir=${System.getProperty("user.dir")}")
}
