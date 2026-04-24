const TREXPAY_DEPOSIT_URL = "https://app.trexpay.com.br/api/wallet/deposit/payment";
const { getSupabase } = require("./lib/supabase");

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function normalizeAmount(rawAmount) {
  if (rawAmount == null) return { amountCents: 100, amountNum: 1 };
  if (typeof rawAmount === "string") {
    const cleaned = rawAmount.replace(/[^\d,.-]/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return { amountCents: 100, amountNum: 1 };
    return { amountCents: Math.max(1, Math.round(n * 100)), amountNum: n };
  }
  const n = Number(rawAmount);
  if (!Number.isFinite(n)) return { amountCents: 100, amountNum: 1 };
  if (Number.isInteger(n) && n >= 1000) {
    const num = n / 100;
    return { amountCents: Math.max(1, Math.round(num * 100)), amountNum: num };
  }
  return { amountCents: Math.max(1, Math.round(n * 100)), amountNum: n };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: "",
    };
  }

  const token = process.env.TREXPAY_TOKEN;
  const secret = process.env.TREXPAY_SECRET;
  if (!token || !secret) {
    return jsonResponse(500, {
      success: false,
      error: "Configure TREXPAY_TOKEN e TREXPAY_SECRET nas variaveis do Netlify",
    });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const randDigits = (len) => Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");
  const randId = randDigits(6);
  const rawAmount = body.amount ?? body.valor ?? body.total ?? 84.9;
  const { amountCents, amountNum } = normalizeAmount(rawAmount);
  const customerName = (body.nome || body.name || body.customer_name || `Cliente ${randId}`).toString();
  const customerEmail = (body.email || body.customer_email || `cliente${randId}@example.com`).toString();
  const customerPhone = (body.phone || body.customer_phone || `11${randDigits(9)}`).toString().replace(/\D/g, "");
  const cpfRaw = (body.cpf || body.document || body.customer_cpf || randDigits(11)).toString().replace(/\D/g, "");
  const customerCpf = cpfRaw.padEnd(11, "0").slice(0, 11);
  const tracking = (body.tracking || body.rastreio || body.codigo || `pedido-${randId}`).toString();

  const payload = {
    token,
    secret,
    postback: process.env.POSTBACK_URL || body.postback || undefined,
    amount: Number(amountNum.toFixed(2)),
    debtor_name: customerName,
    email: customerEmail,
    debtor_document_number: customerCpf,
    phone: customerPhone.startsWith("55") ? `+${customerPhone}` : `+55${customerPhone}`,
    method_pay: "pix",
    src: body.src || body.utm_source || "site",
    sck: body.sck || body.utm_campaign || tracking,
    utm_source: body.utm_source,
    utm_campaign: body.utm_campaign,
    utm_medium: body.utm_medium,
    utm_content: body.utm_content,
    utm_term: body.utm_term,
    split_email: body.split_email,
    split_percentage: body.split_percentage,
  };

  const trexResp = await fetch(TREXPAY_DEPOSIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await trexResp.text();
  if (!trexResp.ok) {
    return jsonResponse(trexResp.status, { success: false, error: text || "Erro ao criar PIX" });
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  const pixData = data?.pix || data?.data || data;
  const brcode =
    pixData?.pixCode ||
    pixData?.payload ||
    pixData?.brcode ||
    pixData?.qr_code_text ||
    pixData?.emv ||
    pixData?.qrcode ||
    null;
  const qrcodeFinal =
    pixData?.qr_code_image_url ||
    pixData?.qrcode_url ||
    pixData?.qr_code_base64 ||
    pixData?.qrCodeImage ||
    pixData?.image ||
    null;
  const paymentId =
    pixData?.idTransaction ||
    pixData?.transactionId ||
    pixData?.id ||
    pixData?.txid ||
    null;

  try {
    const supabase = getSupabase();
    await supabase.from("transactions").insert({
      transaction_id: paymentId,
      amount: amountNum,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_cpf: customerCpf,
      customer_phone: customerPhone,
      tracking: tracking,
      status: "PENDING",
      brcode,
      qrcode: qrcodeFinal,
    });
  } catch (_) {}

  return jsonResponse(200, {
    success: true,
    pix_code: brcode,
    transaction_id: paymentId,
    deposit_id: paymentId,
    qrcode: qrcodeFinal,
    amount: amountNum,
    key: null,
    brcode,
    payload: brcode,
    pixCode: brcode,
    pix: {
      key: null,
      brcode,
      qrcode: qrcodeFinal,
      payload: brcode,
    },
    raw: data,
  });
};
