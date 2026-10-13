import {
  notifyBootstrapReeval,
  subscribeBootstrapReeval,
} from './bootstrapReeval';

/**
 * bootstrapReeval — 온보딩 완료 재평가 pub/sub 신호(TRIP-353) 자체 계약.
 *
 * 무엇을 보장하나: (1) 구독한 리스너는 notify 때 정확히 한 번 불린다(신호가 실제로 전달된다),
 * (2) 구독 해제한 뒤에는 notify 해도 더는 불리지 않는다(누수 없음). tokenManager 를 미러링한
 * 최소 이벤트 버스라, 값 비교는 없고 subscribe/notify/unsubscribe 세 동작만 검증한다.
 *
 * 3동작: 준비(리스너 구독) → 실행(발화·해제) → 단언(호출 횟수).
 */
describe('bootstrapReeval — 재평가 신호 pub/sub 계약', () => {
  it('구독한 리스너는 notify 때 불리고, 구독 해제하면 더는 불리지 않는다', () => {
    // 준비 — 관찰용 리스너를 구독한다(구독 해제 함수를 받아 둔다).
    const listener = jest.fn();
    const unsubscribe = subscribeBootstrapReeval(listener);

    // 실행 ① — 신호를 발화한다.
    notifyBootstrapReeval();
    // 단언 ① — 리스너가 정확히 1회 불렸다(no-op 스텁이면 0회라 여기서 red).
    expect(listener).toHaveBeenCalledTimes(1);

    // 실행 ② — 구독을 해제하고 다시 발화한다.
    unsubscribe();
    notifyBootstrapReeval();

    // 단언 ② — 해제 뒤에는 호출 횟수가 늘지 않는다(여전히 1회 — 누수 없음).
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
