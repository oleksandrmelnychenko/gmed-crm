import { invoiceListAmounts, type InvoiceListAmounts } from "@/pages/invoices/model/invoice-amounts";

import type { InvoiceItem } from "./detail-tab-types";

/**
 * The money columns of the invoices tab in the patient card, with the same
 * rule as the invoice list (QA D-33): "Итого" is the total after credit
 * notes, "Оплачено / зачтено" counts cash and the advance money credited into
 * the invoice, "Баланс" is what is still open, so Итого − Оплачено = Баланс
 * on every row that is not overpaid; an overpayment shows as "Переплата".
 */
export function patientInvoiceAmounts(invoice: InvoiceItem): InvoiceListAmounts {
  return invoiceListAmounts({
    total_gross: invoice.total_gross,
    credited_amount: invoice.credited_amount,
    adjusted_total_gross: invoice.adjusted_total_gross,
    paid_amount: invoice.paid_amount,
    prepayment_applied_amount: invoice.prepayment_applied_amount,
    balance_due: invoice.balance_due,
    credit_balance: invoice.credit_balance,
  });
}
