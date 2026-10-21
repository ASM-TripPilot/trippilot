package com.trippilot.savedaccommodation.application

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.hibernate.exception.ConstraintViolationException
import org.postgresql.util.PSQLException
import org.postgresql.util.ServerErrorMessage
import org.springframework.dao.DataIntegrityViolationException
import java.sql.SQLException

/**
 * 제약 이름 판정은 **드라이버의 구조화 필드**가 먼저다(TRIP-1473). 서버 문구가 한국어면 문구 파싱으로는 이름을 못 뽑는다 —
 * 아래 서버 메시지는 그 상황을 그대로 만든다(`M` 은 한국어, `n` 이 제약 이름 필드).
 */
class ConstraintViolationTest : StringSpec({

    /** PostgreSQL 오류 응답 필드: S=심각도 C=SQLSTATE M=문구 n=제약 이름. 필드 구분자는 NUL 이다(프로토콜 형식). */
    fun psql(constraint: String?, message: String = "중복된 키 값이 고유 제약 조건을 위반함") =
        PSQLException(ServerErrorMessage("SERROR\u0000C23505\u0000M$message\u0000" + (constraint?.let { "n$it\u0000" } ?: "")))

    fun wrapped(cause: Throwable) = DataIntegrityViolationException("could not execute statement", cause)

    "드라이버가 준 제약 이름이 맞으면 그 제약이다 — 문구가 한국어여도" {
        wrapped(psql("ux_saved_stay_external")).violatesConstraint("ux_saved_stay_external") shouldBe true
    }

    "드라이버가 다른 제약을 말하면 Hibernate 이름이 무엇이든 그 제약이 아니다" {
        val hibernate = ConstraintViolationException("x", psql("ck_saved_stay_coord"), "ux_saved_stay_external")
        wrapped(hibernate).violatesConstraint("ux_saved_stay_external") shouldBe false
    }

    "드라이버 필드가 없으면 Hibernate 가 뽑은 이름을 쓴다" {
        val hibernate = ConstraintViolationException("x", SQLException("dup", "23505"), "ux_saved_stay_external")
        wrapped(hibernate).violatesConstraint("ux_saved_stay_external") shouldBe true
    }

    "어디에도 이름이 없으면(길이 초과 22001 등) 그 제약이 아니다" {
        wrapped(psql(constraint = null, message = "자료형 character varying(200)에 너무 긴 값")).violatesConstraint("ux_saved_stay_external") shouldBe false
    }
})
