import { notifyManager } from '@tanstack/react-query';
import { act } from '@testing-library/react-native';

/**
 * 지금까지 예약된 react-query 알림이 전부 전달되고 그 재렌더가 커밋될 때까지 기다린다(TRIP-884·953).
 * 같은 스케줄러에 뒤이어 예약하므로 시간이 아니라 순서로 기다린다 — `act` 뒤 `result.current` 를
 * 읽기 전에 부른다.
 *
 * 알림을 늦추는 잠금(`notifyManager.setScheduler`)은 여기 두지 않는다 — 소비 파일의 `beforeAll` 에
 * 인라인으로 걸고 `afterAll` 에서 되돌린다. 공용으로 옮기면 그 지연이 이 헬퍼를 쓰는 모든 파일로 번진다.
 */
export async function flushNotifications(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
}
