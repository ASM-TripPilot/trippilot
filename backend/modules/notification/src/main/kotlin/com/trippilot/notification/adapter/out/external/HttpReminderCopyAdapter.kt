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
        // 계약 enum 밖의 종류는 **보내기 전에** 거른다 — 실으면 그 한 건 때문에 요청 전체가 422 다.
        // 재료가 빈 항목도 뺀다 — 아래 이유가 크다.
        val sendable = items.filter { it.kind.name in AI_KINDS && it.slots.isNotEmpty() }
        val starved = items.count { it.kind.name in AI_KINDS && it.slots.isEmpty() }
        if (starved > 0) {
            // **빈 재료로 물으면 상대가 없는 사실을 지어낸다.** 실측(2026-09-16 실 왕복):
            // slots=[] 로 물었더니 "오늘은 별도의 일정이 없으니 여유롭게…" 가 돌아왔다 —
            // 일정이 꽉 찬 날에 나가면 **거짓말**이다. 상수 문구("오늘의 일정")는 적어도 참이다.
            log.info("재료(slots)가 빈 예약 {}건은 묻지 않습니다 — 빈 입력에는 상대가 '일정 없음'을 지어냅니다.", starved)
        }
        if (sendable.size != items.size) {
            log.warn("상대가 모르는 알림 종류 {}건을 뺐습니다 — 계약 enum 은 {} 뿐입니다.", items.size - sendable.size, AI_KINDS)
        }
        if (sendable.isEmpty()) return emptyMap()

        // 계약 상한(`maxItems: 30`)을 넘기면 **한 건도 못 받는다.** 긴 여행은 하루 1건씩 쌓여
        // 한 달이면 넘는다 — 나눠 보내고 결과를 합친다. 한 묶음이 실패해도 나머지는 산다.
        return sendable.chunked(MAX_ITEMS).fold(emptyMap()) { acc, chunk ->
            acc + runCatching { call(tripTitle, chunk) }
                .onFailure { log.warn("리마인드 문구 호출 실패 — 그 묶음은 상수 문구로 갑니다. base={}", properties.baseUrl, it) }
                .getOrDefault(emptyMap())
        }
    }

    private fun call(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
        val body = AiReminderCopyRequest(
            requestMeta = AiReminderRequestMeta(UUID.randomUUID().toString(), clock.instant(), properties.deadlineMs),
            items = items.map {
                AiReminderCopyItem(
                    scheduleKey = it.scheduleKey,
                    kind = it.kind.name,
                    date = it.date.toString(),
                    slots = it.slots.map { name -> AiReminderSlot(name) },
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

    internal companion object {
        private val log = LoggerFactory.getLogger(HttpReminderCopyAdapter::class.java)
        private const val COPIES_PATH = "/ai/v1/notification/copies"

        /** 계약 enum. 우리 종류는 여덟인데 상대가 받는 것은 둘뿐이다. */
        private val AI_KINDS = setOf("TRIP_DAY", "TRIP_PRE")

        /** 계약 `maxItems`. 넘기면 요청 전체가 422 라 나눠 보낸다. */
        private const val MAX_ITEMS = 30

        /**
         * 계약 게이트가 **생산 값 그대로** 대조하도록 연다. 테스트가 값을 다시 적으면
         * 자기 사본을 보고 통과한다(이 리포에서 겪은 함정).
         */
        internal fun aiKinds(): Set<String> = AI_KINDS
        internal fun maxItems(): Int = MAX_ITEMS

        /** `notification_schedule` 컬럼 폭(V2.47)과 같은 값. 넘으면 저장이 실패하므로 여기서 거른다. */
        private const val TITLE_MAX = 60
        private const val BODY_MAX = 200
    }
}
