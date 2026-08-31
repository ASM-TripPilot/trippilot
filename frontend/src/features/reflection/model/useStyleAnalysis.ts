import { useGetMeStyle } from '@/shared/api/generated/reflection/reflection';

/**
 * TRIP-573 · useStyleAnalysis — j05 스타일 조회를 잇는 얇은 래퍼(재사용 1훅만, 새 HTTP 0).
 *
 * `useGetMeStyle`(orval 생성 훅, `GET /me/style` — 계정 단위 `/me/`, INV-U5-08)을 그대로 흘려보낸다.
 * 조회 전용 — 저장/변형 mutation 을 만들지 않는다(BR-U5-41·INV-U5-09, 임시 미리보기 저장 금지).
 * 얼굴 판정(resolveStyleFace)·VM 조립은 페이지 몫이라 이 훅은 결과를 있는 그대로 낸다.
 *
 * ★ 재사용만 — `customInstance`/`axios`/mutation 훅을 새로 만들지 않는다(travelStyleStructure G5).
 * `MyPage.tsx` 가 이미 `useGetMeStyle` 을 직접 소비하는 선례(같은 봉투를 요약카드용으로 씀).
 *
 * 반환 타입은 **추론에 맡긴다** — 명시 `ReturnType<typeof useGetMeStyle>` 은 오버로드 마지막 시그니처를
 * 집어 `data` 를 `{}` 로 뭉개, 페이지의 `resolveStyleFace(envelope)` 가 tsc 에서 깨진다(직접 호출 추론은
 * `StyleAnalysisEnvelope | undefined` 로 정확하다 — `MyPage` 선례). 그래서 애너테이션을 두지 않는다.
 */
export function useStyleAnalysis() {
  return useGetMeStyle();
}
