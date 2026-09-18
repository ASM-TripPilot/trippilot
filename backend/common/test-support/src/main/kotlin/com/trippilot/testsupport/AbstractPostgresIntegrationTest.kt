package com.trippilot.testsupport

import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource

/**
 * PG 통합 스펙 베이스 — 싱글톤 컨테이너 + 롤/스키마 부트스트랩 + Flyway 적용을 상속만으로 제공.
 *
 * 사용:
 * ```
 * @SpringBootTest
 * class AccountRepositoryIT : AbstractPostgresIntegrationTest() { ... }
 * ```
 * `@SpringBootTest` 는 애플리케이션을 아는 소비 모듈에서 subclass 가 붙인다(공통 베이스는 데이터소스 배선만 담당).
 */
abstract class AbstractPostgresIntegrationTest {
    companion object {
        @JvmStatic
        @DynamicPropertySource
        fun springProperties(registry: DynamicPropertyRegistry) {
            PostgresSupport.registerSpringProperties(registry)
        }
    }
}
