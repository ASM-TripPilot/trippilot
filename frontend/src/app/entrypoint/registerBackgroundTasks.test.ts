/**
 * TRIP-1338 · BR-U10-07 — 플래그 OFF 빌드에서 태스크 정의가 한 줄도 실행되지 않는다. ON 이면 지오펜스·경로 2개.
 * 3동작 뼈대: 준비=플래그 목 → 실행=registerBackgroundTasks → 단언=TaskManager.defineTask 호출 수.
 */
const mockDefineTask = jest.fn();
let mockFlag = false;

jest.mock('expo-task-manager', () => ({ defineTask: mockDefineTask }));
jest.mock('@/shared/location/automation/flag', () => ({
  isLocationAutomationEnabled: () => mockFlag,
}));

describe('registerBackgroundTasks', () => {
  beforeEach(() => {
    jest.resetModules();
    mockDefineTask.mockClear();
  });

  it('RB1 플래그 OFF → tasks.ts 를 평가하지 않는다(defineTask 0회)', () => {
    mockFlag = false;
    jest.isolateModules(() => {
      const { registerBackgroundTasks } = require('./registerBackgroundTasks');
      expect(registerBackgroundTasks()).toBe(false);
    });
    expect(mockDefineTask).not.toHaveBeenCalled();
  });

  it('RB2 플래그 ON → 지오펜스·경로 태스크 2개를 정의한다', () => {
    mockFlag = true;
    jest.isolateModules(() => {
      const { registerBackgroundTasks } = require('./registerBackgroundTasks');
      expect(registerBackgroundTasks()).toBe(true);
    });
    expect(mockDefineTask.mock.calls.map((c) => c[0])).toEqual([
      'trippilot-u10-geofence',
      'trippilot-u10-route',
    ]);
  });
});
