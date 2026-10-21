package com.trippilot.app.config

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.SerializationFeature
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.kotlinModule
import com.trippilot.core.error.ValidationFailed
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.converter.HttpMessageConverter
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter
import org.springframework.web.servlet.HandlerInterceptor
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

/**
 * MVC JSON 컨버터에 Kotlin·java.time 지원 ObjectMapper 를 명시 주입.
 * SB4.0 은 ObjectMapper 빈을 자동 노출하지 않아 MVC 컨버터가 Kotlin 모듈을 못 물려받는다
 * (data class no-arg 생성자 부재로 역직렬화 실패) → 컨버터를 앞에 추가해 해결.
 */
@Configuration
class WebConfig : WebMvcConfigurer {

    private val mapper: ObjectMapper = configured(ObjectMapper())

    /** 다른 컴포넌트도 주입받을 수 있도록 노출. */
    @Bean
    fun objectMapper(): ObjectMapper = mapper

    /**
     * 요청 본문을 읽는 매퍼만 NUL 을 거부한다(TRIP-1473, [NulRejectingJsonFactory]). 위 빈은 아웃박스·저장 행처럼
     * **서버가 쓴 값**을 다시 읽는 데도 쓰여, 거기서 거부하면 입력이 아니라 서버 상태가 400 으로 바뀐다.
     */
    override fun extendMessageConverters(converters: MutableList<HttpMessageConverter<*>>) {
        converters.add(0, MappingJackson2HttpMessageConverter(configured(ObjectMapper(NulRejectingJsonFactory()))))
    }

    /**
     * 질의 파라미터 **값**의 NUL(`%00`)도 같은 원칙으로 400 이다(TRIP-1473). 실측: `GET /regions?q=a%00b` 가 조회 SQL 에서
     * 터져 500 이었다. 인터셉터에서 던지면 `GlobalExceptionHandler` 가 받아 봉투로 낸다. 값은 싣지 않는다(SECURITY-15).
     *
     * **이름**은 여기서 보지 않는다 — 보안 방화벽(`StrictHttpFirewall`)이 이름을 읽는 순간(아래 `parameterMap`) 먼저
     * 거부해 이 줄에 닿지 않는다(그 400 은 `GlobalExceptionHandler.handleRejected`). 경로의 `%00` 은 Tomcat 이 막는다.
     */
    override fun addInterceptors(registry: InterceptorRegistry) {
        registry.addInterceptor(object : HandlerInterceptor {
            override fun preHandle(request: HttpServletRequest, response: HttpServletResponse, handler: Any): Boolean {
                val nul = request.parameterMap.values.any { values -> values.any { NUL in it } }
                if (nul) throw ValidationFailed(emptyList(), "요청 파라미터에 쓸 수 없는 문자(NUL)가 있습니다.")
                return true
            }
        })
    }

    private fun configured(m: ObjectMapper): ObjectMapper = m
        .registerModule(kotlinModule())
        .registerModule(JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)

    private companion object {
        const val NUL = '\u0000'
    }
}
