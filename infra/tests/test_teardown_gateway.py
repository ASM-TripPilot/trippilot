"""클러스터가 살아 있을 때 Ingress·NLB를 먼저 정리하는 삭제 회귀 검사."""

import json
import unittest
from unittest.mock import Mock, patch

from test_teardown_config import valid_settings
from test_teardown_config import load_balancer


def gateway_state():
    return {
        "aws_eks_access_entry.deployment": {},
        "aws_eks_access_policy_association.deployment": {},
        "aws_vpc.this": {"id": "vpc-aaaaaaaaaaaaaaaaa"},
        "aws_subnet.public[0]": {"id": "subnet-aaaaaaaaaaaaaaaaa"},
        "aws_subnet.public[1]": {"id": "subnet-bbbbbbbbbbbbbbbbb"},
        "aws_eks_cluster.this": {
            "arn": "arn:aws:eks:ap-northeast-2:123456789012:cluster/trippilot-dev",
            "endpoint": "https://fixture.eks.amazonaws.com",
        },
    }


def cluster():
    return {
        **gateway_state()["aws_eks_cluster.this"],
        "name": "trippilot-dev",
        "status": "ACTIVE",
        "resourcesVpcConfig": {"vpcId": "vpc-aaaaaaaaaaaaaaaaa"},
    }


def gateway_service():
    return {
        "metadata": {
            "name": "gateway",
            "namespace": "trippilot",
            "annotations": {
                "meta.helm.sh/release-name": "trippilot",
                "meta.helm.sh/release-namespace": "trippilot",
            },
        },
        "spec": {"type": "LoadBalancer", "loadBalancerClass": "eks.amazonaws.com/nlb"},
        "status": {
            "loadBalancer": {"ingress": [{"hostname": load_balancer()["DNSName"]}]}
        },
    }


class DestroyGatewayTest(unittest.TestCase):
    def test_reading_ingress_and_helm_does_not_mask_absence_or_malformed_identity(self):
        from teardown_gateway import get_service, helm_release, matching_nlbs

        self.assertIsNone(get_service(Mock(return_value="")))
        self.assertEqual(
            get_service(Mock(return_value=json.dumps(gateway_service()))), gateway_service()
        )
        for value in ({}, [{"name": "foreign", "namespace": "trippilot"}], [{}, {}]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                helm_release(Mock(return_value=json.dumps(value)))
        with self.assertRaises(TypeError):
            matching_nlbs(
                Mock(return_value='{"LoadBalancers": {}}'),
                valid_settings(),
                gateway_state(),
            )
        with self.assertRaises(ValueError):
            matching_nlbs(
                Mock(
                    return_value=json.dumps(
                        {"LoadBalancers": [load_balancer(), load_balancer()]}
                    )
                ),
                valid_settings(),
                gateway_state(),
            )

    def test_deleted_cluster_without_nlb_and_short_retry_are_allowed(self):
        from teardown_gateway import (
            remove_gateway,
            validate_service,
            wait_gateway_absent,
        )

        run = Mock()
        with (
            patch("teardown_gateway.live_cluster", return_value=None),
            patch("teardown_gateway.matching_nlbs", return_value=[]),
        ):
            remove_gateway(run, valid_settings(), gateway_state())
        run.assert_not_called()
        with (
            patch(
                "teardown_gateway.get_service", side_effect=[gateway_service(), None]
            ),
            patch("teardown_gateway.matching_nlbs", return_value=[]),
            patch("teardown_gateway.time.sleep") as sleep,
        ):
            wait_gateway_absent(run, valid_settings(), gateway_state())
        sleep.assert_called_once()
        with self.assertRaises(ValueError):
            validate_service(
                gateway_service(),
                valid_settings(),
                [{**load_balancer(), "DNSName": "other.elb.amazonaws.com"}],
            )

    def test_partial_destroy_without_access_skips_kubernetes_only_when_nlb_absent(self):
        from teardown_gateway import remove_gateway

        partial = {
            key: value
            for key, value in gateway_state().items()
            if not key.startswith("aws_eks_access")
        }
        run = Mock()
        with (
            patch("teardown_gateway.live_cluster", return_value=cluster()),
            patch("teardown_gateway.matching_nlbs", return_value=[]),
        ):
            remove_gateway(run, valid_settings(), partial)
        run.assert_not_called()
        with (
            patch("teardown_gateway.live_cluster", return_value=cluster()),
            patch(
                "teardown_gateway.matching_nlbs",
                return_value=[load_balancer()],
            ),
            self.assertRaises(RuntimeError),
        ):
            remove_gateway(run, valid_settings(), partial)

    def test_live_cluster_identity_and_network_are_exact(self):
        from teardown_gateway import live_cluster

        for changes in (
            {"arn": "wrong"},
            {"endpoint": "https://other"},
            {"resourcesVpcConfig": {"vpcId": "vpc-other"}},
            {"status": "CREATING"},
        ):
            run = Mock(
                side_effect=[
                    json.dumps({"clusters": ["trippilot-dev"]}),
                    json.dumps({"cluster": {**cluster(), **changes}}),
                ]
            )
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                live_cluster(run, valid_settings(), gateway_state())
        run = Mock(
            side_effect=[
                json.dumps({"clusters": ["trippilot-dev"]}),
                json.dumps({"cluster": cluster()}),
            ]
        )
        self.assertEqual(
            live_cluster(run, valid_settings(), gateway_state()), cluster()
        )

    def test_absent_cluster_is_explicit_and_errors_are_not_swallowed(self):
        from teardown_gateway import live_cluster

        self.assertIsNone(
            live_cluster(
                Mock(return_value='{"clusters": []}'), valid_settings(), gateway_state()
            )
        )
        with self.assertRaises(RuntimeError):
            live_cluster(
                Mock(side_effect=RuntimeError("denied")),
                valid_settings(),
                gateway_state(),
            )
        with self.assertRaises(ValueError):
            live_cluster(
                Mock(return_value='{"clusters": ["trippilot-dev"]}'),
                valid_settings(),
                {},
            )

    def test_nlb_identity_rejects_wrong_type_scheme_subnet_and_account(self):
        from teardown_gateway import matching_nlbs

        lb = load_balancer()
        for changes in (
            {"Type": "application"},
            {"Scheme": "internal"},
            {"AvailabilityZones": []},
            {
                "LoadBalancerArn": lb["LoadBalancerArn"].replace(
                    "123456789012", "999999999999"
                )
            },
        ):
            run = Mock(return_value=json.dumps({"LoadBalancers": [{**lb, **changes}]}))
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                matching_nlbs(run, valid_settings(), gateway_state())
        tags = {'TagDescriptions': [{'ResourceArn': lb['LoadBalancerArn'], 'Tags': [
            {'Key': 'eks:eks-cluster-name', 'Value': 'trippilot-dev'},
            {'Key': 'service.eks.amazonaws.com/stack', 'Value': 'trippilot/gateway'},
        ]}]}
        run = Mock(side_effect=[json.dumps({'LoadBalancers': [lb]}), json.dumps(tags)])
        self.assertEqual(matching_nlbs(run, valid_settings(), gateway_state()), [lb])

    def test_foreign_or_missing_nlb_ownership_tags_fail_closed(self):
        from teardown_gateway import verify_nlb_tags
        arn = load_balancer()['LoadBalancerArn']
        good = [{'Key': 'eks:eks-cluster-name', 'Value': 'trippilot-dev'},
                {'Key': 'service.eks.amazonaws.com/stack', 'Value': 'trippilot/gateway'}]
        for tags in ([], {}, [{'Key': 'eks:eks-cluster-name', 'Value': 'other'}], [None], good + good):
            response = {'TagDescriptions': [{'ResourceArn': arn, 'Tags': tags}]}
            with self.subTest(tags=tags), self.assertRaises(ValueError):
                verify_nlb_tags(Mock(return_value=json.dumps(response)), valid_settings(), arn)
        with self.assertRaises(ValueError):
            verify_nlb_tags(Mock(return_value='{}'), valid_settings(), arn)

    def test_ingress_and_nlb_disappear_before_helm_and_never_force_finalizers(self):
        from teardown_gateway import remove_gateway

        run = Mock()
        with (
            patch("teardown_gateway.live_cluster", return_value=cluster()),
            patch(
                "teardown_gateway.matching_nlbs",
                side_effect=[[load_balancer()], []],
            ),
            patch(
                "teardown_gateway.get_service", side_effect=[gateway_service(), None]
            ),
        ):
            run.return_value = json.dumps(
                [{"name": "trippilot", "namespace": "trippilot"}]
            )
            remove_gateway(run, valid_settings(), gateway_state())
        commands = [entry.args[0] for entry in run.call_args_list]
        delete = next(i for i, command in enumerate(commands) if "delete" in command)
        uninstall = next(
            i for i, command in enumerate(commands) if "uninstall" in command
        )
        self.assertLess(delete, uninstall)
        self.assertNotIn("patch", [part for command in commands for part in command])
        self.assertIn("--no-hooks", commands[uninstall])

    def test_missing_helm_and_ingress_are_restartable(self):
        from teardown_gateway import remove_gateway

        run = Mock(return_value="[]")
        with (
            patch("teardown_gateway.live_cluster", return_value=cluster()),
            patch("teardown_gateway.matching_nlbs", return_value=[]),
            patch("teardown_gateway.get_service", return_value=None),
        ):
            remove_gateway(run, valid_settings(), gateway_state())
        self.assertFalse(
            any(
                "delete" in call.args[0] or "uninstall" in call.args[0]
                for call in run.call_args_list
            )
        )

    def test_orphan_nlb_without_cluster_and_wrong_ingress_fail_before_mutation(self):
        from teardown_gateway import remove_gateway, validate_service

        with (
            patch("teardown_gateway.live_cluster", return_value=None),
            patch(
                "teardown_gateway.matching_nlbs",
                return_value=[load_balancer()],
            ),
            self.assertRaises(RuntimeError),
        ):
            remove_gateway(Mock(), valid_settings(), gateway_state())
        for item in (
            {**gateway_service(), "metadata": {"name": "foreign"}},
            {**gateway_service(), "spec": {"ingressClassName": "other"}},
        ):
            with self.assertRaises(ValueError):
                validate_service(item, valid_settings(), [load_balancer()])

    def test_wait_has_deadline_and_propagates_api_failures(self):
        from teardown_gateway import wait_gateway_absent

        with (
            patch("teardown_gateway.get_service", return_value=gateway_service()),
            patch("teardown_gateway.matching_nlbs", return_value=[]),
            patch("teardown_gateway.time.monotonic", side_effect=[0, 2]),
            self.assertRaises(TimeoutError),
        ):
            wait_gateway_absent(Mock(), valid_settings(), gateway_state(), timeout=1)
        with (
            patch(
                "teardown_gateway.get_service",
                side_effect=RuntimeError("denied"),
            ),
            self.assertRaises(RuntimeError),
        ):
            wait_gateway_absent(Mock(), valid_settings(), gateway_state())


if __name__ == "__main__":
    unittest.main()
