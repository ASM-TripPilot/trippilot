package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.LocationConsentService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal

/**
 * 위치 동의 3층 관리(Bearer 필요). L1 미러·L2 법정·L3 GPS + G182 유효 능력.
 * 인증 주체는 [Principal](=JWT sub=accountId)로 받는다.
 */
@RestController
@RequestMapping("/api/v1/me/location-consent")
class LocationConsentController(
    private val service: LocationConsentService,
) {
    /** 현재 3층 상태 + 유효 능력 매트릭스(G182). */
    @GetMapping
    fun get(principal: Principal): LocationConsentResponse =
        LocationConsentResponse.from(service.get(principal.accountId()))

    /** L2(법정)·L3(GPS) 변경 → 증적·법정로그, L3 철회 시 발자취 파기(INV-L4). */
    @PutMapping
    fun update(principal: Principal, @RequestBody request: LocationConsentUpdateRequest): LocationConsentResponse =
        LocationConsentResponse.from(
            service.update(principal.accountId(), request.legalConsent, request.gpsRecordingOptIn),
        )

    /** L1 OS 권한 미러 보고(단말→서버). 순수 반영. */
    @PatchMapping("/os-permission")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun mirrorOsPermission(principal: Principal, @Valid @RequestBody request: OsPermissionRequest) {
        service.mirrorOsPermission(principal.accountId(), request.osPermission!!)
    }
}
