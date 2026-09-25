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
