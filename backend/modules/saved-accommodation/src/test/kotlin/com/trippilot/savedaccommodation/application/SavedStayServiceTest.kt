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
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.pair
import io.kotest.property.checkAll
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
    override fun existsByAccountAndExternal(accountId: UUID, externalSource: String, externalId: String) =
        store.values.any { it.accountId == accountId && it.externalSource == externalSource && it.externalId == externalId }
}

/** 거점 사용 중 숙소 id 집합만 흉내. */
private class StubBases(val inUse: MutableSet<UUID> = mutableSetOf()) : BaseAssignmentRepository {
    override fun save(base: BaseAssignment) = base
    override fun findByTrip(tripId: UUID) = emptyList<BaseAssignment>()
    override fun findById(baseAssignmentId: UUID): BaseAssignment? = null
    override fun delete(base: BaseAssignment) {}
    override fun existsByStayId(savedStayId: UUID) = savedStayId in inUse

    /** 이 대역은 '거점으로 쓰이는가'만 흉내 낸다 — 역참조는 이 테스트의 관심이 아니다. */
    override fun findTripIdsByStays(savedStayIds: Collection<UUID>) = emptyMap<UUID, List<UUID>>()
}

class SavedStayServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-26T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val other = UUID.randomUUID()

    fun cmd(
        name: String = "제주 호텔",
        lat: Double? = 33.5, lng: Double? = 126.5, coordConfirmed: Boolean = true,
        checkIn: LocalDate? = null, checkOut: LocalDate? = null, route: RegisterRoute = RegisterRoute.PIN,
        // 기본값 인자는 맨 뒤에 — 위치 인자 호출이 어긋나지 않게.
        externalSource: String? = null, externalId: String? = null,
    ) = RegisterStayCommand(name, lat, lng, coordConfirmed, checkIn, checkOut, externalSource, externalId, route, null)

    "등록 후 소유자 조회·목록" {
        val svc = SavedStayService(FakeRepo(), StubBases(), NoEvents, clock)
        val saved = svc.register(acc, cmd())
        svc.get(acc, saved.savedStayId).name shouldBe "제주 호텔"
        svc.list(acc).size shouldBe 1
    }

    // ─── 중복 등록 방지(TRIP-1059 · QA #012 — 연타로 같은 외부 숙소 30행) ───

    "같은 외부 숙소 재등록은 409 — 행이 늘지 않고 알림 이벤트도 다시 안 나간다" {
        val repo = FakeRepo()
        val published = mutableListOf<com.trippilot.core.event.DomainEvent>()
        val capturing = object : com.trippilot.core.event.DomainEventPublisher {
            override fun publish(event: com.trippilot.core.event.DomainEvent) { published += event }
        }
        val svc = SavedStayService(repo, StubBases(), capturing, clock)
        svc.register(acc, cmd(externalSource = "LOCALDATA", externalId = "3530000-201-2014-00006"))

        shouldThrow<ConflictDetected> {
            svc.register(acc, cmd(externalSource = "LOCALDATA", externalId = "3530000-201-2014-00006"))
        }

        repo.store.size shouldBe 1
        published.size shouldBe 1 // 없는 새 숙소의 등록 알림이 가면 위반(TRIP-550)
    }

    "다른 계정은 같은 외부 숙소를 각자 저장한다 — 유니크 범위는 계정이다" {
        val repo = FakeRepo()
        val svc = SavedStayService(repo, StubBases(), NoEvents, clock)
        svc.register(acc, cmd(externalSource = "LOCALDATA", externalId = "X"))
        svc.register(other, cmd(externalSource = "LOCALDATA", externalId = "X"))
        repo.store.size shouldBe 2
    }

    "외부 키 없는 등록(핀 지정)은 같은 이름도 막지 않는다 — 자연 키가 없다" {
        val repo = FakeRepo()
        val svc = SavedStayService(repo, StubBases(), NoEvents, clock)
        svc.register(acc, cmd())
        svc.register(acc, cmd())
        repo.store.size shouldBe 2
    }

    /** 임의 등록 열 — 계정·외부 키당 행 수는 0 또는 1, 키 없는 요청은 요청 수만큼(TRIP-1059 AC-속성). */
    "임의 등록 열에서 계정·외부키당 최대 1행이고 키 없는 등록은 전부 남는다" {
        val accounts = listOf(acc, other, UUID.randomUUID())
        checkAll(Arb.list(Arb.pair(Arb.int(0..2), Arb.int(0..7)), 0..40)) { reqs ->
            val repo = FakeRepo()
            val svc = SavedStayService(repo, StubBases(), NoEvents, clock)
            var keyless = 0
            for ((ai, r) in reqs) {
                val a = accounts[ai]
                try {
                    if (r % 2 == 0) {
                        svc.register(a, cmd(externalSource = "SRC", externalId = "K${r / 2}"))
                    } else {
                        keyless++
                        svc.register(a, cmd())
                    }
                } catch (_: ConflictDetected) {
                    // 중복 거절 — 행이 안 생겼어야 한다(아래 단언이 잡는다)
                }
            }
            for (a in accounts) {
                for (k in 0..3) {
                    repo.store.values.count { it.accountId == a && it.externalId == "K$k" } shouldBeLessThanOrEqual 1
                }
            }
            repo.store.values.count { it.externalId == null } shouldBe keyless
        }
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
