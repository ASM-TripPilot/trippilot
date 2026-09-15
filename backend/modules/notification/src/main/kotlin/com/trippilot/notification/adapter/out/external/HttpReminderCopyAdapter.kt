package com.trippilot.notification.adapter.out.external

import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import org.slf4j.LoggerFactory
import org.springframework.web.client.RestClient
import java.time.Clock
import java.util.UUID

/**
 * 실 AI 리마인드 문구 경계(`POST /ai/v1/notification/copies` · TRIP-836).
 *
 * **못 받는 것이 정상 경로다.** 예외를 위로 올리지 않고 빈 맵으로 낮춘다 — 문구를 못 받았다고
 * 예약 적재가 실패하면 리마인드가 통째로 사라지는데, 그건 문구가 밋밋한 것보다 훨씬 나쁘다(INV-4).
 * 다만 **조용히 내려가지는 않는다**: 사유를 여기서 남겨야 "AI 를 켰는데 왜 늘 상수 문구냐"에 답할 수 있다.
 */
class HttpReminderCopyAdapter(
    private val client: RestClient,
    private val properties: ReminderCopyProperties,
    private val clock: Clock,
) : ReminderCopyPort {

    override val enabled = true

    override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
        if (items.isEmpty()) return emptyMap()
        return runCatching { call(tripTitle, items) }
            .onFailure { log.warn("리마인드 문구 호출 실패 — 상수 문구로 갑니다. base={}", properties.baseUrl, it) }
            .getOrDefault(emptyMap())
    }

    private fun call(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
        val body = AiReminderCopyRequest(
            requestMeta = AiReminderRequestMeta(UUID.randomUUID().toString(), clock.instant(), properties.deadlineMs),
            items = items.map {
                AiReminderCopyItem(
                    scheduleKey = it.scheduleKey,
                    kind = it.kind.name,
                    date = it.date.toString(),
                    slots = it.slots,
                )
            },
            tripTitle = tripTitle,
        )
        val res = client.post().uri(COPIES_PATH).body(body)
            .retrieve().body(AiReminderCopyResponse::class.java)
            ?: return emptyMap()

        // 상대가 규칙 문구로 내려갔다 — 그것을 AI 문구로 저장하면 품질 관측이 거짓이 된다.
        // 우리 상수 문구와 다를 바 없으므로 받지 않고 그쪽으로 간다.
        if (res.degraded) {
            log.info("상대가 규칙 문구로 내려갔습니다(degraded) — 상수 문구를 씁니다. mode={}", res.fallbackMode)
            return emptyMap()
        }

        val requested = items.mapTo(mutableSetOf()) { it.scheduleKey }
        return res.copies.asSequence()
            // **보낸 적 없는 키는 버린다.** 상대가 키를 지어내면 엉뚱한 예약에 문구가 붙는다 —
            // 그 오류는 사용자 화면에 "다른 날 이야기"로 나타나 원인을 되짚기 가장 어렵다.
            .filter { it.scheduleKey in requested }
            .filter { it.title.isNotBlank() && it.body.isNotBlank() }
            // 넘치면 **자르지 않고 버린다**(V2.47 주석) — 잘린 문장을 보이느니 상수 문구가 낫다.
            .filter { it.title.length <= TITLE_MAX && it.body.length <= BODY_MAX }
            .associate { it.scheduleKey to ReminderCopy(it.title, it.body) }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(HttpReminderCopyAdapter::class.java)
        private const val COPIES_PATH = "/ai/v1/notification/copies"

        /** `notification_schedule` 컬럼 폭(V2.47)과 같은 값. 넘으면 저장이 실패하므로 여기서 거른다. */
        private const val TITLE_MAX = 60
        private const val BODY_MAX = 200
    }
}
