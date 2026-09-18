package com.trippilot.app.config

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.SerializationFeature
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.kotlinModule
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.converter.HttpMessageConverter
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

/**
 * MVC JSON 컨버터에 Kotlin·java.time 지원 ObjectMapper 를 명시 주입.
 * SB4.0 은 ObjectMapper 빈을 자동 노출하지 않아 MVC 컨버터가 Kotlin 모듈을 못 물려받는다
 * (data class no-arg 생성자 부재로 역직렬화 실패) → 컨버터를 앞에 추가해 해결.
 */
@Configuration
class WebConfig : WebMvcConfigurer {

    private val mapper: ObjectMapper = ObjectMapper()
        .registerModule(kotlinModule())
        .registerModule(JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)

    /** 다른 컴포넌트도 주입받을 수 있도록 노출. */
    @Bean
    fun objectMapper(): ObjectMapper = mapper

    override fun extendMessageConverters(converters: MutableList<HttpMessageConverter<*>>) {
        converters.add(0, MappingJackson2HttpMessageConverter(mapper))
    }
}
