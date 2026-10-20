-- FROZEN. Run AFTER drizzle-kit migrations, as the database OWNER (MIGRATION_DATABASE_URL).
-- Idempotent: safe to re-run. `npm run db:security` applies it.
-- Contract: docs/domain.md §8 (evidence chain) and §9 (tenancy).

-- 1) App role (created by a human in Phase 0 with a real password; see docs/handoff.md).
--    CREATE ROLE accessloop_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO accessloop_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO accessloop_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO accessloop_app;
-- No DELETE anywhere for the app (7-year retention, ACR s.19). No UPDATE on the event log.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM accessloop_app;
REVOKE UPDATE ON case_events FROM accessloop_app;
GRANT DELETE ON rate_limits TO accessloop_app;

-- 2) Append-only event log, enforced even for the owner.
CREATE OR REPLACE FUNCTION case_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'case_events is append-only (attempted % on id %)', TG_OP, OLD.id;
END $$;
DROP TRIGGER IF EXISTS case_events_no_update ON case_events;
CREATE TRIGGER case_events_no_update BEFORE UPDATE OR DELETE ON case_events
  FOR EACH ROW EXECUTE FUNCTION case_events_immutable();

-- 2b) Sign-off lock (D7(a), approved for Phase 7; T5 block: other tracks edit other blocks of this file).
--     A signed-off report never changes, enforced even for the owner: the ONLY update allowed on a row whose stored
--     status is 'signed_off' is setting published_at once, from null, with every other column unchanged (publishing).
--     Drafts stay editable (the lead's text, and sign-off itself: draft -> signed_off writes content.signing in that
--     same UPDATE). Whoever can switch triggers off can still edit the row; the signed root then catches it
--     (docs/domain.md §8 "Signed at sign-off").
CREATE OR REPLACE FUNCTION reports_signed_off_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  probe reports;
BEGIN
  IF OLD.status IS DISTINCT FROM 'signed_off' THEN
    RETURN NEW;
  END IF;
  probe := NEW;
  probe.published_at := OLD.published_at;
  IF OLD.published_at IS NULL AND NEW.published_at IS NOT NULL AND probe IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'reports: report % is signed off and locked (only published_at may be set, once)', OLD.id;
END $$;
DROP TRIGGER IF EXISTS reports_signed_off_lock ON reports;
CREATE TRIGGER reports_signed_off_lock BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION reports_signed_off_immutable();

-- 3) Row-level security on every tenant table. Fails closed when app.org_id is unset.
CREATE OR REPLACE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'none')
$$;

DO $$
DECLARE t text;
BEGIN
  -- org_locations: Phase 7 D8 (docs/decisions.md 2026-10-20).
  FOREACH t IN ARRAY ARRAY['org_members','cases','case_events','attachments','reports','outbound_messages',
                           'org_locations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = app_org()) WITH CHECK (org_id = app_org())', t);
  END LOOP;
END $$;

-- case_private: anyone in the org context may INSERT (intake), only the lead may read/update.
ALTER TABLE case_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_private FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS private_insert ON case_private;
DROP POLICY IF EXISTS private_lead_read ON case_private;
DROP POLICY IF EXISTS private_lead_update ON case_private;
CREATE POLICY private_insert ON case_private FOR INSERT WITH CHECK (org_id = app_org());
CREATE POLICY private_lead_read ON case_private FOR SELECT USING (org_id = app_org() AND app_role() = 'lead');
CREATE POLICY private_lead_update ON case_private FOR UPDATE
  USING (org_id = app_org() AND app_role() = 'lead') WITH CHECK (org_id = app_org());

-- 4) Public receipt-code lookup without knowing the org first. Returns at most one row.
CREATE OR REPLACE FUNCTION resolve_receipt(code_hash text)
RETURNS TABLE (org_id uuid, case_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.org_id, c.id FROM cases c WHERE c.receipt_code_hash = code_hash LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_receipt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_receipt(text) TO accessloop_app;

-- 4b) Public /verify/[reportId]: find the org of a PUBLISHED report only (drafts stay staff-only via Clerk).
CREATE OR REPLACE FUNCTION resolve_published_report(report_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.org_id FROM reports r
  WHERE r.id = report_id AND r.status = 'signed_off' AND r.published_at IS NOT NULL
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_published_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_published_report(uuid) TO accessloop_app;

-- 5) Default privileges for tables created later by drizzle-kit.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO accessloop_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO accessloop_app;

-- ===== BEGIN Phase 7 T3: decisions D7(b) and D7(c) (docs/decisions.md 2026-10-20) =====
-- 6) orgs and rate_limits get row-level security too, ENABLED and FORCED like every other table, so a role with no
--    policy here (Supabase's anon and authenticated behind its Data API, or any role added later) reads and writes
--    nothing in them even if it holds a grant. The app keeps today's behaviour: orgs is not tenant-scoped
--    (docs/domain.md §9), so the app reads it by slug, Clerk id or id OUTSIDE withOrg (public pages, sign-in,
--    getStaff), updates its own org's settings, and the seed inserts orgs through DATABASE_URL; it counts and prunes
--    rate_limits outside withOrg. So these policies are for accessloop_app with no org condition, plus one for the
--    role running this file (the owner, CURRENT_USER), so owner scripts (e2e fixtures, the seed) keep working where
--    the owner lacks BYPASSRLS. Nobody gets DELETE on orgs (section 1 grants none to the app).
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orgs_app_read ON orgs;
DROP POLICY IF EXISTS orgs_app_insert ON orgs;
DROP POLICY IF EXISTS orgs_app_update ON orgs;
DROP POLICY IF EXISTS orgs_owner ON orgs;
CREATE POLICY orgs_app_read ON orgs FOR SELECT TO accessloop_app USING (true);
CREATE POLICY orgs_app_insert ON orgs FOR INSERT TO accessloop_app WITH CHECK (true);
CREATE POLICY orgs_app_update ON orgs FOR UPDATE TO accessloop_app USING (true) WITH CHECK (true);
CREATE POLICY orgs_owner ON orgs TO CURRENT_USER USING (true) WITH CHECK (true);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_limits_app ON rate_limits;
DROP POLICY IF EXISTS rate_limits_owner ON rate_limits;
CREATE POLICY rate_limits_app ON rate_limits TO accessloop_app USING (true) WITH CHECK (true);
CREATE POLICY rate_limits_owner ON rate_limits TO CURRENT_USER USING (true) WITH CHECK (true);

-- 7) Supabase's API roles get nothing. Supabase creates the roles anon and authenticated, grants them every table,
--    sequence and function in public, and sets default privileges so that objects created later are granted too;
--    its Data API (PostgREST) serves whatever they can reach. The Data API should be off for AccessLoop
--    (docs/phase7-prompt.md Wave 2); this makes sure anyway: where those roles exist, every privilege they hold on
--    public objects is revoked, now and (default privileges) for objects the owner creates later. Elsewhere (the
--    local embedded Postgres, PGlite) the roles don't exist and this block does nothing.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- ===== END Phase 7 T3 =====
