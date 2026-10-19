package com.trippilot.planbdetection.application

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.scheduling.support.CronExpression
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * 스윕 배선(설계서 CD3 · tech-stack 델타 1 · T-D1-U 배선) — 언제 깨고, 몇 개가 동시에 도는가.
 *
 * 애너테이션 문자열은 컴파일러가 아무것도 검사하지 않는다. 존이 빠지면 서버 시각(UTC)으로 깨 밤에 위험 푸시가 나가고,
 * 락 이름이 U10 지연 스캔(`planb-delay-scan`)과 같으면 두 스윕이 서로를 막는다 — 그래서 값 자체를 고정한다.
 */
class SituationSweepScheduleTest : StringSpec({

    val scheduled = SituationSweep::class.java.declaredMethods.filter { it.isAnnotationPresent(Scheduled::class.java) }
    val kst = ZoneId.of("Asia/Seoul")

    /** `${'$'}{키:기본식}` 의 기본식. */
    fun defaultOf(cron: String): String = Regex("""^\$\{[\w.-]+:(.+)}$""").find(cron)!!.groupValues[1]

    "회차 진입점은 둘이다 — 매시 :15 와 20:40 보충, 둘 다 여행지 시각(Asia/Seoul)으로 깬다" {
        scheduled.size shouldBe 2
        scheduled.map { it.getAnnotation(Scheduled::class.java).cron }.toSet() shouldBe setOf(
            "\${trippilot.planb.situation-sweep.cron:0 15 7-20 * * *}",
            "\${trippilot.planb.situation-sweep.evening-cron:0 40 20 * * *}",
        )
        scheduled.map { it.getAnnotation(Scheduled::class.java).zone }.toSet() shouldBe setOf("Asia/Seoul")
    }

    "기본 식이 정본 회차와 같다 — 하루에 07:15 ~ 20:15 매시와 20:40, 밤에는 깨지 않는다" {
        val day = LocalDate.parse("2026-08-11")
        val fires = scheduled.flatMap { method ->
            val cron = CronExpression.parse(defaultOf(method.getAnnotation(Scheduled::class.java).cron))
            generateSequence(cron.next(day.atStartOfDay(kst).minusSeconds(1))) { cron.next(it) }
                .takeWhile { it.toLocalDate() == day }
                .map { it.toLocalTime() }
                .toList()
        }.sorted()

        fires shouldBe (7..20).map { LocalTime.of(it, 15) } + LocalTime.of(20, 40)
    }

    "두 진입점은 같은 단일 실행 락 하나다 — 이름은 U10 지연 스캔과 다르고, 최대 25분·최소 5분 쥔다" {
        val locks = scheduled.map { it.getAnnotation(SchedulerLock::class.java) }
        locks.map { it.name }.toSet() shouldBe setOf("planb-situation-scan")
        locks.forEach {
            it.name shouldNotBe "planb-delay-scan"
            // 최소 5분 — 두 파드가 같은 순간 깨는 cron 의 재실행을 막는다. 최대 25분 — 죽은 파드의 20:15 락이 20:40 보충을 막지 않게.
            it.lockAtMostFor shouldBe "PT25M"
            it.lockAtLeastFor shouldBe "PT5M"
        }
    }
})
