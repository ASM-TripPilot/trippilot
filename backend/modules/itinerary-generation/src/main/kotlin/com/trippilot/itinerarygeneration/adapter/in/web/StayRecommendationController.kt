package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.application.StayCandidate
import com.trippilot.itinerarygeneration.application.StayRecommendationService
import jakarta.validation.Valid
import jakarta.validation.constraints.Size
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/**
 * 숙소 나중 등록 온램프(US-SCHED-11 · h25·h27·h28).
 *
 * 조회지만 POST 인 이유는 입력이 복합(후보 목록)이기 때문이다 — 슬롯 후보 제안과 같은 판단.
 *
 * **등록 후 재정렬 API 는 두지 않는다** — 정본이 "숙소 등록 후 재정렬 = `generate`" 라고 못박았다
 * (DEC-U3-2·4). 숙소를 등록한 뒤 기존 생성 API 를 다시 부르면 그 숙소가 앵커로 들어간다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/stay-recommendations")
class StayRecommendationController(private val service: StayRecommendationService) {

    @PostMapping
    fun recommend(
        principal: Principal,
        @PathVariable tripId: UUID,
        @Valid @RequestBody request: StayRecommendationRequest,
    ): StayRecommendationResponse {
        val r = service.recommend(
            principal.accountId(), tripId,
            request.candidates.map { StayCandidate(it.stayId, it.lat, it.lng) },
        )
        return StayRecommendationResponse(
            r.centroidLat, r.centroidLng, r.avgDistanceM,
            r.candidates.map { CandidateScoreResponse(it.stayId, it.beforeAvgDistanceM, it.afterAvgDistanceM, it.deltaM) },
        )
    }
}

/**
 * 후보는 클라이언트가 `GET /stays/search` 로 얻어 넘긴다 — 숙소 검색은 C3 소유라 여기서 중개하지 않는다.
 * 비워 보내면 **권역만** 돌려준다(지도만 그리는 h27).
 */
data class StayRecommendationRequest(
    @field:Size(max = 50, message = "후보는 50개까지 평가합니다.")
    val candidates: List<CandidateRequest> = emptyList(),
)

data class CandidateRequest(val stayId: String, val lat: Double, val lng: Double)

/**
 * 권역 + 후보 평가. 거리는 전부 **추정(직선)** 이며 화면도 그렇게 표기한다.
 * **소요시간은 없다**(INV-3).
 */
data class StayRecommendationResponse(
    val centroidLat: Double,
    val centroidLng: Double,
    /** 무게중심에서 각 방문지까지의 평균 거리 — 권역 반경의 근거. */
    val avgDistanceM: Int,
    /** 평균 이동 거리가 짧은 순. */
    val candidates: List<CandidateScoreResponse>,
)

data class CandidateScoreResponse(
    val stayId: String,
    val beforeAvgDistanceM: Int,
    val afterAvgDistanceM: Int,
    /** 음수면 줄어든다 — 화면이 "평균 N m 줄어요" 로 쓴다. */
    val deltaM: Int,
)
