# The bootstrap CloudFormation stack owns service trust and fixed managed
# policies. The deployment role can read/pass these roles but cannot edit them.
data "aws_iam_role" "cluster" {
  name = "${local.name}-cluster"
}

data "aws_iam_role" "node" {
  name = "${local.name}-node"
}

# AI pods reach Bedrock through EKS Pod Identity. Auto Mode pins the IMDS hop
# limit to 1, so the node role above is unreachable from pods by design.
data "aws_iam_role" "ai_pod" {
  name = "${local.name}-ai-pod"
}

resource "aws_cloudwatch_log_group" "eks" {
  name              = "/aws/eks/${local.name}/cluster"
  retention_in_days = local.production ? 90 : 14
}

resource "aws_eks_cluster" "this" {
  name                          = local.name
  role_arn                      = data.aws_iam_role.cluster.arn
  version                       = var.cluster_version
  deletion_protection           = local.production
  bootstrap_self_managed_addons = false
  enabled_cluster_log_types     = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = false
  }

  # The built-in NodeClass uses cluster subnets: only private compute subnets.
  compute_config {
    enabled       = true
    node_pools    = ["general-purpose", "system"]
    node_role_arn = data.aws_iam_role.node.arn
  }

  kubernetes_network_config {
    ip_family = "ipv4"
    elastic_load_balancing {
      enabled = true
    }
  }

  storage_config {
    block_storage {
      enabled = true
    }
  }

  vpc_config {
    subnet_ids              = aws_subnet.private[*].id
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = var.eks_public_access_cidrs
  }

  # Pin upgrades deliberately while standard support is available.
  upgrade_policy {
    support_type = "STANDARD"
  }

  depends_on = [
    aws_cloudwatch_log_group.eks,
    aws_route.nat,
  ]
}

resource "aws_eks_access_entry" "deployment" {
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = var.deployment_role_arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "deployment" {
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = aws_eks_access_entry.deployment.principal_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}

resource "aws_eks_pod_identity_association" "ai" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = "trippilot"
  service_account = "ai"
  role_arn        = data.aws_iam_role.ai_pod.arn
}

# Container stdout is otherwise reachable only through kubectl. The add-on's
# Fluent Bit tails the node log files, so the application needs no change and
# keeps OTEL_SDK_DISABLED=true - this stack provisions no OTLP collector.
#
# Cost: CloudWatch Logs charges for ingested volume (around USD 0.5-0.8 per GB)
# plus storage over the retention window below, and the add-on's agent publishes
# Container Insights observations (around USD 0.21 per million). Application
# Signals auto-monitoring is turned off in the add-on config: it would inject
# instrumentation into every workload and bill per request.
data "aws_iam_role" "cloudwatch_pod" {
  count = var.container_logs_enabled ? 1 : 0

  name = "${local.name}-cloudwatch-pod"
}

# The collectors create these groups themselves, without any expiry. Creating
# them here first is what keeps retention - and the storage bill - bounded.
resource "aws_cloudwatch_log_group" "container_insights" {
  for_each = var.container_logs_enabled ? toset(["application", "dataplane", "host", "performance"]) : toset([])

  name              = "/aws/containerinsights/${local.name}/${each.value}"
  retention_in_days = var.container_logs_retention_days
}

resource "aws_eks_addon" "cloudwatch_observability" {
  count = var.container_logs_enabled ? 1 : 0

  cluster_name = aws_eks_cluster.this.name
  addon_name   = "amazon-cloudwatch-observability"

  configuration_values = jsonencode({
    containerLogs = { enabled = true }
    manager       = { applicationSignals = { autoMonitor = { monitorAllServices = false } } }
  })

  # Auto Mode pins the IMDS hop limit to 1, so the collector pods take their
  # CloudWatch permissions from Pod Identity, like the AI pods above. The
  # add-on binds the association to its own amazon-cloudwatch namespace.
  pod_identity_association {
    role_arn        = data.aws_iam_role.cloudwatch_pod[0].arn
    service_account = "cloudwatch-agent"
  }

  depends_on = [aws_cloudwatch_log_group.container_insights]
}
