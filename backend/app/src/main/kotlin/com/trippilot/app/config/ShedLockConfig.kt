package com.trippilot.app.config

import net.javacrumbs.shedlock.core.LockProvider
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.JdbcTemplate

/**
 * 분산 스케줄 락(TRIP-539) — 아웃박스 릴레이가 다중 인스턴스에서 **하나만** 돌게 한다.
 *
 * `shedlock` 테이블은 **V1.0 부터 있었다.** 라이브러리만 없어 아무도 쓰지 못한 채 유지돼 온
 * U0 스캐폴딩 부채였다 — 릴레이를 붙이는 이 시점에 갚는다.
 *
 * `defaultLockAtMostFor` 는 안전망이다: 락을 쥔 인스턴스가 죽어도 이 시간이 지나면 풀린다.
 * 없으면 죽은 인스턴스가 락을 영원히 붙잡아 릴레이가 통째로 멈춘다.
 */
@Configuration
@EnableSchedulerLock(defaultLockAtMostFor = "PT5M")
class ShedLockConfig {

    @Bean
    fun lockProvider(jdbc: JdbcTemplate): LockProvider = JdbcTemplateLockProvider(
        JdbcTemplateLockProvider.Configuration.builder()
            .withJdbcTemplate(jdbc)
            .usingDbTime() // 인스턴스 시계가 갈려도 락 판정은 DB 시각 하나로 — 시계 오차가 락을 뚫는 것을 막는다
            .build(),
    )
}
