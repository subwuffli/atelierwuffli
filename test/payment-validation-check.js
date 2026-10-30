const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('test/app.js','utf8'),sql=fs.readFileSync('supabase/test-payment-validation-v0126.sql','utf8');

const helper=app.match(/function bindRequiredPaymentFields\(form,statusName,paidValue\)\{[\s\S]*?\n\}/);
assert.ok(helper,'Zahlungsfeld-Validierung im Formular fehlt');
const context={};vm.runInNewContext(`${helper[0]}; result=bindRequiredPaymentFields`,context);
function form(status){
  const listeners={};
  const field=name=>({name,value:'',required:false,disabled:false,addEventListener(type,fn){listeners[`${name}:${type}`]=fn}});
  const controls={paymentStatus:field('paymentStatus'),status:field('status'),paidDate:field('paidDate'),paymentMethod:field('paymentMethod')};
  const result={elements:controls,listeners};
  return result;
}
for(const [status,paid] of [['Bezahlt',true],['Offen',false],['Storniert',false]]){
  const fields=form(status);fields.elements.status.value=status;context.result(fields,'status','Bezahlt');
  assert.equal(fields.elements.paidDate.required,paid,`${status}: Zahlungsdatum Pflichtstatus`);
  assert.equal(fields.elements.paymentMethod.required,paid,`${status}: Zahlungsart Pflichtstatus`);
  assert.equal(fields.elements.paidDate.disabled,!paid,`${status}: Zahlungsdatum Aktivstatus`);
  assert.equal(fields.elements.paymentMethod.disabled,!paid,`${status}: Zahlungsart Aktivstatus`);
}

assert.match(sql,/if paid_value is null or nullif\(trim\(method_value\),'\'\) is null then raise exception 'PAYMENT_DETAILS_REQUIRED'/i,'RPC muss fehlende Zahlungsdaten ablehnen');
assert.match(sql,/elsif paid_value is not null or nullif\(trim\(method_value\),'\'\) is not null then\s+raise exception 'PAYMENT_DETAILS_NOT_ALLOWED'/i,'RPC muss Zahlungsdaten bei offen/storniert ablehnen');
assert.match(sql,/create trigger validate_invoice_payment_fields before insert or update of status,paid_date,payment_method/i,'Invoice-Schreibschutz fehlt');
assert.match(sql,/create trigger validate_expense_payment_fields before insert or update of payment_status,paid_date,payment_method/i,'Expense-Schreibschutz fehlt');
assert.match(sql,/revoke all on function public\.validate_payment_fields_v1\(\) from public,anon,authenticated/i,'Triggerfunktion darf nicht direkt exponiert sein');
assert.match(sql,/revoke all on function public\.save_invoice_v1\(jsonb,timestamptz,uuid\),public\.save_expense_v1\(jsonb,timestamptz,uuid\) from public,anon/i,'RPC-Wrapper darf nicht anonym aufrufbar sein');
assert.match(sql,/auth\.uid\(\) is null or not public\.is_erp_member_v1\(\)/i,'RPC-Wrapper muss Mitgliedschaft prüfen');
assert.match(sql,/save_invoice_unvalidated_v1\(p_invoice,p_expected_updated_at,p_session_token\)/i,'Invoice-RPC muss Lock-/Konfliktpfad weiterverwenden');
assert.match(sql,/save_expense_unvalidated_v1\(p_expense,p_expected_updated_at,p_session_token\)/i,'Expense-RPC muss Lock-/Konfliktpfad weiterverwenden');
const bookkeeping=fs.readFileSync('supabase/test-bookkeeping-v0091.sql','utf8');
assert.match(bookkeeping,/old\.paid_date is distinct from new\.paid_date or old\.payment_method is distinct from new\.payment_method or old\.total is distinct from new\.total then\s+new\.payment_reconciled_at:=null/i,'Rechnungsabgleich wird bei Zahlungsänderung zurückgesetzt');
assert.match(bookkeeping,/old\.payment_status is distinct from new\.payment_status or old\.paid_date is distinct from new\.paid_date or old\.payment_method is distinct from new\.payment_method or old\.amount is distinct from new\.amount then\s+new\.payment_reconciled_at:=null/i,'Ausgabenabgleich wird bei Zahlungsänderung zurückgesetzt');
console.log('payment-validation-check: ok');
