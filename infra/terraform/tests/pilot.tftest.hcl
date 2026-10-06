mock_provider "aws" {
  mock_data "aws_vpc" { defaults = { cidr_block = "10.20.0.0/16" } }
  mock_data "aws_subnet" { defaults = { availability_zone = "ap-southeast-2a" } }
  mock_data "aws_ssm_parameter" { defaults = { value = "ami-0123456789abcdef0" } }
}
variables {
  region             = "ap-southeast-2"
  account_id         = "111111111111"
  vpc_id             = "vpc-0123456789abcdef0"
  private_subnet_ids = ["subnet-0123456789abcdef0", "subnet-1123456789abcdef0"]
  pilot_client_cidrs = ["10.30.0.0/16"]
  certificate_arn    = "arn:aws:acm:ap-southeast-2:111111111111:certificate/11111111-1111-1111-1111-111111111111"
  hosted_zone_id     = "Z111111111"
  app_domain         = "app.example.invalid"
  sync_domain        = "sync.example.invalid"
  image              = "111111111111.dkr.ecr.ap-southeast-2.amazonaws.com/unischedule@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  app_secret_arn     = "arn:aws:secretsmanager:ap-southeast-2:111111111111:secret:app-AbCdEf"
  zero_secret_arn    = "arn:aws:secretsmanager:ap-southeast-2:111111111111:secret:zero-AbCdEf"
  secret_kms_key_arn = "arn:aws:kms:ap-southeast-2:111111111111:key/11111111-1111-1111-1111-111111111111"
}
run "bootstrap_is_private_and_disabled" {
  command = plan
  assert {
    condition     = aws_lb.pilot.internal && !aws_db_instance.database.publicly_accessible && aws_db_instance.database.storage_encrypted
    error_message = "Pilot infrastructure must remain private and encrypted."
  }
  assert {
    condition     = aws_ecs_service.app.desired_count == 0 && length(aws_instance.zero) == 0
    error_message = "Services must wait for database and secret bootstrap."
  }
  assert {
    condition     = aws_db_instance.database.deletion_protection && !aws_db_instance.database.skip_final_snapshot && aws_db_instance.database.backup_retention_period >= 14
    error_message = "Database recovery safeguards are required."
  }
}
run "enabled_services_keep_private_networking" {
  command = plan
  variables { services_enabled = true }
  assert {
    condition     = aws_ecs_service.app.desired_count == 2 && length(aws_instance.zero) == 1 && !aws_instance.zero[0].associate_public_ip_address
    error_message = "Enabled pilot requires two app tasks and one private sync host."
  }
}
