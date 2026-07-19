package com.trippilot.auth.application

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.ConsentChannel
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.location.LocationConsent
import com.trippilot.auth.domain.location.LocationLegalEvent
import com.trippilot.auth.domain.location.LocationLegalEventType
import com.trippilot.auth.domain.location.OsPermission
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.auth.domain.port.LocationConsentStateRepository
import com.trippilot.auth.domain.port.LocationLegalLogRepository
import com.trippilot.auth.domain.port.TermsVersionRepository
import com.trippilot.core.error.ResourceNotFound
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant

/**
 * 위치 동의 3층 관리(TRIP-155). L1 OS 미러 · L2 법정동의 · L3 GPS 옵트인.
 *
 * L2/L3 변경은 consent_record 증적(LOCATION_TERMS·GPS_RECORDING, 채널 SETTINGS) + location_legal_log 를
 * 남기고, L3 철회 시 GPS 발자취 파기(PURGE)를 트리거한다(INV-L4). L1 은 순수 미러라 부수효과 없음(INV-L3).
 * 유효 능력(G182)은 도메인 [LocationConsent.capabilities] 총함수로만 도출한다.
 */
@Service
class LocationConsentService(
    private val stateRepository: LocationConsentStateRepository,
    private val legalLog: LocationLegalLogRepository,
    private val terms: TermsVersionRepository,
    private val consentRecords: ConsentRecordRepository,
    private val clock: Clock,
) {
    /** 현재 3층 상태 — 미설정 계정은 기본값(모든 층 비활성). */
    @Transactional(readOnly = true)
    fun get(accountId: AccountId): LocationConsent =
        stateRepository.find(accountId) ?: LocationConsent.initial(accountId, clock.instant())

    /**
     * L2(법정)·L3(GPS) 변경. null 은 변경 없음. 실제 값이 바뀔 때만 증적·로그를 남긴다.
     * L3 철회 시 발자취 파기(PURGE) 트리거(INV-L4). L2 철회는 능력 파생으로 차단되며 L3 는 보존한다.
     */
    @Transactional
    fun update(accountId: AccountId, legalConsent: Boolean?, gpsRecordingOptIn: Boolean?): LocationConsent {
        val now = clock.instant()
        var state = stateRepository.find(accountId) ?: LocationConsent.initial(accountId, now)

        if (legalConsent != null && legalConsent != state.legalConsent) {
            recordConsentChange(accountId, TermsType.LOCATION_TERMS, legalConsent, now)
            state = state.withLegalConsent(legalConsent, now)
        }
        if (gpsRecordingOptIn != null && gpsRecordingOptIn != state.gpsRecordingOptIn) {
            recordConsentChange(accountId, TermsType.GPS_RECORDING, gpsRecordingOptIn, now)
            state = state.withGpsRecordingOptIn(gpsRecordingOptIn, now)
            if (!gpsRecordingOptIn) {
                // L3 철회 → GPS 발자취 즉시 파기 트리거(INV-L4). 발자취 저장소는 후속 유닛 — 여기선 법정 로그로 사실 기록.
                legalLog.append(
                    LocationLegalEvent.of(
                        accountId, LocationLegalEventType.PURGE,
                        mapOf("scope" to "gps_track", "reason" to "L3_REVOKED"), now,
                    ),
                )
            }
        }
        return stateRepository.save(state)
    }

    /** L1 OS 권한 미러 보고(단말→서버). 순수 반영 — 증적·로그·파기 없음(INV-L3). L2/L3 은 보존된다. */
    @Transactional
    fun mirrorOsPermission(accountId: AccountId, osPermission: OsPermission) {
        val now = clock.instant()
        val state = (stateRepository.find(accountId) ?: LocationConsent.initial(accountId, now))
            .withOsPermission(osPermission, now)
        stateRepository.save(state)
    }

    /** L2/L3 전이를 consent_record(채널 SETTINGS) + location_legal_log(GRANTED/REVOKED)로 이중 기록. */
    private fun recordConsentChange(accountId: AccountId, termsType: TermsType, granted: Boolean, now: Instant) {
        val version = terms.findCurrent(termsType, now)?.version
            ?: throw ResourceNotFound("현행 약관을 찾을 수 없습니다: $termsType")
        val action = if (granted) ConsentAction.GRANT else ConsentAction.REVOKE
        consentRecords.append(ConsentRecord.of(accountId, termsType, version, action, ConsentChannel.SETTINGS, now))
        legalLog.append(
            LocationLegalEvent.of(
                accountId,
                if (granted) LocationLegalEventType.CONSENT_GRANTED else LocationLegalEventType.CONSENT_REVOKED,
                mapOf("termsType" to termsType.name, "version" to version, "channel" to ConsentChannel.SETTINGS.name),
                now,
            ),
        )
    }
}
