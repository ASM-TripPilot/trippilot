// TRIP-1338 · 앱 JS 평가의 첫 줄(NFR LC-U10-1). U10 백그라운드 태스크 정의가 라우트 트리보다 먼저 평가돼야
// 백그라운드 wake(JS 번들만 로드)에서도 태스크가 있다. 플래그 OFF 면 registerBackgroundTasks 가 아무것도 끌지 않는다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./src/app/entrypoint/registerBackgroundTasks').registerBackgroundTasks();
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('expo-router/entry');
