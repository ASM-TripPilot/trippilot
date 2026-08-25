package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/** 발행만 삼키는 싱크(TRIP-550). 발행 여부는 `SavedStayEventTest` 가 따로 본다. */
private object NoEvents : com.trippilot.core.event.DomainEventPublisher {
    override fun publish(event: com.trippilot.core.event.DomainEvent) = Unit
}

private class FakeRepo : SavedStayRepository {
    val store = mutableMapOf<UUID, SavedStay>()
    override fun save(stay: SavedStay) = stay.also { store[it.savedStayId] = it }
    override fun findById(savedStayId: UUID) = store[savedStayId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
    override fun delete(stay: SavedStay) { store.remove(stay.savedStayId) }
}

/** 거점 사용 중 숙소 id 집합만 흉내. */
private class StubBases(val inUse: MutableSet<UUID> = mutableSetOf()) : BaseAssignmentRepository {
    override fun save(base: BaseAssignment) = base
    override fun findByTrip(tripId: UUID) = emptyList<BaseAssignment>()
    override fun findById(baseAssignmentId: UUID): BaseAssignment? = null
    override fun delete(base: BaseAssignment) {}
    override fun existsByStayId(savedStayId: UUID) = savedStayId in inUse
}

class SavedStayServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-26T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val other = UUID.randomUUID()

    fun cmd(
        name: String = "제주 호텔",
        lat: Double? = 33.5, lng: Double? = 126.5, coordConfirmed: Boolean = true,
        checkIn: LocalDate? = null, checkOut: LocalDate? = null, route: RegisterRoute = RegisterRoute.PIN,
    ) = RegisterStayCommand(name, lat, lng, coordConfirmed, checkIn, checkOut, null, null, route, null)

    "등록 후 소유자 조회·목록" {
        val svc = SavedStayService(FakeRepo(), StubBases(), NoEvents, clock)
        val saved = svc.register(acc, cmd())
        svc.get(acc, saved.savedStayId).name shouldBe "제주 호텔"
        svc.list(acc).size shouldBe 1
    }

    "타 계정 리소스는 404(존재 은닉)" {
        val svc = SavedStayService(FakeRepo(), StubBases(), NoEvents, clock)
        val saved = svc.register(acc, cmd())
        shouldThrow<ResourceNotFound> { svc.get(other, saved.savedStayId) }
        shouldThrow<ResourceNotFound> { svc.delete(other, saved.savedStayId) }
    }

    "체크아웃 <= 체크인은 400" {
        val svc = SavedStayService(FakeRepo(), StubBases(), NoEvents, clock)
        shouldThrow<ValidationFailed> {
            svc.register(acc, cmd(checkIn = LocalDate.parse("2026-08-02"), checkOut = LocalDate.parse("2026-08-02")))
        }
    }

    "좌표 한쪽만은 400" {
        val svc = SavedStayService(FakeRepo(), StubBases(), NoEvents, clock)
        shouldThrow<ValidationFailed> { svc.register(acc, cmd(lat = 33.5, lng = null, coordConfirmed = false)) }
    }

    "coord_confirmed인데 좌표 없으면 400(INV-U1-08)" {
        val svc = SavedStayService(FakeRepo(), StubBases(), NoEvents, clock)
        shouldThrow<ValidationFailed> { svc.register(acc, cmd(lat = null, lng = null, coordConfirmed = true)) }
    }

    "날짜 없이 저장 가능(거점은 나중)" {
        val svc = SavedStayService(FakeRepo(), StubBases(), NoEvents, clock)
        svc.register(acc, cmd(coordConfirmed = false, lat = null, lng = null, route = RegisterRoute.LINK_PASTE)).coordConfirmed shouldBe false
    }

    "편집은 가변필드 대체" {
        val svc = SavedStayService(FakeRepo(), StubBases(), NoEvents, clock)
        val saved = svc.register(acc, cmd())
        val edited = svc.edit(acc, saved.savedStayId, EditStayCommand("변경숙소", 34.0, 127.0, true, null, null, "메모"))
        edited.name shouldBe "변경숙소"
        edited.memo shouldBe "메모"
    }

    "삭제 후 조회 404" {
        val svc = SavedStayService(FakeRepo(), StubBases(), NoEvents, clock)
        val saved = svc.register(acc, cmd())
        svc.delete(acc, saved.savedStayId)
        shouldThrow<ResourceNotFound> { svc.get(acc, saved.savedStayId) }
    }

    "거점으로 사용 중인 숙소 삭제는 409(INV-U1-08 · 500 방지)" {
        val repo = FakeRepo()
        val bases = StubBases()
        val svc = SavedStayService(repo, bases, NoEvents, clock)
        val saved = svc.register(acc, cmd())
        bases.inUse += saved.savedStayId
        shouldThrow<ConflictDetected> { svc.delete(acc, saved.savedStayId) }
    }

    "거점으로 사용 중인 숙소의 좌표 확정 해제 편집은 409(INV-U1-08)" {
        val repo = FakeRepo()
        val bases = StubBases()
        val svc = SavedStayService(repo, bases, NoEvents, clock)
        val saved = svc.register(acc, cmd())
        bases.inUse += saved.savedStayId
        shouldThrow<ConflictDetected> {
            svc.edit(acc, saved.savedStayId, EditStayCommand("변경", null, null, false, null, null, null))
        }
    }
})
