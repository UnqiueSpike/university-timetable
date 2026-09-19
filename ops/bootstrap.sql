-- Run as the university database administrator after creating the RDS databases.
-- Set LOGIN passwords separately through an approved secret-management workflow.
-- Do not paste passwords into this file or commit populated connection strings.
CREATE ROLE unischedule_app LOGIN;
CREATE ROLE unischedule_zero LOGIN;
CREATE ROLE unischedule_migrator LOGIN;
GRANT CONNECT ON DATABASE unischedule_pilot TO unischedule_app, unischedule_zero, unischedule_migrator;
GRANT CREATE ON DATABASE unischedule_pilot TO unischedule_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO unischedule_migrator;
-- Run migrations as the migration owner before the grants below.
GRANT USAGE ON SCHEMA public TO unischedule_app, unischedule_zero;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO unischedule_app;
GRANT INSERT, UPDATE, DELETE ON "user", session, account, verification, supplement, announcement, announcement_target, share TO unischedule_app;
GRANT INSERT ON audit_event TO unischedule_app;
GRANT INSERT, UPDATE ON sync_signal TO unischedule_app;
-- The replication user can SELECT only the published signal data in the application schema.
GRANT SELECT ON sync_signal TO unischedule_zero;
GRANT rds_replication TO unischedule_zero;
-- As the migration owner / RDS administrator:
CREATE PUBLICATION unischedule_sync FOR TABLE sync_signal;
-- Create separate unischedule_zero_cvr / unischedule_zero_change databases owned by unischedule_zero.
-- Zero also needs CREATE on the upstream database for its internal metadata schema.
GRANT CREATE ON DATABASE unischedule_pilot TO unischedule_zero;
