package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
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

private class FakeRepo : SavedStayRepository {
    val store = mutableMapOf<UUID, SavedStay>()
    override fun save(stay: SavedStay) = stay.also { store[it.savedStayId] = it }
    override fun findById(savedStayId: UUID) = store[savedStayId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
    override fun delete(stay: SavedStay) { store.remove(stay.savedStayId) }
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
        val svc = SavedStayService(FakeRepo(), clock)
        val saved = svc.register(acc, cmd())
        svc.get(acc, saved.savedStayId).name shouldBe "제주 호텔"
        svc.list(acc).size shouldBe 1
    }

    "타 계정 리소스는 404(존재 은닉)" {
        val svc = SavedStayService(FakeRepo(), clock)
        val saved = svc.register(acc, cmd())
        shouldThrow<ResourceNotFound> { svc.get(other, saved.savedStayId) }
        shouldThrow<ResourceNotFound> { svc.delete(other, saved.savedStayId) }
    }

    "체크아웃 <= 체크인은 400" {
        val svc = SavedStayService(FakeRepo(), clock)
        shouldThrow<ValidationFailed> {
            svc.register(acc, cmd(checkIn = LocalDate.parse("2026-08-02"), checkOut = LocalDate.parse("2026-08-02")))
        }
    }

    "좌표 한쪽만은 400" {
        val svc = SavedStayService(FakeRepo(), clock)
        shouldThrow<ValidationFailed> { svc.register(acc, cmd(lat = 33.5, lng = null, coordConfirmed = false)) }
    }

    "coord_confirmed인데 좌표 없으면 400(INV-U1-08)" {
        val svc = SavedStayService(FakeRepo(), clock)
        shouldThrow<ValidationFailed> { svc.register(acc, cmd(lat = null, lng = null, coordConfirmed = true)) }
    }

    "날짜 없이 저장 가능(거점은 나중)" {
        val svc = SavedStayService(FakeRepo(), clock)
        svc.register(acc, cmd(coordConfirmed = false, lat = null, lng = null, route = RegisterRoute.LINK_PASTE)).coordConfirmed shouldBe false
    }

    "편집은 가변필드 대체" {
        val svc = SavedStayService(FakeRepo(), clock)
        val saved = svc.register(acc, cmd())
        val edited = svc.edit(acc, saved.savedStayId, EditStayCommand("변경숙소", 34.0, 127.0, true, null, null, "메모"))
        edited.name shouldBe "변경숙소"
        edited.memo shouldBe "메모"
    }

    "삭제 후 조회 404" {
        val svc = SavedStayService(FakeRepo(), clock)
        val saved = svc.register(acc, cmd())
        svc.delete(acc, saved.savedStayId)
        shouldThrow<ResourceNotFound> { svc.get(acc, saved.savedStayId) }
    }
})
