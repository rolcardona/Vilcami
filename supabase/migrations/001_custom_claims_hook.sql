-- Custom Access Token Hook for VILCAMI
-- Injects org_id and role from organization_members into JWT claims
--
-- This hook runs at every JWT issuance, dynamically injecting claims
-- based on the user's membership in organization_members.
--
-- Enable via: Dashboard → Authentication → Hooks → Custom Access Token Hook

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
  DECLARE
    claims jsonb;
    member record;
  BEGIN
    -- Look up the user's organization membership
    SELECT organization_id, role INTO member
      FROM public.organization_members
      WHERE supabase_user_id = (event->>'user_id')::uuid
      LIMIT 1;

    claims := event->'claims';

    IF member.organization_id IS NOT NULL THEN
      claims := jsonb_set(claims, '{org_id}', to_jsonb(member.organization_id));
      claims := jsonb_set(claims, '{role}', to_jsonb(member.role));
    ELSE
      -- No membership found: default to user role with null org
      claims := jsonb_set(claims, '{org_id}', 'null');
      claims := jsonb_set(claims, '{role}', to_jsonb('user'));
    END IF;

    RETURN jsonb_set(event, '{claims}', claims);
  END;
$$;

-- Create organization_members table in Supabase PostgreSQL
-- This mirrors the D1 schema to support the auth hook
CREATE TABLE IF NOT EXISTS public.organization_members (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id text NOT NULL REFERENCES public.organizations(id),
  supabase_user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'active',
  invited_at timestamptz,
  joined_at timestamptz DEFAULT now(),
  suspended_at timestamptz,
  suspended_reason text
);

CREATE INDEX IF NOT EXISTS idx_org_members_supabase_user
  ON public.organization_members(supabase_user_id);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id
  ON public.organization_members(organization_id);