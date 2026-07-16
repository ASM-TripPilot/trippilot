# TripPilot FE — 통합 테스트용 최소 스텁 (nginx 정적 + /api 프록시).
# 실제 Expo Web export 로 후속 교체. 네이티브는 호스트(시뮬레이터)에서.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/
EXPOSE 80
