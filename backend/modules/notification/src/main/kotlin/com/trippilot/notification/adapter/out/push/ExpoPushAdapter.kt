package com.trippilot.notification.adapter.out.push

import com.fasterxml.jackson.annotation.JsonInclude
import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushRateLimited
import com.trippilot.notification.domain.PushReceipt
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushUrgency
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Component
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.HttpClientErrorException
import org.springframework.web.client.RestClient
import java.time.Duration

/**
 * Expo Push Service 어댑터 — **expo 모드에서만 활성**(기본은 기록만 하는 [LoggingPushAdapter]).
 *
 * 한 번의 POST 로 여러 메시지를 보내고, **입력 순서 그대로** 티켓 배열을 받는다. 그 순서가 곧
 * 토큰과 결과의 대응이라, 배열 길이가 다르면 어느 결과가 어느 기기 것인지 알 수 없다 —
 * 그때는 전부 실패로 다룬다(잘못 대응시켜 죽지 않은 토큰을 무효화하는 것보다 낫다).
 *
 * `DeviceNotRegistered` 는 **여기서 판정한다**(INV-U6-07) — Expo 의 오류 코드를 도메인 상태로
 * 옮기는 것이 어댑터의 일이다. 도메인은 Expo 를 모른다.
 *
 * ⚠ **CI 에서 이 빈은 뜨지 않는다.** 게이트 정책이 "외부 API 호출 0회"라 테스트 설정은 모드를
 * 켜지 않는다. 실 왕복은 사람이 켜서 한 번 태운다.
 */
@Component
@Primary
@ConditionalOnProperty(name = ["trippilot.push.mode"], havingValue = "expo")
class ExpoPushAdapter(
    @param:Value("\${trippilot.push.expo.access-token:}") private val accessToken: String,
    @param:Qualifier(ExpoPushClientConfiguration.BEAN_NAME) private val client: RestClient,
) : PushPort {

    /** 실제 Expo Push Service 로 나간다. */
    override val deliversExternally = true

    override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> {
        val payload = tokens.map {
            ExpoPushRequest(
                to = it, title = message.title, body = message.body, data = message.data,
                interruptionLevel = message.urgency.expoInterruptionLevel(),
                priority = message.urgency.expoPriority(),
                sound = message.urgency.expoSound(),
                ttl = message.urgency.expoTtlSeconds(),
            )
        }
        val response = try {
            client.post()
                .uri("/--/api/v2/push/send")
                .headers { h ->
                    // 프로젝트가 "enhanced security" 를 켰을 때만 필요하다. 비어 있으면 헤더를 아예 안 보낸다 —
                    // 빈 Bearer 를 보내면 401 이라, 안 켠 프로젝트에서 오히려 실패한다.
                    if (accessToken.isNotBlank()) h.setBearerAuth(accessToken)
                }
                .body(payload)
                .retrieve()
                .body(ExpoPushResponse::class.java)
        } catch (e: HttpClientErrorException.TooManyRequests) {
            // 프로젝트 발송량 한도(COST-U6-04 재평가 트리거). 응용층이 웹 예외를 몰라도 구분할 수 있게 도메인 타입으로 올린다.
            throw PushRateLimited(e.message, e)
        }

        val tickets = response?.data.orEmpty()
        if (tickets.size != tokens.size) {
            // 대응을 잃었다. 죽지 않은 토큰을 무효화하는 것이 더 나쁘므로 전부 FAILED 로 둔다.
            log.warn("Expo 응답 티켓 수({})가 요청 토큰 수({})와 다릅니다.", tickets.size, tokens.size)
            return tokens.map { PushReceipt(it, PushStatus.FAILED, "TICKET_COUNT_MISMATCH") }
        }
        return tokens.zip(tickets) { token, ticket -> ticket.toReceipt(token) }
    }

    private fun ExpoPushTicket.toReceipt(token: String): PushReceipt = when {
        // 접수. 티켓 id 는 영수증 조회의 열쇠라 같이 돌려준다 — id 가 없는 ok 는 접수는 됐지만 도착을 추적할 수 없다.
        status == "ok" -> PushReceipt(token, PushStatus.SENT, ticketId = id?.takeIf { it.isNotBlank() })
        details?.error == DEVICE_NOT_REGISTERED -> PushReceipt(token, PushStatus.DEVICE_NOT_REGISTERED, DEVICE_NOT_REGISTERED)
        else -> PushReceipt(token, PushStatus.FAILED, details?.error ?: message ?: "UNKNOWN")
    }

    /**
     * iOS 전용. Android 는 이 값을 무시하고 **채널 중요도**로 같은 일을 하는데, 채널은 앱이 먼저
     * 만들어야 한다 — 없는 `channelId` 를 실어 보내면 안드로이드에서 **알림이 아예 표시되지 않는다.**
     * 프론트에 `setNotificationChannelAsync` 가 아직 없어(2026-09-02 실측) `channelId` 는 싣지 않는다.
     */
    private fun PushUrgency.expoInterruptionLevel(): String = when (this) {
        PushUrgency.PASSIVE -> "passive"
        PushUrgency.ACTIVE -> "active"
        PushUrgency.TIME_SENSITIVE -> "time-sensitive"
    }

    /**
     * Android 에 닿는 유일한 신호다(위 사유로 채널을 못 쓰는 동안). `high` 는 잠든 기기를 깨울 수 있어
     * 시간 민감에만 쓴다 — 남발하면 배터리 영향이 있고 사용자가 앱 알림을 통째로 끈다.
     *
     * ⚠ **안드로이드에서는 3단이 아니라 2단이다.** Expo 의 `default` 는 플랫폼별로 해석되는데
     * Android 에서는 `normal` 과 같다 — 즉 [PushUrgency.ACTIVE] 와 [PushUrgency.PASSIVE] 가
     * 그 기기에서 **구분되지 않는다.** iOS 는 `interruptionLevel` 로 셋이 갈린다.
     * 안드로이드에서 셋을 가르려면 채널이 필요하고, 그건 프론트가 채널을 만든 뒤의 일이다.
     */
    private fun PushUrgency.expoPriority(): String = when (this) {
        PushUrgency.TIME_SENSITIVE -> "high"
        PushUrgency.ACTIVE -> "default"
        PushUrgency.PASSIVE -> "normal"
    }

    /**
     * iOS 소리. Expo 는 `sound` 를 싣지 않으면 **소리 없이 배너만** 올린다(Expo 푸시 계약 — 지식 기반) — "도착은 했는데 아무도
     * 모르는" 리마인드가 된다. 긴급도가 보통 이상이면 기본 소리를 내고, 조용한 등급(회고·커뮤니티)은 싣지 않는다.
     * Android 의 소리는 채널이 정한다(이 필드는 iOS 전용).
     */
    private fun PushUrgency.expoSound(): String? = when (this) {
        PushUrgency.PASSIVE -> null
        PushUrgency.ACTIVE, PushUrgency.TIME_SENSITIVE -> "default"
    }

    /**
     * 기기가 꺼져 있을 때 메시지를 **얼마나 붙들어 둘지**(초). 안 싣으면 제공자 기본을 따른다 — APNs 는 0(즉시 못 가면 버림),
     * FCM 은 4주라서 안드로이드에서는 꺼 둔 기기가 켜질 때 *며칠 전의* "오늘의 일정"·Plan-B 가 도착할 수 있다(지식 기반).
     * 시각이 의미인 알림일수록 짧게 둔다. iOS 도 값을 주면 그 시간 안에는 기기가 다시 켜질 때 한 번 전달된다.
     */
    private fun PushUrgency.expoTtlSeconds(): Int = when (this) {
        PushUrgency.TIME_SENSITIVE -> 2 * HOUR   // Plan-B·일정 시작 전 — 두 시간이 지나면 이미 지난 일이다
        PushUrgency.ACTIVE -> 6 * HOUR           // 오늘의 일정·여행 전날 — 그날 안
        PushUrgency.PASSIVE -> 24 * HOUR         // 회고·요약 — 하루
    }

    private companion object {
        private const val HOUR = 3_600

        /** Expo 가 죽은 토큰에 주는 코드. 이 문자열이 INV-U6-07 의 방아쇠다. */
        private const val DEVICE_NOT_REGISTERED = "DeviceNotRegistered"

        private val log = LoggerFactory.getLogger(ExpoPushAdapter::class.java)
    }
}

/** Expo 로 보내는 메시지 한 건. 필드명은 Expo 와이어 그대로다. 값이 없는 필드는 키째로 뺀다(`null` 을 실으면 Expo 가 거절할 수 있다). */
@JsonInclude(JsonInclude.Include.NON_NULL)
internal data class ExpoPushRequest(
    val to: String,
    val title: String,
    val body: String,
    val data: Map<String, String>,
    /** iOS `UNNotificationInterruptionLevel`. 집중 모드를 뚫는지가 여기서 갈린다. */
    val interruptionLevel: String,
    /** `default | normal | high`. Android 에서 잠든 기기를 깨울지가 여기서 갈린다. */
    val priority: String,
    /** iOS 소리. `"default"` 를 싣지 않으면 소리 없는 배너다. */
    val sound: String? = null,
    /** 초. 꺼진 기기에 메시지를 붙들어 두는 시간 — 안 싣으면 제공자 기본(FCM 4주). */
    val ttl: Int? = null,
)

/** Expo 응답 — 판정에 쓰는 것만 받는다. */
internal data class ExpoPushResponse(val data: List<ExpoPushTicket> = emptyList())

internal data class ExpoPushTicket(
    /** `status=ok` 에만 온다. 영수증 응답(`getReceipts`)이 이 id 를 키로 돌아온다. */
    val id: String? = null,
    val status: String? = null,
    val message: String? = null,
    val details: ExpoPushTicketDetails? = null,
)

internal data class ExpoPushTicketDetails(val error: String? = null)

/** Expo 전용 RestClient. 모드가 켜졌을 때만 만든다 — 안 쓰는 커넥션 풀을 늘 띄우지 않는다. */
@Configuration
@ConditionalOnProperty(name = ["trippilot.push.mode"], havingValue = "expo")
class ExpoPushClientConfiguration {

    /**
     * **연결·읽기 시한이 있다.** 기본 요청 팩토리는 시한을 안 걸어서, exp.host 가 연결만 받고 응답을 안 주면
     * 이 호출을 감싼 발화 폴러·아웃박스 릴레이 스레드와 DB 트랜잭션이 풀리지 않는다 — 오류도 로그도 없이
     * 리마인드·사건 알림이 통째로 멈추고, 재시작 뒤엔 밀린 예약이 유예(10분)를 넘겨 영구 취소된다.
     * 시한을 넘기면 예외가 올라가 `PUSH_ERROR` 로 기록되고(알림함에는 이미 남아 있다) 다음 발화로 넘어간다.
     * 리마인드 문구 경계([com.trippilot.notification.adapter.out.external.ReminderCopyConfiguration])가
     * 같은 이유로 이미 시한을 건다.
     */
    @Bean(BEAN_NAME)
    fun expoPushRestClient(
        @Value("\${trippilot.push.expo.base-url:https://exp.host}") baseUrl: String,
        @Value("\${trippilot.push.expo.connect-timeout-ms:$DEFAULT_CONNECT_TIMEOUT_MS}") connectTimeoutMs: Long,
        @Value("\${trippilot.push.expo.read-timeout-ms:$DEFAULT_READ_TIMEOUT_MS}") readTimeoutMs: Long,
    ): RestClient = RestClient.builder()
        .baseUrl(baseUrl)
        .requestFactory(
            SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(Duration.ofMillis(connectTimeoutMs))
                setReadTimeout(Duration.ofMillis(readTimeoutMs))
            },
        )
        .build()

    companion object {
        /** 앱에 RestClient 빈이 여럿이라 이름으로 집는다(카카오 클라이언트 선례). */
        const val BEAN_NAME = "expoPushRestClient"

        /** 발송은 정상이면 1초 안쪽이다. 한 번 막혀도 폴러(60초)·릴레이(락 5분)를 오래 못 잡도록 짧게 둔다. */
        const val DEFAULT_CONNECT_TIMEOUT_MS = 3_000L
        const val DEFAULT_READ_TIMEOUT_MS = 10_000L
    }
}
