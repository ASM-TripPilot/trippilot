package com.trippilot.app.config

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.core.env.SystemEnvironmentPropertySource
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor
import org.springframework.test.util.ReflectionTestUtils
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class AsyncConfigTest {
    private val contextRunner = ApplicationContextRunner().withUserConfiguration(AsyncConfig::class.java)

    @Test
    fun `local default remains thirty seconds`() {
        contextRunner.run { context ->
            assertThat(context).hasNotFailed()
            val executor = context.getBean(ThreadPoolTaskExecutor::class.java)
            assertThat(ReflectionTestUtils.getField(executor, "awaitTerminationMillis")).isEqualTo(30_000L)
        }
    }

    @Test
    fun `Kubernetes environment variable configures the executor shutdown budget`() {
        contextRunner.withInitializer { context ->
            context.environment.propertySources.addFirst(
                SystemEnvironmentPropertySource(
                    "deployment",
                    mapOf("TRIPPILOT_ASYNC_AWAIT_TERMINATION_SECONDS" to "630"),
                ),
            )
        }.run { context ->
            assertThat(context).hasNotFailed()
            val executor = context.getBean(ThreadPoolTaskExecutor::class.java)
            assertThat(ReflectionTestUtils.getField(executor, "awaitTerminationMillis")).isEqualTo(630_000L)
        }
    }

    @Test
    fun `invalid shutdown budgets fail startup`() {
        listOf("0", "-1", "3601", "invalid").forEach { value ->
            contextRunner.withPropertyValues("trippilot.async.await-termination-seconds=$value").run { context ->
                assertThat(context).hasFailed()
            }
        }
    }

    @Test
    fun `context shutdown lets active work finish within the configured budget`() {
        contextRunner.withPropertyValues("trippilot.async.await-termination-seconds=2").run { context ->
            val executor = context.getBean(ThreadPoolTaskExecutor::class.java)
            val started = CountDownLatch(1)
            val release = CountDownLatch(1)
            val interrupted = AtomicBoolean(false)
            val task = executor.submit {
                started.countDown()
                try {
                    release.await()
                } catch (_: InterruptedException) {
                    interrupted.set(true)
                }
            }
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue()
            val closing = CompletableFuture.runAsync { context.close() }
            try {
                awaitShutdown(executor)
                assertThat(closing.isDone).isFalse()
                release.countDown()
                closing.get(5, TimeUnit.SECONDS)
                assertThat(task.isDone).isTrue()
                assertThat(interrupted.get()).isFalse()
            } finally {
                release.countDown()
                task.get(5, TimeUnit.SECONDS)
                closing.get(5, TimeUnit.SECONDS)
            }
        }
    }

    @Test
    fun `configured deadline bounds shutdown when work exceeds the budget`() {
        contextRunner.withPropertyValues("trippilot.async.await-termination-seconds=1").run { context ->
            val executor = context.getBean(ThreadPoolTaskExecutor::class.java)
            val started = CountDownLatch(1)
            val release = CountDownLatch(1)
            val task = executor.submit {
                started.countDown()
                release.await()
            }
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue()
            val closing = CompletableFuture.runAsync { context.close() }
            try {
                closing.get(5, TimeUnit.SECONDS)
                assertThat(task.isDone).isFalse()
            } finally {
                release.countDown()
                task.get(5, TimeUnit.SECONDS)
                closing.get(5, TimeUnit.SECONDS)
            }
        }
    }

    private fun awaitShutdown(executor: ThreadPoolTaskExecutor) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (!executor.threadPoolExecutor.isShutdown && System.nanoTime() < deadline) {
            Thread.sleep(5)
        }
        assertThat(executor.threadPoolExecutor.isShutdown).isTrue()
    }
}
