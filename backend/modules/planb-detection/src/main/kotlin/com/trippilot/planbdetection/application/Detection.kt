package com.trippilot.planbdetection.application

import com.trippilot.planbdetection.domain.TriggerKind
import java.time.LocalDate

/**
 * 감지기 한 출처가 (여행, 날짜) 하나를 본 결과 — 스윕이 모아 [TriggerService.reconcile] 에 넘긴다.
 *
 * 감지기는 저장·이벤트를 하지 않는다 — 쓰기 경로는 reconcile 하나다(CD1).
 * 모름은 0·기본값으로 채우지 않는다(BR-U4-05 · INV-U4-09) — [Unknown] 이면 그 출처·날짜는 발화도 해제도 없다.
 */
sealed interface Detection {
    /**
     * 확인했다. [checked] = 해제 임계 **아래로** 확인한 대상(slotKey, 날짜 전체 = null) — 신호를 낸 대상은 넣지 않는다.
     * 그 출처가 띄운 트리거는 그 대상이 여기 있고 어떤 출처도 신호를 내지 않았을 때만 해제된다(규칙 7).
     * [partial] = 그 날 본 대상 가운데 판정하지 못한 것이 남았다 — 신호·해제는 그대로 쓰되 감시 상태는 '확인'으로 남기지 않는다
     * (G-SA-21 사용자 결정 '하나라도 모르면 확인 불가' · INV-SA-2). 지금은 장소 감지기만 쓴다.
     */
    data class Checked(val checked: Set<String?>, val signals: List<DetectionSignal>, val partial: Boolean = false) : Detection

    /** 확인하지 못했다(키 미등록·장애·보류). [why] 는 요약 로그용이다. */
    data class Unknown(val why: String) : Detection
}

/**
 * 출처([source] — `payload.detector` 가 될 해제 자격 이름)·종류·날짜와 그 결과.
 * 이번 회차에 없는 (출처, 날짜)는 '미호출'이다 — 모름과 같아서 해제하지 않는다.
 */
data class Observation(val source: String, val kind: TriggerKind, val date: LocalDate, val detection: Detection)
