package com.trippilot.reflection.application

import com.trippilot.auth.api.PersonalizationConsentFacade
import com.trippilot.reflection.api.PersonalizationReason
import com.trippilot.reflection.domain.CategoryShare
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleAnalysisRepository
import com.trippilot.reflection.domain.TraitGauges
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldNotContain
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.PropTestConfig
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.of
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/**
 * 개인화 동의 게이트(BR-U5-44·45).
 *
 * **동의 OFF 계정의 추천 입력에 과거 기록이 한 건도 없어야 한다.** 성질로 쓰는 이유는 실패가
 * 조용하기 때문이다 — 기록이 새어 나가도 추천은 그럴듯하게 나오고, 오류도 로그도 없다.
 * 사용자는 동의하지 않은 데이터가 쓰였다는 사실을 영영 모른다.
 */
class PersonalizationServiceTest : StringSpec({

    val acc = UUID.randomUUID()

    fun consentOf(granted: Boolean) = object : PersonalizationConsentFacade {
        override fun isPersonalizationGranted(accountId: UUID) = granted
    }

    /** 조회 여부까지 본다 — 동의가 없으면 **읽지도 않는 것**이 이 서비스의 계약이다. */
    class Analyses(private val stored: StyleAnalysis? = null) : StyleAnalysisRepository {
        var reads = 0
        override fun upsert(analysis: StyleAnalysis) = analysis
        override fun find(accountId: UUID) = stored.also { reads++ }
    }

    fun analysisOf(categories: List<Pair<String, Double>>, easygoing: Int = 3) = StyleAnalysis(
        accountId = acc,
        descriptors = listOf("#카페"),
        traitGauges = TraitGauges(easygoing = easygoing, foodAffinity = 3, activeness = 2),
        categoryBreakdown = categories.map { CategoryShare(it.first, it.second) },
        avgPlacesPerDay = 3.0,
        avgRadiusKm = 1.2,
        avgDwellMinutes = 72,
        sampleTripCount = 3,
        sampleVisitCount = 12,
        updatedAt = Instant.parse("2026-08-14T12:00:00Z"),
    )

    "동의가 없으면 과거 기록을 읽지도 않는다(BR-U5-44)" {
        val analyses = Analyses(analysisOf(listOf("카페" to 1.0)))

        val view = PersonalizationService(consentOf(false), analyses).deriveFor(acc)

        view.applied shouldBe false
        view.reason shouldBe PersonalizationReason.CONSENT_MISSING
        view.activities.shouldBeEmpty()
        view.pace shouldBe null
        // 마지막에 거르는 것과 애초에 읽지 않는 것은 사고가 났을 때 결과가 다르다.
        analyses.reads shouldBe 0
    }

    "동의는 있는데 근거가 모자란 것은 다른 사유다 — 조용히 같게 다루지 않는다" {
        val view = PersonalizationService(consentOf(true), Analyses(null)).deriveFor(acc)

        view.applied shouldBe false
        view.reason shouldBe PersonalizationReason.NOT_ENOUGH_RECORDS
        // 화면이 이 둘을 구분해야 이미 동의한 사용자에게 "동의하면 더 맞춰드려요"를 보이지 않는다.
        view.sharedItems.shouldBeEmpty()
    }

    "동의 OFF 면 어떤 기록이 있어도 힌트가 비어 있다" {
        checkAll(
            PropTestConfig(iterations = 40),
            Arb.list(Arb.of("맛집", "카페", "자연", "문화", "야경", "쇼핑", "명소", "액티비티"), 1..5),
            Arb.int(0..5),
        ) { cats, gauge ->
            val analysis = analysisOf(cats.distinct().map { it to 1.0 / cats.distinct().size }, easygoing = gauge)

            val view = PersonalizationService(consentOf(false), Analyses(analysis)).deriveFor(acc)

            view.activities.shouldBeEmpty()
            view.pace shouldBe null
            view.sharedItems.shouldBeEmpty()
        }
    }

    "동의가 있으면 카테고리를 취향 어휘로 옮겨 낸다" {
        val analysis = analysisOf(listOf("맛집" to 0.5, "카페" to 0.3, "자연" to 0.2))

        val view = PersonalizationService(consentOf(true), Analyses(analysis)).deriveFor(acc)

        view.applied shouldBe true
        view.reason shouldBe PersonalizationReason.APPLIED
        // 코드가 아니라 profile 어휘다 — 받는 쪽(AI 경계)이 아는 말이어야 한다.
        view.activities shouldContainExactly listOf("맛집투어", "카페", "자연")
        view.sharedItems.size shouldBe 2
    }

    "대응이 없는 코드는 버린다 — 억지로 가까운 값에 붙이지 않는다(BR-U5-31)" {
        val analysis = analysisOf(listOf("명소" to 0.6, "액티비티" to 0.4))

        val view = PersonalizationService(consentOf(true), Analyses(analysis)).deriveFor(acc)

        // 사용자가 고른 적 없는 취향이 추천에 들어가느니 아무것도 안 보태는 편이 낫다.
        view.activities.shouldBeEmpty()
        view.applied shouldBe true // 속도는 여전히 낼 수 있다
        // 넘긴 것이 없으면 그 줄은 안내에도 없다.
        view.sharedItems.map { it.item } shouldNotContain "자주 방문한 장소 유형"
    }

    "묶음 줄(기타)은 취향으로 옮기지 않는다 — 어떤 종류인지 모르는 값이다" {
        val analysis = analysisOf(listOf("카페" to 0.6))
            .let { it.copy(categoryBreakdown = it.categoryBreakdown + CategoryShare("기타", 0.4, isOther = true)) }

        val view = PersonalizationService(consentOf(true), Analyses(analysis)).deriveFor(acc)

        view.activities shouldContainExactly listOf("카페")
    }

    "여유로움 게이지가 속도로 옮겨진다 — 세 단 모두 profile 어휘다" {
        fun paceAt(g: Int) = PersonalizationService(
            consentOf(true), Analyses(analysisOf(listOf("카페" to 1.0), easygoing = g)),
        ).deriveFor(acc).pace

        paceAt(5) shouldBe "느긋하게"
        paceAt(4) shouldBe "느긋하게"
        paceAt(3) shouldBe "균형있게"
        paceAt(2) shouldBe "균형있게"
        paceAt(1) shouldBe "알차게"
        paceAt(0) shouldBe "알차게"
    }

    "안내 목록은 실제로 넘긴 것만 담는다(BR-U5-45)" {
        val view = PersonalizationService(consentOf(true), Analyses(analysisOf(listOf("카페" to 1.0)))).deriveFor(acc)

        // 목적이 비어 있으면 화면이 "왜 쓰는지"를 지어내야 한다.
        view.sharedItems.forEach { it.purpose.isNotBlank() shouldBe true }
        view.sharedItems.map { it.item } shouldContainExactly listOf("자주 방문한 장소 유형", "하루 평균 방문 수")
    }
})
