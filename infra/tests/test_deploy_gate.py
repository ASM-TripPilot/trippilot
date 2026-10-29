import importlib.util
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'scripts' / 'deploy_gate.py'
spec = importlib.util.spec_from_file_location('deploy_gate', MODULE)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)


def run(sha, hours_ago, **overrides):
    created = NOW - timedelta(hours=hours_ago)
    return {'conclusion': 'success', 'head_branch': 'develop', 'display_title': 'dev apply app=true kind=none',
            'head_sha': sha, 'created_at': created.strftime('%Y-%m-%dT%H:%M:%SZ'), **overrides}


class CandidateTests(unittest.TestCase):
    def test_newest_first(self):
        self.assertEqual(gate.candidates([run('old', 30), run('new', 2), run('mid', 10)], NOW), ['new', 'mid', 'old'])

    def test_only_successful_dev_app_deploys_count(self):
        runs = [run('failed', 1, conclusion='failure'), run('cancelled', 1, conclusion='cancelled'),
                run('main-run', 1, head_branch='main'),
                run('dev-without-app', 1, display_title='dev apply app=false kind=none'),
                run('dev-plan', 1, display_title='dev plan app=true kind=none'),
                run('prod-release', 1, display_title='prod apply app=true kind=release'),
                run('legacy-title', 1, display_title='AWS / Terraform and EKS deploy'),
                run('good', 1)]
        self.assertEqual(gate.candidates(runs, NOW), ['good'])

    def test_window_is_72_hours_inclusive(self):
        self.assertEqual(gate.candidates([run('edge', 72), run('late', 72.02)], NOW), ['edge'])

    def test_empty(self):
        self.assertEqual(gate.candidates([], NOW), [])


class ValidatedShaTests(unittest.TestCase):
    def test_picks_the_newest_run_whose_tree_matches(self):
        runs = [run('a', 1), run('b', 5), run('c', 9)]
        self.assertEqual(gate.validated_sha(runs, NOW, lambda sha: sha in {'b', 'c'}), 'b')

    def test_none_when_no_tree_matches(self):
        self.assertIsNone(gate.validated_sha([run('a', 1)], NOW, lambda sha: False))
        self.assertIsNone(gate.validated_sha([], NOW, lambda sha: True))

    def test_stale_runs_are_never_checked(self):
        seen = []
        gate.validated_sha([run('stale', 100)], NOW, lambda sha: seen.append(sha) or True)
        self.assertEqual(seen, [])


class RunGateTests(unittest.TestCase):
    def never(self, repo, since):
        raise AssertionError('the run list must not be read')

    def test_hotfix_and_undeclared_skip_the_dev_check(self):
        for kind in ('hotfix', 'none', ''):
            with self.subTest(kind=kind):
                code, message = gate.run_gate({'DEPLOY_KIND': kind}, self.never, lambda sha: True, NOW)
                self.assertEqual(code, 0)
                self.assertIn('skipped', message)

    def test_release_passes_with_a_validated_dev_run(self):
        env = {'DEPLOY_KIND': 'release', 'GITHUB_REPOSITORY': 'org/repo'}
        code, message = gate.run_gate(env, lambda repo, since: [run('abc', 3)] if repo == 'org/repo' else [], lambda sha: True, NOW)
        self.assertEqual((code, message), (0, 'dev-validated commit: abc'))

    def test_release_is_refused_without_one(self):
        env = {'DEPLOY_KIND': 'release', 'GITHUB_REPOSITORY': 'org/repo'}
        for runs, tree in (([], True), ([run('abc', 3)], False), ([run('abc', 99)], True)):
            with self.subTest(runs=len(runs), tree=tree):
                code, message = gate.run_gate(env, lambda repo, since: runs, lambda sha: tree, NOW)
                self.assertEqual(code, 1)
                self.assertIn('target=dev', message)
                self.assertIn('hotfix', message)


class GitAndGithubAdapterTests(unittest.TestCase):
    def completed(self, code=0, stdout=''):
        return subprocess.CompletedProcess([], code, stdout=stdout)

    def test_same_tree_compares_everything_but_the_workflows(self):
        calls = []

        def fake(args, **kwargs):
            calls.append(args)
            return self.completed(0)
        with patch.object(gate.subprocess, 'run', fake):
            self.assertTrue(gate.same_tree('abc123'))
        self.assertEqual(calls[0][:4], ['git', 'fetch', '--depth=1', '--quiet'])
        self.assertEqual(calls[0][-2:], ['origin', 'abc123'])
        self.assertEqual(calls[1], ['git', 'diff', '--quiet', 'abc123', 'HEAD', '--', '.', ':!.github'])

    def test_same_tree_is_false_on_a_diff_or_any_git_failure(self):
        with patch.object(gate.subprocess, 'run', lambda args, **kw: self.completed(1)):
            self.assertFalse(gate.same_tree('abc'))  # fetch 실패
        answers = iter([self.completed(0), self.completed(1)])
        with patch.object(gate.subprocess, 'run', lambda args, **kw: next(answers)):
            self.assertFalse(gate.same_tree('abc'))  # diff 있음
        answers = iter([self.completed(0), self.completed(128)])
        with patch.object(gate.subprocess, 'run', lambda args, **kw: next(answers)):
            self.assertFalse(gate.same_tree('abc'))  # diff 가 에러 — 검증 안 된 것으로 본다

    def test_fetch_runs_filters_by_time_on_the_server_instead_of_taking_the_latest_n(self):
        seen = {}

        def fake(args, **kwargs):
            seen['args'] = args
            return self.completed(0, json.dumps({'workflow_runs': [run('abc', 1)]}))
        with patch.object(gate.subprocess, 'run', fake):
            runs = gate.fetch_runs('org/repo', NOW - gate.WINDOW)
        self.assertEqual(runs[0]['head_sha'], 'abc')
        args = seen['args']
        self.assertIn('repos/org/repo/actions/workflows/aws-deploy.yml/runs', args)
        for expected in ('branch=develop', 'status=success', 'per_page=100', 'created=>=2026-10-27T12:00:00Z'):
            self.assertIn(expected, args)

    def test_run_gate_asks_only_for_runs_inside_the_window(self):
        asked = {}

        def source(repo, since):
            asked['since'] = since
            return []
        gate.run_gate({'DEPLOY_KIND': 'release', 'GITHUB_REPOSITORY': 'org/repo'}, source, lambda sha: True, NOW)
        self.assertEqual(asked['since'], NOW - gate.WINDOW)


class MainTests(unittest.TestCase):
    def invoke(self, env, runs=(), tree=True):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp, 'output')
            out.touch()
            values = {**env, 'GITHUB_OUTPUT': str(out)}
            with patch.dict(gate.os.environ, values, clear=True), \
                    patch.object(gate, 'fetch_runs', lambda repo, since: list(runs)), \
                    patch.object(gate, 'same_tree', lambda sha: tree), \
                    patch('sys.stdout', new_callable=io.StringIO) as stdout, patch('sys.stderr', new_callable=io.StringIO) as stderr:
                with self.assertRaises(SystemExit) as exit_info:
                    gate.main()
            return exit_info.exception.code, stdout.getvalue(), stderr.getvalue(), out.read_text(encoding='utf-8')

    def test_release_with_validated_run_exits_zero_and_records_the_sha(self):
        recent = run('abc', 0.5, created_at=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
        code, stdout, _, output = self.invoke({'DEPLOY_KIND': 'release', 'GITHUB_REPOSITORY': 'org/repo'}, [recent])
        self.assertEqual(code, 0)
        self.assertIn('dev-validated commit: abc', stdout)
        self.assertIn('dev_validated_sha=abc', output)

    def test_release_without_one_fails_with_an_error_annotation(self):
        code, _, stderr, output = self.invoke({'DEPLOY_KIND': 'release', 'GITHUB_REPOSITORY': 'org/repo'}, [])
        self.assertEqual(code, 1)
        self.assertTrue(stderr.startswith('::error::'))
        self.assertEqual(output, '')

    def test_hotfix_passes_without_reading_runs(self):
        code, stdout, _, output = self.invoke({'DEPLOY_KIND': 'hotfix'})
        self.assertEqual(code, 0)
        self.assertIn('skipped', stdout)
        self.assertIn('dev_validated_sha=\n', output)

    def test_github_or_git_errors_fail_closed(self):
        def boom(repo, since):
            raise subprocess.CalledProcessError(1, ['gh'])
        with tempfile.TemporaryDirectory() as tmp:
            env = {'DEPLOY_KIND': 'release', 'GITHUB_REPOSITORY': 'org/repo', 'GITHUB_OUTPUT': str(Path(tmp, 'o'))}
            with patch.dict(gate.os.environ, env, clear=True), patch.object(gate, 'fetch_runs', boom), \
                    patch('sys.stderr', new_callable=io.StringIO) as stderr:
                with self.assertRaises(SystemExit) as exit_info:
                    gate.main()
        self.assertEqual(exit_info.exception.code, 1)
        self.assertIn('could not verify', stderr.getvalue())

    def test_missing_repository_fails_closed(self):
        code, _, stderr, _ = self.invoke({'DEPLOY_KIND': 'release'}, [])
        self.assertEqual(code, 1)
        self.assertIn('could not verify', stderr)


if __name__ == '__main__':
    unittest.main()
