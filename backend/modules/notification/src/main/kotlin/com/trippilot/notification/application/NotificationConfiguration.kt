package com.trippilot.notification.application

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration

/**
 * 알림 모듈 설정 바인딩. 값이 **관측 후 조정 예정**이라 코드 상수로 두지 않는다(COST-U6-01).
 */
@Configuration
@EnableConfigurationProperties(PushRateLimits::class)
class NotificationConfiguration
