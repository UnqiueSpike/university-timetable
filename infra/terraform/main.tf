data "aws_vpc" "university" {
  id = var.vpc_id
}

data "aws_subnet" "zero" {
  id = var.private_subnet_ids[0]
}

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_security_group" "lb" {

  name_prefix = "unischedule-lb-"
  vpc_id      = var.vpc_id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = concat(var.pilot_client_cidrs, [data.aws_vpc.university.cidr_block])
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [data.aws_vpc.university.cidr_block]
  }


}

resource "aws_security_group" "app" {

  name_prefix = "unischedule-app-"
  vpc_id      = var.vpc_id
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.lb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }


}

resource "aws_security_group" "zero" {

  name_prefix = "unischedule-zero-"
  vpc_id      = var.vpc_id
  ingress {
    from_port       = 4848
    to_port         = 4848
    protocol        = "tcp"
    security_groups = [aws_security_group.lb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }


}

resource "aws_security_group" "database" {

  name_prefix = "unischedule-db-"
  vpc_id      = var.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id, aws_security_group.zero.id]
  }


}

resource "aws_db_subnet_group" "database" {
  name       = "unischedule-pilot"
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_parameter_group" "database" {

  name_prefix = "unischedule-pilot-"
  family      = "postgres18"
  parameter {
    name         = "rds.logical_replication"
    value        = "1"
    apply_method = "pending-reboot"
  }

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }


}

resource "aws_db_instance" "database" {

  identifier                      = "unischedule-pilot"
  engine                          = "postgres"
  engine_version                  = var.database_engine_version
  instance_class                  = var.database_instance_class
  allocated_storage               = 30
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  db_name                         = "unischedule_pilot"
  username                        = "unischedule_admin"
  manage_master_user_password     = true
  db_subnet_group_name            = aws_db_subnet_group.database.name
  parameter_group_name            = aws_db_parameter_group.database.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  publicly_accessible             = false
  multi_az                        = true
  backup_retention_period         = 14
  backup_window                   = "16:00-17:00"
  maintenance_window              = "sun:17:00-sun:18:00"
  auto_minor_version_upgrade      = true
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "unischedule-pilot-final"
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  lifecycle {
    prevent_destroy = true
  }


}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/unischedule/pilot/app"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "zero" {
  name              = "/unischedule/pilot/zero"
  retention_in_days = 30
}

resource "aws_iam_role" "execution" {

  name_prefix = "unischedule-execution-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }

      Action = "sts:AssumeRole"
      }
    ]
    }
  )

}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secret" {

  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [var.app_secret_arn]
      }
      , {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.secret_kms_key_arn]
      }
    ]
    }
  )

}

resource "aws_iam_role" "task" {

  name_prefix        = "unischedule-task-"
  assume_role_policy = aws_iam_role.execution.assume_role_policy

}

resource "aws_ecs_cluster" "app" {
  name = "unischedule-pilot"
}

resource "aws_ecs_task_definition" "app" {

  family                   = "unischedule-pilot"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name      = "app"
    image     = var.image
    essential = true
    portMappings = [{
      containerPort = 3000
      }
    ]
    environment = [{
      name  = "NODE_ENV"
      value = "production"
      }
      , {
        name  = "BETTER_AUTH_URL"
        value = "https://${var.app_domain}"
      }
    ]
    secrets = [{
      name      = "DATABASE_URL"
      valueFrom = "${var.app_secret_arn}:DATABASE_URL::"
      }
      , {
        name      = "BETTER_AUTH_SECRET"
        valueFrom = "${var.app_secret_arn}:BETTER_AUTH_SECRET::"
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "app"
      }

    }

    healthCheck = {
      command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }

    }
  ])

}

resource "aws_lb" "pilot" {

  name                       = "unischedule-pilot"
  internal                   = true
  load_balancer_type         = "application"
  subnets                    = var.private_subnet_ids
  security_groups            = [aws_security_group.lb.id]
  idle_timeout               = 120
  enable_deletion_protection = true
  drop_invalid_header_fields = true

}

resource "aws_lb_target_group" "app" {

  name        = "unischedule-app"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  health_check {
    path    = "/api/health"
    matcher = "200"
  }


}

resource "aws_lb_target_group" "zero" {

  name        = "unischedule-zero"
  port        = 4848
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = var.vpc_id
  health_check {
    path    = "/"
    matcher = "200"
  }


}

resource "aws_lb_listener" "https" {

  load_balancer_arn = aws_lb.pilot.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      status_code  = "404"
      message_body = "Not found"
    }

  }


}

resource "aws_lb_listener_rule" "app" {

  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    host_header {
      values = [var.app_domain]
    }

  }


}

resource "aws_lb_listener_rule" "zero" {

  listener_arn = aws_lb_listener.https.arn
  priority     = 20
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.zero.arn
  }

  condition {
    host_header {
      values = [var.sync_domain]
    }

  }


}

resource "aws_route53_record" "pilot" {

  for_each = toset([var.app_domain, var.sync_domain])
  zone_id  = var.hosted_zone_id
  name     = each.value
  type     = "A"
  alias {
    name                   = aws_lb.pilot.dns_name
    zone_id                = aws_lb.pilot.zone_id
    evaluate_target_health = true
  }


}

resource "aws_ecs_service" "app" {

  name            = "unischedule-pilot"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.services_enabled ? 2 : 0
  launch_type     = "FARGATE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener_rule.app]

}

resource "aws_iam_role" "zero" {

  name_prefix = "unischedule-zero-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }

      Action = "sts:AssumeRole"
      }
    ]
    }
  )

}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.zero.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "zero" {

  role = aws_iam_role.zero.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.zero_secret_arn]
      }
      ,
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.secret_kms_key_arn]
      }
      ,
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      }
      ,
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = "arn:aws:ecr:${var.region}:${var.account_id}:repository/${split("@", split(".amazonaws.com/", var.image)[1])[0]}"
      }
      ,
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.zero.arn}:*"
      }

    ]
    }
  )

}

resource "aws_iam_instance_profile" "zero" {
  name_prefix = "unischedule-zero-"
  role        = aws_iam_role.zero.name
}

resource "aws_ebs_volume" "replica" {

  availability_zone = data.aws_subnet.zero.availability_zone
  size              = 30
  type              = "gp3"
  encrypted         = true
  lifecycle {
    prevent_destroy = true
  }


}

resource "aws_instance" "zero" {

  count                       = var.services_enabled ? 1 : 0
  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.zero_instance_type
  subnet_id                   = var.private_subnet_ids[0]
  vpc_security_group_ids      = [aws_security_group.zero.id]
  iam_instance_profile        = aws_iam_instance_profile.zero.name
  associate_public_ip_address = false
  metadata_options {
    http_tokens = "required"
  }

  root_block_device {
    encrypted   = true
    volume_size = 20
  }

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/zero-user-data.sh.tftpl", {
    region = var.region, image = var.image, secret_arn = var.zero_secret_arn, volume_id = replace(aws_ebs_volume.replica.id, "-", ""), app_domain = var.app_domain, log_group = aws_cloudwatch_log_group.zero.name
    }
  )
  tags = {
    Name = "unischedule-zero-pilot"
  }


}

resource "aws_volume_attachment" "replica" {
  count       = var.services_enabled ? 1 : 0
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.replica.id
  instance_id = aws_instance.zero[0].id
}

resource "aws_lb_target_group_attachment" "zero" {
  count            = var.services_enabled ? 1 : 0
  target_group_arn = aws_lb_target_group.zero.arn
  target_id        = aws_instance.zero[0].id
  port             = 4848
}

resource "aws_cloudwatch_metric_alarm" "database_storage" {

  alarm_name          = "unischedule-database-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.database.id
  }

  alarm_description = "Attach university notification routing before pilot acceptance."

}
