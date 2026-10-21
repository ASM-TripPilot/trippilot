package com.trippilot.notification.adapter.`in`.event

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.notification.application.NotificationRaiseService
import com.trippilot.notification.application.PushPolicy
import com.trippilot.notification.domain.NotificationAction
import com.trippilot.notification.domain.NotificationKind
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.Duration
import java.util.UUID

/**
 * 도메인 사건 → 알림 적재(TRIP-550 · U6 §2.1).
 *
 * 세 구독자가 한 파일에 있는 이유는 **셋이 같은 모양**이기 때문이다 — payload 에서 계정과 문구
 * 재료를 꺼내 `NotificationRaiseService` 에 넘긴다. 나눠 두면 같은 다섯 줄이 세 번 반복된다.
 *
 * ## 멱등은 DB 가 한다
 *
 * `source_event_id` UNIQUE 가 중복 적재를 막는다(INV-U6-01 · BR-U6-34). 릴레이는 at-least-once 라
 * 같은 이벤트가 두 번 온다 — 앱에서 "이미 있나" 검사하면 두 인스턴스가 동시에 통과한다.
 *
 * ## payload 를 못 읽으면 예외로 올린다
 *
 * 릴레이가 재시도하고 상한에서 error 로 남긴다. 조용히 건너뛰면 "알림이 왜 안 오나"를 영영 못
 * 찾는다(INV-4).
 */
@Component
class StayRegisteredSubscriber(
    private val notifications: NotificationRaiseService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "stay.StayRegistered"

    override fun handle(envelope: EventEnvelope) {
        val payload = envelope.payloadTree(mapper)
        val accountId = payload.uuid("accountId")
            ?: error("StayRegistered payload 에서 accountId 를 읽지 못했습니다. eventId=${envelope.eventId}")
        // 빈·공백 이름도 없는 것과 같다 — 그대로 실으면 본문 검증(1~400자)에 걸려 재시도마다 같은 예외로 끝내 유실된다.
        val name = payload.text("name")?.takeIf { it.isNotBlank() } ?: "숙소"
        notifications.raise(
            accountId = accountId,
            kind = NotificationKind.STAY,
            title = "숙소가 등록됐어요",
            // 이름만 싣는다(BR-U6-01 개정 · TRIP-1066). 날짜는 FE 가 등록에 보내지 않게 되면서(TRIP-1052)
            // "null ~ null" 로 나가던 자리다 — 없는 값을 본문에 채우지 않는다(BR-U6-03).
            body = name,
            sourceEventId = envelope.eventId,
            // 같은 숙소를 다시 등록하는 일은 없지만(행이 새로 생긴다), 억제 판정의 재료는 남긴다.
            dedupKey = "STAY#${envelope.aggregateId}",
            actionType = NotificationAction.STAY_DETAIL,
            actionPayload = mapOf("savedStayId" to envelope.aggregateId),
        )
    }

}

/**
 * Plan-B 발화 → `PLAN_B` 알림.
 *
 * **발화한 것만 온다**(INV-U4-01) — 억제·무영향 판정은 발행 자체가 되지 않는다. 여기서 다시
 * 거르지 않는 이유가 그것이다: 규칙이 두 곳에 흩어지면 한쪽만 고쳐도 아무도 모른다.
 *
 * **푸시 여부는 사건이 정한다**(BR-SA-21 ② · DEC-SA-5) — `kind`·`push`·`others` 를 트리로 읽는다.
 * 발행처는 하나(`TriggerService.eventOf`)이고 날씨 확인(`evaluate`)도 거기를 지나 언제나 `push` 를 싣는다 — 위험
 * 대표 ∧ 트리거 하루 푸시 상한(민감도별) 안이면 true, 아니면 false(알림함만). U10 지연은 아직 발행처가 없다 —
 * `evaluate` 를 지나면 같은 규칙을 받는다. `push` 가 없는 것은 새 필드가 생기기 전에 발행돼 배포 순간 아웃박스에
 * 남아 있던 옛 사건(위치 인자 6개)뿐이고, 종전처럼 푸시 대상이되 제목도 종전 그대로다(BR-SA-21 ①).
 */
@Component
class PlanBTriggeredSubscriber(
    private val notifications: NotificationRaiseService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "planb.PlanBTriggered"

    override fun handle(envelope: EventEnvelope) {
        val payload = envelope.payloadTree(mapper)
        val accountId = payload.uuid("accountId")
            ?: error("PlanBTriggered payload 에서 accountId 를 읽지 못했습니다. eventId=${envelope.eventId}")
        val tripId = payload.text("tripId").orEmpty()
        val kind = payload.text("kind")
        val push = payload.get("push")?.takeIf { !it.isNull }
        // 어휘 밖 값은 옛 제목으로 알림함에만 둔다(BR-SA-21 ③) — 잘못 들어온 값이 기기를 울리면 안 된다.
        val unknown = !PlanBNotificationCopy.isKnownKind(kind) || (push != null && !push.isBoolean)
        if (unknown) {
            log.warn("Plan-B 사건의 kind·push 를 모릅니다 — 옛 제목으로 알림함에만 둡니다. kind={} push={} eventId={}", kind, push, envelope.eventId)
        }
        // 새 필드가 없는 옛 사건은 종전 제목이다(BR-SA-21 ① '그 밖·옛 사건') — kind 제목은 새 사건만 받는다.
        val legacy = push == null
        notifications.raise(
            accountId = accountId,
            kind = NotificationKind.PLAN_B,
            title = PlanBNotificationCopy.title(kind.takeUnless { unknown || legacy }),
            // 사유는 있으면 싣는다 — "왜 바꾸라는지" 없이 오는 알림은 사용자가 무시한다.
            body = PlanBNotificationCopy.body(payload.text("reason"), payload.get("others")?.intValue() ?: 0),
            sourceEventId = envelope.eventId,
            // 같은 여행·같은 슬롯의 반복 발화를 억제 판정이 볼 수 있게 한다(BR-U6-34 재료).
            dedupKey = "PLAN_B#$tripId#${payload.text("slotKey").orEmpty()}",
            // 일정 화면이 아니라 **재계획 진입**이다(BR-U6-08 '대안 일정 보기'). 일정만 열어 주면
            // 사용자가 알림을 읽고도 무엇을 하라는 것인지 다시 찾아야 한다.
            actionType = NotificationAction.PLANB_REPLAN,
            // 어느 트리거로 열린 재계획인지 실어야 화면이 사유를 다시 물어보지 않는다.
            // 날짜·세션 id 는 싣지 않는다 — 앱이 탭 시점에 트리거 상세와 준비된 대안을 조회한다(BR-SA-21 ④).
            actionPayload = mapOf("tripId" to tripId, "triggerId" to envelope.aggregateId),
            push = when {
                unknown || push?.booleanValue() == false -> PushPolicy.InAppOnly
                // 같은 여행 Plan-B 푸시는 10분에 1번이다(BR-U6-09 개정) — dedupKey 의 여행 접두로 묶는다.
                else -> PushPolicy.OncePer("PLAN_B#$tripId#", PUSH_WINDOW)
            },
        )
    }

    private companion object {
        private val PUSH_WINDOW: Duration = Duration.ofMinutes(10)

        private val log = LoggerFactory.getLogger(PlanBTriggeredSubscriber::class.java)
    }
}

/**
 * 회고 준비됨 → `REFLECTION` 알림.
 *
 * **발행부는 이미 있다**(U5 가 회고·요약 생성 시 낸다) — 이 티켓에서 만든 것은 구독·매핑뿐이다.
 * 하루 회고(`DAILY`)와 여행 요약(`SUMMARY`)이 같은 이벤트로 오므로 문구를 `kind` 로 가른다.
 */
@Component
class ReflectionReadySubscriber(
    private val notifications: NotificationRaiseService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "reflection.ReflectionReady"

    override fun handle(envelope: EventEnvelope) {
        val payload = envelope.payloadTree(mapper)
        val tripId = payload.text("tripId")
            ?: error("ReflectionReady payload 에서 tripId 를 읽지 못했습니다. eventId=${envelope.eventId}")
        val tripUuid = runCatching { UUID.fromString(tripId) }.getOrNull()
            ?: error("ReflectionReady 의 tripId 가 UUID 가 아닙니다. tripId=$tripId eventId=${envelope.eventId}")
        // 이 이벤트는 계정을 싣지 않는다 — 여행 소유자를 물어 온다(R1: trip.api).
        val accountId = notifications.ownerOfTrip(tripUuid)
            ?: error("ReflectionReady 의 여행 소유자를 찾지 못했습니다. tripId=$tripId eventId=${envelope.eventId}")
        val summary = payload.text("kind") == KIND_SUMMARY
        // 근거가 하나도 없어 **기본 카드**로 떨어진 회고다(BR-U6-12). 열어도 볼 것이 없으므로
        // 액션을 주지 않는다 — 액션 없는 알림을 "있는 척" 그리게 하면 사용자가 빈 화면에 도착한다(INV-4).
        val empty = payload.text("source") == SOURCE_BASIC
        val dayDate = payload.text("dayDate")
        if (!summary && dayDate == null) {
            error("ReflectionReady(DAILY) 에 dayDate 가 없습니다. eventId=${envelope.eventId}")
        }
        notifications.raise(
            accountId = accountId,
            kind = NotificationKind.REFLECTION,
            title = when {
                empty -> "회고를 만들지 못했어요"
                summary -> "여행 요약이 준비됐어요"
                else -> "오늘의 회고가 준비됐어요"
            },
            body = when {
                empty -> "기록할 활동이 없어 회고를 생성하지 못했습니다"
                summary -> "다녀온 곳을 한 장으로 모았어요"
                else -> "오늘 다녀온 곳을 정리했어요"
            },
            sourceEventId = envelope.eventId,
            // 하루 회고는 날짜까지 넣어야 여행 하나에 여러 장이 구분된다.
            dedupKey = "REFLECTION#$tripId#${dayDate.orEmpty()}",
            actionType = when {
                empty -> null
                summary -> NotificationAction.TRIP_SUMMARY
                else -> NotificationAction.REFLECTION_DAILY
            },
            // 하루 회고는 **어느 날짜**인지까지 실어야 화면이 여러 장 중 하나를 고를 수 있다.
            actionPayload = when {
                empty -> null
                summary -> mapOf("tripId" to tripId)
                else -> mapOf("tripId" to tripId, "dayDate" to dayDate!!)
            },
        )
    }

    private companion object {
        private const val KIND_SUMMARY = "SUMMARY"
        private const val SOURCE_BASIC = "BASIC"
    }
}

/** payload 는 트리로만 읽는다 — 발행측 DTO 를 참조하면 모듈 경계를 넘는다(R1). */
private fun EventEnvelope.payloadTree(mapper: ObjectMapper): JsonNode =
    runCatching { mapper.readTree(payload) }.getOrElse { error("payload 를 읽지 못했습니다. eventId=$eventId") }

private fun JsonNode.text(field: String): String? = get(field)?.takeIf { !it.isNull }?.asText()

private fun JsonNode.uuid(field: String): UUID? = text(field)?.let { runCatching { UUID.fromString(it) }.getOrNull() }
