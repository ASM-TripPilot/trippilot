// common/security — JWT 발급·검증·인증 필터 지원(LC-2). RS256 리소스 서버(TRIP-153).
// kotlin-spring: @Component·@Configuration open (프록시). BOM은 platform 으로 버전 해석.
plugins {
    alias(libs.plugins.kotlin.spring)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(libs.spring.boot.starter.oauth2.resource.server) // JwtEncoder/Decoder(Nimbus) + Bearer 필터
    implementation(libs.kotlin.reflect)
    // 서비스 토큰 필터가 쓰는 서블릿 타입 — 런타임은 app 의 web starter 가 제공한다(여기서 톰캣을 끌지 않는다).
    compileOnly("jakarta.servlet:jakarta.servlet-api")                              // @ConfigurationProperties 바인딩

    testImplementation(libs.bundles.kotest)
}
