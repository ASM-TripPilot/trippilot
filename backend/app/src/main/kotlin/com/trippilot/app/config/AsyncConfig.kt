package com.trippilot.app.config

import org.slf4j.LoggerFactory
import org.springframework.aop.interceptor.AsyncUncaughtExceptionHandler
import org.springframework.aop.interceptor.SimpleAsyncUncaughtExceptionHandler
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.AsyncConfigurer
import org.springframework.scheduling.annotation.EnableAsync
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor
import java.lang.reflect.Method
import java.util.concurrent.Executor
import java.util.concurrent.ThreadPoolExecutor

/**
 * `@Async` 실행기(TRIP-267 day1 2차 생성 등 백그라운드 작업).
 *
 * 큐를 **유한**하게 두고 포화 시 `CallerRunsPolicy` 로 되민다 — 무한 큐는 부하 시 힙을 먹고 실패를 늦게 드러낸다.
 * 되밀린 작업은 요청 스레드에서 동기 실행되므로 유실되지 않는다(느려질 뿐).
 */
@Configuration
@EnableAsync
class AsyncConfig : AsyncConfigurer {

    override fun getAsyncExecutor(): Executor =
        ThreadPoolTaskExecutor().apply {
            corePoolSize = CORE_POOL
            maxPoolSize = MAX_POOL
            queueCapacity = QUEUE_CAPACITY
            setThreadNamePrefix("tp-async-")
            setRejectedExecutionHandler(ThreadPoolExecutor.CallerRunsPolicy())
            setWaitForTasksToCompleteOnShutdown(true) // 종료 시 진행 중 2차 생성을 잘라내지 않는다
            setAwaitTerminationSeconds(AWAIT_TERMINATION_SEC)
            initialize()
        }

    /** 침묵 금지(INV-4) — `@Async` 반환형이 void 라 예외가 삼켜지므로 최소한 로그로는 남긴다. */
    override fun getAsyncUncaughtExceptionHandler(): AsyncUncaughtExceptionHandler =
        AsyncUncaughtExceptionHandler { ex: Throwable, method: Method, params: Array<out Any?> ->
            log.error("비동기 작업 실패 — method={}, params={}", method.name, params.size, ex)
            SimpleAsyncUncaughtExceptionHandler().handleUncaughtException(ex, method, params)
        }

    companion object {
        private val log = LoggerFactory.getLogger(AsyncConfig::class.java)
        private const val CORE_POOL = 4
        private const val MAX_POOL = 8
        private const val QUEUE_CAPACITY = 64
        private const val AWAIT_TERMINATION_SEC = 30
    }
}
