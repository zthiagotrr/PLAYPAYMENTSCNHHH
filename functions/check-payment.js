const { getSupabase } = require("./lib/supabase");

const PLAY_BASE = "https://api.playpayments.com.br/v1";

let cachedToken = null;
let tokenExpiry = 0;

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

async function getToken(publicKey, secretKey) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(`${PLAY_BASE}/auth`, {
      method: "POST",
      headers: {
        "X-Public-Key": publicKey,
        "X-Secret-Key": secretKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Auth falhou (${resp.status}): ${text}`);
    const data = JSON.parse(text);
    const token = data.token || data.access_token || data.accessToken;
    if (!token) throw new Error("Token não encontrado na resposta de auth");
    cachedToken = token;
    tokenExpiry = Date.now() + 50 * 60 * 1000;
    return token;
  } finally {
    clearTimeout(timeout);
  }
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

  const publicKey = process.env.PLAY_PUBLIC_KEY;
  const secretKey = process.env.PLAY_SECRET_KEY;

  if (!publicKey || !secretKey) {
    return jsonResponse(500, {
      success: false,
      error: "Configure PLAY_PUBLIC_KEY e PLAY_SECRET_KEY nas variaveis de ambiente",
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

  let token;
  try {
    token = await getToken(publicKey, secretKey);
  } catch (err) {
    return jsonResponse(502, { success: false, error: "Falha na autenticação: " + String(err) });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let statusResp;
  let text = "";
  try {
    statusResp = await fetch(`${PLAY_BASE}/transactions/${encodeURIComponent(transactionId)}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
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

  const rawStatus = (data.status || "PENDING").toUpperCase();
  const paid =
    rawStatus === "PAID" || rawStatus === "COMPLETED" ||
    rawStatus === "APPROVED" || rawStatus === "APROVADO" ||
    rawStatus === "CONCLUIDO" || rawStatus === "SUCCESS";
  const status = paid ? "paid" : rawStatus.toLowerCase();
  const paidAt = data.paid_at || data.paidAt || data.updated_at || null;

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
