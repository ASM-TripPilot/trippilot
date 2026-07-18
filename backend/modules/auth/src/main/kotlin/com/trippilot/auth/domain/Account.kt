package com.trippilot.auth.domain

import java.time.Instant
import java.time.LocalDate
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

/**
 * 계정 애그리거트(도메인 — 프레임워크 의존 0).
 * 상태 전이·제재·삭제 심화는 TRIP-152. 여기선 소셜 신규 가입 생성만 소유.
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
) {
    companion object {
        /**
         * 소셜 신규 가입 — 제공자가 신원을 보증하므로 즉시 [AccountStatus.ACTIVE],
         * `verifiedAt = createdAt`. 최초 연령확인을 동반한다(N1/D33).
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
            return Account(
                id = id,
                email = email,
                ageMethod = ageMethod,
                birthDate = birthDate,
                ageConfirmedAt = now,
                status = AccountStatus.ACTIVE,
                createdAt = now,
                verifiedAt = now,
            )
        }

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
        ): Account = Account(id, email, ageMethod, birthDate, ageConfirmedAt, status, createdAt, verifiedAt)
    }
}
