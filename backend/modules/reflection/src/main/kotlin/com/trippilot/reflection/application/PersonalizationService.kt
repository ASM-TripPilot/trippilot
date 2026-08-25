package com.trippilot.reflection.application

import com.trippilot.auth.api.PersonalizationConsentFacade
import com.trippilot.reflection.api.PersonalizationFacade
import com.trippilot.reflection.api.PersonalizationItem
import com.trippilot.reflection.api.PersonalizationReason
import com.trippilot.reflection.api.PersonalizationView
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleAnalysisRepository
import com.trippilot.reflection.domain.TraitGauges
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/**
 * 개인화 입력을 만든다(US-REC-10 · BR-U5-44·45).
 *
 * ## 동의가 없으면 **읽지도 않는다**
 *
 * 게이트를 "만들어 놓고 마지막에 거른다"로 두지 않았다. 동의가 없으면 스타일 분석을 조회조차
 * 하지 않고 빈 입력을 낸다 — 거르는 코드가 한 줄 빠지는 것과, 애초에 읽지 않는 것은 사고가
 * 났을 때의 결과가 다르다.
 *
 * ## 왜 profile 어휘로 옮기나
 *
 * 받는 쪽(일정 생성 → AI 경계)이 아는 어휘는 `preference_snapshot` 7축뿐이다. 카테고리 코드
 * (`맛집`·`카페`)를 그대로 실으면 AI 는 모르는 값을 받고, 경계 계약에는 과거 기록을 실을 자리가
 * 아예 없다. **있는 것으로 표현할 수 있으면 상대에게 새 필드를 요구하지 않는다.**
 *
 * 옮길 수 없는 코드는 **버린다** — `명소`·`액티비티` 는 활동 어휘에 대응이 없다. 억지로 가까운
 * 값에 붙이면 사용자가 고른 적 없는 취향이 추천에 들어간다(BR-U5-31 근거 안에서만).
 */
@Service
class PersonalizationService(
    private val consents: PersonalizationConsentFacade,
    private val analyses: StyleAnalysisRepository,
) : PersonalizationFacade {

    @Transactional(readOnly = true)
    override fun deriveFor(accountId: UUID): PersonalizationView {
        if (!consents.isPersonalizationGranted(accountId)) return empty(PersonalizationReason.CONSENT_MISSING)
        // 정식 분석이 없으면 근거가 모자란 것이다(INV-U5-09) — 임시 미리보기는 저장되지 않으므로 여기 오지 않는다.
        val analysis = analyses.find(accountId) ?: return empty(PersonalizationReason.NOT_ENOUGH_RECORDS)

        val activities = analysis.categoryBreakdown
            .filter { !it.isOther }
            .mapNotNull { ACTIVITY_BY_CATEGORY[it.category] }
            .distinct()
        val pace = paceOf(analysis.traitGauges)
        return PersonalizationView(
            applied = true,
            reason = PersonalizationReason.APPLIED,
            activities = activities,
            pace = pace,
            // **실제로 넘긴 것만** 적는다 — 활동이 하나도 안 옮겨졌으면 그 줄은 없다.
            sharedItems = buildList {
                if (activities.isNotEmpty()) {
                    add(PersonalizationItem("자주 방문한 장소 유형", "추천 장소의 종류를 취향에 맞춥니다"))
                }
                add(PersonalizationItem("하루 평균 방문 수", "하루 일정의 빽빽함을 조절합니다"))
            },
        )
    }

    /**
     * 여유로움 게이지 → 여행 속도(profile `pace` 어휘).
     *
     * 게이지는 0~5 이고 어휘는 3단이라 경계를 둘로 자른다. 가운데를 넓게 둔 이유는, 한쪽으로
     * 치우친 판정이 사용자가 고른 적 없는 속도를 추천에 밀어 넣기 때문이다.
     */
    private fun paceOf(gauges: TraitGauges): String = when {
        gauges.easygoing >= CALM_FROM -> PACE_CALM
        gauges.easygoing <= BUSY_UPTO -> PACE_BUSY
        else -> PACE_BALANCED
    }

    private fun empty(reason: PersonalizationReason) = PersonalizationView(
        applied = false,
        reason = reason,
        activities = emptyList(),
        pace = null,
        // 넘긴 것이 없으면 목록도 비어 있다 — "이런 걸 씁니다"만 적어 두면 안내가 거짓말이 된다.
        sharedItems = emptyList(),
    )

    private companion object {
        /**
         * `poi.category`(8종) → profile `activities`(8종) 매핑.
         *
         * 두 어휘는 겹치지만 같지 않다. **대응이 없는 코드는 넣지 않는다** — `명소`·`액티비티` 가
         * 그것이다(활동 어휘의 `테마파크`·`역사문화` 는 더 좁은 뜻이라 같다고 볼 수 없다).
         * 화면 라벨 매핑(O-U5-7)과는 **다른 표다**: 저쪽은 표시용, 이쪽은 추천 입력용이다.
         */
        private val ACTIVITY_BY_CATEGORY = mapOf(
            "맛집" to "맛집투어",
            "카페" to "카페",
            "자연" to "자연",
            "문화" to "전시",
            "야경" to "야경",
            "쇼핑" to "쇼핑",
        )

        private const val PACE_CALM = "느긋하게"
        private const val PACE_BALANCED = "균형있게"
        private const val PACE_BUSY = "알차게"

        /** 게이지 0~5 를 3단으로 자르는 경계. [StyleAnalysis] 의 잠정 산출식(O-U5-9)에 딸린 값이다. */
        private const val CALM_FROM = 4
        private const val BUSY_UPTO = 1
    }
}
