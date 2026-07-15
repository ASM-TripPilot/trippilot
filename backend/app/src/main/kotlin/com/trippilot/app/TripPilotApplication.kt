package com.trippilot.app

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

/**
 * TripPilot 백엔드 조립 지점(모듈러 모놀리스의 유일한 Spring Boot 애플리케이션).
 * 컴포넌트 스캔 루트는 com.trippilot 하위 전 모듈.
 */
@SpringBootApplication(scanBasePackages = ["com.trippilot"])
class TripPilotApplication

fun main(args: Array<String>) {
    runApplication<TripPilotApplication>(*args)
}
