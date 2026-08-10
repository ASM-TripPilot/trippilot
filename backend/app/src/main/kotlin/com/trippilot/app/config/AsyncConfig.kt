package com.trippilot.app.config

import org.slf4j.LoggerFactory
import org.springframework.aop.interceptor.AsyncUncaughtExceptionHandler
import org.springframework.aop.interceptor.SimpleAsyncUncaughtExceptionHandler
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.AsyncConfigurer
import org.springframework.scheduling.annotation.EnableAsync
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor
import java.lang.reflect.Method
import java.util.concurrent.Executor

/**
 * `@Async` 실행기(TRIP-267 day1 2차 생성 등 백그라운드 작업).
 *
 * **반드시 빈이어야 한다** — 스프링이 소유해야 컨텍스트 종료 시 `destroy()` 가 불려 아래 종료 설정이 실제로 동작한다.
 * `getAsyncExecutor()` 안에서 `ThreadPoolTaskExecutor()` 를 직접 만들면 생명주기 밖이라 종료 설정이 죽은 코드가 되고,
 * 스레드가 남은 채 DataSource 가 먼저 닫혀 진행 중 작업이 실패한다.
 *
 * 큐를 **유한**하게 두고 포화 시 `CallerRunsPolicy` 로 되민다 — 무한 큐는 부하 시 힙을 먹고 실패를 늦게 드러낸다.
 * 되밀린 작업은 호출 스레드에서 동기 실행되므로 유실되지 않는다(대신 그 요청은 2차 시한만큼 느려진다).
 * 정상 처리량은 **corePoolSize** 가 좌우한다 — `ThreadPoolExecutor` 는 큐가 가득 찬 뒤에야 max 까지 늘린다.
 */
@Configuration
@EnableAsync
@EnableScheduling // 중단된 2차 생성 정리(StalePartialSweeper)
class AsyncConfig : AsyncConfigurer {

    @Bean // ThreadPoolTaskExecutor 는 DisposableBean — 스프링이 종료 설정대로 정리한다
    fun backgroundTaskExecutor(): ThreadPoolTaskExecutor =
        ThreadPoolTaskExecutor().apply {
            corePoolSize = CORE_POOL
            maxPoolSize = MAX_POOL
            queueCapacity = QUEUE_CAPACITY
            setThreadNamePrefix("tp-async-")
            // 기본 CallerRunsPolicy 는 **종료 중이면 작업을 조용히 버린다** — 침묵 금지(INV-4)라 그 경우를 로그로 드러낸다.
            // 버려진 2차는 일정을 PARTIAL 로 남기고, 지연된 PARTIAL 스윕이 FAILED 로 정리한다.
            setRejectedExecutionHandler { task, executor ->
                if (executor.isShutdown) {
                    log.warn("종료 중이라 백그라운드 작업을 실행하지 못했습니다 — PARTIAL 일정은 스윕이 FAILED 로 정리합니다.")
                } else {
                    task.run() // caller-runs: 유실 대신 호출 스레드에서 동기 실행
                }
            }
            setWaitForTasksToCompleteOnShutdown(true) // 종료 시 진행 중 2차 생성을 잘라내지 않는다
            setAwaitTerminationSeconds(AWAIT_TERMINATION_SEC)
        }

    override fun getAsyncExecutor(): Executor = backgroundTaskExecutor()

    /** 침묵 금지(INV-4) — `@Async` 반환형이 void 라 예외가 삼켜지므로 최소한 로그로는 남긴다. */
    override fun getAsyncUncaughtExceptionHandler(): AsyncUncaughtExceptionHandler =
        AsyncUncaughtExceptionHandler { ex: Throwable, method: Method, params: Array<out Any?> ->
            log.error("비동기 작업 실패 — method={}, params={}", method.name, params.size, ex)
            SimpleAsyncUncaughtExceptionHandler().handleUncaughtException(ex, method, params)
        }

    companion object {
        private val log = LoggerFactory.getLogger(AsyncConfig::class.java)
        private const val CORE_POOL = 8 // 정상 동시 처리량 = core (큐가 차기 전엔 max 까지 늘지 않는다)
        private const val MAX_POOL = 16
        private const val QUEUE_CAPACITY = 32 // 대기열이 길수록 마지막 사용자의 PARTIAL 체류가 길어진다
        private const val AWAIT_TERMINATION_SEC = 30
    }
}
