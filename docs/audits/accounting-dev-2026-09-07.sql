-- Read-only reconciliation. Contains no patient names or contact details.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT 'inventory', json_build_object(
 'orders',(SELECT count(*) FROM orders), 'quotes',(SELECT count(*) FROM quotes),
 'invoices',(SELECT count(*) FROM invoices), 'payments',(SELECT count(*) FROM invoice_payment_transactions),
 'refunds',(SELECT count(*) FROM invoice_refund_transactions), 'credits',(SELECT count(*) FROM invoice_credit_note_transactions),
 'advances_allocated',(SELECT count(*) FROM invoice_prepayment_allocations),
 'external_invoices',(SELECT count(*) FROM external_invoices),
 'provider_payments',(SELECT count(*) FROM external_invoice_provider_payment_transactions),
 'ledger',(SELECT count(*) FROM accounting_entries), 'accounts',(SELECT count(*) FROM company_financial_accounts),
 'transfers',(SELECT count(*) FROM company_financial_account_transfers),
 'account_adjustments',(SELECT count(*) FROM company_financial_account_adjustments),
 'patient_adjustments',(SELECT count(*) FROM patient_balance_adjustments));
WITH p AS (SELECT invoice_id, sum(CASE WHEN transaction_type='payment' THEN amount_gross ELSE -amount_gross END) amount FROM invoice_payment_transactions GROUP BY 1),
r AS (SELECT invoice_id, sum(CASE WHEN transaction_type='refund' THEN amount_gross ELSE -amount_gross END) amount FROM invoice_refund_transactions GROUP BY 1),
c AS (SELECT invoice_id, sum(CASE WHEN transaction_type='credit_note' THEN amount_gross ELSE -amount_gross END) amount FROM invoice_credit_note_transactions GROUP BY 1),
a AS (SELECT target_invoice_id, sum(amount_gross) amount FROM invoice_prepayment_allocations GROUP BY 1)
SELECT 'invoice_reconciliation',json_build_object('number',i.invoice_number,'type',i.invoice_type,'status',i.status,'gross',i.total_gross,'paid',i.paid_amount,'journal_net_cash',coalesce(p.amount,0)-coalesce(r.amount,0),'credited',i.credited_amount,'journal_credit',coalesce(c.amount,0),'prepayment',i.prepayment_applied_amount,'allocated',coalesce(a.amount,0),'open',i.total_gross-i.credited_amount-i.paid_amount-i.prepayment_applied_amount,'cash_matches',i.paid_amount=coalesce(p.amount,0)-coalesce(r.amount,0),'credit_matches',i.credited_amount=coalesce(c.amount,0),'prepayment_matches',i.prepayment_applied_amount=coalesce(a.amount,0),'due_date',i.due_date)
FROM invoices i LEFT JOIN p ON p.invoice_id=i.id LEFT JOIN r ON r.invoice_id=i.id LEFT JOIN c ON c.invoice_id=i.id LEFT JOIN a ON a.target_invoice_id=i.id ORDER BY i.invoice_number;
SELECT 'invoice_arithmetic_errors',count(*) FROM invoices WHERE total_net+total_vat<>total_gross;
SELECT 'quote_arithmetic_errors',count(*) FROM quotes WHERE total_net+total_vat<>total_gross;
SELECT 'external_arithmetic_errors',count(*) FROM external_invoices WHERE amount_net+amount_vat<>amount_gross;
SELECT 'ledger_arithmetic_errors',count(*) FROM accounting_entries WHERE amount_net+amount_vat<>amount_gross;
SELECT 'invoice_line_totals',json_build_object('number',i.invoice_number,'gross',i.total_gross,'line_gross',sum(coalesce((line->>'line_gross')::numeric,0)),'net',i.total_net,'line_net',sum(coalesce((line->>'line_net')::numeric,0)),'vat',i.total_vat,'line_vat',sum(coalesce((line->>'line_vat')::numeric,0))) FROM invoices i CROSS JOIN LATERAL jsonb_array_elements(i.line_items) line GROUP BY i.id ORDER BY i.invoice_number;
SELECT 'payment_ledger',json_build_object('invoice',i.invoice_number,'type',p.transaction_type,'method',p.payment_method,'journal',p.amount_gross,'ledger',sum(e.amount_gross),'entries',count(e.id)) FROM invoice_payment_transactions p JOIN invoices i ON i.id=p.invoice_id LEFT JOIN accounting_entries e ON e.source_invoice_payment_transaction_id=p.id GROUP BY p.id,i.invoice_number;
SELECT 'invoice_ledger',json_build_object('number',i.invoice_number,'net_cash',i.paid_amount,'ledger_gross',coalesce(sum(e.amount_gross),0)) FROM invoices i LEFT JOIN accounting_entries e ON e.source_invoice_id=i.id GROUP BY i.id ORDER BY i.invoice_number;
SELECT 'unlinked_ledger',entry_kind,count(*),sum(amount_gross) FROM accounting_entries WHERE source_invoice_payment_transaction_id IS NULL AND source_invoice_refund_transaction_id IS NULL AND source_external_provider_payment_transaction_id IS NULL GROUP BY entry_kind;
SELECT 'overallocated_advance',count(*) FROM (SELECT s.id FROM invoices s JOIN invoice_prepayment_allocations a ON a.advance_invoice_id=s.id GROUP BY s.id HAVING sum(a.amount_gross)>least(s.paid_amount,s.total_gross-s.credited_amount)) bad;
SELECT 'overallocated_quote_lines',count(*) FROM (SELECT a.quote_id,a.quote_line_index FROM invoice_order_line_allocations a JOIN invoices i ON i.id=a.invoice_id JOIN quotes q ON q.id=a.quote_id WHERE i.status<>'cancelled' GROUP BY a.quote_id,a.quote_line_index,q.line_items HAVING sum(a.quantity)>(q.line_items->a.quote_line_index->>'quantity')::numeric) bad;
SELECT 'multiple_active_finals',count(*) FROM (SELECT quote_id FROM invoices WHERE invoice_type='final' AND status<>'cancelled' GROUP BY quote_id HAVING count(*)>1) bad;
SELECT 'account_currency_errors',count(*) FROM accounting_entries e JOIN company_financial_accounts a ON a.id=e.financial_account_id WHERE upper(e.currency)<>a.currency;
SELECT 'unassigned_cash',count(*),coalesce(sum(amount_gross),0) FROM accounting_entries WHERE financial_account_id IS NULL;
SELECT 'cash_before_account_opening',count(*),coalesce(sum(e.amount_gross),0) FROM accounting_entries e JOIN company_financial_accounts a ON a.id=e.financial_account_id WHERE e.entry_date<a.opening_balance_on;
SELECT 'provider_reconciliation',json_build_object('number',e.external_invoice_number,'scope',e.invoice_scope,'status',e.status,'paid_by',e.paid_by,'gross',e.amount_gross,'receivable',e.patient_receivable_gross,'liability',e.provider_liability_gross,'journal',coalesce((SELECT sum(CASE WHEN p.transaction_type='payment' THEN p.amount_gross ELSE -p.amount_gross END) FROM external_invoice_provider_payment_transactions p WHERE p.external_invoice_id=e.id),0),'ledger',coalesce((SELECT sum(a.amount_gross) FROM accounting_entries a WHERE a.source_external_invoice_id=e.id),0)) FROM external_invoices e;
SELECT 'quote_recorded_prepayments',q.quote_number,q.paid_amount,(SELECT coalesce(sum(i.paid_amount),0) FROM invoices i WHERE i.order_id=q.order_id AND i.invoice_type='advance' AND i.status<>'cancelled') advance_cash FROM quotes q WHERE q.paid_amount>0;
SELECT 'invoice_status_counts',status,count(*),sum(total_gross),sum(paid_amount) FROM invoices GROUP BY status;
SELECT 'ledger_totals',currency,direction,category,count(*),sum(amount_net),sum(amount_vat),sum(amount_gross) FROM accounting_entries GROUP BY currency,direction,category;
SELECT 'financial_trigger_inventory',c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('invoices','invoice_payment_transactions','accounting_entries') ORDER BY 1,2;
COMMIT;
