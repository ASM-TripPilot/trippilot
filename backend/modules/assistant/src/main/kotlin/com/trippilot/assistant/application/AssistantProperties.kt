package com.trippilot.assistant.application

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/**
 * 도우미 설정(tech-stack §2 델타 4). 정본은 키를 `assistant.*` 로 적었지만 이 리포의 설정은 전부
 * `trippilot.*` 아래라 그 관례를 따른다. **지금 읽히는 키만 둔다** — 나머지(턴 예산·분당 상한·일 상한…)는
 * 그 값을 읽는 코드와 함께 들어온다(TRIP-1378~1380).
 *
 * @property retentionDays 대화 보존 = 마지막 턴 후 이만큼(DATA-U8-01). **잠정값** — 처리방침이 정해지면 여기만 바꾼다.
 */
@ConfigurationProperties(prefix = "trippilot.assistant")
data class AssistantProperties(val retentionDays: Long = 90) {
    val retention: Duration get() = Duration.ofDays(retentionDays)
}
