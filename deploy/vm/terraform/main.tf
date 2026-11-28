# 개인 AWS 계정의 Lightsail VM 한 대 — deploy/vm 의 docker compose 가 올라갈 자리.
# 상태는 로컬(terraform.tfstate, git 제외)에 둔다: 리소스가 몇 개뿐이라 잃어도 import 로 되살린다.
terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.38"
    }
  }
}

variable "aws_profile" {
  type    = string
  default = "trippilot-vm"
}

# 4GB($24). 운영 실측(11-28)으로 embedding 없이 3.3~3.6GB — 스왑을 계속 타면 large_3_0(8GB, $44)로.
# 스냅숏에서 만든 인스턴스는 같거나 더 큰 번들만 되니, 올리는 건 쉽고 내리는 건 재구축이다.
variable "bundle_id" {
  type    = string
  default = "medium_3_0"
}

variable "public_key_path" {
  type    = string
  default = "~/.ssh/trippilot-prod.pem.pub"
}

variable "budget_email" {
  type = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 35
}

provider "aws" {
  region  = "ap-northeast-2"
  profile = var.aws_profile
  # 리허설 셸은 AWS_PROFILE 이 대여 계정이다(README) — 프로필이 어긋나도 거기에는 만들지 않는다.
  forbidden_account_ids = ["223767249602"]
}

resource "aws_lightsail_key_pair" "vm" {
  name       = "trippilot-vm"
  public_key = file(pathexpand(var.public_key_path))
}

resource "aws_lightsail_instance" "vm" {
  name              = "trippilot"
  availability_zone = "ap-northeast-2a"
  blueprint_id      = "ubuntu_24_04"
  bundle_id         = var.bundle_id
  key_pair_name     = aws_lightsail_key_pair.vm.name

  # backup.sh 덤프(18:30 UTC) 뒤에 디스크째 찍는다 — 덤프만으로는 디스크를 잃으면 같이 잃는다.
  add_on {
    type          = "AutoSnapshot"
    snapshot_time = "19:00"
    status        = "Enabled"
  }
}

resource "aws_lightsail_static_ip" "vm" {
  name = "trippilot"
}

resource "aws_lightsail_static_ip_attachment" "vm" {
  static_ip_name = aws_lightsail_static_ip.vm.name
  instance_name  = aws_lightsail_instance.vm.name
}

# 이 리소스가 방화벽 전체를 정한다(여기 없는 포트는 닫힌다). 80 은 Let's Encrypt HTTP 검증·https 리다이렉트, 443/udp 는 HTTP/3.
resource "aws_lightsail_instance_public_ports" "vm" {
  instance_name = aws_lightsail_instance.vm.name

  dynamic "port_info" {
    for_each = [["tcp", 22], ["tcp", 80], ["tcp", 443], ["udp", 443]]
    content {
      protocol   = port_info.value[0]
      from_port  = port_info.value[1]
      to_port    = port_info.value[1]
      cidrs      = ["0.0.0.0/0"]
      ipv6_cidrs = ["::/0"]
    }
  }
}

# 개인 카드라 감시가 이것뿐이다 — 실제 80%·예상 100% 에서 메일.
resource "aws_budgets_budget" "monthly" {
  name         = "trippilot-vm-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}

output "static_ip" {
  value = aws_lightsail_static_ip.vm.ip_address
}
