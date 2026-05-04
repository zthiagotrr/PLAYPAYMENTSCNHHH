const TREXPAY_STATUS_URL = "https://app.trexpayments.com.br/api/status";
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

  let id = event.queryStringParameters?.id;
  if (event.httpMethod === "POST") {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      id = body?.id || body?.paymentId || id;
    } catch {}
  }

  if (!id) {
    return jsonResponse(400, { success: false, error: "Informe o id" });
  }

  const statusResp = await fetch(TREXPAY_STATUS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      token,
      secret,
      idTransaction: id,
    }),
  });

  const text = await statusResp.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!statusResp.ok) {
    return jsonResponse(statusResp.status, { success: false, error: text || "Erro ao consultar pagamento" });
  }

  const status = data?.data?.status || data?.status || "PENDING";
  const paid = ["PAID_OUT", "COMPLETED", "PAID", "APPROVED"].includes(String(status).toUpperCase());

  try {
    const supabase = getSupabase();
    await supabase
      .from("transactions")
      .update({ status, paid_at: paid ? new Date().toISOString() : null })
      .eq("transaction_id", id);
  } catch (_) {}

  return jsonResponse(200, {
    success: true,
    id,
    status,
    paid,
    raw: data,
  });
};
