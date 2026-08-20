-- AI 전용 벡터 스토어 초기화 (TRIP-426) — 컨테이너 최초 기동 1회.
-- DDL 정본: PgVectorStore(agents/adapters/pgvector_store.py)는 DML만 소유한다.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS kb_vectors (
  collection text  NOT NULL,          -- intent_bank · persona · poi_desc · planb_* (KB_COLLECTIONS)
  item_id    text  NOT NULL,
  embedding  vector(1024) NOT NULL,   -- 차원 1024 고정 (AI-D06, BR-AF-09)
  payload    jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (collection, item_id)
);

-- ponytail: ANN 인덱스 없음(전수 스캔) — KB 수백 건 규모에는 충분.
-- 컬렉션이 수만 건을 넘으면 HNSW: CREATE INDEX ON kb_vectors USING hnsw (embedding vector_cosine_ops);
