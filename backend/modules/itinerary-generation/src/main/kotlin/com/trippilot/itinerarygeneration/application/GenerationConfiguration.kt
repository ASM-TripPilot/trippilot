package com.trippilot.itinerarygeneration.application

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration

/**
 * 생성 관련 설정 등록.
 *
 * [ScheduleDeadlineProperties] 를 **여기서** 연다 — AI 어댑터 설정은 `mode=http` 조건부라 기본(fake)
 * 모드에서는 아예 로드되지 않는데, 시간 예산은 모드와 무관하게 필요하다(멈춘 생성 판정이 그것을 본다).
 * 조건부 설정에 매달아 두면 기본 모드의 컨텍스트가 통째로 뜨지 않는다.
 */
@Configuration
@EnableConfigurationProperties(ScheduleDeadlineProperties::class)
class GenerationConfiguration
