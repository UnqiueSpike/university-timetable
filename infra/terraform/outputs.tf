output "database_endpoint" { value = aws_db_instance.database.address }
output "database_admin_secret_arn" { value = aws_db_instance.database.master_user_secret[0].secret_arn }
output "app_url" { value = "https://${var.app_domain}" }
output "sync_url" { value = "https://${var.sync_domain}" }
output "cluster" { value = aws_ecs_cluster.app.name }
output "app_task_definition" { value = aws_ecs_task_definition.app.arn }
output "replica_volume" { value = aws_ebs_volume.replica.id }
