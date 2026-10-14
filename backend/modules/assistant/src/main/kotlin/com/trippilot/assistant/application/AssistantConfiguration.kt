package com.trippilot.assistant.application

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration

@Configuration
@EnableConfigurationProperties(AssistantProperties::class)
class AssistantConfiguration
