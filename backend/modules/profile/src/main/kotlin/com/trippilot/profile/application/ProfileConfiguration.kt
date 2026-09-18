package com.trippilot.profile.application

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration

/** profile 모듈 설정 — 부트스트랩 버전 프로퍼티 바인딩. */
@Configuration
@EnableConfigurationProperties(BootstrapProperties::class)
class ProfileConfiguration
