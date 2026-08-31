package com.trippilot.planbdetection.application

import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.SensitivityRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/**
 * Plan-B 알림 민감도 설정(BR-U4-08 · O-U6-2).
 *
 * ## 상한은 별도 값이 아니다
 *
 * 티켓(TRIP-616)은 `{ sensitivity, hourlyCap }` 두 값을 요구했으나 **실장은 상한을 민감도에서
 * 파생**한다([Sensitivity.dailyCap] — LOW 2 · NORMAL 5 · HIGH 10). 실장을 유지했다:
 *
 * - 노브가 하나면 사용자가 "민감도"만 이해하면 된다. 둘이면 `HIGH` 인데 상한 1 같은 모순 조합이 생긴다
 * - **시간당 상한은 하루 총량보다 약한 보장이다** — 매시 1건이면 하루 24건이 나간다.
 *   여행 중 알림 피로를 막자는 BR-U4-08 취지에는 하루 단위가 맞다
 * - BR-U4-08 은 "전역 빈도 상한과 민감도를 감지 단계에서 적용한다"까지만 정하고 단위를 말하지 않는다
 *   — 정본이 둘 다 허용하는 자리이고, 이미 도는 쪽을 택했다
 *
 * ## 임계값은 내보내지 않는다
 *
 * 응답에 `dailyCap` 을 싣지 않는다(BR-U4-03) — 클라가 임계를 알면 자체 판단으로 배너를 띄우게 되고,
 * 그러면 판정이 두 곳에 흩어진다. 사용자에게 필요한 것은 "적게/보통/많이"이지 숫자가 아니다.
 */
@Service
class SensitivityService(private val sensitivities: SensitivityRepository) {

    /** 설정한 적 없으면 `NORMAL` — 설정이 없다고 알림이 멈추면 안 된다. */
    @Transactional(readOnly = true)
    fun of(accountId: UUID): Sensitivity = sensitivities.of(accountId)

    @Transactional
    fun set(accountId: UUID, sensitivity: Sensitivity): Sensitivity = sensitivities.set(accountId, sensitivity)
}
