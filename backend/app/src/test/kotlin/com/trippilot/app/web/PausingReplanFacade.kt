package com.trippilot.app.web

import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
import com.trippilot.itinerarygeneration.api.ReplanProposal
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** ReplanApiIT 전용: 지정한 여행의 첫 산출만 보류하고 나머지 호출은 실제 퍼사드에 위임한다. */
class PausingReplanFacade(private val delegate: ReplanFacade) : ReplanFacade by delegate {
    private val pending = ConcurrentHashMap<UUID, PausedReplan>()

    fun withPausedNext(tripId: UUID, assertion: (PausedReplan) -> Unit) {
        val paused = PausedReplan()
        check(pending.putIfAbsent(tripId, paused) == null) { "이미 보류 중인 여행입니다: $tripId" }
        try {
            assertion(paused)
        } finally {
            // 요청·단언이 실패해도 다음 테스트와 컨텍스트 종료가 막히지 않게 한다.
            pending.remove(tripId, paused)
            paused.release()
        }
    }

    override fun propose(command: ReplanCommand): ReplanProposal? {
        // 트랜잭션 프록시에 위임하기 전에 기다려 DB 커넥션을 점유하지 않는다.
        // remove 로 첫 호출만 보류한다. 재진입으로 열린 두 번째 세션은 정상 산출한다.
        pending.remove(command.tripId)?.awaitRelease()
        return delegate.propose(command)
    }

    class PausedReplan {
        private val started = CountDownLatch(1)
        private val released = CountDownLatch(1)

        fun awaitStarted() {
            check(started.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) { "재계획 산출이 시작되지 않았습니다." }
        }

        fun awaitRelease() {
            started.countDown()
            check(released.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) { "재계획 산출 보류가 해제되지 않았습니다." }
        }

        fun release() = released.countDown()
    }

    private companion object {
        private const val TIMEOUT_SECONDS = 20L
    }
}
