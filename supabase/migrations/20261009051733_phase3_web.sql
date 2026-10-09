-- Phase 3: read helpers for the web app and the API.
--
-- PostgREST exposes a function that takes a table row as a computed field, so
-- `select=id,title,snippet` returns a short preview instead of a body that can
-- run to 30,000 characters.

create function public.snippet(public.knowledge)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select left(regexp_replace($1.body, '\s+', ' ', 'g'), 280)
$$;

revoke execute on function public.snippet(public.knowledge) from public;
grant execute on function public.snippet(public.knowledge) to anon, authenticated, service_role;
