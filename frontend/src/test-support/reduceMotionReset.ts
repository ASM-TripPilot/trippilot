// 동작 줄이기 답은 모듈 캐시라(TRIP-1735) 같은 파일 안 테스트 사이로 샌다 — 앞 테스트의 답·진행 중 질문·구독을 테스트마다
// 비운다. 파일과 파일 사이는 jest 가 모듈 레지스트리를 새로 만들어 원래 안 샌다. 두 jest 설정이 모두 물려받는다.
import { resetReduceMotionForTests } from '@/shared/lib/reduceMotion';

beforeEach(() => {
  resetReduceMotionForTests();
});
