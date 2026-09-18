package com.trippilot.app.web

import com.trippilot.notification.domain.NotificationAction
import io.kotest.matchers.collections.shouldBeEmpty
import org.junit.jupiter.api.Test
import org.springframework.core.io.ClassPathResource
import org.yaml.snakeyaml.Yaml

/**
 * 알림 액션 어휘가 계약과 **같은 집합**인가(TRIP-615).
 *
 * 왜 필요한가: 이 값들이 파일마다 흩어져 있는 동안 계약(`Notification.actionType`)은 한 값에서
 * 멈춰 있었다 — **코드가 셋을 내보내는데 계약은 하나만 선언한 상태로 모든 게이트가 초록이었다.**
 * 경로↔핸들러 대조도, `$ref` 해소도, 중복 키 검사도 enum 의 **값**은 보지 않는다.
 *
 * 그래서 여기서만 잡힌다. 값을 늘리려면 [NotificationAction] 과 계약을 함께 고쳐야 한다.
 *
 * ⚠ 스프링을 띄우지 않는다 — 계약 파일과 상수만 대조하면 되고, 컨텍스트를 띄우면 느려지기만 한다.
 */
class NotificationActionContractIT {

    @Test
    fun `코드의 액션 어휘와 계약의 enum 이 정확히 같다`() {
        val documented = documentedActionTypes()

        val missingInContract = (NotificationAction.ALL - documented).sorted()
        val missingInCode = (documented - NotificationAction.ALL).sorted()

        missingInContract.shouldBeEmpty()
        missingInCode.shouldBeEmpty()
    }

    /** `components.schemas.Notification.actionType.enum` 을 읽는다. */
    @Suppress("UNCHECKED_CAST")
    private fun documentedActionTypes(): Set<String> {
        val spec = Yaml().load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)
        val components = spec["components"] as Map<String, Any>
        val schemas = components["schemas"] as Map<String, Map<String, Any>>
        val notification = schemas["Notification"] ?: error("openapi 에 Notification 스키마가 없다.")
        val properties = notification["properties"] as Map<String, Map<String, Any>>
        val actionType = properties["actionType"] ?: error("Notification 에 actionType 이 없다.")
        return (actionType["enum"] as? List<String>)?.toSet()
            ?: error("actionType 에 enum 이 선언돼 있지 않다 — 어휘를 열어 두면 화면이 무엇을 그릴지 모른다.")
    }
}
