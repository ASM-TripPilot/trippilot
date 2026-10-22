package com.trippilot.placedata.application

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiCursor
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSearchOrder
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.util.Base64
import java.util.UUID

/**
 * POI 조회(C7) — 탐색 랜딩(US-EXPL-01)용. **ACTIVE만**(INV-U1-01) 지역·카테고리·이름 필터.
 * 반경/취향 후보풀(CandidatePoolPort)은 TRIP-213.
 */
@Service
class PoiQueryService(
    private val repo: PoiRepository,
    private val regions: RegionLookupFacade,
) {
    /**
     * @param region 지역 **이름**(표준명·별칭 모두). 화면이 코드를 들고 다니지 않아도 되게 이름을 받고,
     *   코드로의 해석은 여기서 한다 — 숙소 검색(`DbContentAdapter`)과 같은 계약 모양이다.
     * @param query 이름 부분일치. **서버가 검색한다** — 클라가 받은 페이지 안에서만 거르면
     *   "없다"가 거짓이 된다(뒷장에 있는데 안 보인다).
     * @param cursor 이전 응답의 [PoiPage.nextCursor]. 없으면 처음부터.
     * @param limit 요청 상한. 미지정·초과는 [MAX_LIMIT] 로 맞춘다.
     * @param order `name`(기본, TRIP-1003) | `random`(TRIP-1570). random 이면 [seed] 가 필수다.
     * @param seed 무작위 정렬 시드 — 화면이 한 진입 동안 고정해 장을 이어 받는다. 같은 seed 면 같은 순서.
     */
    fun search(
        region: String?,
        category: PoiCategory?,
        query: String? = null,
        cursor: String? = null,
        limit: Int? = null,
        order: String? = null,
        seed: String? = null,
    ): PoiPage {
        val randomSeed = resolveSeed(order, seed)
        val codes = resolveRegion(region) ?: return PoiPage(emptyList(), null)
        val size = (limit ?: MAX_LIMIT).coerceIn(1, MAX_LIMIT)

        // 상한보다 **하나 더** 물어본다 — 그 하나가 오면 뒤가 있다는 뜻이다.
        // 전체 개수를 세는 것보다 싸고, 개수는 어차피 화면이 쓰지 않는다.
        val q = query?.trim().orEmpty()
        val fetched = repo.findActive(codes, category, q, decode(cursor), size + 1, randomSeed)
        val items = fetched.take(size)
        // 커서 재료(관련도·정렬키)는 도메인 식으로 만든다 — DB 정렬식과 같아야 이어받기가 산다(PoiSearchOrder KDoc).
        val next = if (fetched.size > size) {
            items.lastOrNull()?.let { encode(PoiCursor(PoiSearchOrder.rank(q, it.nameKo), PoiSearchOrder.key(it.nameKo, it.poiId, randomSeed), it.poiId)) }
        } else null
        return PoiPage(items, next)
    }

    /**
     * 장소 한 곳(TRIP-824) — 상세 화면이 **목록을 거치지 않고** 여는 길.
     *
     * **ACTIVE 만으로 거르지 않는다.** 목록은 ACTIVE 만 내지만(INV-U1-01 — 새로 고를 수 있는 곳), 상세는 이미
     * 알고 있는 장소를 다시 여는 화면이다. 담아 둔 곳이 폐업(`CLOSED`)하거나 원본에서 빠지면(`LOST`) 목록에서는
     * 사라지는데, 상세까지 404 를 내면 사용자는 담은 장소가 왜 안 열리는지 모른다. `dataStatus` 를 실어
     * 화면이 말하게 한다. 둘 다 **한때 ACTIVE 였던**, 게이트를 통과한 데이터다.
     *
     * **`UNVERIFIED` 는 없는 것으로 답한다** — 수집 게이트를 통과한 적이 없는 행이라 어느 조회에도 나오면
     * 안 된다(INV-1). 지금 이 상태를 쓰는 코드 경로는 없지만(컬럼 기본값이라 SQL 직접 삽입에서만 생긴다),
     * 열어 두면 게이트가 id 하나로 우회된다.
     */
    fun get(poiId: UUID): Poi =
        repo.findById(poiId)?.takeIf { it.dataStatus != DataStatus.UNVERIFIED } ?: throw ResourceNotFound()

    /**
     * **후보풀용 — 화면 상한을 적용하지 않는다.**
     *
     * 탐색 목록의 상한(200)은 화면이 한 번에 그릴 수 있는 규모를 넘지 않게 하려는 값이다. 같은 값을
     * AI 후보풀에 걸면 **닫힌 집합(INV-1)이 조용히 줄어** 생성 품질이 나빠지는데, 그 증상은
     * "추천이 좀 아쉽다"로만 보여 원인을 못 찾는다. 그래서 경로를 나눈다.
     *
     * 그래도 무한은 아니다 — 상한에 닿으면 로그로 드러낸다(침묵 금지).
     */
    fun allIn(region: String?, category: PoiCategory?): List<Poi> {
        val codes = resolveRegion(region) ?: return emptyList()
        val found = repo.findActive(codes, category, "", null, POOL_LIMIT)
        if (found.size == POOL_LIMIT) {
            log.warn("후보풀이 상한에 닿았습니다 — 닫힌 집합이 잘렸을 수 있습니다. region={} limit={}", region, POOL_LIMIT)
        }
        return found
    }

    /**
     * 정렬 모드 → 무작위 시드(null = 이름순).
     *
     * **seed 없는 random 은 거절한다.** 이름순으로 조용히 떨어뜨리면 화면은 그것을 "무작위"로 그린다 —
     * 사용자에게는 "섞었다는데 왜 늘 ㄱ부터냐"로만 보인다. 허용 문자를 좁히는 것은 seed 가 그대로 SQL
     * 인자(md5 입력)로 가기 때문이다 — NUL 은 PostgreSQL 에서 500 이었다(커서의 TRIP-1473 과 같은 자리).
     */
    private fun resolveSeed(order: String?, seed: String?): String? = when (order?.trim()?.ifEmpty { null }) {
        null, ORDER_NAME -> null
        ORDER_RANDOM -> seed?.takeIf { SEED_PATTERN.matches(it) }
            ?: throw ValidationFailed(listOf(FieldError("seed", "무작위 정렬에는 1~64자 영숫자·_·- seed 가 필요합니다.")))
        else -> throw ValidationFailed(listOf(FieldError("order", "정렬은 name 또는 random 입니다.")))
    }

    /** null = 지역을 안 걸렀다. 빈 목록 = **모르는 이름**이라 결과가 없다. */
    private fun resolveRegion(region: String?): List<String>? {
        val key = region?.trim().orEmpty()
        if (key.isEmpty()) return emptyList()

        // 동명이지역이 있다 — '동구'는 대전·대구·광주·부산에 다 있고 '고성'은 경남·강원 둘이다.
        // 하나를 고르면 거짓이므로 전부를 대상으로 삼는다(숙소와 같은 판단).
        val codes = regions.codesOf(key)

        // **모르는 이름은 빈 결과다.** 여기서 지역 조건을 떨어뜨리면 전국이 나가는데, 화면은 그것을
        // "그 지역 장소"로 표시한다 — 조용히 틀린 목록을 보여주느니 없다고 말하는 편이 맞다.
        return if (codes.isEmpty()) null else codes
    }

    /**
     * 커서는 **불투명 문자열**이다. 정렬 키를 그대로 노출하면 클라가 그 모양에 기대게 되고,
     * 정렬 기준을 바꾸는 순간 남의 코드가 깨진다.
     */
    private fun encode(c: PoiCursor): String =
        Base64.getUrlEncoder().withoutPadding()
            .encodeToString("${c.rank}$SEP${c.sortKey}$SEP${c.poiId}".toByteArray())

    /** 망가진 커서는 **거절한다**. 처음부터로 되돌리면 사용자는 목록이 리셋된 이유를 알 수 없다. */
    private fun decode(cursor: String?): PoiCursor? {
        if (cursor.isNullOrBlank()) return null
        return runCatching {
            val raw = String(Base64.getUrlDecoder().decode(cursor))
            // 풀린 정렬 키가 그대로 SQL 인자로 간다 — NUL 은 요청 관문(NUL 거부)을 base64 로 지나와 PostgreSQL 에서 500 이었다(TRIP-1473).
            require('\u0000' !in raw)
            val first = raw.indexOf(SEP)
            val last = raw.lastIndexOf(SEP)
            require(first in 1 until last)
            PoiCursor(raw.substring(0, first).toInt(), raw.substring(first + 1, last), UUID.fromString(raw.substring(last + 1)))
        }.getOrElse { throw ValidationFailed(listOf(FieldError("cursor", "커서 형식이 올바르지 않습니다."))) }
    }

    private companion object {
        /** 지역을 안 골라도 전량이 나가지 않게(숙소 `UNSCOPED_LIMIT` 과 같은 fail-safe 방향). */
        private val log = LoggerFactory.getLogger(PoiQueryService::class.java)

        private const val MAX_LIMIT = 200

        /** 후보풀 상한 — 실측 전국 ACTIVE 가 1천 대라 한 지역이 여기 닿으면 데이터 쪽을 봐야 한다. */
        private const val POOL_LIMIT = 5_000
        private const val SEP = '\u001F' // 이름에 나타나지 않는 구분자

        private const val ORDER_NAME = "name"
        private const val ORDER_RANDOM = "random"
        private val SEED_PATTERN = Regex("[A-Za-z0-9_-]{1,64}")
    }
}

/**
 * 목록 한 장(TRIP-503).
 *
 * @property nextCursor 다음 장의 지점. **null 이 아니면 이것이 전부가 아니라는 뜻**이다 —
 *   뒤따르는 클라 필터가 부분집합 위에서 도는 것을 숨기지 않는다.
 */
data class PoiPage(val items: List<Poi>, val nextCursor: String?)
