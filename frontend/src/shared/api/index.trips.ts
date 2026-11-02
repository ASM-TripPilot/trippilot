// 태그 하나만 내는 진입점 — 부팅 경로가 12태그 배럴(index.hooks)을 통째로 끌지 않게(TRIP-1716). 그 밖의 소비처는 index.hooks.

export * from './generated/trips/trips';
export {
  cancelActiveGeneration,
  resolveGenerationInProgress,
  resolveGenerationRefused,
} from './generationInProgress';
