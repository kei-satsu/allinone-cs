import { Asset } from 'expo-asset';
import { Platform } from 'react-native';
import qrcode from 'qrcode-generator';

import type { StatusOrder } from '@/lib/order-status';

export type VoucherFields = {
  receiveDate: string;
  itemId: string;
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  codAmount: string;
  deliFee: string;
  payType: string;
  paymentLabel?: string;
  totalAmount: string;
  remark: string;
};

export type VoucherMarkupOptions = {
  includeQr?: boolean;
  paymentLabel?: string;
};

export type VoucherOutputDocument = {
  id: string;
  fields: VoucherFields;
  qrEnabled: boolean;
  paymentLabel?: string;
};

function stringField(value: unknown, fallback = '---'): string {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  return text || fallback;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character);
}

function hasNegativeAmount(value: string): boolean {
  const amount = Number(value.replace(/,/g, ''));
  return Number.isFinite(amount) && amount < 0;
}

export function normalizeVoucherFields(order: StatusOrder): VoucherFields {
  return {
    receiveDate: stringField(order.received_date || order.created_at),
    itemId: stringField(order.item_id || order.barcode),
    senderName: stringField(order.sender_name),
    senderPhone: stringField(order.sender_phone),
    senderAddress: stringField(order.sender_loc),
    receiverName: stringField(order.receiver_name),
    receiverPhone: stringField(order.receiver_phone),
    receiverAddress: stringField(order.receiver_address),
    codAmount: stringField(order.cod_amount, '0'),
    deliFee: stringField(order.deli_fee, '0'),
    payType: stringField(order.fee_type, 'COLLECT'),
    totalAmount: stringField(order.total_amount, '0'),
    remark: stringField(order.remark, '---'),
  };
}

export function voucherPaymentDisplay(fields: VoucherFields, paymentLabel?: string) {
  const payTypeDisplay =
    paymentLabel?.trim() ||
    fields.paymentLabel?.trim() ||
    (fields.payType === 'Deli' ? 'Receiver Pay' : 'Sender Pay');
  const deliStatus =
    fields.payType === 'Cash' || fields.payType === 'Kpay'
      ? 'Paid'
      : fields.payType === 'Bill'
        ? 'Bill'
        : '';
  const codAmount =
    fields.payType === 'Bill'
      ? fields.totalAmount
      : fields.codAmount === '-' || hasNegativeAmount(fields.codAmount)
        ? '0'
        : fields.codAmount;
  return { payTypeDisplay, deliStatus, codAmount };
}

export function voucherQrDataUrl(payload: string): string {
  const code = qrcode(0, 'M');
  code.addData(payload || 'AIO-INTAKE');
  code.make();
  return code.createDataURL(4, 0);
}

export function buildVoucherMarkup(
  fields: VoucherFields,
  qrDataUrl: string,
  logoDataUrl: string,
  options: VoucherMarkupOptions = {},
): string {
  const includeQr = options.includeQr !== false;
  const printableFields = includeQr ? fields : { ...fields, itemId: '' };
  const safe = Object.fromEntries(
    Object.entries(printableFields).map(([key, value]) => [key, escapeHtml(value ?? '')]),
  ) as Record<keyof VoucherFields, string>;
  const { codAmount, deliStatus, payTypeDisplay } =
    voucherPaymentDisplay(fields, options.paymentLabel);
  const safeCod = escapeHtml(codAmount);
  const safeDeliStatus = escapeHtml(deliStatus);
  const safePayType = escapeHtml(payTypeDisplay);
  const remarkFontSize =
    fields.remark.length > 50 ? '10px' : fields.remark.length > 25 ? '12px' : '20px';
  const officeClass = includeQr ? 'office' : 'office no-qr';
  const qrMarkup = includeQr ? `<img class="qr" src="${qrDataUrl}" alt="QR"/>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
@page { size: 4in 6in; margin: 0; }
* { box-sizing: border-box; }
body { margin:0; background:#fff; color:#000; font-family: Pyidaungsu, Arial, "Noto Sans Myanmar", sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.voucher { width:4in; height:6in; padding:12px; overflow:hidden; background:#fff; color:#000; display:flex; flex-direction:column; }
.header { display:flex; align-items:center; justify-content:center; gap:8px; padding-bottom:6px; }
.header img { width:24px; height:24px; object-fit:contain; flex:none; }
.brand-name { font-size:16px; line-height:18px; font-family:Arial,sans-serif; font-weight:700; letter-spacing:-.25px; }
.date-row { display:flex; justify-content:space-between; align-items:baseline; margin-top:0; margin-bottom:2px; font-size:12px; }
.date-row b { font-weight:700; }.date-value,.item { font-family:monospace; }.item { font-size:12px; font-weight:900; letter-spacing:1px; }
.office { margin-top:8px; display:grid; grid-template-columns:65px 1px minmax(0,1fr) 52px; column-gap:6px; align-items:start; font-size:10px; line-height:1.18; }.office.no-qr { grid-template-columns:65px 1px minmax(0,1fr); }
.office-label { text-align:right; font-weight:700; display:flex; flex-direction:column; justify-content:space-between; min-height:45px; }.office-rule { width:1px; min-height:45px; background:#000; }.office-copy { padding-right:3px; font-weight:500; }.office-copy div + div { margin-top:6px; }.qr { width:52px; height:52px; object-fit:contain; margin-left:2px; }
.section { margin-top:10px; }.section.to { margin-top:6px; }.section-title { border-top:1px solid #000; border-bottom:1px solid #000; padding:3px 0; text-align:center; font-family:Arial,sans-serif; font-weight:700; font-size:11px; line-height:12px; letter-spacing:2px; }.to .section-title { font-size:12px; }
.fields { margin-top:5px; padding:5px 0; }.field { display:grid; grid-template-columns:64px minmax(0,1fr); align-items:start; margin-top:3px; font-size:11px; line-height:14px; }.field:first-child { margin-top:0; }.field-label { padding-right:8px; text-align:right; font-weight:700; }.field-value { font-weight:500; overflow-wrap:anywhere; }.to .field { font-size:12px; line-height:16px; }.to .field:nth-child(2) { margin-top:7px; }.to .field-value { font-weight:700; }.to .address { padding-top:3px; padding-bottom:5px; min-height:58px; line-height:18px; overflow:hidden; }
.money { margin-top:6px; border-top:1px solid #000; font-size:12px; }.money-row { display:grid; grid-template-columns:72px minmax(0,1fr); align-items:stretch; min-height:33px; }.money-row + .money-row { border-top:1px dashed #000; }.money-row.total { border-top:1px solid #000; }.money-label { padding:7px 8px 7px 0; border-right:1px solid #000; text-align:right; font-weight:700; }.money-value { padding:7px 0 7px 12px; font-family:monospace; font-weight:700; }.fee-value { display:flex; justify-content:space-between; align-items:center; gap:7px; padding-right:24px; font-family:inherit; }.fee-value .amount { font-family:monospace; font-weight:600; }.fee-value .pay-type { font-family:Arial,sans-serif; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.3px; }.total .money-label { font-size:14px; font-weight:900; }.total .money-value { font-size:15px; font-weight:900; }.money-bottom { border-top:1px solid #000; }
.remark { padding-top:6px; min-height:90px; display:flex; flex-direction:column; }.remark-title { text-align:center; font-size:12px; line-height:15px; font-weight:700; }.remark-rule { margin-top:3px; border-bottom:1px dotted #9ca3af; }.remark-copy { height:58px; padding:0 8px; display:flex; align-items:center; justify-content:center; text-align:center; overflow:hidden; overflow-wrap:anywhere; font-size:${remarkFontSize}; line-height:1.15; }.remark-bottom { padding-top:25px; border-bottom:1px dotted #9ca3af; }
</style></head><body><main class="voucher"><header class="header"><img src="${logoDataUrl}" alt="Logo"/><div class="brand-name">ALL IN ONE EXPRESS</div></header><div class="date-row"><div><b>Date:</b> <span class="date-value">${safe.receiveDate}</span></div><div class="item">${safe.itemId}</div></div><div class="${officeClass}"><div class="office-label"><div>MDY Office:</div><div>YGN Office:</div></div><div class="office-rule"></div><div class="office-copy"><div>No.Nga-6/93, 62A, between 109 &amp; 109B, Mandalay.09-889988856</div><div>No.280, Corner of Du Yar St. &amp; Ba La Min Htin St., 50 ward, North Dagon, Yangon.</div></div>${qrMarkup}</div><section class="section from"><div class="section-title">FROM</div><div class="fields"><div class="field"><span class="field-label">Name:</span><span class="field-value">${safe.senderName}</span></div><div class="field"><span class="field-label">Phone:</span><span class="field-value">${safe.senderPhone}</span></div><div class="field"><span class="field-label">Address:</span><span class="field-value">${safe.senderAddress}</span></div></div></section><section class="section to"><div class="section-title">TO</div><div class="fields"><div class="field"><span class="field-label">Name:</span><span class="field-value">${safe.receiverName}</span></div><div class="field"><span class="field-label">Phone:</span><span class="field-value">${safe.receiverPhone}</span></div><div class="field address"><span class="field-label">Address:</span><span class="field-value">${safe.receiverAddress}</span></div></div></section><section class="money"><div class="money-row"><div class="money-label">COD:</div><div class="money-value">${safeCod} Ks</div></div><div class="money-row"><div class="money-label">Deli Fee:</div><div class="money-value fee-value"><span class="amount">${safe.deliFee} Ks ${safeDeliStatus ? `(${safeDeliStatus})` : ''}</span><span class="pay-type">${safePayType}</span></div></div><div class="money-row total"><div class="money-label">Total:</div><div class="money-value">${safe.totalAmount} Ks</div></div></section><div class="money-bottom"></div><section class="remark"><div class="remark-title">မှတ်ချက်</div><div class="remark-rule"></div><div class="remark-copy">${safe.remark}</div><div class="remark-bottom"></div></section></main></body></html>`;
}

let voucherLogoDataUrlPromise: Promise<string> | null = null;

async function loadVoucherLogoDataUrl(): Promise<string> {
  const [asset] = await Asset.loadAsync(require('../assets/images/voclogo.png'));
  if (!asset.localUri) {
    throw new Error('Logo asset could not be loaded for the voucher.');
  }

  if (Platform.OS === 'web') {
    const response = await fetch(asset.localUri);
    if (!response.ok) {
      throw new Error(`Logo asset request failed (${response.status}).`);
    }

    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Logo asset could not be encoded for the voucher.'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Logo asset could not be read.'));
      reader.readAsDataURL(blob);
    });
  }

  const { EncodingType, readAsStringAsync } = await import('expo-file-system/legacy');
  const logoBase64 = await readAsStringAsync(asset.localUri, {
    encoding: EncodingType.Base64,
  });
  return `data:image/png;base64,${logoBase64}`;
}

export async function buildVoucherHtml(document: VoucherOutputDocument): Promise<string> {
  const qr = voucherQrDataUrl(document.fields.itemId || document.id);
  voucherLogoDataUrlPromise ??= loadVoucherLogoDataUrl().catch((error: unknown) => {
    voucherLogoDataUrlPromise = null;
    throw error;
  });
  const logoDataUrl = await voucherLogoDataUrlPromise;
  return buildVoucherMarkup(document.fields, qr, logoDataUrl, {
    includeQr: document.qrEnabled,
    paymentLabel: document.paymentLabel,
  });
}
