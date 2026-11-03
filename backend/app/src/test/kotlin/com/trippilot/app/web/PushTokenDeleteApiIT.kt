package com.trippilot.app.web

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.notification.application.PushTokenService
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.OsPermission
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.net.Socket
import java.time.Instant
import java.util.UUID

/**
 * 푸시 토큰 해제(`DELETE /api/v1/me/push-tokens/{token}`)가 **실제 HTTP 로** 되는가.
 *
 * Expo 토큰은 `ExponentPushToken[…]` 라 경로에 대괄호가 실린다. 앱이 이를 인코딩 없이 보내면 Tomcat 기본 설정은
 * **400** 으로 거절하는데(요청 목적지의 `[`·`]` 는 RFC 3986 상 경로에 허용되지 않는다), MockMvc 는 Tomcat 의 요청 해석을
 * 거치지 않아 이 거절을 못 본다 — 그래서 소켓으로 날것 요청줄을 그대로 보낸다. 해제가 실패하면 로그아웃한 기기에 이전 계정의
 * 알림이 계속 간다(앱은 오류를 삼킨다).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PushTokenDeleteApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var tokens: PushTokenService
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): Pair<UUID, String> {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return account.id.value to accessTokenIssuer.issue(account.id.value.toString()).value
    }

    /** 요청줄을 **한 글자도 안 바꾸고** 보낸다 — HTTP 클라이언트 라이브러리는 대괄호를 알아서 인코딩해 버려 재현이 안 된다. */
    private fun rawDelete(requestTarget: String, bearer: String): Int =
        Socket("localhost", port).use { socket ->
            socket.soTimeout = 10_000
            val request = "DELETE $requestTarget HTTP/1.1\r\nHost: localhost:$port\r\nAuthorization: Bearer $bearer\r\nConnection: close\r\n\r\n"
            socket.getOutputStream().apply { write(request.toByteArray()); flush() }
            // 상태줄 한 줄이면 충분하다 — "HTTP/1.1 204 ".
            socket.getInputStream().bufferedReader().readLine().split(" ")[1].toInt()
        }

    private fun tokenRows(token: String) =
        jdbc.queryForObject("SELECT count(*) FROM push_token WHERE token = ?", Int::class.java, token)

    @Test
    fun `대괄호를 날것으로 보내도 해제된다 — 400 이 아니다`() {
        val (accountId, bearer) = newAccount()
        val token = "ExponentPushToken[${UUID.randomUUID()}]"
        tokens.register(accountId, token, "device-1", DevicePlatform.IOS, OsPermission.GRANTED)

        rawDelete("/api/v1/me/push-tokens/$token", bearer) shouldBe 204

        // 해제가 실제로 됐다 — 안 되면 로그아웃한 기기에 이전 계정의 알림이 계속 간다.
        tokenRows(token) shouldBe 0
    }

    @Test
    fun `퍼센트 인코딩해서 보내도 해제된다`() {
        val (accountId, bearer) = newAccount()
        val token = "ExponentPushToken[${UUID.randomUUID()}]"
        tokens.register(accountId, token, "device-1", DevicePlatform.IOS, OsPermission.GRANTED)

        rawDelete("/api/v1/me/push-tokens/${token.replace("[", "%5B").replace("]", "%5D")}", bearer) shouldBe 204

        tokenRows(token) shouldBe 0
    }

    @Test
    fun `남의 토큰은 해제되지 않는다 — 대괄호를 허용해도 404 다`() {
        val (ownerId, _) = newAccount()
        val (_, strangerBearer) = newAccount()
        val token = "ExponentPushToken[${UUID.randomUUID()}]"
        tokens.register(ownerId, token, "device-1", DevicePlatform.IOS, OsPermission.GRANTED)

        rawDelete("/api/v1/me/push-tokens/$token", strangerBearer) shouldBe 404

        tokenRows(token) shouldBe 1
    }
}
