package com.trippilot.reflection.domain

import java.time.Instant
import java.util.UUID

/**
 * 여행 스타일 분석(U5 정본 §4.3 · US-REC-09) — **계정 단위**.
 *
 * **임계 미만에서는 이 타입이 존재할 수 없다**(INV-U5-09). 생성자가 막으므로 "미리보기를 실수로
 * 저장"하는 경로가 코드상 없다 — 그것이 이 `require` 의 목적이다. 미리보기는 [StylePreview] 다.
 */
data class StyleAnalysis(
    val accountId: UUID,
    val descriptors: List<String>,
    val traitGauges: TraitGauges,
    val categoryBreakdown: List<CategoryShare>,
    val avgPlacesPerDay: Double,
    val avgRadiusKm: Double,
    /**
     * **소요시간 노출의 유일한 예외**(BR-U5-08a · PBT-U5-5). 사후 실적 통계는 U5 소관이라
     * INV-3(솔버 미검증 예측 소요시간 금지)에 걸리지 않는다. 개별 방문의 체류는 계속 미노출이다.
     *
     * 잴 수 없으면 null — 0 으로 채우면 "0분 머물렀다"는 거짓말이 된다.
     */
    val avgDwellMinutes: Int?,
    val sampleTripCount: Int,
    val sampleVisitCount: Int,
    val updatedAt: Instant,
) {
    init {
        require(sampleVisitCount >= MIN_VISITS) {
            "정식 분석은 누적 방문 $MIN_VISITS 곳부터입니다(INV-U5-09). 미만은 미리보기로 냅니다."
        }
        require(avgPlacesPerDay >= 0.0 && avgRadiusKm >= 0.0) { "평균 수치는 음수일 수 없습니다." }
        require(avgDwellMinutes == null || avgDwellMinutes >= 0) { "평균 체류는 음수일 수 없습니다." }
    }

    companion object {
        /** 정식 분석 임계(BR-U5-40). 화면의 `현재 N곳/필요 10곳` 이 이 값을 읽는다. */
        const val MIN_VISITS = 10
    }
}

/**
 * dot 게이지 3축(각 0~5) — `l03` 실물 화면의 축이다.
 *
 * ⚠ **산출식은 잠정이다**(O-U5-9 미결). 스토리 원문(US-NOTIF-08)은 "밀도·반경"이라 화면과 축이
 * 다르고, 정본은 "화면을 따르되 산출식은 U6 마이페이지 설계와 함께 확정"으로 열어 뒀다.
 * 지금 식은 [StyleAnalysisService] 에 있고 **실적으로 관측 가능한 값만** 쓴다 — 확정되면 그 함수만
 * 바꾸면 되도록 축의 의미(무엇이 높으면 5인가)를 여기 적어 둔다.
 *
 * @property easygoing 여유로움 — 하루에 적게 다닐수록 높다(방문 밀도의 역).
 * @property foodAffinity 미식취향 — 맛집·카페 방문 비중이 높을수록 높다.
 * @property activeness 활동성 — 하루 이동 반경이 넓을수록 높다.
 */
data class TraitGauges(val easygoing: Int, val foodAffinity: Int, val activeness: Int) {
    init {
        require(listOf(easygoing, foodAffinity, activeness).all { it in 0..MAX }) {
            "게이지는 0~$MAX 입니다."
        }
    }

    companion object {
        const val MAX = 5
    }
}

/**
 * 카테고리 한 줄(`j05` 막대).
 *
 * [category] 는 **`poi.category` 코드**다(`맛집`·`카페`·`자연`…) — 화면 라벨이 아니다.
 * 화면이 `맛집` 을 `미식` 으로 그리는 것은 표시 매핑이고, 그 매핑표는 아직 디자인 확인이
 * 필요하다(O-U5-7). 라벨을 저장하면 라벨이 바뀔 때 **저장된 과거 분석이 전부 틀린 말이 된다**.
 *
 * [isOther] 상위 3 밖을 하나로 묶은 줄. 코드가 아니라 예약 라벨이라 플래그로 구분한다.
 */
data class CategoryShare(val category: String, val ratio: Double, val isOther: Boolean = false) {
    init {
        require(ratio in 0.0..1.0) { "비율은 0~1 입니다." }
    }

    companion object {
        /** 묶음 줄의 이름. 코드 8종에 없는 값이라 [isOther] 로 구분한다. */
        const val OTHER = "기타"

        /** `j05` 막대는 4줄이다 — 상위 3 + 묶음. */
        const val TOP_N = 3
    }
}

/**
 * 임계 미만의 임시 미리보기(BR-U5-40 · BR-U5-41).
 *
 * **저장하지 않는다.** 별도 타입인 이유가 그것이다 — [StyleAnalysis] 와 같은 타입이면 저장 경로가
 * 열려 있고, 한 번 섞이면 어느 것이 정식인지 되돌릴 근거가 없다.
 *
 * 디스크립터는 **온보딩 취향**에서 온다(실적이 부족해 실적으로 만들 수 없다). 그래서 화면은
 * "정식 아님"을 명시해야 하고, 그 판단 근거가 [required] 대비 [current] 다.
 */
data class StylePreview(val descriptors: List<String>, val current: Int, val required: Int)

/** 분석 결과 — 정식이거나 미리보기이거나. 둘을 한 타입에 담지 않는다. */
sealed interface StyleOutcome {
    data class Official(val analysis: StyleAnalysis) : StyleOutcome

    data class Preview(val preview: StylePreview) : StyleOutcome
}

/** 정식 분석만 다룬다 — 미리보기는 애초에 이 포트에 닿지 않는다. */
interface StyleAnalysisRepository {
    /** 계정당 하나 — 재분석은 덮어쓰기다. */
    fun upsert(analysis: StyleAnalysis): StyleAnalysis

    fun find(accountId: UUID): StyleAnalysis?
}
