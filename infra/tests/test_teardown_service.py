"""서비스 삭제의 실행 순서, 조회 전용 계획, 부분 삭제와 스냅샷 검사."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from test_teardown_config import valid_settings
from test_teardown_plan import change, plan, resource


def database_values():
    return {
        "tags_all": {
            "Project": "trippilot",
            "Environment": "dev",
            "ManagedBy": "terraform",
        },
        "identifier": "trippilot-dev",
        "arn": "arn:aws:rds:ap-northeast-2:123456789012:db:trippilot-dev",
        "deletion_protection": False,
        "skip_final_snapshot": False,
        "final_snapshot_identifier": "trippilot-dev-final-123-1",
        "delete_automated_backups": True,
    }


def database_plan():
    values = database_values()
    return plan(
        [change("aws_db_instance.postgres", values, None, ["delete"])],
        [resource("aws_db_instance.postgres", values)],
    )


def preparation_plan():
    values = database_values()
    return {
        **plan([change("aws_db_instance.postgres", values, values, ["no-op"])]),
        "complete": False,
    }


class DestroyServiceTest(unittest.TestCase):
    def test_new_resource_or_reappearing_nlb_blocks_final_destroy(self):
        from teardown import finish_destroy

        new_values = {
            "id": "vpc-aaaaaaaaaaaaaaaaa",
            "tags_all": database_values()["tags_all"],
        }
        unexpected = plan(
            [change("aws_vpc.this", new_values, None, ["delete"])],
            [resource("aws_vpc.this", new_values)],
        )
        run = Mock()
        with tempfile.TemporaryDirectory() as temporary:
            temp = Path(temporary)
            with (
                patch("teardown.saved_plan", return_value=unexpected),
                self.assertRaises(ValueError),
            ):
                finish_destroy(run, valid_settings(), temp, temp / "vars", temp, {}, {})
            with (
                patch("teardown.saved_plan", return_value=plan()),
                patch("teardown.matching_nlbs", return_value=[{}]),
                self.assertRaises(RuntimeError),
            ):
                finish_destroy(run, valid_settings(), temp, temp / "vars", temp, {}, {})
        run.assert_not_called()

    def run_service(self, run, *, execute=False, plans=None, snapshot_policy="retain"):
        from teardown import destroy_service

        with tempfile.TemporaryDirectory() as temporary:
            temp = Path(temporary)
            with (
                patch(
                    "teardown.saved_plan",
                    side_effect=plans
                    or [database_plan(), preparation_plan(), database_plan()],
                ) as saved,
                patch("teardown.remove_gateway") as gateway,
            ):
                destroy_service(
                    run,
                    valid_settings(),
                    temp,
                    {"environment": "dev"},
                    temp,
                    execute=execute,
                    snapshot_policy=snapshot_policy,
                )
                return saved, gateway

    def test_plan_never_applies_or_mutates_kubernetes_or_aws(self):
        run = Mock(return_value='{"DBSnapshots": []}')
        saved, gateway = self.run_service(run)
        gateway.assert_not_called()
        self.assertEqual(saved.call_count, 2)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertFalse(
            any(
                "apply" in command or command[0] in {"helm", "kubectl"}
                for command in commands
            )
        )
        self.assertTrue(saved.call_args_list[0].kwargs["destroy"])
        self.assertEqual(
            saved.call_args_list[1].kwargs["targets"], ["aws_db_instance.postgres"]
        )

    def test_execute_applies_only_after_cleanup_and_regenerates_destroy_plan(self):
        from teardown import destroy_service

        events = []

        def run(command, **_kwargs):
            events.append(command[0:2])
            return '{"DBSnapshots": []}' if command[0] == "aws" else ""

        def saved(*_args, **kwargs):
            events.append(["plan", "destroy" if kwargs.get("destroy") else "prepare"])
            return database_plan() if kwargs.get("destroy") else preparation_plan()

        with tempfile.TemporaryDirectory() as temporary:
            temp = Path(temporary)
            with (
                patch("teardown.saved_plan", side_effect=saved),
                patch(
                    "teardown.remove_gateway",
                    side_effect=lambda *_: events.append(["gateway", "removed"]),
                ),
            ):
                destroy_service(run, valid_settings(), temp, {}, temp, execute=True)
        selected = [
            event
            for event in events
            if event[0] in {"plan", "gateway"} or event == ["terraform", "apply"]
        ]
        self.assertEqual(
            selected,
            [
                ["plan", "destroy"],
                ["plan", "prepare"],
                ["gateway", "removed"],
                ["terraform", "apply"],
                ["plan", "destroy"],
                ["terraform", "apply"],
            ],
        )

    def test_invalid_preparation_fails_before_gateway_and_cloud_mutations(self):
        invalid = plan([change("aws_vpc.this", {"id": "a"}, {"id": "b"})])
        with self.assertRaises(ValueError):
            self.run_service(
                Mock(return_value='{"DBSnapshots": []}'),
                execute=True,
                plans=[database_plan(), invalid],
            )

    def test_existing_snapshot_or_wrong_database_identity_fails_before_cleanup(self):
        run = Mock(
            return_value=json.dumps(
                {"DBSnapshots": [{"DBSnapshotIdentifier": "trippilot-dev-final-123-1"}]}
            )
        )
        with self.assertRaisesRegex(ValueError, "스냅샷"):
            self.run_service(run, execute=True)
        invalid = database_plan()
        invalid["prior_state"]["values"]["root_module"]["resources"][0]["values"][
            "identifier"
        ] = "another-environment"
        with self.assertRaises(ValueError):
            self.run_service(Mock(), execute=True, plans=[invalid])

    def test_empty_state_and_skip_need_no_snapshot_reads(self):
        run = Mock(return_value="")
        saved, gateway = self.run_service(run, execute=True, plans=[plan()])
        gateway.assert_not_called()
        self.assertEqual(saved.call_count, 1)
        self.assertFalse(any(call.args[0][0] == "aws" for call in run.call_args_list))
        run = Mock(return_value="")
        skiped = {
            **database_values(),
            "skip_final_snapshot": True,
            "final_snapshot_identifier": None,
        }
        skiped_preparation = plan(
            [change("aws_db_instance.postgres", database_values(), skiped)]
        )
        self.run_service(
            run,
            snapshot_policy="skip",
            plans=[database_plan(), skiped_preparation],
        )
        self.assertFalse(any(call.args[0][0] == "aws" for call in run.call_args_list))

    def test_failed_cleanup_never_applies_and_nonempty_final_state_fails(self):
        from teardown import destroy_service

        with tempfile.TemporaryDirectory() as temporary:
            temp = Path(temporary)
            run = Mock(return_value='{"DBSnapshots": []}')
            with (
                patch(
                    "teardown.saved_plan",
                    side_effect=[database_plan(), preparation_plan()],
                ),
                patch(
                    "teardown.remove_gateway", side_effect=TimeoutError("NLB")
                ),
                self.assertRaises(TimeoutError),
            ):
                destroy_service(run, valid_settings(), temp, {}, temp, execute=True)
            self.assertFalse(
                any("apply" in call.args[0] for call in run.call_args_list)
            )
        run = Mock(
            side_effect=lambda command, **_: (
                '{"DBSnapshots": []}'
                if command[0] == "aws"
                else "aws_vpc.this"
                if command[1:3] == ["state", "list"]
                else ""
            )
        )
        with self.assertRaisesRegex(RuntimeError, "state"):
            self.run_service(run, execute=True)

    def test_final_destroy_uses_prepared_snapshot_policy(self):
        invalid = database_plan()
        invalid["resource_changes"][0]["change"]["before"]["skip_final_snapshot"] = True
        with self.assertRaisesRegex(ValueError, "정책"):
            self.run_service(
                Mock(return_value='{"DBSnapshots": []}'),
                execute=True,
                plans=[database_plan(), preparation_plan(), invalid],
            )


if __name__ == "__main__":
    unittest.main()
