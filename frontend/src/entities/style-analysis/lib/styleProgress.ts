import type {
  StyleAnalysisEnvelope,
  StyleProgress,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-956 · 스타일 진행도 폴백 — j05(상세)와 l03 요약카드가 같이 쓰는 한 곳.
 *
 * 계약상 `progress` 는 필수지만 서버가 빼먹거나 한쪽만 보내도 두 화면이 죽지 않고 같은 "현재 N곳"을
 * 보이도록 **칸마다** 채운다(current 0 · required 10). 객체 통째 폴백(`progress ?? 기본값`)은 `{}` 를
 * 그대로 흘려보내므로 쓰지 않는다.
 */
export function resolveStyleProgress(
  envelope: StyleAnalysisEnvelope
): StyleProgress {
  return {
    current: envelope.progress?.current ?? 0,
    required: envelope.progress?.required ?? 10,
  };
}
