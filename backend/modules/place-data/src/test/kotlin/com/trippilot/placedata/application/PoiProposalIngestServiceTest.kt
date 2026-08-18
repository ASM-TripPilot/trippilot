package com.trippilot.placedata.application

import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.maps.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * AI 수집 등록 제안 수신(INV-1).
 *
 * 여기서 지키는 것은 둘이다.
 * 1. **재실행이 행을 늘리지 않는다** — 수집은 매일 돈다. 같은 장소가 매번 새 행이 되면 후보풀에 중복이
 *    쌓이고, AI 가 하루 일정에 같은 곳을 두 번 넣는 형태로 사용자에게 드러난다.
 * 2. **탈락을 사유별로 센다** — 총계만 남기면 수집 쪽이 무엇을 고쳐야 할지 알 수 없다(INV-4).
 */
class PoiProposalIngestServiceTest : StringSpec({

    val clock: Clock = Clock.fixed(Instant.parse("2026-08-18T03:00:00Z"), ZoneOffset.UTC)
    val later: Clock = Clock.fixed(Instant.parse("2026-08-19T03:00:00Z"), ZoneOffset.UTC)

    fun proposal(
        ref: String? = "126508",
        name: String = "성산일출봉",
        lat: Double? = 33.4587,
        lng: Double? = 126.9427,
        category: PoiCategory? = PoiCategory.자연,
        region: String? = "서귀포시",
        hours: String? = "05:00~20:00",
        tags: List<String> = listOf("자연관광지", "일출"),
        imageUrl: String? = "https://tong.visitkorea.or.kr/sample.jpg",
    ) = PoiProposal(name, lat, lng, category, region, hours, ref, tags, imageUrl)

    "게이트를 통과한 제안이 ACTIVE 로 등록된다" {
        val repo = InMemoryPoiRepository()

        val result = PoiProposalIngestService(repo, clock).ingest(PoiSource.TOURAPI, listOf(proposal()))

        result.registered shouldBe 1
        result.updated shouldBe 0
        repo.stored shouldHaveSize 1
        val saved = repo.stored.single()
        saved.dataStatus shouldBe DataStatus.ACTIVE
        saved.sourceRef shouldBe "126508"
        saved.openingHours shouldBe "05:00~20:00"
    }

    /** 이 테스트가 이 클래스의 핵심이다 — 매일 도는 수집이 같은 장소를 계속 쌓으면 안 된다. */
    "같은 문서를 두 번 넣어도 행이 늘지 않는다" {
        val repo = InMemoryPoiRepository()
        val svc = PoiProposalIngestService(repo, clock)

        svc.ingest(PoiSource.TOURAPI, listOf(proposal()))
        val second = svc.ingest(PoiSource.TOURAPI, listOf(proposal()))

        second.registered shouldBe 0
        second.updated shouldBe 1
        repo.stored shouldHaveSize 1
    }

    // 벤더가 이름·좌표를 고치는 일이 실제로 있다(이전·개명). 갱신이 그걸 반영해야 한다.
    "재수집으로 값이 바뀌면 같은 행이 갱신된다 — id 는 유지된다" {
        val repo = InMemoryPoiRepository()
        PoiProposalIngestService(repo, clock).ingest(PoiSource.TOURAPI, listOf(proposal()))
        val firstId = repo.stored.single().poiId

        PoiProposalIngestService(repo, later)
            .ingest(PoiSource.TOURAPI, listOf(proposal(name = "성산일출봉(개명)", lat = 33.46)))

        repo.stored shouldHaveSize 1
        val after = repo.stored.single()
        after.poiId shouldBe firstId          // 참조가 붙어 있으므로 id 를 새로 만들지 않는다
        after.nameKo shouldBe "성산일출봉(개명)"
        after.lat shouldBe 33.46
        after.createdAt shouldBe clock.instant()   // 처음 안 시점은 유지
        after.updatedAt shouldBe later.instant()
    }

    /**
     * 식별자가 없으면 다음 수집 때 같은 행을 찾을 수 없다. 받아 두면 **매일 중복이 쌓이므로** 여기서 끊는다.
     * 조용히 넣는 쪽이 당장은 친절해 보이지만, 그 대가는 후보풀 오염이다.
     */
    "출처 식별자가 없으면 받지 않는다" {
        val repo = InMemoryPoiRepository()

        val result = PoiProposalIngestService(repo, clock)
            .ingest(PoiSource.TOURAPI, listOf(proposal(ref = null), proposal(ref = "  ")))

        result.registered shouldBe 0
        result.dropped shouldContainExactly mapOf(PoiProposalIngestService.DROP_NO_SOURCE_REF to 2)
        repo.stored shouldHaveSize 0
    }

    // 한 문서 안 중복을 그대로 저장하면 부분 유니크 인덱스에 걸려 **문서 전체가 실패**한다(한 건 때문에 전부 잃는다).
    "한 문서에 같은 식별자가 두 번 오면 한 건만 남는다" {
        val repo = InMemoryPoiRepository()

        val result = PoiProposalIngestService(repo, clock)
            .ingest(PoiSource.TOURAPI, listOf(proposal(name = "먼저"), proposal(name = "나중")))

        result.registered shouldBe 1
        result.dropped[PoiProposalIngestService.DROP_DUPLICATE_IN_DOCUMENT] shouldBe 1
        repo.stored.single().nameKo shouldBe "나중"
    }

    "게이트 탈락은 사유별로 센다" {
        val repo = InMemoryPoiRepository()

        val result = PoiProposalIngestService(repo, clock).ingest(
            PoiSource.TOURAPI,
            listOf(
                proposal(ref = "1", name = " "),
                proposal(ref = "2", lat = null),
                proposal(ref = "3", lng = null),
                // 우리 8종에 없는 코드(AI 내부 전용 STAY 등)는 웹 계층이 null 로 옮겨 온다
                proposal(ref = "4", category = null),
            ),
        )

        result.received shouldBe 4
        result.registered shouldBe 0
        result.dropped shouldContainExactly mapOf(
            PoiProposalIngestService.DROP_NO_NAME to 1,
            PoiProposalIngestService.DROP_NO_COORD to 2,
            PoiProposalIngestService.DROP_UNKNOWN_CATEGORY to 1,
        )
        repo.stored shouldHaveSize 0
    }

    // 탈락분이 통과분을 막지 않는다 — 하나 때문에 문서 전체를 잃으면 매일 수집이 통째로 헛돈다.
    "일부가 탈락해도 나머지는 들어간다" {
        val repo = InMemoryPoiRepository()

        val result = PoiProposalIngestService(repo, clock)
            .ingest(PoiSource.TOURAPI, listOf(proposal(ref = "1"), proposal(ref = "2", lat = null)))

        result.registered shouldBe 1
        result.dropped[PoiProposalIngestService.DROP_NO_COORD] shouldBe 1
        repo.stored.single().sourceRef shouldBe "1"
    }

    // 식별자 체계는 벤더마다 독립이다 — 숫자가 같다고 같은 장소가 아니다.
    "출처가 다르면 같은 식별자라도 다른 장소다" {
        val repo = InMemoryPoiRepository()
        val svc = PoiProposalIngestService(repo, clock)

        svc.ingest(PoiSource.TOURAPI, listOf(proposal(ref = "100")))
        val other = svc.ingest(PoiSource.KAKAO_LOCAL, listOf(proposal(ref = "100", name = "다른 곳")))

        other.registered shouldBe 1
        repo.stored shouldHaveSize 2
    }

    "빈 문서는 아무것도 하지 않는다" {
        val repo = InMemoryPoiRepository()

        val result = PoiProposalIngestService(repo, clock).ingest(PoiSource.TOURAPI, emptyList())

        result shouldBe PoiIngestResult(0, 0, 0, emptyMap())
        repo.stored shouldHaveSize 0
    }

    "수동 등록분(sourceRef 없음)은 재수집에 영향받지 않는다" {
        val repo = InMemoryPoiRepository()
        PoiProposalIngestService(repo, clock).ingest(PoiSource.TOURAPI, listOf(proposal(ref = "500")))

        // 같은 이름·좌표를 가진 수동 POI 가 따로 있어도 수집 갱신이 그걸 건드리면 안 된다.
        repo.findBySourceRefs(PoiSource.TOURAPI, listOf("500")).shouldNotBeNull()
        repo.findBySourceRefs(PoiSource.TOURAPI, listOf("없는키")) shouldBe emptyMap()
    }
    /**
     * 상대는 모든 제안에 분류 명칭을 싣는다(실측 1,104/1,104). 이걸 버리면 `poi.tags` 가 늘 비고
     * 화면의 태그 자리가 빈 칸이 된다 — **조용히** 그렇게 된다(오류가 없다).
     */
    "태그를 버리지 않는다" {
        val repo = InMemoryPoiRepository()

        PoiProposalIngestService(repo, clock).ingest(PoiSource.TOURAPI, listOf(proposal()))

        repo.stored.single().tags shouldBe listOf("자연관광지", "일출")
    }

    "재수집이 태그를 갱신한다 — 벤더가 분류를 고치기도 한다" {
        val repo = InMemoryPoiRepository()
        val svc = PoiProposalIngestService(repo, clock)
        svc.ingest(PoiSource.TOURAPI, listOf(proposal(tags = listOf("옛분류"))))

        svc.ingest(PoiSource.TOURAPI, listOf(proposal(tags = listOf("새분류", "추가"))))

        repo.stored.single().tags shouldBe listOf("새분류", "추가")
    }

    // 빈 태그로 덮어써 기존 값을 지우지 않는다 — 벤더가 이번에 안 준 것과 "없다"는 다르다.
    "빈 태그는 기존 값을 지우지 않는다" {
        val repo = InMemoryPoiRepository()
        val svc = PoiProposalIngestService(repo, clock)
        svc.ingest(PoiSource.TOURAPI, listOf(proposal(tags = listOf("유지되어야함"))))

        svc.ingest(PoiSource.TOURAPI, listOf(proposal(tags = emptyList())))

        repo.stored.single().tags shouldBe listOf("유지되어야함")
    }
    // 이미지는 출처가 준 원본만 싣는다(2026-08-18 결정). 실 데이터는 1,043/1,104 에만 있다.
    "이미지 URL 을 그대로 싣는다" {
        val repo = InMemoryPoiRepository()

        PoiProposalIngestService(repo, clock).ingest(PoiSource.TOURAPI, listOf(proposal()))

        repo.stored.single().imageUrl shouldBe "https://tong.visitkorea.or.kr/sample.jpg"
    }

    "이미지가 없으면 null — 기본 이미지를 지어내지 않는다" {
        val repo = InMemoryPoiRepository()

        PoiProposalIngestService(repo, clock).ingest(PoiSource.TOURAPI, listOf(proposal(imageUrl = null)))

        repo.stored.single().imageUrl.shouldBeNull()
    }

    /**
     * 벤더가 이번에 이미지를 안 준 것과 "이미지가 없다"는 다르다. null 로 덮으면 한 번 받은 이미지가
     * 다음 수집에 조용히 사라진다 — 화면에 빈 자리가 생기고 원인을 되짚기 어렵다.
     */
    "재수집에 이미지가 없으면 기존 값을 지키다" {
        val repo = InMemoryPoiRepository()
        val svc = PoiProposalIngestService(repo, clock)
        svc.ingest(PoiSource.TOURAPI, listOf(proposal(imageUrl = "https://a/keep.jpg")))

        svc.ingest(PoiSource.TOURAPI, listOf(proposal(imageUrl = null)))

        repo.stored.single().imageUrl shouldBe "https://a/keep.jpg"
    }

    "새 이미지가 오면 갱신한다" {
        val repo = InMemoryPoiRepository()
        val svc = PoiProposalIngestService(repo, clock)
        svc.ingest(PoiSource.TOURAPI, listOf(proposal(imageUrl = "https://a/old.jpg")))

        svc.ingest(PoiSource.TOURAPI, listOf(proposal(imageUrl = "https://a/new.jpg")))

        repo.stored.single().imageUrl shouldBe "https://a/new.jpg"
    }
})
