package com.trippilot.archive.adapter.`in`.event

import com.trippilot.archive.application.VisitRecordService
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * GPS 기록 동의(L3)가 꺼지면 **이미 저장된 EXIF 좌표를 지운다**(INV-L4).
 *
 * 게이팅만으로는 부족하다 — 그건 "앞으로 들어올 좌표"를 막을 뿐이고, 철회 이전에 저장된 좌표는
 * 그대로 남는다. 게이팅이 잘 도는 탓에 지켜지는 것처럼 보여 더 안 드러나던 구멍이다.
 *
 * 멱등: 좌표를 null 로 만드는 일이라 두 번 배달돼도(at-least-once) 결과가 같다. 두 번째는 지울 것이
 * 없어 파기 기록도 남지 않는다 — 건수가 부풀지 않는다.
 *
 * ⚠ 파기가 계속 실패하면(릴레이 상한 10회) 좌표가 **남은 채 포기된다.** 그 사실은 릴레이의
 * `error` 로그와 `WHERE published_at IS NULL AND attempts >= 10` 조회로만 드러난다 — 파기는
 * 법적 요구라 그 조회를 운영에서 실제로 보는 장치가 필요하다(관측 티켓 범위).
 *
 * ⚠ 릴레이는 **구독자를 붙인 시점 이후** 이벤트만 준다. 이 배포 전에 철회한 계정의 좌표는 남아 있고,
 * 소급은 `location_consent_state` 를 훑는 별도 배치가 필요하다(이 티켓 밖).
 */
@Component
class GpsRecordingOptOutSubscriber(
    private val records: VisitRecordService,
) : OutboxSubscriber {

    override val eventType: String = "auth.GpsRecordingOptOut"

    override fun handle(envelope: EventEnvelope) {
        // 집계 식별자가 곧 계정이다(auth 가 그렇게 싣는다). 못 읽으면 예외로 올려 릴레이가 재시도한다 —
        // 조용히 건너뛰면 "철회했는데 좌표가 남은" 상태가 되고 그것을 아무도 모른다(INV-4).
        val accountId = runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
            ?: error("GpsRecordingOptOut 의 aggregateId 를 계정으로 읽지 못했습니다. eventId=${envelope.eventId}")

        val purged = records.purgeExifCoordinates(accountId)
        log.info("위치 동의 철회로 EXIF 좌표를 파기했습니다. accountId={} 건수={}", accountId, purged)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(GpsRecordingOptOutSubscriber::class.java)
    }
}
