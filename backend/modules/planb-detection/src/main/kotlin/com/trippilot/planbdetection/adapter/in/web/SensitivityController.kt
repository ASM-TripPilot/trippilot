package com.trippilot.planbdetection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.planbdetection.application.SensitivityService
import com.trippilot.planbdetection.domain.Sensitivity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/**
 * Plan-B 알림 민감도(`l02` 알림 설정 · BR-U4-08).
 *
 * 저장·적용은 이미 감지 단계가 하고 있었고(`TriggerService`), **없던 것은 이 표면뿐이다** —
 * 그래서 FE(TRIP-607)가 이 행을 못 그려 반쪽으로 남았다.
 *
 * PATCH 가 아니라 PUT 인 이유: 값이 하나뿐이라 "준 것만 바꾼다"가 의미를 갖지 않는다.
 * 부분 갱신 규약을 흉내 내면 빈 본문이 무엇을 뜻하는지 계약이 애매해진다.
 */
@RestController
@RequestMapping("/api/v1/me/planb-sensitivity")
class SensitivityController(private val service: SensitivityService) {

    /** 설정한 적 없으면 `NORMAL` 이 온다 — 404 가 아니다(첫 진입에서 화면이 설정을 그려야 한다). */
    @GetMapping
    fun get(principal: Principal): SensitivityResponse =
        SensitivityResponse(service.of(principal.accountId()).name)

    @PutMapping
    fun put(principal: Principal, @RequestBody request: UpdateSensitivityRequest): SensitivityResponse =
        SensitivityResponse(service.set(principal.accountId(), request.parsed()).name)
}

/** [sensitivity] `LOW`·`NORMAL`·`HIGH`. 어휘 밖이면 400 — 조용히 NORMAL 로 떨어뜨리면 사용자가 바꾼 줄 안다. */
data class UpdateSensitivityRequest(val sensitivity: String?) {
    fun parsed(): Sensitivity =
        runCatching { Sensitivity.valueOf(sensitivity.orEmpty()) }.getOrNull()
            ?: throw ValidationFailed(
                listOf(FieldError("sensitivity", "민감도는 LOW·NORMAL·HIGH 중 하나입니다.")),
            )
}

/**
 * [sensitivity] 만 내보낸다. **상한 수치는 싣지 않는다**(BR-U4-03) — 클라가 임계를 알면 자체 판단으로
 * 배너를 띄우게 되고 판정이 두 곳에 흩어진다.
 */
data class SensitivityResponse(val sensitivity: String)

private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
