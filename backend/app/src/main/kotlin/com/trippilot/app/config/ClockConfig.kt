package com.trippilot.app.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.time.Clock

/** 전역 Clock — 도메인/유스케이스가 시각을 주입받아 테스트 가능하게. */
@Configuration
class ClockConfig {
    @Bean
    fun clock(): Clock = Clock.systemUTC()
}
