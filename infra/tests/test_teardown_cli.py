"""Exercise the public entrypoint, secret isolation, and post-auth dispatch."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from test_teardown_config import environment, valid_settings
from teardown import initialize_terraform, main, run_main
from teardown_config import Runner, verify_source


class EntrypointTests(unittest.TestCase):
    def test_validation_makes_no_aws_call(self):
        run = Mock(side_effect=['a' * 40, ''])
        with patch.dict(os.environ, environment(), clear=True):
            run_main(['--validate-only'], run=run)
        self.assertEqual([call.args[0][0] for call in run.call_args_list], ['git', 'git'])

    def test_source_mismatch_and_dirty_checkout_fail_before_authentication(self):
        for responses in (['b' * 40], ['a' * 40, '?? injected_override.tf']):
            with self.subTest(responses=responses), self.assertRaises(ValueError):
                verify_source(Mock(side_effect=responses), Path.cwd(), valid_settings())

    def test_explicit_arguments_override_environment_but_keep_validation(self):
        with patch.dict(os.environ, environment(), clear=True), self.assertRaises(ValueError):
            run_main(['--operation', 'destroy'], run=Mock())

    def test_bootstrap_dispatch_has_private_temp_and_separate_role_check(self):
        settings = valid_settings()
        caller = {'Account': settings.account, 'Arn': f'arn:aws:sts::{settings.account}:assumed-role/external-bootstrap/session'}
        run = Mock(side_effect=[settings.sha, '', json.dumps(caller), ''])
        def delete(scoped_run, actual, temp, **options):
            self.assertEqual(actual, settings)
            self.assertEqual(temp.stat().st_mode & 0o777, 0o700)
            self.assertEqual(options, {'execute': False, 'purge_state': True})
            scoped_run(['aws', 's3api', 'list-buckets'], quiet=True)
            return str(temp)
        with patch.dict(os.environ, environment(TEARDOWN_SCOPE='bootstrap', PURGE_STATE='true'), clear=True), patch('teardown_bootstrap.delete_bootstrap', side_effect=delete) as cleanup:
            run_main([], run=run)
        path = cleanup.call_args.args[2]
        self.assertFalse(path.exists())
        self.assertEqual(run.call_args.kwargs['env']['KUBECONFIG'], str(path / 'kubeconfig'))

    def test_service_dispatch_initializes_existing_state_without_aws_bootstrap(self):
        settings = valid_settings()
        caller = {'Account': settings.account, 'Arn': f'arn:aws:sts::{settings.account}:assumed-role/trippilot-dev-github-deploy/session'}
        run = Mock(side_effect=[settings.sha, '', json.dumps(caller)])
        with patch.dict(os.environ, environment(), clear=True), patch('teardown.initialize_terraform', return_value=(Path('/private/terraform'), {'environment': 'dev'})) as init, patch('teardown.destroy_service') as destroy:
            run_main([], run=run)
        self.assertEqual(init.call_args.args[2], settings)
        self.assertFalse(destroy.call_args.kwargs['execute'])
        self.assertEqual(destroy.call_args.kwargs['snapshot_policy'], 'retain')

    def test_private_terraform_copy_has_backend_and_checked_in_environment(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            run = Mock(return_value='')
            copied, config = initialize_terraform(run, root, valid_settings(), temp)
            command = run.call_args.args[0]
            for option in ('-backend-config=use_lockfile=true', '-backend-config=key=terraform.tfstate', '-lockfile=readonly'):
                self.assertIn(option, command)
            self.assertEqual((copied / 'environment.auto.tfvars').read_text(), (root / 'infra/terraform/environments/dev.tfvars').read_text())
            self.assertFalse((copied / '.terraform').exists())
            self.assertEqual(config['deployment_role_arn'], valid_settings().role)

    def test_main_reports_validation_error_without_traceback(self):
        stderr = io.StringIO()
        with patch('teardown.run_main', side_effect=ValueError('invalid input')), contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as error:
            main()
        self.assertEqual(error.exception.code, 1)
        self.assertEqual(stderr.getvalue(), '::error::invalid input\n')

    def test_runner_success_respects_quiet_and_disables_configured_endpoints(self):
        process = Mock(returncode=0, stdout='safe output', stderr='')
        output = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), patch('teardown_config.subprocess.run', return_value=process) as execute, contextlib.redirect_stdout(output):
            run = Runner(Path.cwd())
            self.assertEqual(run(['aws', 'sts'], quiet=True), 'safe output')
            self.assertEqual(output.getvalue(), '')
            run(['git', 'status'])
        self.assertEqual(output.getvalue(), 'safe output')
        self.assertEqual(execute.call_args.kwargs['env']['AWS_IGNORE_CONFIGURED_ENDPOINT_URLS'], 'true')
        with patch.dict(os.environ, {'TF_CLI_ARGS_plan': '-target=foreign'}, clear=True), self.assertRaises(ValueError):
            Runner(Path.cwd())(['terraform', 'plan'])


if __name__ == '__main__':
    unittest.main()
