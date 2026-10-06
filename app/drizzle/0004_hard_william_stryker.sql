CREATE TABLE "sync_signal" (
	"user_id" text PRIMARY KEY NOT NULL,
	"revision" text DEFAULT gen_random_uuid()::text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_signal" ADD CONSTRAINT "sync_signal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO sync_signal(user_id) SELECT id FROM "user" ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION signal_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v jsonb; u text; cid uuid; gid uuid; aid uuid; src text; users_to_notify text[] := ARRAY[]::text[]; course_ids uuid[] := ARRAY[]::uuid[]; group_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR v IN SELECT x FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END]) x WHERE x IS NOT NULL LOOP
    FOREACH u IN ARRAY ARRAY[v->>'user_id',v->>'owner_id',v->>'recipient_id',v->>'author_id',v->>'updated_by'] LOOP
      IF u IS NOT NULL THEN users_to_notify := array_append(users_to_notify,u); END IF;
    END LOOP;
    IF TG_TABLE_NAME='user' THEN users_to_notify:=array_append(users_to_notify,v->>'id'); END IF;
    cid:=null;gid:=null;aid:=null;src:=null;
    IF v->>'course_id' IS NOT NULL THEN cid:=(v->>'course_id')::uuid;
    ELSIF TG_TABLE_NAME='course' THEN cid:=(v->>'id')::uuid;
    ELSIF v->>'class_id' IS NOT NULL THEN SELECT course_id INTO cid FROM class WHERE id=(v->>'class_id')::uuid;
    ELSIF v->>'entry_id' IS NOT NULL THEN SELECT c.course_id INTO cid FROM timetable_entry e JOIN class c ON c.id=e.class_id WHERE e.id=(v->>'entry_id')::uuid;
    END IF;
    IF cid IS NOT NULL THEN course_ids:=array_append(course_ids,cid); END IF;
    IF v->>'group_id' IS NOT NULL THEN gid:=(v->>'group_id')::uuid;
    ELSIF TG_TABLE_NAME='user_group' THEN gid:=(v->>'id')::uuid; END IF;
    IF gid IS NOT NULL THEN group_ids:=array_append(group_ids,gid); END IF;
    IF TG_TABLE_NAME='announcement' THEN aid:=(v->>'id')::uuid; END IF;
    IF aid IS NOT NULL THEN
      course_ids:=course_ids||ARRAY(SELECT coalesce(t.course_id,c.course_id) FROM announcement_target t LEFT JOIN class c ON c.id=t.class_id WHERE t.announcement_id=aid AND coalesce(t.course_id,c.course_id) IS NOT NULL);
      group_ids:=group_ids||ARRAY(SELECT group_id FROM announcement_target WHERE announcement_id=aid AND group_id IS NOT NULL);
    END IF;
    IF TG_TABLE_NAME='data_source' THEN src:=v->>'id'; ELSIF TG_TABLE_NAME='sync_scope' THEN src:=v->>'source_id'; END IF;
    IF src IS NOT NULL THEN course_ids:=course_ids||ARRAY(SELECT id FROM course WHERE source_id=src); END IF;
  END LOOP;
  users_to_notify:=users_to_notify||ARRAY(SELECT sc.user_id FROM student_class sc JOIN class c ON c.id=sc.class_id WHERE c.course_id=ANY(course_ids))||ARRAY(SELECT user_id FROM user_role WHERE course_id=ANY(course_ids))||ARRAY(SELECT user_id FROM group_member WHERE group_id=ANY(group_ids))||ARRAY(SELECT user_id FROM staff_permission WHERE group_id=ANY(group_ids));
  users_to_notify:=users_to_notify||ARRAY(SELECT recipient_id FROM share WHERE owner_id=ANY(users_to_notify) AND revoked_at IS NULL AND expires_at>clock_timestamp());
  INSERT INTO sync_signal(user_id,revision) SELECT DISTINCT id,gen_random_uuid()::text FROM "user" WHERE id=ANY(users_to_notify) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision;
  RETURN NULL;
END; $$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['user','session','user_role','staff_permission','course','class','student_class','timetable_entry','capacity_snapshot','data_source','sync_scope','supplement','announcement','announcement_target','user_group','group_member','share_recipient','share'] LOOP
EXECUTE format('CREATE TRIGGER notify_sync AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION signal_change()',t);
END LOOP; END; $$;
