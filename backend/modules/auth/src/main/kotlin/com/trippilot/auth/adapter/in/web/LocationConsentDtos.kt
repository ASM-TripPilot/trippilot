package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.domain.location.LocationConsent
import com.trippilot.auth.domain.location.OsPermission
import jakarta.validation.constraints.NotNull

/** GET·PUT /me/location-consent 응답 — 3층 상태 + G182 유효 능력. */
data class LocationConsentResponse(
    val osPermissionMirror: OsPermission,
    val legalConsent: Boolean,
    val gpsRecordingOptIn: Boolean,
    val capabilities: Capabilities,
) {
    data class Capabilities(
        val serverLocationService: Boolean,
        val gpsTrackRetention: Boolean,
    )

    companion object {
        fun from(c: LocationConsent): LocationConsentResponse {
            val caps = c.capabilities()
            return LocationConsentResponse(
                osPermissionMirror = c.osPermission,
                legalConsent = c.legalConsent,
                gpsRecordingOptIn = c.gpsRecordingOptIn,
                capabilities = Capabilities(caps.serverLocationService, caps.gpsTrackRetention),
            )
        }
    }
}

/** PUT /me/location-consent — L2/L3 변경(null = 변경 없음). */
data class LocationConsentUpdateRequest(
    val legalConsent: Boolean? = null,
    val gpsRecordingOptIn: Boolean? = null,
)

/** PATCH /me/location-consent/os-permission — L1 OS 권한 미러 보고. */
data class OsPermissionRequest(
    @field:NotNull(message = "osPermission 이 필요합니다") val osPermission: OsPermission?,
)
