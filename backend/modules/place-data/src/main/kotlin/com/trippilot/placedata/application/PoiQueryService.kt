package com.trippilot.placedata.application

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiCursor
import com.trippilot.placedata.domain.PoiRepository
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
     */
    fun search(
        region: String?,
        category: PoiCategory?,
        query: String? = null,
        cursor: String? = null,
        limit: Int? = null,
    ): PoiPage {
        val codes = resolveRegion(region) ?: return PoiPage(emptyList(), null)
        val size = (limit ?: MAX_LIMIT).coerceIn(1, MAX_LIMIT)

        // 상한보다 **하나 더** 물어본다 — 그 하나가 오면 뒤가 있다는 뜻이다.
        // 전체 개수를 세는 것보다 싸고, 개수는 어차피 화면이 쓰지 않는다.
        val fetched = repo.findActive(codes, category, query?.trim().orEmpty(), decode(cursor), size + 1)
        val items = fetched.take(size)
        val next = if (fetched.size > size) items.lastOrNull()?.let { encode(PoiCursor(it.nameKo, it.poiId)) } else null
        return PoiPage(items, next)
    }

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
            .encodeToString("${c.nameKo}$SEP${c.poiId}".toByteArray())

    /** 망가진 커서는 **거절한다**. 처음부터로 되돌리면 사용자는 목록이 리셋된 이유를 알 수 없다. */
    private fun decode(cursor: String?): PoiCursor? {
        if (cursor.isNullOrBlank()) return null
        return runCatching {
            val raw = String(Base64.getUrlDecoder().decode(cursor))
            val at = raw.lastIndexOf(SEP)
            PoiCursor(raw.substring(0, at), UUID.fromString(raw.substring(at + 1)))
        }.getOrElse { throw ValidationFailed(listOf(FieldError("cursor", "커서 형식이 올바르지 않습니다."))) }
    }

    private companion object {
        /** 지역을 안 골라도 전량이 나가지 않게(숙소 `UNSCOPED_LIMIT` 과 같은 fail-safe 방향). */
        private val log = LoggerFactory.getLogger(PoiQueryService::class.java)

        private const val MAX_LIMIT = 200

        /** 후보풀 상한 — 실측 전국 ACTIVE 가 1천 대라 한 지역이 여기 닿으면 데이터 쪽을 봐야 한다. */
        private const val POOL_LIMIT = 5_000
        private const val SEP = '\u001F' // 이름에 나타나지 않는 구분자
    }
}

/**
 * 목록 한 장(TRIP-503).
 *
 * @property nextCursor 다음 장의 지점. **null 이 아니면 이것이 전부가 아니라는 뜻**이다 —
 *   뒤따르는 클라 필터가 부분집합 위에서 도는 것을 숨기지 않는다.
 */
data class PoiPage(val items: List<Poi>, val nextCursor: String?)
