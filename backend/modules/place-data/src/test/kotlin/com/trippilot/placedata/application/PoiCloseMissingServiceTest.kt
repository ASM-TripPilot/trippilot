package com.trippilot.placedata.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.FakeRegionCatalog
import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.set
import io.kotest.property.checkAll
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 원본에서 빠진 수집분 닫기(TRIP-1227).
 *
 * 지키는 것은 둘이다.
 * 1. **문서가 말하는 행만 닫는다** — 같은 출처·ACTIVE·식별자 있음. 나머지(다른 출처·시드·이미 닫힌 행)는
 *    이 문서와 무관하다. 잘못 닫으면 사용자에게는 멀쩡한 가게가 후보에서 사라지고 담기 목록에 폐업 배지가 붙는다.
 * 2. **부분 문서로는 닫지 않는다** — 청크 하나·다른 출처의 목록·회차 한 장을 "전부"로 받으면 출처가 통째로 닫힌다.
 */
class PoiCloseMissingServiceTest : StringSpec({

    val t0 = Instant.parse("2026-10-01T00:00:00Z")
    val clock: Clock = Clock.fixed(Instant.parse("2026-10-04T03:00:00Z"), ZoneOffset.UTC)
    val later: Clock = Clock.fixed(Instant.parse("2026-11-04T03:00:00Z"), ZoneOffset.UTC)

    fun poi(ref: String?, source: PoiSource = PoiSource.LOCALDATA, status: DataStatus = DataStatus.ACTIVE) =
        Poi.reconstitute(
            poiId = UUID.randomUUID(), nameKo = "식당-$ref", lat = 35.11, lng = 129.04, category = PoiCategory.맛집,
            region = "동구", openingHours = null, dataStatus = status, source = source, savedCount = 0,
            createdAt = t0, updatedAt = t0, sourceRef = ref,
        )

    fun repoWith(vararg pois: Poi) = InMemoryPoiRepository().apply { saveAll(pois.toList()) }

    fun InMemoryPoiRepository.row(ref: String, source: PoiSource = PoiSource.LOCALDATA) =
        stored.single { it.source == source && it.sourceRef == ref }

    fun InMemoryPoiRepository.allActive() = stored.all { it.dataStatus == DataStatus.ACTIVE }

    // 스크립트 순서를 재현할 때는 실제 수신 서비스로 붓는다 — 새 행이 어떤 상태로 생기는지까지 실물 규칙을 탄다.
    fun InMemoryPoiRepository.ingest(refs: Collection<String>) = PoiProposalIngestService(this, FakeRegionCatalog, clock)
        .ingest(
            PoiSource.LOCALDATA,
            refs.map {
                PoiProposal(
                    nameKo = "식당-$it", lat = 35.11, lng = 129.04, category = PoiCategory.맛집, region = "동구",
                    openingHours = null, sourceRef = it, address = "부산광역시 동구 초량동 1",
                )
            },
        )

    "문서에 없는 ACTIVE 행만 닫는다 — 삭제가 아니라 CLOSED 이고, 닫힌 시각이 남는다" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"))

        val result = PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, listOf("A", "B"))

        result shouldBe PoiCloseMissingResult(PoiSource.LOCALDATA, activeBefore = 3, present = 2, closed = 1, closedSourceRefs = listOf("C"))
        repo.row("C").dataStatus shouldBe DataStatus.CLOSED
        repo.row("C").updatedAt shouldBe clock.instant()
        repo.row("A").dataStatus shouldBe DataStatus.ACTIVE
        repo.row("B").dataStatus shouldBe DataStatus.ACTIVE
        repo.stored shouldHaveSize 3   // 담기·확정 스냅숏이 이 행을 가리킨다
    }

    // 식별자 체계는 벤더마다 독립이다 — 같은 문자열이어도 다른 출처의 행은 이 문서가 말하는 대상이 아니다.
    "다른 출처의 행은 같은 식별자라도 건드리지 않는다" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"), poi("C", PoiSource.TOURAPI), poi("Z", PoiSource.TOURAPI))

        val result = PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, listOf("A", "B"))

        result.activeBefore shouldBe 3   // 다른 출처는 세지도 않는다
        repo.row("C").dataStatus shouldBe DataStatus.CLOSED
        repo.row("C", PoiSource.TOURAPI).dataStatus shouldBe DataStatus.ACTIVE
        repo.row("Z", PoiSource.TOURAPI).dataStatus shouldBe DataStatus.ACTIVE
    }

    /**
     * 수동 등록분(시드)은 어떤 문서에서 온 것도 아니다. 식별자가 붙은 수동 행이 하나라도 있으면 "문서에 없음"으로
     * 닫히므로 출처 자체를 받지 않는다 — 대량 정리 플래그로도 열리지 않는다.
     */
    "MANUAL 은 거부한다 — 플래그로도 시드를 닫을 수 없다" {
        val repo = repoWith(poi(null, PoiSource.MANUAL), poi("M-1", PoiSource.MANUAL))

        val e = shouldThrow<ValidationFailed> {
            PoiCloseMissingService(repo, clock).closeMissing(PoiSource.MANUAL, emptyList(), allowMassClose = true)
        }

        e.fieldErrors.single().field shouldBe "source"
        repo.allActive() shouldBe true
    }

    "목록에 있는 것이 ACTIVE 의 절반 미만이면 아무것도 닫지 않고 거부한다 — 부분 문서 사고" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"), poi("D"))

        val e = shouldThrow<ConflictDetected> {
            PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, listOf("A"))   // 1/4
        }

        // 숫자로 드러낸다 — 운영자가 "얼마나 모자랐는지"를 보고 문서를 의심할 수 있어야 한다(INV-4).
        e.message!! shouldContain "ACTIVE 4건"
        e.message!! shouldContain "1건(25%)"
        repo.allActive() shouldBe true
    }

    /**
     * TourAPI 식별자 목록을 LOCALDATA 로 잘못 보낸 경우 — 목록 크기는 넉넉한데 하나도 안 맞물린다.
     * 크기로 재면 비율 가드를 통과해 출처 전량이 닫힌다.
     */
    "목록 크기가 아니라 맞물린 수로 잰다 — 다른 출처의 목록으로는 닫지 않는다" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"))

        shouldThrow<ConflictDetected> {
            PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, (1..100).map { "$it" })
        }

        repo.allActive() shouldBe true
    }

    "정확히 절반이 남으면 통과한다 — 기준은 '절반 미만'이다" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"), poi("D"))

        val result = PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, listOf("A", "B"))

        result.closed shouldBe 2
    }

    // 선별 기준이 바뀌어 정말 절반 넘게 빠지는 경우(공백 해소 등)가 있다 — 그때만 쓰는 문이다.
    "의도한 대량 정리는 명시 플래그로만 통과한다" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"), poi("D"))

        val result = PoiCloseMissingService(repo, clock)
            .closeMissing(PoiSource.LOCALDATA, listOf("A"), allowMassClose = true)

        result shouldBe PoiCloseMissingResult(PoiSource.LOCALDATA, activeBefore = 4, present = 1, closed = 3, closedSourceRefs = listOf("B", "C", "D"))
        repo.row("A").dataStatus shouldBe DataStatus.ACTIVE
    }

    // 적재가 중간에 실패하면 같은 명령을 다시 돈다 — 두 번째 호출이 아무것도 바꾸지 않아야 그게 안전하다.
    "두 번 불러도 상태가 같다 — 두 번째는 아무것도 닫지 않고 닫힌 시각도 그대로다" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"))
        PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, listOf("A", "B"))

        val second = PoiCloseMissingService(repo, later).closeMissing(PoiSource.LOCALDATA, listOf("A", "B"))

        second shouldBe PoiCloseMissingResult(PoiSource.LOCALDATA, activeBefore = 2, present = 2, closed = 0, closedSourceRefs = emptyList())
        repo.row("C").dataStatus shouldBe DataStatus.CLOSED
        repo.row("C").updatedAt shouldBe clock.instant()
    }

    /**
     * 상태는 수신이 덮지 않는 값이다(`Poi.refreshed`) — 사람이 내린 판단이거나 라이프사이클의 결과라서다.
     * 닫기도 같다: ACTIVE 만 대상이고, 이미 닫힌 행이 목록에 다시 나타나도 되살리지 않는다.
     */
    "이미 닫힌 행·미검증 행은 건드리지 않는다 — 목록에 다시 나타나도 되살리지 않는다" {
        val repo = repoWith(
            poi("A"), poi("B"),
            poi("X", status = DataStatus.CLOSED),
            poi("U", status = DataStatus.UNVERIFIED),   // 목록에 없지만 ACTIVE 가 아니다
        )

        val result = PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, listOf("A", "B", "X"))

        result shouldBe PoiCloseMissingResult(PoiSource.LOCALDATA, activeBefore = 2, present = 2, closed = 0, closedSourceRefs = emptyList())
        repo.row("X").dataStatus shouldBe DataStatus.CLOSED
        repo.row("X").updatedAt shouldBe t0
        repo.row("U").dataStatus shouldBe DataStatus.UNVERIFIED
        repo.row("U").updatedAt shouldBe t0
    }

    // 아직 아무것도 안 부은 출처에 먼저 불러도 실패하지 않는다 — 0/0 을 "절반 미만"으로 읽지 않는다.
    "ACTIVE 가 없는 출처는 0 이다 — 빈 목록이어도 거부하지 않는다" {
        val repo = repoWith(poi("A", PoiSource.TOURAPI))

        PoiCloseMissingService(repo, clock).closeMissing(PoiSource.KAKAO_LOCAL, emptyList()) shouldBe
            PoiCloseMissingResult(PoiSource.KAKAO_LOCAL, activeBefore = 0, present = 0, closed = 0, closedSourceRefs = emptyList())
    }

    // 운영자가 첫 실행 전에 보는 숫자다 — 드라이런이 말한 만큼만 실제로 닫혀야 그 숫자를 믿고 돌릴 수 있다.
    "드라이런은 아무것도 바꾸지 않고, 실제 실행과 같은 숫자와 식별자를 돌려준다" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"), poi("D"))
        val svc = PoiCloseMissingService(repo, clock)

        val dry = svc.closeMissing(PoiSource.LOCALDATA, listOf("A", "B", "C"), dryRun = true)

        dry shouldBe PoiCloseMissingResult(PoiSource.LOCALDATA, activeBefore = 4, present = 3, closed = 1, closedSourceRefs = listOf("D"))
        repo.allActive() shouldBe true
        svc.closeMissing(PoiSource.LOCALDATA, listOf("A", "B", "C")) shouldBe dry
        repo.row("D").dataStatus shouldBe DataStatus.CLOSED
    }

    "드라이런에도 비율 가드가 같다 — 실제로 거부될 호출은 드라이런도 409" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"), poi("D"))

        shouldThrow<ConflictDetected> {
            PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, listOf("A"), dryRun = true)
        }
        repo.allActive() shouldBe true
    }

    /**
     * 적재 스크립트가 닫기를 **적재 전에** 부르는 근거(리뷰 실측 재현). 식별자 체계가 통째로 바뀐 문서(수집기 회귀)를
     * 적재 전에 재면 기존 1,000건 중 0건이라 409 다. 적재 뒤에 재면 방금 만든 1,000행이 스스로를 "목록에 있음"으로 세어
     * 2,000 중 1,000(정확히 50%)으로 가드를 넘고 기존 행이 전부 닫힌다. 서버는 호출 순서를 모르므로 순서는 호출자 몫이다.
     */
    "적재 뒤에 재면 방금 만든 행이 자기를 세어 가드를 넘는다 — 그래서 닫기는 적재 전에 부른다" {
        val old = (1..1000).map { "OLD-$it" }
        val rekeyed = (1..1000).map { "NEW-$it" }

        val closeFirst = InMemoryPoiRepository().apply { ingest(old) }
        shouldThrow<ConflictDetected> { PoiCloseMissingService(closeFirst, clock).closeMissing(PoiSource.LOCALDATA, rekeyed) }
        closeFirst.allActive() shouldBe true

        val ingestFirst = InMemoryPoiRepository().apply { ingest(old); ingest(rekeyed) }
        val passed = PoiCloseMissingService(ingestFirst, clock).closeMissing(PoiSource.LOCALDATA, rekeyed)
        passed.present shouldBe 1000
        passed.closed shouldBe 1000
    }

    /**
     * 닫기를 적재 앞으로 옮겨도 되는 근거 — 적재는 목록 안의 행만 만들고 상태를 덮지 않으므로, 닫히는 행은 어느 쪽에서
     * 재든 "기존 ACTIVE 중 목록에 없는 것"이다. 목록은 문서 전체라 **적재가 중간에 끊겨도**(앞 일부만 들어가도) 같다.
     */
    "닫히는 집합은 적재 전후가 같다 — 닫은 뒤 적재가 중간에 끊겨도 같다" {
        checkAll(Arb.set(Arb.int(0..30), 0..20), Arb.set(Arb.int(0..30), 0..20), Arb.int(0..20)) { existing, listed, cut ->
            val doc = listed.map { "R$it" }

            fun closedRefs(closeFirst: Boolean, ingested: List<String>): Set<String> {
                val repo = InMemoryPoiRepository().apply { ingest(existing.map { "R$it" }) }
                val close = { PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, doc, allowMassClose = true) }
                if (closeFirst) { close(); repo.ingest(ingested) } else { repo.ingest(ingested); close() }
                return repo.stored.filter { it.dataStatus == DataStatus.CLOSED }.mapNotNull { it.sourceRef }.toSet()
            }

            closedRefs(closeFirst = true, ingested = doc.take(cut)) shouldBe closedRefs(closeFirst = false, ingested = doc)
        }
    }
})
