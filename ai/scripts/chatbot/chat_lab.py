"""도우미 챗봇 성능 테스트 화면 — 실 앱(build_app_from_env)을 이 프로세스에 띄우고 브라우저 화면에서 대화한다.

켜기·끄기·화면 설명은 같은 폴더의 README.md. 요약: `cd ai && uv run python scripts/chatbot/chat_lab.py` → http://127.0.0.1:8790
- AI 앱은 127.0.0.1:8791 에 뜬다(실 LLM·실 Provider). 화면 서버(8790)가 서비스 토큰을 붙여 대신 부른다.
- 환경은 로컬 trippilot-ai 컨테이너 값을 `docker exec env` 로 읽고(파일로 남기지 않는다) 호스트만 localhost 로 바꾼다.
  날씨·ODsay 키는 리포 루트 .env(워크트리면 메인 체크아웃 것)에서 보강한다. 섀도 비율은 LAB_SHADOW_RATE(기본 1.0 = 개발 서버와 같음).
- LLM·Provider·후보 풀·PlanB·메모리 호출을 클래스 단위로 감싸 턴마다 타임라인으로 돌려준다.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LAB_PORT, AI_PORT = 8790, 8791
HERE = Path(__file__).resolve().parent
AI_DIR = HERE.parents[1]
os.chdir(AI_DIR)  # config/llm-prices.json·prompts 를 ai/ 기준 상대경로로 읽는다
sys.path[:0] = [str(AI_DIR), str(AI_DIR / "src")]


def _env_file() -> Path | None:
    common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                            capture_output=True, text=True).stdout.strip()
    for p in (AI_DIR.parent / ".env", Path(common).parent / ".env" if common else None):
        if p is not None and p.is_file():
            return p
    return None


# ── 1. 환경 ──────────────────────────────────────────────────────────────
_ps = subprocess.run(["docker", "exec", "trippilot-ai", "env"], capture_output=True, text=True)
if _ps.returncode != 0:
    sys.exit("로컬 AI 컨테이너(trippilot-ai)가 떠 있어야 한다 — 리포 루트에서 `docker compose --profile full up -d` 후 다시 실행\n"
             + _ps.stderr.strip())
env = dict(line.split("=", 1) for line in _ps.stdout.splitlines() if "=" in line)
keep = {k: v for k, v in env.items() if k.startswith(("TRIPPILOT_", "OPENAI_", "ANTHROPIC_", "TMAP_", "KAKAO_", "WEATHER_",
                                                     "EVENTS_", "EXISTENCE_", "AWS_PROFILE"))}
ENV_FILE = _env_file()
for line in ENV_FILE.read_text().splitlines() if ENV_FILE else []:
    for key in ("ODSAY_API_KEY", "WEATHER_API"):
        if line.startswith(key + "="):
            keep[key] = line.split("=", 1)[1].strip().strip('"')
keep.update({
    "TRIPPILOT_BACKEND_BASE_URL": "http://localhost:8080",
    "TRIPPILOT_EMBEDDING_BASE_URL": "http://localhost:8100",
    "TRIPPILOT_VECTOR_DB_URL": "postgresql://ai_kb:ai_kb@localhost:5433/ai_kb",
    "TRIPPILOT_LLM_PRICE_FILE": str(Path.cwd() / "config/llm-prices.json"),
    "TRIPPILOT_DIALOGUE_ORCHESTRATOR": "on",
    "TRIPPILOT_DIALOGUE_SHADOW_RATE": os.environ.get("LAB_SHADOW_RATE", "1.0"),
})
# 장소 탐색 NL2SQL — 로컬 백엔드 DB 를 ai_user(poi_public 뷰 읽기 전용)로 읽고, DIALOGUE_SQL 을 분류와 같은 모델에 배정해 켠다.
# LAB_PLACE_SQL=0 이면 끈다(반경 탐색만). 롤·뷰 준비는 README "장소 조회(NL2SQL)".
# 도구 계획 단계(DIALOGUE_PLAN — 분류가 "정해진 의도 없음"으로 닫은 말을 조회 도구로)도 같은 모델로 켠다. LAB_PLAN=0 이면 끈다.
# 인사·잡담 LLM(DIALOGUE_SMALLTALK)도 같은 모델로 켠다. LAB_SMALLTALK=0 이면 고정 문장.
_models = keep.get("TRIPPILOT_LLM_FEATURE_MODELS", "")
_intent_model = dict(kv.split("=", 1) for kv in _models.split(",") if "=" in kv).get("DIALOGUE_INTENT")
for feature, flag in (("DIALOGUE_SQL", "LAB_PLACE_SQL"), ("DIALOGUE_PLAN", "LAB_PLAN"), ("DIALOGUE_SMALLTALK", "LAB_SMALLTALK")):
    if _intent_model and os.environ.get(flag, "1") != "0" and f"{feature}=" not in _models:
        _models = f"{_models},{feature}={_intent_model}"
keep["TRIPPILOT_LLM_FEATURE_MODELS"] = _models
if os.environ.get("LAB_PLACE_SQL", "1") != "0":
    keep["TRIPPILOT_PLACE_DB_URL"] = os.environ.get("LAB_PLACE_DB_URL", "postgresql://ai_user:ai_user@localhost:5432/trippilot")
os.environ.update(keep)
TOKEN = keep.get("TRIPPILOT_SERVICE_AUTH_TOKEN", "")

# ── 2. 계측 ──────────────────────────────────────────────────────────────
# 한계: 턴 구분은 시각·순번으로만 한다 — 한 사람이 한 번에 한 턴씩 보내는 전제, 동시 사용이면 요청 ID 로 묶어야 한다.
EVENTS: list[dict] = []
LOCK = threading.Lock()
T0 = time.perf_counter()


def _ms(t: float) -> int:
    return int((t - T0) * 1000)


def _rec(label, t1, t2, detail):
    with LOCK:
        EVENTS.append({"seq": len(EVENTS), "label": label, "s": _ms(t1), "e": _ms(t2),
                       "thread": threading.current_thread().name, **detail})


def wrap(cls, name, label, summarize):
    orig = getattr(cls, name)

    def w(self, *a, **k):
        t1 = time.perf_counter()
        r, err = None, None
        try:
            r = orig(self, *a, **k)
            return r
        except Exception as e:  # noqa: BLE001
            err = type(e).__name__
            raise
        finally:
            d = {"error": err} if err else {}
            try:
                d.update(summarize(a, k, r) if r is not None else {})
            except Exception:  # noqa: BLE001
                pass
            _rec(label, t1, time.perf_counter(), d)
    setattr(cls, name, w)


class _Cap(logging.Handler):
    def emit(self, record):
        t = time.perf_counter()
        _rec("log", t, t, {"level": record.levelname, "logger": record.name, "msg": record.getMessage()[:300]})


from trippilot.agents.adapters.pg_memory_store import PgDialogueMemoryStore  # noqa: E402
from trippilot.agents.planb.rag import PlanBAgent  # noqa: E402
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder  # noqa: E402
from trippilot.providers.poi_info import PoiInfoProvider  # noqa: E402
from trippilot.providers.transit import TransitProvider  # noqa: E402
from trippilot.providers.weather import WeatherProvider  # noqa: E402


def _llm_sum(a, k, r):
    rec = getattr(r, "call_record", None)
    return {"feature": getattr(a[0], "value", str(a[0])), "fallback": bool(r.is_fallback), "err": (r.error or "")[:160],
            "model": getattr(rec, "model_id", None), "in_tok": getattr(rec, "input_tokens", None),
            "out_tok": getattr(rec, "output_tokens", None), "llm_ms": getattr(rec, "latency_ms", None)}


def _pkt_sum(a, k, r):
    st = getattr(r, "status", None)
    return {"status": getattr(st, "value", str(st)), "data_keys": sorted((getattr(r, "data", {}) or {}).keys())[:8]}


wrap(GatewayFacade, "call", "LLM", _llm_sum)
wrap(PoiInfoProvider, "fetch", "provider:POI_INFO", _pkt_sum)
wrap(WeatherProvider, "fetch", "provider:WEATHER", _pkt_sum)
wrap(TransitProvider, "fetch", "provider:TRANSIT", _pkt_sum)
wrap(CandidatePoolBuilder, "build", "agent:CandidatePool", lambda a, k, r: {"pool_size": len(getattr(r, "pois", ()))})
wrap(PlanBAgent, "run", "agent:PlanB", lambda a, k, r: {"alternatives": len(getattr(r, "alternatives", ())),
                                                       "empty_reason": getattr(r, "empty_reason", None)})
for m in [n for n in dir(PgDialogueMemoryStore) if not n.startswith("_") and callable(getattr(PgDialogueMemoryStore, n))]:
    wrap(PgDialogueMemoryStore, m, f"memory:{m}", lambda a, k, r: {})

import main  # noqa: E402

main.configure_logging()
logging.getLogger().addHandler(_Cap(level=logging.WARNING))
app = main.build_app_from_env()


# ── 3. 화면 서버 ─────────────────────────────────────────────────────────
def _ai(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    req = urllib.request.Request(f"http://127.0.0.1:{AI_PORT}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "X-Service-Token": TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw[:1000]}
    except OSError as e:
        return 0, {"error": f"{type(e).__name__}: {e}"}


def _events_after(seq: int) -> list[dict]:
    with LOCK:
        return EVENTS[seq:]


class Lab(BaseHTTPRequestHandler):
    def _send(self, code: int, obj=None, *, html: bytes | None = None):
        data = html if html is not None else json.dumps(obj, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8" if html is not None else "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self._send(200, html=(HERE / "chat_lab.html").read_bytes())
        if self.path.startswith("/events"):
            seq = int(self.path.split("after=", 1)[1]) if "after=" in self.path else 0
            return self._send(200, {"events": _events_after(seq), "seq": len(EVENTS)})
        if self.path == "/info":
            code, health = _ai("GET", "/health")
            return self._send(200, {"ai": code, "health": health,
                                    "shadow_rate": keep["TRIPPILOT_DIALOGUE_SHADOW_RATE"]})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/chat":
            return self._send(404, {"error": "not found"})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        seq0, t1 = len(EVENTS), time.perf_counter()
        code, resp = _ai("POST", "/ai/v1/dialogue/interpret", body)
        t2 = time.perf_counter()
        self._send(200, {"http": code, "t0": _ms(t1), "wall_ms": int((t2 - t1) * 1000), "response": resp,
                         "events": _events_after(seq0), "seq": len(EVENTS)})

    def do_DELETE(self):
        if not self.path.startswith("/memory"):
            return self._send(404, {"error": "not found"})
        code, resp = _ai("DELETE", "/ai/v1/dialogue/memory" + self.path[len("/memory"):])
        self._send(200, {"http": code, "response": resp})

    def log_message(self, *a):  # 요청마다 찍는 기본 접근 로그는 끈다
        pass


if __name__ == "__main__":
    import uvicorn

    threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", LAB_PORT), Lab).serve_forever, daemon=True).start()
    print(f"챗봇 테스트 화면: http://127.0.0.1:{LAB_PORT}  (AI 앱 {AI_PORT}, 섀도 {keep['TRIPPILOT_DIALOGUE_SHADOW_RATE']})",
          flush=True)
    uvicorn.run(app, host="127.0.0.1", port=AI_PORT, log_level="warning")
