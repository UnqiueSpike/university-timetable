variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {

  type = list(string)
  validation {

    condition     = length(var.private_subnet_ids) >= 2
    error_message = "Provide university private subnets in at least two availability zones."

  }


}

variable "pilot_client_cidrs" {

  type = list(string)
  validation {

    condition     = length(var.pilot_client_cidrs) > 0 && !contains(var.pilot_client_cidrs, "0.0.0.0/0")
    error_message = "Supply explicit campus/VPN client CIDRs; public access is not the pilot default."

  }


}

variable "certificate_arn" {
  type = string
}

variable "hosted_zone_id" {
  type = string
}

variable "app_domain" {
  type = string
}

variable "sync_domain" {
  type = string
}

variable "image" {

  type        = string
  description = "University ECR image pinned by sha256 digest; used for app and the patched Zero runtime."
  validation {

    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\..+\\.amazonaws\\.com/.+@sha256:[0-9a-f]{64}$", var.image))
    error_message = "Use an immutable university ECR image digest."

  }


}

variable "app_secret_arn" {
  type = string
}

variable "zero_secret_arn" {
  type = string
}

variable "secret_kms_key_arn" {
  type = string
}

variable "services_enabled" {

  type        = bool
  default     = false
  description = "Enable only after database bootstrap, migrations and service secrets are complete."

}

variable "database_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "database_engine_version" {
  type    = string
  default = "18"
}

variable "zero_instance_type" {
  type    = string
  default = "t3.medium"
}
