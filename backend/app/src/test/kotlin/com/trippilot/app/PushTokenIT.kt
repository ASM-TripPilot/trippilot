package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.notification.adapter.out.push.LoggingPushAdapter
import com.trippilot.notification.application.PushDispatchService
import com.trippilot.notification.application.PushOutcome
import com.trippilot.notification.application.PushTokenService
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushTokenRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.types.shouldBeInstanceOf
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.util.UUID

/**
 * 푸시 토큰 실 DB 검증(TRIP-549 · V2.40).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **`token` UNIQUE 와 계정 이전** — 같은 토큰이 다른 계정으로 오면 `ON CONFLICT` 가 그 행을
 *   옮기는가. Map 대역은 키가 계정이라 이 상황 자체가 만들어지지 않는다
 * - **조건부 무효화** — 두 번째 `invalidate` 가 0행이라 false 인가(INV-U6-07). "언제 죽었나"가
 *   나중 시도로 밀리면 조사에 못 쓴다
 * - **부분 인덱스와 조회 조건이 같은 집합인가** — `invalidated_at IS NULL`
 * - **CASCADE** — 계정이 지워지면 토큰도 간다
 * - **CI 외부 호출 0회** — 기본 설정에서 실제로 주입되는 발송기가 무엇인가. 이건 설정과 조립의
 *   문제라 단위 테스트로는 확인할 수 없다
 */
@SpringBootTest
class PushTokenIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var service: PushTokenService
    @Autowired private lateinit var tokens: PushTokenRepository
    @Autowired private lateinit var notifications: NotificationRepository
    @Autowired private lateinit var dispatch: PushDispatchService
    @Autowired private lateinit var push: PushPort
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newToken() = "ExponentPushToken[${UUID.randomUUID()}]"

    private fun rows(accountId: UUID) =
        jdbc.queryForObject("SELECT count(*) FROM push_token WHERE account_id = ?", Int::class.java, accountId)

    @Test
    fun `같은 토큰을 다시 등록해도 행이 늘지 않는다 — 포그라운드 복귀마다 온다`() {
        val accountId = newAccount()
        val token = newToken()

        service.register(accountId, token, "device-1", DevicePlatform.IOS, OsPermission.GRANTED)
        val second = service.register(accountId, token, "device-1", DevicePlatform.IOS, OsPermission.DENIED)

        rows(accountId) shouldBe 1
        // 권한 미러는 **마지막에 알려 준 값**이다 — 사용자가 설정에서 껐을 수 있다.
        second.osPermission shouldBe OsPermission.DENIED
        second.deliverable shouldBe false
    }

    @Test
    fun `같은 기기가 다른 계정으로 로그인하면 토큰이 옮겨진다`() {
        val first = newAccount()
        val second = newAccount()
        val token = newToken()
        service.register(first, token, "device-1", DevicePlatform.ANDROID, OsPermission.GRANTED)

        service.register(second, token, "device-1", DevicePlatform.ANDROID, OsPermission.GRANTED)

        // 옮기지 않으면 UNIQUE 에 걸려 로그인이 막히거나, 남의 알림이 그 기기로 간다.
        rows(first) shouldBe 0
        rows(second) shouldBe 1
    }

    @Test
    fun `무효화는 한 번만 성공한다 — 죽은 시각이 나중 시도로 밀리지 않는다(INV-U6-07)`() {
        val accountId = newAccount()
        val token = newToken()
        service.register(accountId, token, null, DevicePlatform.IOS, OsPermission.GRANTED)

        tokens.invalidate(token, now) shouldBe true
        tokens.invalidate(token, now.plusSeconds(600)) shouldBe false

        tokens.findActive(accountId) shouldBe emptyList()
        jdbc.queryForObject(
            "SELECT invalidated_at FROM push_token WHERE token = ?", Instant::class.java, token,
        ) shouldBe now
    }

    @Test
    fun `앱을 다시 깔면 되살아난다 — 죽은 채로 남으면 알림이 영영 안 간다`() {
        val accountId = newAccount()
        val token = newToken()
        service.register(accountId, token, null, DevicePlatform.IOS, OsPermission.GRANTED)
        tokens.invalidate(token, now) shouldBe true

        service.register(accountId, token, null, DevicePlatform.IOS, OsPermission.GRANTED)

        tokens.findActive(accountId).single().invalidatedAt shouldBe null
    }

    @Test
    fun `계정을 지우면 토큰도 함께 파기된다`() {
        val accountId = newAccount()
        service.register(accountId, newToken(), null, DevicePlatform.IOS, OsPermission.GRANTED)

        jdbc.update("DELETE FROM account WHERE account_id = ?", accountId) shouldBe 1

        rows(accountId) shouldBe 0
    }

    @Test
    fun `발송 결과가 알림 행에 기록된다 — 존재를 좌우하지는 않는다(INV-U6-02 · BR-U6-38)`() {
        val accountId = newAccount()
        service.register(accountId, newToken(), null, DevicePlatform.IOS, OsPermission.GRANTED)
        val notification = Notification.raise(accountId, NotificationKind.TRIP_DAY, "제목", "본문", now)
        notifications.appendIfAbsent(notification) shouldBe true

        dispatch.dispatch(notification) shouldBe PushOutcome.SENT

        // 기본 발송기는 아무 데도 안 보내지만 성공으로 보고한다 — 기록 경로가 도는지는 여기서 본다.
        jdbc.queryForObject(
            "SELECT push_sent_at FROM notification WHERE notification_id = ?",
            Instant::class.java, notification.notificationId,
        ) shouldNotBe null
    }

    @Test
    fun `기본 설정에서는 실 발송기가 뜨지 않는다 — CI 외부 호출 0회`() {
        // 이 단정이 깨지는 방식은 하나다: 누군가 기본 모드를 expo 로 바꾸는 것. 그때 CI 게이트
        // 정책("외부 API 호출 0회")이 조용히 깨지므로 여기서 막는다.
        push.shouldBeInstanceOf<LoggingPushAdapter>()
    }
}
