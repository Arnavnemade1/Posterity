-- Deleting a workspace deletes its commits and change requests through separate cascades. References
-- to commits were plain NO ACTION foreign keys, so a commit a comment still pointed at could be checked
-- before the cascade removed that comment, and the delete failed. Commits only ever go away with their
-- whole workspace, so every reference follows them: nullable ones are cleared, required ones cascade.

alter table public.change_requests
  drop constraint change_requests_base_commit_fkey,
  add constraint change_requests_base_commit_fkey foreign key (base_commit) references public.commits (id) on delete set null,
  drop constraint change_requests_head_commit_fkey,
  add constraint change_requests_head_commit_fkey foreign key (head_commit) references public.commits (id) on delete set null,
  drop constraint change_requests_target_head_fkey,
  add constraint change_requests_target_head_fkey foreign key (target_head) references public.commits (id) on delete set null,
  drop constraint change_requests_merged_commit_fkey,
  add constraint change_requests_merged_commit_fkey foreign key (merged_commit) references public.commits (id) on delete set null;

alter table public.cr_reviews
  drop constraint cr_reviews_commit_id_fkey,
  add constraint cr_reviews_commit_id_fkey foreign key (commit_id) references public.commits (id) on delete set null;

alter table public.cr_comments
  drop constraint cr_comments_commit_id_fkey,
  add constraint cr_comments_commit_id_fkey foreign key (commit_id) references public.commits (id) on delete set null;

alter table public.cr_checks
  drop constraint cr_checks_commit_id_fkey,
  add constraint cr_checks_commit_id_fkey foreign key (commit_id) references public.commits (id) on delete cascade;

alter table public.branches
  drop constraint branches_head_fkey,
  add constraint branches_head_fkey foreign key (head) references public.commits (id) on delete cascade;
