-- Phase 8 contract (release only): drop the comments compatibility view.
--
-- Since Phase 7 a comment is a reply post. The API answers its comments routes from posts, the web
-- reads replies through post_thread and thread_shape, and nothing in the database reads the view
-- (checked against pg_depend and every function body). Applied after the Phase 8 web went live;
-- phase8_web.sql runs the drop inside its transaction and checks every read still works.

drop view if exists public.comments;
