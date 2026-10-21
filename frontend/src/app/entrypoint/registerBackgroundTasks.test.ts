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
// TRIP-1485 · 실 http 싱크는 네트워크 계층(orval·axios·토큰 저장소)을 끈다 — 이 파일은 설치 여부만 본다.
const mockHttpSink = { sentinel: 'http-sink' };
const mockCreateHttpSink = jest.fn(() => mockHttpSink);
jest.mock('@/shared/location/automation/httpSink', () => ({
  createHttpAutomationSink: mockCreateHttpSink,
}));

describe('registerBackgroundTasks', () => {
  beforeEach(() => {
    jest.resetModules();
    mockDefineTask.mockClear();
    mockCreateHttpSink.mockClear();
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

  // TRIP-1485 · 태스크 적재와 한 쌍으로 실 싱크를 꽂는다(백그라운드 wake 에서도 실 싱크). sink.ts 는 모듈 싱글턴이라
  // 같은 격리 레지스트리에서 꺼내야 배선이 바꾼 그 인스턴스를 본다.
  it('RB3 플래그 ON → http 싱크를 만들어 설치한다', () => {
    mockFlag = true;
    let installed: unknown;
    jest.isolateModules(() => {
      require('./registerBackgroundTasks').registerBackgroundTasks();
      installed =
        require('@/shared/location/automation/sink').getAutomationSink();
    });
    expect(mockCreateHttpSink).toHaveBeenCalledTimes(1);
    expect(installed).toBe(mockHttpSink);
  });

  it('RB4 플래그 OFF → http 싱크를 만들지 않고 가짜 싱크가 남는다', () => {
    mockFlag = false;
    let installed: unknown;
    jest.isolateModules(() => {
      require('./registerBackgroundTasks').registerBackgroundTasks();
      installed =
        require('@/shared/location/automation/sink').getAutomationSink();
    });
    expect(mockCreateHttpSink).not.toHaveBeenCalled();
    expect(installed).not.toBe(mockHttpSink);
  });
});
