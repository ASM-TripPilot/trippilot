package com.trippilot.auth.domain.location

import com.trippilot.auth.domain.AccountId
import java.time.Instant

/** L1 — 단말 OS 위치 권한 미러. 서버는 값을 반영만 하고 파생하지 않는다(INV-L1). */
enum class OsPermission { GRANTED, DENIED, NOT_DETERMINED }

/**
 * G182 유효 능력 — (L1,L2,L3)에서 파생되는 총함수 결과(서버·클라 공유, INV-L1/L2).
 * 위치정보법 정합: 서버 전송 = L1∧L2, GPS 발자취 저장 = L1∧L2∧L3.
 */
data class LocationCapabilities(
    val serverLocationService: Boolean,
    val gpsTrackRetention: Boolean,
)

/**
 * 위치 동의 3층 현재 상태(V1.3 location_consent_state).
 * L1 osPermission(OS 미러) · L2 legalConsent(LOCATION_TERMS 파생) · L3 gpsRecordingOptIn(GPS_RECORDING 파생).
 * 불변 — 전이는 새 인스턴스. 능력은 [capabilities] 총함수로만 도출(상태에 저장하지 않음).
 */
class LocationConsent private constructor(
    val accountId: AccountId,
    val osPermission: OsPermission,
    val legalConsent: Boolean,
    val gpsRecordingOptIn: Boolean,
    val updatedAt: Instant,
) {
    /** G182 총함수 — 서버전송=L1∧L2, GPS발자취=L1∧L2∧L3. L1 은 GRANTED 만 활성(DENIED·미결정=차단, INV-L3). */
    fun capabilities(): LocationCapabilities {
        val serverLocationService = osPermission == OsPermission.GRANTED && legalConsent
        return LocationCapabilities(
            serverLocationService = serverLocationService,
            gpsTrackRetention = serverLocationService && gpsRecordingOptIn,
        )
    }

    fun withOsPermission(value: OsPermission, now: Instant) = copy(osPermission = value, updatedAt = now)

    fun withLegalConsent(value: Boolean, now: Instant) = copy(legalConsent = value, updatedAt = now)

    fun withGpsRecordingOptIn(value: Boolean, now: Instant) = copy(gpsRecordingOptIn = value, updatedAt = now)

    private fun copy(
        osPermission: OsPermission = this.osPermission,
        legalConsent: Boolean = this.legalConsent,
        gpsRecordingOptIn: Boolean = this.gpsRecordingOptIn,
        updatedAt: Instant = this.updatedAt,
    ) = LocationConsent(accountId, osPermission, legalConsent, gpsRecordingOptIn, updatedAt)

    companion object {
        /** 미설정 계정의 기본 상태 — 모든 층 비활성(권한 NOT_DETERMINED). 미저장 파생값. */
        fun initial(accountId: AccountId, now: Instant): LocationConsent =
            LocationConsent(accountId, OsPermission.NOT_DETERMINED, legalConsent = false, gpsRecordingOptIn = false, now)

        fun reconstitute(
            accountId: AccountId,
            osPermission: OsPermission,
            legalConsent: Boolean,
            gpsRecordingOptIn: Boolean,
            updatedAt: Instant,
        ): LocationConsent = LocationConsent(accountId, osPermission, legalConsent, gpsRecordingOptIn, updatedAt)
    }
}
