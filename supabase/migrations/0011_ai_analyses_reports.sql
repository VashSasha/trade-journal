-- Extend ai_analyses to hold two kinds of AI analysis rows.
--
-- Journal rows (existing): kind='journal', date=YYYY-MM-DD, title=null.
-- Report  rows (new):      kind='report',  date=null,       title='MNQ · 5m · Live Data'.
--
-- Existing rows get kind='journal' via the column default, so no back-fill is needed.
-- RLS policies already cover all columns — no change required there.
--
-- Run this via the Supabase SQL editor (same as the earlier migrations).

alter table public.ai_analyses
    add column kind  text not null default 'journal'
        check (kind in ('journal', 'report')),
    add column title text;

-- Reports have no journal date; journal rows keep their date value.
alter table public.ai_analyses
    alter column date drop not null;

-- Fastest path for listing saved reports newest-first.
create index ai_analyses_user_kind_idx
    on public.ai_analyses (user_id, kind, created_at desc);
