"""실 수집 DAG(`poi_collect_live`·`event_collect_live`) — 실 API·GitHub 0회.

origin 은 임시 bare 리포(file://), `uv`·`gh` 는 PATH 앞에 둔 가짜다 — 수집 스크립트 대신 정해 둔 산출물을 쓰고,
gh 는 정해 둔 PR 상태를 돌려준다. 그래서 복원·병합·게시·커서 영속의 **순서와 조건**을 진짜 git 위에서 본다.
Airflow 가 없으면 DAG 실행 테스트는 건너뛴다(복원·영속 단위 테스트는 돈다).
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from datetime import date, datetime, time
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

BATCH = Path(__file__).resolve().parents[1]
DAGS = BATCH / "dags"
sys.path.insert(0, str(BATCH))
import checks  # noqa: E402
import live  # noqa: E402

os.environ.setdefault("AIRFLOW__CORE__DAGS_FOLDER", str(DAGS))
os.environ.setdefault("AIRFLOW__CORE__LOAD_EXAMPLES", "False")
try:
    import airflow  # noqa: F401
except ImportError:  # pragma: no cover
    airflow = None

SEOUL_ADDRESS = "서울특별시 양천구 신정동 1"

# 가짜 uv — `uv sync` 는 아무것도 안 하고, `uv run python scripts/collect/<x>.py` 는 x 에 맞는 산출물을 쓴다.
FAKE_UV = textwrap.dedent("""\
    #!/usr/bin/env python3
    import json, os, sys
    args = sys.argv[1:]
    with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as f:
        f.write("uv " + " ".join(args) + "\\n")
    if args[0] == "sync":
        sys.exit(0)
    name = os.path.basename(args[2])
    rest = args[3:]
    def dump(path, doc):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
    if name == "collect_pois.py":
        dump("collected_pois.json", {"proposals": [{"poi": {"name": "new"},
             "provenance": {"address": os.environ.get("FAKE_NEW_ADDRESS", "%s")}}]})
        dump("collect_state.json", {"cursor": "new"})
    elif name == "merge_pois_docs.py":
        out = rest[rest.index("-o") + 1]
        docs = [json.load(open(p, encoding="utf-8")) for p in rest[rest.index("-o") + 2:]]
        dump(out, {"proposals": [p for d in docs for p in d["proposals"]], "stats": {}})
    elif name == "collect_events.py":
        dump(os.environ["EVENTS_STORE"], json.loads(os.environ["FAKE_EVENTS"]))
    elif name == "collect_tourapi_festivals.py":
        sys.exit(int(os.environ.get("FAKE_FESTIVAL_EXIT", "0")))
""" % SEOUL_ADDRESS)

FAKE_GH = textwrap.dedent("""\
    #!/bin/sh
    echo "gh $*" >> "$FAKE_LOG"
    case "$*" in
      *"--jq length"*) echo 0 ;;
      *"--jq .[0].number // empty"*) echo 77 ;;
      *"pr view"*) echo "${FAKE_PR_STATE:-MERGED}" ;;
    esac
""")


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class Origin:
    """develop(공유본 600건) + collect-state(옛 커서·행사 저장소·남의 파일) 를 가진 bare 리포."""

    def __init__(self, root: Path, events: dict | None = None, state_branch: bool = True):
        self.bare = root / "origin.git"
        git(root, "init", "-q", "--bare", str(self.bare))
        seed = root / "seed"
        (seed / "ai/data").mkdir(parents=True)
        git(seed, "init", "-q", "-b", "develop")
        git(seed, "config", "user.email", "t@t"), git(seed, "config", "user.name", "t")
        rows = [{"poi": {"name": f"p{i}"}, "provenance": {"address": SEOUL_ADDRESS}} for i in range(600)]
        (seed / "ai/data/collected_pois.json").write_text(json.dumps({"proposals": rows}, ensure_ascii=False))
        git(seed, "add", "-A"), git(seed, "commit", "-qm", "seed")
        git(seed, "push", "-q", str(self.bare), "develop")
        if state_branch:
            git(seed, "checkout", "-q", "--orphan", "collect-state")
            git(seed, "rm", "-rqf", ".")
            (seed / "collect_state.json").write_text('{"cursor": "old"}')
            (seed / "rehearsal_log.jsonl").write_text("{}\n")   # ai-llm-smoke 의 파일 — 영속이 지우면 안 된다
            (seed / "collected_events.json").write_text(json.dumps(events or {"events": [], "coverage": {}}))
            git(seed, "add", "-A"), git(seed, "commit", "-qm", "state")
            git(seed, "push", "-q", str(self.bare), "collect-state")
        self.url = self.bare.as_uri()

    def show(self, ref_path: str) -> str:
        return git(self.bare, "show", ref_path)

    def has(self, ref: str) -> bool:
        return subprocess.run(["git", "rev-parse", "--verify", "-q", ref], cwd=self.bare, capture_output=True).returncode == 0


class Sandbox(unittest.TestCase):
    """임시 폴더·가짜 uv/gh·origin. 환경변수는 테스트마다 되돌린다."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        for name, body in (("uv", FAKE_UV), ("gh", FAKE_GH)):
            (bin_dir / name).write_text(body)
            (bin_dir / name).chmod(0o755)
        self.log = self.root / "calls.log"
        self.log.touch()
        env = mock.patch.dict(os.environ, {"PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "FAKE_LOG": str(self.log),
                                           "BATCH_OUTPUT": str(self.root / "out")})
        env.start()
        self.addCleanup(env.stop)
        for key in ("BATCH_LIVE", "GH_TOKEN", "TOUR_API_KEY", "NAVER_SEARCH_CLIENT_ID"):
            os.environ.pop(key, None)

    def origin(self, **kwargs) -> Origin:
        origin = Origin(self.root, **kwargs)
        os.environ["BATCH_REPO_URL"] = origin.url
        return origin

    def calls(self) -> str:
        return self.log.read_text(encoding="utf-8")


class RestorePersistTest(Sandbox):
    """Airflow 없이 — 복원·영속의 판정."""

    def clone(self) -> Path:
        dest = self.root / "run" / "repo"
        dest.parent.mkdir(parents=True)
        return live.checkout(dest)

    def test_복원은_collect_state_의_파일을_ai_아래에_놓는다(self):
        self.origin()
        repo = self.clone()
        self.assertTrue(live.restore(repo, "collect_state.json"))
        self.assertEqual(json.loads((repo / "ai/collect_state.json").read_text()), {"cursor": "old"})

    def test_브랜치가_없으면_처음부터(self):
        self.origin(state_branch=False)
        self.assertFalse(live.restore(self.clone(), "collect_state.json"))

    def test_있던_파일이_tip_에서_사라졌으면_유실로_멈춘다(self):
        origin = self.origin()
        work = self.root / "overwrite"
        git(self.root, "clone", "-q", "-b", "collect-state", origin.url, str(work))
        git(work, "-c", "user.email=t@t", "-c", "user.name=t", "rm", "-q", "collect_state.json")
        git(work, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "덮어씀")
        git(work, "push", "-q", "origin", "collect-state")
        with self.assertRaisesRegex(RuntimeError, "유실"):
            live.restore(self.clone(), "collect_state.json")

    def test_조회가_실패하면_처음부터_돌지_않는다(self):
        self.origin()
        repo = self.clone()
        git(repo, "remote", "set-url", "origin", (self.root / "없는곳.git").as_uri())
        with self.assertRaisesRegex(RuntimeError, "조회 실패"):
            live.restore(repo, "collect_state.json")

    def test_영속은_자기_파일만_바꾸고_남의_파일은_남긴다(self):
        origin = self.origin()
        repo = self.clone()
        (repo / "ai/collect_state.json").write_text('{"cursor": "new"}')
        live.persist(repo, "collect_state.json", "갱신")
        self.assertEqual(json.loads(origin.show("collect-state:collect_state.json")), {"cursor": "new"})
        self.assertEqual(origin.show("collect-state:rehearsal_log.jsonl"), "{}")
        self.assertEqual(origin.show("collect-state~1:collect_state.json"), '{"cursor": "old"}')   # 이력을 잇는다

    def test_토큰은_복제본_설정에_남지_않는다(self):
        self.origin()
        os.environ["GH_TOKEN"] = "ghs_비밀"
        repo = self.clone()
        self.assertNotIn("ghs_", (repo / ".git/config").read_text())
        self.assertIn("AUTHORIZATION: basic", live.git_env()["GIT_CONFIG_VALUE_0"])

    def test_축소_가드(self):
        self.assertIsNone(live.shrink_failure({"before": 10, "after": 8, "dropped": 2}))
        self.assertIn("축소 덮어쓰기 차단", live.shrink_failure({"before": 10, "after": 8, "dropped": 1}))


@unittest.skipIf(airflow is None, "Airflow 가 설치돼 있지 않다")
class LiveDagTest(Sandbox):
    def load(self, module):
        # 공용 모듈은 출력 폴더(BATCH_OUTPUT)를 불러올 때 정한다 — 테스트마다 새로 불러온다.
        for shared in ("pipeline", "checks", "live"):
            sys.modules.pop(shared, None)
        spec = importlib.util.spec_from_file_location(module, DAGS / f"{module}.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        sleep = mock.patch.object(mod.live.time, "sleep")   # 머지 확인 대기(5초 × 6)를 건너뛴다
        sleep.start()
        self.addCleanup(sleep.stop)
        return mod

    @staticmethod
    def states(run) -> dict:
        return {ti.task_id: ti.state for ti in run.get_task_instances()}

    def test_구조_검증이_게시_앞이고_커서는_게시_뒤다(self):
        from airflow.dag_processing.dagbag import DagBag
        bag = DagBag(dag_folder=str(DAGS))
        self.assertEqual(bag.import_errors, {})
        poi = bag.get_dag("poi_collect_live")
        self.assertEqual(poi.get_task("validate").upstream_task_ids, {"collect"})
        self.assertEqual(poi.get_task("publish").upstream_task_ids, {"validate"})
        self.assertEqual(poi.get_task("persist_cursor").upstream_task_ids, {"validate", "publish"})
        self.assertEqual(poi.get_task("persist_cursor").trigger_rule, "all_success")
        event = bag.get_dag("event_collect_live")
        self.assertEqual(event.get_task("publish").upstream_task_ids, {"validate"})
        for dag in (poi, event):   # 켜는 것은 사람이다 — 올라가자마자 Actions 와 함께 실 수집하면 안 된다
            self.assertTrue(dag.is_paused_upon_creation, dag.dag_id)

    def test_POI_그림자는_실_API_도_게시도_커서도_건드리지_않는다(self):
        origin = self.origin()
        run = self.load("poi_collect_live").poi_collect_live().test()
        self.assertEqual(self.states(run), {"collect": "success", "validate": "success",
                                            "publish": "skipped", "persist_cursor": "skipped"})
        self.assertNotIn("collect_pois.py", self.calls())
        self.assertNotIn("gh ", self.calls())
        self.assertEqual(origin.show("collect-state:collect_state.json"), '{"cursor": "old"}')
        self.assertEqual(list((self.root / "out/runs/poi_collect_live").iterdir()), [])   # 복제본을 남기지 않는다

    def live_poi(self, **env):
        os.environ.update({"BATCH_LIVE": "1", "TOUR_API_KEY": "가짜", **env})
        return self.load("poi_collect_live").poi_collect_live().test()

    def test_POI_실_수집은_병합_검증_게시_뒤에_커서를_저장한다(self):
        origin = self.origin()
        run = self.live_poi()
        self.assertEqual(set(self.states(run).values()), {"success"})
        calls = self.calls()
        order = [calls.index(s) for s in ("collect_pois.py", "merge_pois_docs.py", "gh pr merge 77", "gh workflow run")]
        self.assertEqual(order, sorted(order))
        self.assertIn("--state collect_state.json", calls)   # 시도 게이트를 켠 병합
        self.assertEqual(len(json.loads(origin.show("chore/poi-data-sync:ai/data/collected_pois.json"))["proposals"]), 601)
        self.assertEqual(json.loads(origin.show("collect-state:collect_state.json")), {"cursor": "new"})

    def test_POI_머지를_확인하지_못하면_커서를_저장하지_않는다_1475(self):
        origin = self.origin()
        run = self.live_poi(FAKE_PR_STATE="OPEN")
        states = self.states(run)
        self.assertEqual((states["publish"], states["persist_cursor"]), ("failed", "upstream_failed"))
        self.assertEqual(origin.show("collect-state:collect_state.json"), '{"cursor": "old"}')

    def test_POI_검증에_실패하면_게시도_커서도_없다_1427(self):
        origin = self.origin()
        run = self.live_poi(FAKE_NEW_ADDRESS="부산광역 사하구 하단동 1195")
        states = self.states(run)
        self.assertEqual((states["validate"], states["publish"], states["persist_cursor"]),
                         ("failed", "upstream_failed", "upstream_failed"))
        self.assertFalse(origin.has("chore/poi-data-sync"))
        self.assertEqual(origin.show("collect-state:collect_state.json"), '{"cursor": "old"}')

    def test_POI_실_모드에_키가_없으면_실패한다(self):
        self.origin()
        os.environ["BATCH_LIVE"] = "1"
        run = self.load("poi_collect_live").poi_collect_live().test()
        self.assertEqual(self.states(run)["collect"], "failed")
        self.assertNotIn("collect_pois.py", self.calls())

    DAY = date(2026, 11, 3)

    def events(self, valid: int) -> dict:
        stamp = "2026-11-03T04:40:00+09:00"
        return {"events": [{"start": "2026-11-01", "end": "2026-11-30"}] * valid,
                "coverage": {r: stamp for r in checks.event_regions()}}

    def run_events(self, collected: dict, **env):
        os.environ.update({"BATCH_LIVE": "1", "NAVER_SEARCH_CLIENT_ID": "가짜",
                           "FAKE_EVENTS": json.dumps(collected), **env})
        mod = self.load("event_collect_live")
        return mod.event_collect_live().test(logical_date=datetime.combine(self.DAY, time(4, 40), tzinfo=ZoneInfo("Asia/Seoul")))

    def test_행사_실_수집은_검증을_통과해야_저장소를_영속한다(self):
        origin = self.origin()
        run = self.run_events(self.events(40), FAKE_FESTIVAL_EXIT="1")   # 축제 실패는 게시를 막지 않는다
        self.assertEqual(set(self.states(run).values()), {"success"})
        self.assertEqual(len(json.loads(origin.show("collect-state:collected_events.json"))["events"]), 40)
        self.assertEqual(origin.show("collect-state:rehearsal_log.jsonl"), "{}")

    def test_행사_그날_유효_건수가_하한_아래면_영속하지_않는다(self):
        origin = self.origin()
        run = self.run_events(self.events(3))
        self.assertEqual(self.states(run)["publish"], "upstream_failed")
        self.assertEqual(json.loads(origin.show("collect-state:collected_events.json"))["events"], [])

    def test_행사_그림자는_Actions_가_영속한_저장소를_검증만_한다(self):
        origin = self.origin(events=self.events(40))
        mod = self.load("event_collect_live")
        run = mod.event_collect_live().test(logical_date=datetime.combine(self.DAY, time(4, 40), tzinfo=ZoneInfo("Asia/Seoul")))
        self.assertEqual(self.states(run), {"collect": "success", "validate": "success", "publish": "skipped"})
        self.assertNotIn("collect_events.py", self.calls())
        self.assertEqual(git(origin.bare, "rev-list", "--count", "collect-state"), "1")   # 영속하지 않았다


if __name__ == "__main__":
    unittest.main()
