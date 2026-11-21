-- Send purchase request notification rows to phones. The authenticated app
-- cannot call this webhook: its only input is the notification ID, and the
-- function loads the saved message itself.
--
-- PUSH_WEBHOOK_SECRET is set in the Edge Function environment and the same
-- value is stored in Supabase Vault as purchase_push_webhook_secret. The
-- function URL is stored in private.settings as purchase_push_function_url.
-- Neither value belongs in this public repository.

alter table public.notifications
  add column pushed_at timestamptz;

comment on column public.notifications.pushed_at is
  'When delivery was claimed. Set before sending so repeated webhook calls cannot send the same notification twice.';

drop policy "People add notifications for themselves" on public.notifications;

create policy "People add test notifications for themselves"
  on public.notifications for insert to authenticated
  with check (
    member_id = (select auth.uid())
    and topic is null
    and (select private.is_member())
  );

create function private.send_purchase_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  webhook_secret text;
begin
  select value into function_url
  from private.settings
  where key = 'purchase_push_function_url';

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'purchase_push_webhook_secret';

  if function_url is null or webhook_secret is null or webhook_secret = '' then
    raise warning 'Purchase phone notifications are not configured; notification % remains in the app only.', new.id;
    return null;
  end if;

  perform net.http_post(
    url := function_url,
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-webhook-secret', webhook_secret
    ),
    timeout_milliseconds := 5000
  );
  return null;
end;
$$;

revoke all on function private.send_purchase_notification_push() from public, anon, authenticated;

create trigger send_purchase_notification_push
  after insert on public.notifications
  for each row
  when (new.topic = 'purchasing.request_updates')
  execute function private.send_purchase_notification_push();
