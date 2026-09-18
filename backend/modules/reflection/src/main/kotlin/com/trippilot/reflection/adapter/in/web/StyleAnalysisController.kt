package com.trippilot.reflection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.reflection.application.StyleAnalysisService
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleOutcome
import com.trippilot.reflection.domain.StylePreview
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/**
 * 여행 스타일 분석(`j05`). **계정 스코프** — 여행 하위가 아니라 `/me` 아래다(INV-U5-08).
 *
 * 응답이 두 모양인 이유는 그 둘이 **다른 것이기 때문이다**(BR-U5-40). `official=false` 는
 * "아직 없음"이 아니라 "정식이 아닌 미리보기"다 — 화면이 그 사실을 명시해야 하고, 근거가
 * `progress`(현재 N곳 / 필요 10곳)다. 한 모양으로 합치면 화면이 둘을 구분할 수 없다.
 */
@RestController
@RequestMapping("/api/v1/me/style")
class StyleAnalysisController(private val service: StyleAnalysisService) {

    @GetMapping
    fun get(principal: Principal): StyleAnalysisResponse =
        when (val outcome = service.analyze(principal.accountId())) {
            is StyleOutcome.Official -> StyleAnalysisResponse(
                official = true,
                analysis = StyleAnalysisBody.from(outcome.analysis),
                progress = StyleProgressResponse(outcome.analysis.sampleVisitCount, StyleAnalysis.MIN_VISITS),
            )

            is StyleOutcome.Preview -> StyleAnalysisResponse(
                official = false,
                preview = StylePreviewBody.from(outcome.preview),
                progress = StyleProgressResponse(outcome.preview.current, outcome.preview.required),
            )
        }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

/**
 * @property official 정식 분석인가. false 면 [preview] 가 차 있고 화면은 **"정식 아님"을 명시**한다.
 * @property progress 두 경우 모두 싣는다 — 정식이어도 `분석에 사용된 방문 N곳`을 보인다(BR-U5-42).
 */
data class StyleAnalysisResponse(
    val official: Boolean,
    val progress: StyleProgressResponse,
    val analysis: StyleAnalysisBody? = null,
    val preview: StylePreviewBody? = null,
)

data class StyleProgressResponse(val current: Int, val required: Int)

/** 임계 미만의 임시 미리보기 — **온보딩 취향**에서 왔다. 실적이 아니다. */
data class StylePreviewBody(val descriptors: List<String>) {
    companion object {
        fun from(p: StylePreview) = StylePreviewBody(p.descriptors)
    }
}

/**
 * 정식 분석.
 *
 * **`avgDwellMinutes` 가 소요시간 노출의 유일한 예외다**(BR-U5-08a · PBT-U5-5) — 사후 실적
 * 통계라 INV-3 에 걸리지 않는다. 다른 어떤 필드도 소요시간을 싣지 않는다.
 */
data class StyleAnalysisBody(
    val descriptors: List<String>,
    val traitGauges: TraitGaugesResponse,
    val categoryBreakdown: List<CategoryShareResponse>,
    val avgPlacesPerDay: Double,
    val avgRadiusKm: Double,
    val avgDwellMinutes: Int?,
    val sampleTripCount: Int,
    val updatedAt: Instant,
) {
    companion object {
        fun from(a: StyleAnalysis) = StyleAnalysisBody(
            descriptors = a.descriptors,
            traitGauges = TraitGaugesResponse(
                a.traitGauges.easygoing, a.traitGauges.foodAffinity, a.traitGauges.activeness,
            ),
            categoryBreakdown = a.categoryBreakdown.map { CategoryShareResponse(it.category, it.ratio, it.isOther) },
            avgPlacesPerDay = a.avgPlacesPerDay,
            avgRadiusKm = a.avgRadiusKm,
            avgDwellMinutes = a.avgDwellMinutes,
            sampleTripCount = a.sampleTripCount,
            updatedAt = a.updatedAt,
        )
    }
}

/** dot 게이지 3축(각 0~5). **산출식은 잠정이다**(O-U5-9). */
data class TraitGaugesResponse(val easygoing: Int, val foodAffinity: Int, val activeness: Int)

/**
 * @property category **`poi.category` 코드**다(`맛집`·`카페`…) — 화면 라벨이 아니다.
 *   화면이 `맛집` 을 `미식` 으로 그리는 표시 매핑은 클라이언트 몫이다(O-U5-7).
 * @property isOther 상위 3 밖을 묶은 줄. 이 줄의 [category] 는 코드가 아니라 예약 라벨(`기타`)이다.
 */
data class CategoryShareResponse(val category: String, val ratio: Double, val isOther: Boolean)
