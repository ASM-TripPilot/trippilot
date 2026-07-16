# TripPilot AI — 통합 테스트용 최소 스텁 (Python stdlib, 의존성 없음)
# 실제 C1/C2 는 FastAPI 등으로 후속 교체.
FROM python:3.12-slim
WORKDIR /app
COPY main.py .
EXPOSE 8000
CMD ["python", "main.py"]
