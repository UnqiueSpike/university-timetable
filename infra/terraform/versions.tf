terraform {

  required_version = "~> 1.14.0"
  required_providers {

    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }


  }

  backend "s3" {

  }


}

provider "aws" {

  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = {
      Project     = "UniSchedule"
      Environment = "pilot"
      ManagedBy   = "Terraform"
    }

  }


}
