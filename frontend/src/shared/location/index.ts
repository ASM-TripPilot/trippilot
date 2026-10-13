// 순수 뷰·글리프·config·순수 model 은 index.view 가 정본이고, 여기엔 네트워크 훅 등 그 밖의 것만 더한다.
export * from './index.view';

export { readDevicePosition } from './readDevicePosition';
export { useLocationConsent } from './useLocationConsent';
export { useLocationAutomation } from './automation/useLocationAutomation';
export type { LocationAutomationInput, LocationAutomationResult } from './automation/useLocationAutomation';
export type { EngineStatus } from './automation/engine';
export type { AutomationSlotRef, AutomationVisitRef } from './automation/store';
export { useTripRoutes } from './automation/useTripRoutes';
export { isLocationAutomationEnabled } from './automation/flag';
export { createFakeAutomationSink, getAutomationSink, setAutomationSink } from './automation/sink';
export type { AutomationSinkPort } from './automation/sink';
export { useAutomationStatus } from './automation/useAutomationStatus';
export { distanceSourceByDate } from './automation/distanceSource';
export type { DistanceSource } from './automation/distanceSource';
