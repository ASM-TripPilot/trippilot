package com.trippilot.placedata.application

import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.FakeRegionCatalog
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiCursor
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import java.util.Base64
import java.util.UUID

/**
 * **상한과 커서가 실제로 걸리는가**(TRIP-503).
 *
 * 실 DB IT 로는 상한을 못 잰다 — 시드 POI 가 29건뿐이라 상한이 200 이든 10만이든 결과가 같아
 * 그 테스트는 **어떤 값이어도 통과한다**(역검증에서 상한 제거 변이가 안 잡혔다).
 * 여기서는 리포지토리에 **무엇을 요청했는지**를 직접 본다.
 */
class PoiQueryPagingTest : StringSpec({

    /** 요청한 인자만 기록하는 대역 — 결과는 이 테스트의 관심사가 아니다. */
    class Capturing : PoiRepository {
        var limit: Int? = null
        var after: PoiCursor? = null

        override fun findActive(
            regionCodes: List<String>,
            category: PoiCategory?,
            query: String,
            after: PoiCursor?,
            limit: Int,
        ): List<Poi> {
            this.limit = limit
            this.after = after
            return emptyList()
        }

        override fun saveAll(pois: List<Poi>) = pois
        override fun findById(poiId: UUID): Poi? = null
        override fun findActiveInBounds(latMin: Double, latMax: Double, lngMin: Double, lngMax: Double) = emptyList<Poi>()
        override fun findActiveByIds(poiIds: List<UUID>) = emptyList<Poi>()
        override fun findByIds(poiIds: List<UUID>) = emptyList<Poi>()
        override fun findBySourceRefs(source: PoiSource, sourceRefs: Collection<String>) = emptyMap<String, Poi>()
    }

    fun svc(repo: Capturing) = PoiQueryService(repo, RegionLookupService(FakeRegionCatalog))

    /** 지역을 안 골라도 전량이 나가면 안 된다(숙소 `UNSCOPED_LIMIT` 과 같은 fail-safe). */
    "상한을 요청하지 않아도 200 으로 막는다" {
        val repo = Capturing()

        svc(repo).search(region = null, category = null)

        // **하나 더** 물어본다 — 그 하나가 오면 뒤가 있다는 뜻이다(개수를 세지 않는다).
        repo.limit shouldBe 201
    }

    "상한을 넘겨 요청해도 200 으로 맞춘다" {
        val repo = Capturing()

        svc(repo).search(region = null, category = null, limit = 5_000)

        repo.limit shouldBe 201
    }

    "작은 상한은 그대로 쓴다" {
        val repo = Capturing()

        svc(repo).search(region = null, category = null, limit = 3)

        repo.limit shouldBe 4
    }

    /** 0·음수를 그대로 내려보내면 DB 가 예외를 던지거나 빈 목록이 조용히 나온다. */
    "0 이하 상한은 최소 1 로 올린다" {
        val repo = Capturing()

        svc(repo).search(region = null, category = null, limit = 0)

        repo.limit shouldBe 2
    }

    /** 커서가 리포지토리까지 **실제로 전달되는지** — 여기서 끊기면 매번 첫 장만 돌려준다. */
    "커서를 주면 그 지점을 리포지토리에 넘긴다" {
        val repo = Capturing()
        val raw = "감천문화마을" + SEP + "11111111-1111-4111-8111-111111111111"
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(raw.toByteArray())

        svc(repo).search(region = null, category = null, cursor = encoded)

        repo.after shouldNotBe null
        repo.after!!.nameKo shouldBe "감천문화마을"
    }

    "커서가 없으면 지점도 없다 — 처음부터다" {
        val repo = Capturing()

        svc(repo).search(region = null, category = null)

        repo.after shouldBe null
    }

    "망가진 커서는 거절한다 — 조용히 처음으로 되돌리지 않는다" {
        shouldThrow<ValidationFailed> {
            svc(Capturing()).search(region = null, category = null, cursor = "!!!broken!!!")
        }
    }
})

/** 서비스가 쓰는 구분자와 같은 값 — 이름에 나타나지 않는 문자다. */
private const val SEP = '\u001F'
