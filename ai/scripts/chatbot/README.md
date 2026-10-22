# 도우미 챗봇 테스트 화면 (chat lab)

앱 도우미 시트와 비슷한 화면에서 **실제 챗봇**(지금 체크아웃의 AI 코드 · 실 LLM · 실 Provider)과 대화하고,
턴마다 응답 시간·LLM 호출·Provider 호출을 타임라인으로 본다. 성능·답변 품질 점검용 개발 도구이고 배포되지 않는다.

| 파일 | 역할 |
|---|---|
| `chat_lab.py` | AI 앱(`main.build_app_from_env`)을 띄우고(8791) 화면 서버(8790)가 서비스 토큰을 붙여 대신 부른다. 호출 계측 포함 |
| `chat_lab.html` | 화면 — 왼쪽 휴대폰 시트, 오른쪽 성능 패널 |

## 준비 (처음 한 번)

1. 로컬 도커를 띄운다 — 리포 루트에서 `docker compose --profile full up -d`.
   `trippilot-ai`(설정값을 여기서 읽는다)·`trippilot-backend`(장소 DB)·`trippilot-ai-embedding`·`trippilot-ai-vectordb`(대화 메모리)가 떠 있어야 한다.
2. `cd ai && uv sync`
3. (선택) 리포 루트 `.env` 에 `WEATHER_API`·`ODSAY_API_KEY` 가 있으면 그 값을 쓴다. 워크트리에서 켜면 메인 체크아웃의 `.env` 를 찾는다. 없으면 컨테이너 값을 쓴다.

## 켜기

```bash
cd ai
uv run python scripts/chatbot/chat_lab.py
```

`챗봇 테스트 화면: http://127.0.0.1:8790` 줄이 나오면 브라우저로 연다. 뜨는 데 10~20초 걸린다(질문뱅크 색인).

터미널을 닫아도 계속 돌게 하려면 백그라운드로 켠다.

```bash
cd ai
nohup uv run python scripts/chatbot/chat_lab.py > /tmp/chat_lab.log 2>&1 &
```

## 끄기

- 앞에서 켰으면 그 터미널에서 **Ctrl+C**
- 백그라운드로 켰으면 `pkill -f scripts/chatbot/chat_lab.py`
- 켜져 있는지 확인: `curl -s http://127.0.0.1:8790/info` (응답이 없으면 꺼져 있다)

## 화면

- **왼쪽 휴대폰 시트** — 말풍선·정보 카드·대안 목록·다음 행동 버튼·추천 답장·입력창. 답변 아래 회색 줄(`#1 · 5.85s · LLM 2 …`)을 누르면 오른쪽에 그 턴 상세가 열린다.
  다음 행동 버튼과 후보 고르기는 앱에선 백엔드가 처리하므로 여기선 안내만 뜬다. 편집 같은 프레임 반환·범위 밖 답도 백엔드 몫이라 메모·템플릿 문구로 보여 준다.
- **요약** — 턴 수, 응답 시간 p50·p90·최대, 평균 LLM 호출·지연, LLM 폴백, HTTP 실패. 의도 분류 불가(범위 밖)는 정상 판정이라 폴백에 세지 않는다.
- **테스트 문장** — 누르면 대화에 이어서 보낸다. `전체 자동 실행`은 문장마다 새 세션으로 보내고 끝나면 그 세션 메모리를 지운다.
- **턴 기록** — 턴별 응답 시간·LLM 호출·결과·의도·신뢰도·토큰. `JSON 내보내기`로 저장.
- **턴 상세** — 메모리 읽기·의도 분류 LLM·Provider·후보 풀·PlanB·답변 LLM 막대, 병렬/순차, 경고 로그, 요청·응답 원문.
  분홍 연한 막대는 3단 라우터 섀도(배경)라 사용자 응답 시간 밖이다.
- **상황 설정** — 백엔드가 보내는 `context`(여행·일정)를 JSON 으로 고친다. 기본값은 제주 오늘·내일 일정(제주문학관은 월요일 휴관).

## 도구 계획 단계

분류가 "정해진 의도 없음"으로 닫은 말("내일 비 오면 실내 갈 데 있어?")은 계획 LLM(`DIALOGUE_PLAN`)이 조회 도구 ≤2 를 골라 답한다(#1420). 테스트 화면은 기본으로 켜 둔다 — 끄려면 `LAB_PLAN=0`.

장소의 영업시간·휴무일·입장료가 "미확인"이면 `UnknownHandlingAgent`(`PLACE_FACT_LOOKUP`)가 벤더 웹 검색으로 뒤에서 찾는다 — 첫 질문은 "찾아보고 있어요" 각주와 [다시 묻기] 칩, 10초쯤 뒤 다시 물으면 출처와 함께 답한다. 결과는 로컬 벡터 DB `place_fact_cache` 에 남는다(표가 없으면 `docker exec -i trippilot-ai-vectordb psql -U ai_kb -d ai_kb < ai/docker/vector-init/03-place-fact-cache.sql`). 끄려면 `LAB_UNKNOWN=0`. 다시 찾게 하려면 그 장소 행을 지운다.

## 장소 조회(NL2SQL)

일정에 없는 장소의 영업시간·입장료("경복궁 몇 시까지 해?")와 일정 밖 두 곳 사이 거리("강남에서 홍대 어떻게 가?")는 같은 DB 에서 **정확한 이름**으로 찾는다(LLM 없음, 별칭·체인점은 찾지 않는다). "서울 요즘 핫한 곳"·"망원동 산책할 곳"처럼 **지역을 말한 장소 탐색**은 LLM 이 쓴 SELECT 로 백엔드 장소 DB 를 읽는다(`DIALOGUE_SQL`). 테스트 화면은 기본으로 켜 둔다 — `DIALOGUE_SQL` 을 분류와 같은 모델에 배정하고 `ai_user`(읽기 전용)로 로컬 백엔드 DB 에 붙는다. 끄려면 `LAB_PLACE_SQL=0`.

방어는 세 겹이다: DB 롤은 `poi_public` 뷰(보여 줘도 되는 칸·영업 중 행)만 읽기 전용·문장 시한 2s 로 읽고, 출구 게이트가 허용 목록 밖 낱말·기호(다른 표·함수·주석·세미콜론·형변환 등)를 통째로 버리며, 실행기가 READ ONLY·1.5s·20행으로 감싸고 화면에 나갈 칸(이름·종류·구군·표지)만 고른다. SQL 이 실패·0건이면 종전 반경 탐색으로 간다.

로컬 DB 준비(처음 한 번 — 새로 만든 DB 는 `backend/docker/init/00-roles.sql` 이 롤을 만든다. 뷰는 백엔드가 Flyway V2.77 을 돌리면 `app.poi_public` 으로 생기고, 그 전까지는 같은 정의를 `lab` 스키마에 둔다):

```bash
docker exec -i trippilot-db sh -c 'psql -U "$POSTGRES_USER" -d trippilot' <<'SQL'
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ai_user') THEN CREATE ROLE ai_user LOGIN PASSWORD 'ai_user'; END IF; END $$;
GRANT CONNECT ON DATABASE trippilot TO ai_user;
GRANT USAGE ON SCHEMA app TO ai_user;
ALTER ROLE ai_user IN DATABASE trippilot SET default_transaction_read_only = on;
ALTER ROLE ai_user IN DATABASE trippilot SET statement_timeout = '2s';
CREATE SCHEMA IF NOT EXISTS lab;
CREATE OR REPLACE VIEW lab.poi_public WITH (security_barrier) AS
SELECT poi_id, name_ko AS name, category, split_part(address, ' ', 1) AS sido, region AS sigungu, address, tags, saved_count
FROM app.poi WHERE data_status = 'ACTIVE';
GRANT USAGE ON SCHEMA lab TO ai_user;
GRANT SELECT ON lab.poi_public TO ai_user;
ALTER ROLE ai_user IN DATABASE trippilot SET search_path = lab, app;
SQL
```

치우기: `DROP SCHEMA lab CASCADE;` 뒤 `ALTER ROLE ai_user IN DATABASE trippilot SET search_path = app;`. 로컬 DB 에는 `요즘 인기` 표지가 없어서 인기순 정렬은 개발 서버 데이터에서만 보인다.

## 알아 둘 것

- **실 LLM·실 API 를 부른다** — 비용과 일일 한도(ODsay 등, 운영과 같은 키)를 쓴다. 자동 실행 반복 횟수에 주의한다.
- 섀도 비율 기본 1.0(개발 서버와 같음)이라 턴마다 배경 LLM 이 1~2회 더 돈다. 끄려면 `LAB_SHADOW_RATE=0 uv run python scripts/chatbot/chat_lab.py`.
- 도는 코드는 **켠 체크아웃의 것**이다. develop 최신을 보려면 pull 하고 켠다.
- 대화 메모리는 로컬 vectordb(`ai_kb.dialogue_memory`)에 세션 단위로 남는다. `새 대화`·자동 실행은 끝날 때 지운다.
- 한 사람이 한 번에 한 턴씩 보내는 전제다 — 타임라인을 시각으로 묶는다.
- `Address already in use` 가 나면 이미 켜져 있다. 끄고 다시 켠다(포트 8790 화면 · 8791 AI 앱).
