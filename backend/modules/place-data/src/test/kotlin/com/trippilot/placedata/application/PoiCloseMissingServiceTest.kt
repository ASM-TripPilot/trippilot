package com.trippilot.placedata.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ValidationFailed
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

    "문서에 없는 ACTIVE 행만 닫는다 — 삭제가 아니라 CLOSED 이고, 닫힌 시각이 남는다" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"))

        val result = PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, listOf("A", "B"))

        result shouldBe PoiCloseMissingResult(PoiSource.LOCALDATA, activeBefore = 3, present = 2, closed = 1)
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

        result shouldBe PoiCloseMissingResult(PoiSource.LOCALDATA, activeBefore = 4, present = 1, closed = 3)
        repo.row("A").dataStatus shouldBe DataStatus.ACTIVE
    }

    // 적재가 중간에 실패하면 같은 명령을 다시 돈다 — 두 번째 호출이 아무것도 바꾸지 않아야 그게 안전하다.
    "두 번 불러도 상태가 같다 — 두 번째는 아무것도 닫지 않고 닫힌 시각도 그대로다" {
        val repo = repoWith(poi("A"), poi("B"), poi("C"))
        PoiCloseMissingService(repo, clock).closeMissing(PoiSource.LOCALDATA, listOf("A", "B"))

        val second = PoiCloseMissingService(repo, later).closeMissing(PoiSource.LOCALDATA, listOf("A", "B"))

        second shouldBe PoiCloseMissingResult(PoiSource.LOCALDATA, activeBefore = 2, present = 2, closed = 0)
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

        result shouldBe PoiCloseMissingResult(PoiSource.LOCALDATA, activeBefore = 2, present = 2, closed = 0)
        repo.row("X").dataStatus shouldBe DataStatus.CLOSED
        repo.row("X").updatedAt shouldBe t0
        repo.row("U").dataStatus shouldBe DataStatus.UNVERIFIED
        repo.row("U").updatedAt shouldBe t0
    }

    // 아직 아무것도 안 부은 출처에 먼저 불러도 실패하지 않는다 — 0/0 을 "절반 미만"으로 읽지 않는다.
    "ACTIVE 가 없는 출처는 0 이다 — 빈 목록이어도 거부하지 않는다" {
        val repo = repoWith(poi("A", PoiSource.TOURAPI))

        PoiCloseMissingService(repo, clock).closeMissing(PoiSource.KAKAO_LOCAL, emptyList()) shouldBe
            PoiCloseMissingResult(PoiSource.KAKAO_LOCAL, activeBefore = 0, present = 0, closed = 0)
    }
})
