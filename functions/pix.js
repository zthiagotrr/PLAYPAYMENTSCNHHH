const { getSupabase } = require("./lib/supabase");

const VENO_BASE = "https://beta.venopayments.com/api";

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
  if (rawAmount == null) return { amountCents: 4990, amountNum: 49.9 };
  if (typeof rawAmount === "string") {
    const cleaned = rawAmount.replace(/[^\d,.-]/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return { amountCents: 4990, amountNum: 49.9 };
    if (Number.isInteger(n) && n >= 100) return { amountCents: n, amountNum: n / 100 };
    return { amountCents: Math.max(100, Math.round(n * 100)), amountNum: n };
  }
  const n = Number(rawAmount);
  if (!Number.isFinite(n)) return { amountCents: 4990, amountNum: 49.9 };
  if (Number.isInteger(n) && n >= 100) return { amountCents: n, amountNum: n / 100 };
  return { amountCents: Math.max(100, Math.round(n * 100)), amountNum: n };
}

async function postWithRetry(url, authHeader, payload) {
  const delays = [1000, 2000, 4000];
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.status >= 400 && resp.status < 500) return resp;
      if (resp.ok) return resp;
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, delays[attempt]));
  }
  throw lastErr;
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

  const apiKey = process.env.VENO_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, {
      success: false,
      error: "Configure VENO_API_KEY nas variaveis de ambiente",
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
  const rawAmount = body.amount ?? body.valor ?? body.total ?? 4990;
  const { amountCents, amountNum } = normalizeAmount(rawAmount);
  const customerName = (body.nome || body.name || body.customer_name || `Cliente ${randId}`).toString().trim();
  const customerEmail = (body.email || body.customer_email || `cliente${randId}@example.com`).toString().trim();
  const customerPhone = (body.phone || body.customer_phone || `11${randDigits(9)}`).toString().replace(/\D/g, "");
  const cpfRaw = (body.cpf || body.document || body.customer_cpf || randDigits(11)).toString().replace(/\D/g, "");
  const customerCpf = cpfRaw.padEnd(11, "0").slice(0, 11);
  const itemTitle = (body.item_title || body.produto || body.plan || "CNH").toString();

  const utmFields = {};
  for (const key of ["utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"]) {
    if (body[key]) utmFields[key] = String(body[key]);
  }
  if (!utmFields.utm_source && (body.utm || body.utms)) {
    utmFields.utm_source = String(body.utm || body.utms);
  }

  const payload = {
    amount: amountCents,
    description: itemTitle,
    payer: {
      name: customerName,
      email: customerEmail,
      document: customerCpf,
      phone: customerPhone,
    },
    ...utmFields,
  };

  let resp;
  try {
    resp = await postWithRetry(`${VENO_BASE}/v1/pix`, `Bearer ${apiKey}`, payload);
  } catch (err) {
    return jsonResponse(502, { success: false, error: "Falha ao conectar com gateway: " + String(err) });
  }

  const text = await resp.text();
  if (!resp.ok) {
    return jsonResponse(resp.status, { success: false, error: text || "Erro ao criar cobrança PIX" });
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  const pixCode = data.qr_code || data.pix_copy_paste || null;
  const transactionId = data.id || null;

  try {
    const supabase = getSupabase();
    await supabase.from("transactions").insert({
      transaction_id: transactionId,
      amount: amountNum,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_cpf: customerCpf,
      customer_phone: customerPhone,
      status: "PENDING",
      brcode: pixCode,
    });
  } catch (_) {}

  return jsonResponse(200, {
    success: true,
    pixCode,
    pix_code: pixCode,
    brcode: pixCode,
    payload: pixCode,
    transaction_id: transactionId,
    transactionId,
    deposit_id: transactionId,
    status: data.status || "PENDING",
  });
};
