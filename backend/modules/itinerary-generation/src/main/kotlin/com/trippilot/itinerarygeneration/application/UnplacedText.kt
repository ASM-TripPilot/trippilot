package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.UnplacedReason

/**
 * 미배치 사유 → 사용자 문구(계약 M2 — **문구는 백엔드가 만든다**, AI 는 코드만 준다).
 *
 * 왜 백엔드가 만드나: AI 문구를 그대로 쓰면 어휘·존댓말이 화면마다 흔들리고, 사유가 늘 때
 * 문구 품질을 우리가 통제할 수 없다. 코드가 닫힌 집합이라 여기서 한 곳에 모을 수 있다.
 */
object UnplacedText {

    /** 사유별 안내 문구. 무엇을 하면 되는지까지 담는다 — "안 됐다"만 알리면 사용자가 할 일이 없다. */
    fun of(reason: UnplacedReason): String = when (reason) {
        UnplacedReason.OUT_OF_RANGE ->
            "여행 기간 밖 날짜로 지정돼 있어 넣지 못했어요. 날짜를 여행 기간 안으로 바꿔 주세요."
        UnplacedReason.WINDOW_CONFLICT ->
            "다른 필수 방문지와 시간이 겹쳐 넣지 못했어요. 한쪽 시각을 옮겨 주세요."
        UnplacedReason.NO_FEASIBLE_SLOT ->
            "남은 시간과 이동을 고려하면 넣을 자리가 없었어요. 시각 고정을 풀거나 일정을 줄여 보세요."
        // 계약에 없는 사유가 온 경우 — 지어내지 않고 "확인 불가"로 둔다.
        UnplacedReason.UNKNOWN ->
            "넣지 못했어요. 사유를 확인하지 못했습니다."
    }
}
