const CPF_API_BASE = "https://api.amnesiatecnologia.rocks/";

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

function extractCpfData(payload) {
  const root = payload || {};
  const base =
    root.DADOS ||
    root.dados ||
    root.data ||
    root.DadosBasicos ||
    root.dadosBasicos ||
    root.dados_basicos ||
    root;
  const nome = base.nome || base.name || "";
  const nomeMae = base.nome_mae || base.nomeMae || base.mae || "";
  const dataNasc = base.data_nascimento || base.dataNascimento || base.nascimento || "";
  const cpf = base.cpf || base.documento || base.document || "";
  return {
    cpf,
    nome,
    nome_mae: nomeMae,
    data_nascimento: dataNasc,
    sexo: base.sexo || "",
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

  const cpfRaw = event.queryStringParameters?.cpf || "";
  const cpf = cpfRaw.replace(/\D/g, "").slice(0, 11);
  if (!cpf) {
    return jsonResponse(400, { status: 400, statusMsg: "Informe o CPF" });
  }

  const token = process.env.CPF_API_TOKEN;
  if (!token) {
    return jsonResponse(500, { status: 500, statusMsg: "Configure CPF_API_TOKEN nas variaveis do Netlify" });
  }
  const apiUrl = `${CPF_API_BASE}?token=${encodeURIComponent(token)}&cpf=${cpf}`;

  let apiResp;
  let text = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      apiResp = await fetch(apiUrl, {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: controller.signal,
      });
      text = await apiResp.text();
      if (apiResp.ok) break;
    } catch (error) {
      if (attempt === 3) {
        return jsonResponse(502, { status: 502, statusMsg: "Falha ao consultar CPF", details: String(error) });
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!apiResp || !apiResp.ok) {
    return jsonResponse(apiResp.status, data);
  }

  const dados = extractCpfData(data);
  return jsonResponse(200, { DADOS: dados });
};
