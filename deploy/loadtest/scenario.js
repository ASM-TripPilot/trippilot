// 부하 시나리오 — 앱을 연 사용자가 실제로 부르는 조회 경로(LLM 을 부르는 경로는 비용 때문에 뺀다).
// run.py 가 ConfigMap 으로 넣고 클러스터 안에서 backend:8080 에 직접 쏜다(gateway 의 IP 당 10r/s 제한을 거치지 않는다 —
// 그 제한은 클라이언트 보호용이고, 여기서 재는 것은 서버가 버티는 양이다).
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://backend:8080';
const tokens = JSON.parse(open('/work/tokens.json'));

// "1m:20,2m:50,2m:100,1m:0" → 단계. run.py --stages 로 바꾼다.
const stages = (__ENV.STAGES || '1m:20,2m:50,2m:100,1m:0').split(',').map((s) => {
  const [duration, target] = s.split(':');
  return { duration, target: Number(target) };
});

export const options = {
  stages,
  // 판정은 하지 않고 기록만 — 문턱은 덱 26장 "서버 API 목표 0.8초"와 같게 둬서 요약에 통과 여부가 찍힌다.
  thresholds: {
    'http_req_duration{kind:api}': ['p(95)<800'],
    'http_req_failed{kind:api}': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
// k6 는 문턱이 걸린 태그만 따로 집계한다 — 경로별 지연을 요약에 남기려고 항상 통과하는 문턱을 건다.
for (const name of ['bootstrap', 'me', 'trips', 'places_region', 'places_search', 'regions', 'notifications']) {
  options.thresholds[`http_req_duration{name:${name}}`] = ['max>=0'];
}

const REGIONS = ['제주', '서울', '부산', '강원', '경주'];
// PoiCategory 는 한글 값이다(place-data Poi.kt) — 영문 경계 코드를 넣으면 400 이다.
const CATEGORIES = ['맛집', '카페', '명소'];
const WORDS = ['카페', '해변', '시장', '박물관', '공원'];

function get(path, name, token) {
  const res = http.get(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name, kind: 'api' },
  });
  check(res, { [`${name} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  return res;
}

export default function () {
  const token = tokens[(__VU - 1) % tokens.length];
  const region = REGIONS[__ITER % REGIONS.length];
  // 앱 열기
  get('/api/v1/bootstrap', 'bootstrap', token);
  get('/api/v1/me', 'me', token);
  get('/api/v1/trips', 'trips', token);
  sleep(1);
  // 장소 둘러보기 — DB 가 가장 무거운 경로
  get(`/api/v1/places?region=${encodeURIComponent(region)}&category=${encodeURIComponent(CATEGORIES[__ITER % 3])}&limit=20`, 'places_region', token);
  get(`/api/v1/places?q=${encodeURIComponent(WORDS[__ITER % WORDS.length])}&limit=20`, 'places_search', token);
  get(`/api/v1/regions?q=${encodeURIComponent(region)}`, 'regions', token);
  sleep(1);
  get('/api/v1/me/notifications', 'notifications', token);
  sleep(2);
}

export function handleSummary(data) {
  const m = data.metrics;
  const pick = (name) => m[name] && m[name].values;
  const byName = {};
  for (const key of Object.keys(m)) {
    const hit = key.match(/^http_req_duration\{name:(.+)\}$/);
    if (hit) byName[hit[1]] = m[key].values;
  }
  const out = {
    stages: __ENV.STAGES,
    vus_max: pick('vus_max') && pick('vus_max').max,
    requests: pick('http_reqs') && pick('http_reqs').count,
    rps: pick('http_reqs') && pick('http_reqs').rate,
    failed_rate: pick('http_req_failed') && pick('http_req_failed').rate,
    duration: pick('http_req_duration'),
    by_endpoint: byName,
    thresholds_ok: Object.values(m).every((x) => !x.thresholds || Object.values(x.thresholds).every((t) => t.ok)),
  };
  return { stdout: `LOADTEST_SUMMARY ${JSON.stringify(out)}\n` };
}
