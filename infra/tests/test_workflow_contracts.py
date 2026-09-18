from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


def workflow(name):
    # YAML 1.1 resolves the GitHub key `on` as a boolean; BaseLoader preserves it.
    return yaml.load((ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)


class WorkflowContractTests(unittest.TestCase):
    def test_aws_deploy_is_only_manual(self):
        for filename in ('aws-deploy.yml', 'aws-bootstrap.yml'):
            with self.subTest(filename=filename):
                value = workflow(filename)
                self.assertEqual(set(value['on']), {'workflow_dispatch'})
                self.assertEqual(value['on']['workflow_dispatch']['inputs']['environment']['options'], ['dev', 'prd'])
                self.assertEqual(value['concurrency']['group'], 'aws-${{ inputs.environment }}')
                self.assertEqual(value['concurrency']['cancel-in-progress'], 'false')

    def test_plan_has_no_application_or_bootstrap_mutations(self):
        value = workflow('aws-deploy.yml')
        self.assertEqual(value['on']['workflow_dispatch']['inputs']['mode']['default'], 'plan')
        steps = value['jobs']['deploy']['steps']
        apply = next(step for step in steps if step.get('name') == 'Apply the saved run plan')
        self.assertEqual(apply['if'], "inputs.mode == 'apply'")
        for step in steps:
            if step.get('name', '').startswith(('Build and publish', 'Synchronize runtime', 'Initialize database', 'Deploy and wait')):
                self.assertIn("steps.config.outputs.deploy_application == 'true'", step['if'])
        text = (ROOT / '.github/workflows/aws-deploy.yml').read_text()
        self.assertNotIn('aws-bootstrap.yml', text)
        self.assertNotIn('terraform destroy', text)
        self.assertNotIn('upload-artifact', text)

    def test_environment_credentials_and_state_are_explicit(self):
        value = workflow('aws-deploy.yml')['jobs']['deploy']
        self.assertEqual(value['environment'], '${{ inputs.environment }}')
        self.assertEqual(value['permissions']['id-token'], 'write')
        init = next(s['run'] for s in value['steps'] if s.get('name') == 'Initialize existing environment state')
        self.assertIn('use_lockfile=true', init)
        self.assertIn('key=terraform.tfstate', init)
        self.assertIn('encrypt=true', init)


if __name__ == '__main__':
    unittest.main()
