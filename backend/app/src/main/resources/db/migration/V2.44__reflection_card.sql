-- 회고 산출물을 문장에서 카드로(TRIP-425 계열 · DEC-U5-14 · G-U5-4 해소).
--
-- V2.43 다음 번호. 열린 PR 중 db/migration 을 건드리는 것이 없어 충돌 없음(2026-09-01 확인).
--
-- ## 왜 바뀌나
--
-- 정본 §5.3 은 `ai/` 회고 계약을 **초안**으로 적고 G-U5-4 가 "AI팀 협의 선행"이라 열어 뒀다.
-- 협의 결과 실계약은 문장이 아니라 **카드**다 — `template_id`·`cover`·`scenes[]`·`hashtags[]`.
-- `scenes[].photo_slot` 은 사용자 사진을 특정 장면에 묶는 장치라 문장 하나로 표현할 수 없다.
--
-- ## 왜 지금인가
--
-- 프런트에 회고 화면이 아직 없다(실측: `features/reflection` 부재). 계약을 깨도 깨질 소비자가
-- 없는 지금이 전환 비용의 최저점이다.
--
-- ## 백엔드는 카드를 모델링하지 않는다(DEC-U5-14)
--
-- 카드는 jsonb 로 통째 보관하고 `cover` 밖은 해석하지 않는다. `template_id`·`card_format` 이
-- 버전 키라, 상대가 템플릿을 늘려도 이 스키마가 안 움직인다.
ALTER TABLE reflection
  ADD COLUMN draft_card  jsonb,
  ADD COLUMN edited_card jsonb,
  ADD COLUMN template_id varchar(64),
  ADD COLUMN card_format varchar(24);

-- 기존 행 이관 — 문장을 **버리지 않는다**. 문장이 곧 카드의 제목이 되고, 장면은 만들지 않는다.
--
-- 장면을 지어내지 않는 이유가 이 전환의 규칙이다(BR-U5-31 환각 금지): 옛 행에는 장면을 만들
-- 근거가 없다. `legacy.text.v1` 이 "이건 옛 문장을 옮긴 것"이라고 밝혀, 나중에 이 카드를 보고
-- "AI 가 이렇게 만들었나" 하고 오해하지 않게 한다.
UPDATE reflection SET
  draft_card = jsonb_build_object(
    'template_id', 'legacy.text.v1', 'format', 'CARD',
    'cover', jsonb_build_object('title', draft_narrative, 'subtitle', ''),
    'scenes', '[]'::jsonb),
  edited_card = CASE WHEN edited_narrative IS NULL THEN NULL ELSE jsonb_build_object(
    'template_id', 'legacy.text.v1', 'format', 'CARD',
    'cover', jsonb_build_object('title', edited_narrative, 'subtitle', ''),
    'scenes', '[]'::jsonb) END,
  template_id = 'legacy.text.v1',
  card_format = 'CARD'
WHERE draft_card IS NULL;

-- 이관이 끝난 뒤에야 NOT NULL 을 건다 — 먼저 걸면 기존 행이 있는 DB 에서 마이그레이션이 죽는다.
ALTER TABLE reflection
  ALTER COLUMN draft_card  SET NOT NULL,
  ALTER COLUMN template_id SET NOT NULL,
  ALTER COLUMN card_format SET NOT NULL;

-- 문장 컬럼은 **지운다**. 남기면 두 출처가 되고, 편집이 한쪽에만 반영되는 날이 온다.
ALTER TABLE reflection
  DROP COLUMN draft_narrative,
  DROP COLUMN edited_narrative;
