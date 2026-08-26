package com.trippilot.app.export

import com.trippilot.core.export.AccountDataContributor
import com.trippilot.core.export.ExportSection
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * 내 데이터 내려받기 조립(TRIP-551 · G-U6-3).
 *
 * `app` 이 조립하는 이유는 [AccountDataContributor] 에 적었다 — 한 모듈이 여섯 모듈을 의존하지 않게
 * 하려는 것이다. 아웃박스 릴레이가 구독자를 모으는 것과 같은 꼴이다(TRIP-539).
 *
 * **한 트랜잭션에서 읽는다.** 몫마다 따로 읽으면 그 사이 변경이 끼어들어 서로 어긋난 스냅숏이 나간다 —
 * 여행은 지워졌는데 그 여행의 방문 기록은 실려 있는 파일이 된다.
 */
@Service
class AccountExportService(
    contributors: List<AccountDataContributor>,
    private val clock: Clock,
) {
    init {
        // 같은 자리에 둘이 쓰면 하나가 조용히 덮인다. 기동 때 드러내는 편이 낫다.
        val duplicated = contributors.groupBy { it.section }.filterValues { it.size > 1 }.keys
        require(duplicated.isEmpty()) { "내보내기 몫 이름이 겹칩니다: $duplicated" }
    }

    /** 이름순으로 고정 — 응답 순서가 실행마다 달라지면 받은 파일을 견주기 어렵다. */
    private val ordered = contributors.sortedBy { it.section }

    @Transactional(readOnly = true)
    fun export(accountId: UUID, perSectionLimit: Int = DEFAULT_SECTION_LIMIT): AccountExport {
        val limit = perSectionLimit.coerceIn(1, MAX_SECTION_LIMIT)
        val sections = ordered.map { it.export(accountId, limit) }
        return AccountExport(
            accountId = accountId,
            exportedAt = clock.instant(),
            sectionLimit = limit,
            // 어느 몫이 잘렸는지 **값으로** 알린다 — 조용히 자르면 받은 것이 전부인 줄 안다(INV-4).
            truncatedSections = sections.filter { it.truncated }.map { it.section },
            sections = sections,
        )
    }

    companion object {
        /** 몫당 기본 건수. 동기 응답이라 무한정 담을 수 없다. */
        const val DEFAULT_SECTION_LIMIT = 500

        /** 몫당 상한. 이걸 넘겨야 하면 비동기 내보내기가 필요하다는 신호다 — 그때 별도 안건으로 연다. */
        const val MAX_SECTION_LIMIT = 2_000
    }
}

/**
 * 내보내기 한 벌.
 *
 * @property truncatedSections 상한에 걸려 잘린 몫들. 비어 있으면 전부 다 실렸다는 뜻이다.
 */
data class AccountExport(
    val accountId: UUID,
    val exportedAt: Instant,
    val sectionLimit: Int,
    val truncatedSections: List<String>,
    val sections: List<ExportSection>,
)
