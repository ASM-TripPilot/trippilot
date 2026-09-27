package com.trippilot.affiliatelink.adapter.out.persistence

import com.trippilot.affiliatelink.domain.OutboundClick
import com.trippilot.affiliatelink.domain.OutboundClickPort
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** affiliate_click 매핑(V2.54). stay_id 는 합성 경계 키 — stay 테이블 FK 아님(시드 재생성이 지운다). */
@Entity
@Table(name = "affiliate_click")
class AffiliateClickEntity(
    @Id @Column(name = "click_id") var clickId: UUID,
    @Column(name = "account_id") var accountId: UUID,
    @Column(name = "stay_id") var stayId: String,
    @Column(name = "vendor") var vendor: String,
    @Column(name = "check_in") var checkIn: LocalDate?,
    @Column(name = "check_out") var checkOut: LocalDate?,
    @Column(name = "adults") var adults: Int?,
    @Column(name = "clicked_at") var clickedAt: Instant,
    // 칸 2(포스트백 수신) 어휘 — domain-entities C5: NONE·RECEIVED. 지금은 전부 NONE.
    @Column(name = "postback_status") var postbackStatus: String,
)

interface AffiliateClickJpaRepository : JpaRepository<AffiliateClickEntity, UUID>

@Component
class AffiliateClickRepositoryAdapter(
    private val jpa: AffiliateClickJpaRepository,
) : OutboundClickPort {
    override fun record(click: OutboundClick) {
        jpa.save(
            AffiliateClickEntity(
                clickId = click.clickId,
                accountId = click.accountId,
                stayId = click.stayId,
                vendor = click.vendor,
                checkIn = click.query.checkIn,
                checkOut = click.query.checkOut,
                adults = click.query.adults,
                clickedAt = click.clickedAt,
                postbackStatus = "NONE",
            ),
        )
    }
}
