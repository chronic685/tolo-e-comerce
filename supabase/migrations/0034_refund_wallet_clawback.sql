-- Phase 5a, item 2: a completed refund must claw back the wallet credit
-- finalizePaymentSuccess gave the merchant for that order — otherwise
-- settlement-run still pays the merchant in full for an order Tolo already
-- refunded the customer for. wallet_txn_type already has a 'refund' value
-- (migration 0009) that nothing has ever posted; this is the first use of
-- it, via the existing post_wallet_transaction() — no new ledger mechanism.
--
-- Implemented as a trigger on refunds rather than in the admin frontend
-- (Refunds.tsx just does a plain `.update()` today, gated by the existing
-- refunds_manage_finance RLS policy to Tolo finance/admin) so the clawback
-- happens no matter which client sets a refund to "completed" — today's
-- frontend or a future one — rather than depending on every future caller
-- remembering to also call an RPC.

create or replace function claw_back_wallet_on_refund_completed()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_merchant_order_id uuid;
  v_merchant_id uuid;
begin
  select r.merchant_order_id, mo.merchant_id
  into v_merchant_order_id, v_merchant_id
  from returns r
  join merchant_orders mo on mo.id = r.merchant_order_id
  where r.id = new.return_id;

  if v_merchant_id is not null then
    perform post_wallet_transaction(
      v_merchant_id,
      v_merchant_order_id,
      'refund',
      -new.amount,
      'Refund clawback for return ' || v_merchant_order_id
    );
  end if;

  return new;
end;
$$;

-- Covers both the normal path (a refund created 'pending' and later marked
-- 'completed' by finance, today's only real flow) and a refund inserted as
-- already-'completed' outright — the OLD.status guard on the update
-- trigger prevents re-firing on an unrelated update to an already-completed
-- row (e.g. a future column edit) from clawing back twice.
create trigger refunds_wallet_clawback_on_insert
  after insert on refunds
  for each row
  when (new.status = 'completed')
  execute function claw_back_wallet_on_refund_completed();

create trigger refunds_wallet_clawback_on_update
  after update on refunds
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function claw_back_wallet_on_refund_completed();
