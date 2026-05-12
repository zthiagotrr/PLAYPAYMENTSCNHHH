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

  let transactionId = event.queryStringParameters?.id || event.queryStringParameters?.transactionId;
  if (event.httpMethod === "POST") {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      transactionId = body?.transactionId || body?.id || transactionId;
    } catch {}
  }

  if (!transactionId) {
    return jsonResponse(400, { success: false, error: "Informe o transactionId" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let statusResp;
  let text = "";
  try {
    statusResp = await fetch(`${VENO_BASE}/v1/pix/${encodeURIComponent(transactionId)}/status`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    text = await statusResp.text();
  } catch (err) {
    clearTimeout(timeout);
    return jsonResponse(502, { success: false, error: "Falha ao consultar status: " + String(err) });
  } finally {
    clearTimeout(timeout);
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!statusResp.ok) {
    return jsonResponse(statusResp.status, { success: false, error: text || "Erro ao consultar pagamento" });
  }

  const paid = data.status === "paid";
  const status = paid ? "paid" : (data.status || "pending").toLowerCase();
  const paidAt = data.paid_at || null;

  try {
    const supabase = getSupabase();
    await supabase
      .from("transactions")
      .update({ status, paid_at: paid ? (paidAt || new Date().toISOString()) : null })
      .eq("transaction_id", transactionId);
  } catch (_) {}

  return jsonResponse(200, {
    success: true,
    transactionId,
    status,
    paid,
    paidAt,
  });
};
