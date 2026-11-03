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
            //   TRIP_DAY  slots=[] → "오늘은 정해진 일정 없이 여유롭게 이번 여행을 즐겨보세요"
            //   TRIP_PRE  slots=[] → "내일은 등록된 일정이 없으니 여행 계획을 가볍게 다시 확인해 보세요"
            // 둘 다 **일정이 있는 날에 나가면 거짓말**이다 — 종류를 가리지 않는다("TRIP_PRE 는 원래
            // 슬롯이 없으니 풀어도 되지 않나"가 틀린 이유다). 상수 문구는 밋밋해도 참이다.
            // 슬롯 이름을 실으면 그 이름을 쓴 정상 문구가 온다 — 재료가 답의 진위를 가른다(TRIP-883).
            log.info("재료(slots)가 빈 예약 {}건은 묻지 않습니다 — 빈 입력에는 상대가 '일정 없음'을 지어냅니다.", starved)
        }
        // 종류만 센다 — `sendable` 은 재료가 빈 항목도 빼므로 그 차이를 세면 '모르는 종류'가 아닌 것까지 경고가 된다.
        val unknownKinds = items.count { it.kind.name !in AI_KINDS }
        if (unknownKinds > 0) {
            log.warn("상대가 모르는 알림 종류 {}건을 뺐습니다 — 계약 enum 은 {} 뿐입니다.", unknownKinds, AI_KINDS)
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
                    slots = it.slots.map { s -> AiReminderSlot(s.name, s.category) },
                )
            },
            tripTitle = tripTitle,
        )
        val res = client.post().uri(COPIES_PATH).body(body)
            .retrieve().body(AiReminderCopyResponse::class.java)
            ?: return emptyMap()

        // **degraded 는 "빠진 항목이 있다"는 뜻이다**(계약: "빠진 항목은 백엔드가 기존 상수로 채운다 — degraded 가
        // 그 사실의 증빙"). 상대는 실패·게이트 탈락 항목만 `copies` 에서 빼고 통과한 문구는 그대로 준다 — 상대가 규칙
        // 문구를 지어 넣는 일은 없다(`fallback_mode=backend_constant`). 종전에는 degraded 면 온 문구까지 전부 버렸다:
        // 운영 48시간에 일부만 빠진 요청이 16건이었고 그만큼의 멀쩡한 문구(31건)가 상수로 돌아갔다.
        // 빠진 자리는 호출자가 상수 문구로 둔다(`NotificationSchedulePersistence` 의 null 제목 → 발화가 상수를 쓴다).
        if (res.degraded) {
            log.info(
                "상대가 일부 항목을 못 만들었습니다(degraded) — 받은 {}건은 쓰고 나머지는 상수 문구를 씁니다. mode={}",
                res.copies.size, res.fallbackMode,
            )
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
