package com.trippilot.auth.domain

import com.trippilot.core.error.AgeRequirementNotMet
import com.trippilot.core.error.ConflictDetected
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import java.util.UUID

@JvmInline
value class AccountId(val value: UUID) {
    companion object {
        fun new(): AccountId = AccountId(UUID.randomUUID())
    }
}

/** 계정 생명주기 상태. PENDING_VERIFICATION 은 이메일 가입(후속) 예약값 — 소셜은 도달 불가. */
enum class AccountStatus {
    PENDING_VERIFICATION,
    ACTIVE,
    DELETION_PENDING,
    DELETED,
}

/** 연령 확인 방식. BIRTH_DATE 는 생년월일 필수(INV-A2). */
enum class AgeMethod {
    BIRTH_DATE,
    SELF_DECLARED,
}

/** 제재 단계 — 생명주기 상태와 독립. FULLY_SUSPENDED 는 로그인 자체를 막는다. */
enum class SanctionStatus {
    NONE,
    WARNED,
    COMMUNITY_SUSPENDED,
    FULLY_SUSPENDED,
}

/**
 * 계정 애그리거트(도메인 — 프레임워크 의존 0).
 * 소셜 신규 가입 생성 + 연령확인 게이트 + 생명주기/제재 상태 전이를 소유(TRIP-152).
 * 불변 — 전이는 새 인스턴스를 반환한다.
 */
class Account private constructor(
    val id: AccountId,
    val email: String?,
    val ageMethod: AgeMethod,
    val birthDate: LocalDate?,
    val ageConfirmedAt: Instant,
    val status: AccountStatus,
    val createdAt: Instant,
    val verifiedAt: Instant?,
    val sanctionStatus: SanctionStatus,
    val deletedAt: Instant?,
) {
    /** 로그인 허용 여부 — 파기됐거나 전면 정지된 계정은 인증 불가(SECURITY-15: 사유 비노출). */
    fun canAuthenticate(): Boolean =
        status != AccountStatus.DELETED && sanctionStatus != SanctionStatus.FULLY_SUSPENDED

    /** 삭제 요청 — ACTIVE 만 가능. 유예기간 스케줄은 별도(TRIP-158). */
    fun requestDeletion(): Account {
        requireStatus(AccountStatus.ACTIVE, "삭제 요청은 활성 계정만 가능합니다.")
        return copy(status = AccountStatus.DELETION_PENDING)
    }

    /** 삭제 철회(복구) — 삭제 대기 중만 가능. */
    fun cancelDeletion(): Account {
        requireStatus(AccountStatus.DELETION_PENDING, "복구는 삭제 대기 상태만 가능합니다.")
        return copy(status = AccountStatus.ACTIVE)
    }

    /** 파기 확정 — 삭제 대기 중만 가능. 실제 데이터 파기 오케스트레이션은 TRIP-158. */
    fun completeDeletion(now: Instant): Account {
        requireStatus(AccountStatus.DELETION_PENDING, "파기는 삭제 대기 상태만 가능합니다.")
        return copy(status = AccountStatus.DELETED, deletedAt = now)
    }

    /** 제재 단계 변경 — 파기된 계정은 제재 대상이 아니다. */
    fun applySanction(target: SanctionStatus): Account {
        if (status == AccountStatus.DELETED) {
            throw ConflictDetected(current = status, message = "파기된 계정은 제재할 수 없습니다.")
        }
        return copy(sanctionStatus = target)
    }

    private fun requireStatus(expected: AccountStatus, message: String) {
        if (status != expected) throw ConflictDetected(current = status, message = message)
    }

    private fun copy(
        status: AccountStatus = this.status,
        sanctionStatus: SanctionStatus = this.sanctionStatus,
        deletedAt: Instant? = this.deletedAt,
    ): Account = Account(
        id, email, ageMethod, birthDate, ageConfirmedAt, status, createdAt, verifiedAt, sanctionStatus, deletedAt,
    )

    companion object {
        /** 가입 최소 연령(만 나이). 미만은 가입 불가(INV-A). */
        const val MIN_AGE_YEARS: Int = 14

        /**
         * 소셜 신규 가입 — 제공자가 신원을 보증하므로 즉시 [AccountStatus.ACTIVE],
         * `verifiedAt = createdAt`. 최초 연령확인을 동반한다(N1/D33).
         *
         * BIRTH_DATE 는 생년월일로 만 나이를 계산해 [MIN_AGE_YEARS] 미만이면 거부([AgeRequirementNotMet]).
         * SELF_DECLARED 는 클라이언트의 '만 14세 이상' 자기신고를 신뢰한다(생년월일 없음).
         */
        fun registerViaSocial(
            email: String?,
            ageMethod: AgeMethod,
            birthDate: LocalDate?,
            now: Instant,
            id: AccountId = AccountId.new(),
        ): Account {
            require(ageMethod != AgeMethod.BIRTH_DATE || birthDate != null) {
                "BIRTH_DATE 연령확인은 birthDate 가 필요하다 (INV-A2)"
            }
            if (ageMethod == AgeMethod.BIRTH_DATE && ageInYears(birthDate!!, now) < MIN_AGE_YEARS) {
                throw AgeRequirementNotMet("만 $MIN_AGE_YEARS 세 미만은 가입할 수 없습니다.")
            }
            return Account(
                id = id,
                email = email,
                ageMethod = ageMethod,
                birthDate = birthDate,
                ageConfirmedAt = now,
                status = AccountStatus.ACTIVE,
                createdAt = now,
                verifiedAt = now,
                sanctionStatus = SanctionStatus.NONE,
                deletedAt = null,
            )
        }

        /** 만 나이 산정 기준 시간대 — 서비스 기준 KST(민법상 연령은 한국 달력일 기준). */
        private val AGE_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        /** 기준 시각(KST) 기준 만 나이. 미래 생년월일은 음수 → 자연히 미달 처리된다. */
        private fun ageInYears(birthDate: LocalDate, now: Instant): Int =
            Period.between(birthDate, now.atZone(AGE_ZONE).toLocalDate()).years

        /** 영속 계층에서 이미 유효한 저장 데이터로 재구성(생성 불변식 미적용). */
        fun reconstitute(
            id: AccountId,
            email: String?,
            ageMethod: AgeMethod,
            birthDate: LocalDate?,
            ageConfirmedAt: Instant,
            status: AccountStatus,
            createdAt: Instant,
            verifiedAt: Instant?,
            sanctionStatus: SanctionStatus,
            deletedAt: Instant?,
        ): Account = Account(
            id, email, ageMethod, birthDate, ageConfirmedAt, status, createdAt, verifiedAt, sanctionStatus, deletedAt,
        )
    }
}
