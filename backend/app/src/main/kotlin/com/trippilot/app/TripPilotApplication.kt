package com.trippilot.app

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.persistence.autoconfigure.EntityScan
import org.springframework.boot.runApplication
import org.springframework.data.jpa.repository.config.EnableJpaRepositories

/**
 * TripPilot 백엔드 조립 지점(모듈러 모놀리스의 유일한 Spring Boot 애플리케이션).
 * 컴포넌트 스캔 루트는 com.trippilot 하위 전 모듈.
 * JPA 엔티티·리포지토리는 각 모듈(com.trippilot.<module>.adapter.out.persistence)에 있어
 * 스캔 범위를 com.trippilot 전체로 넓힌다(기본값=app 패키지라 못 찾음).
 */
@SpringBootApplication(scanBasePackages = ["com.trippilot"])
@EntityScan("com.trippilot")
@EnableJpaRepositories("com.trippilot")
class TripPilotApplication

fun main(args: Array<String>) {
    runApplication<TripPilotApplication>(*args)
}
