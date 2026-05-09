-- Organizations table required by organization_members
CREATE TABLE IF NOT EXISTS public.organizations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  country_code text NOT NULL,
  currency_code text NOT NULL,
  d1_database_id text,
  created_at timestamptz DEFAULT now()
);