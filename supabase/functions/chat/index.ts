// =============================================
// FINCOPILOT AI — Edge Function "chat"
// Proxy seguro para a API da DeepSeek.
// A chave DEEPSEEK_API_KEY fica como segredo no Supabase
// e NUNCA é exposta ao navegador.
//
// Deploy:
//   supabase secrets set DEEPSEEK_API_KEY=sk-...
//   supabase functions deploy chat --no-verify-jwt
// =============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Método não permitido. Use POST." }, 405);
  }

  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) {
    return json(
      { error: "DEEPSEEK_API_KEY não configurada no servidor." },
      500,
    );
  }

  let payload: { messages?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Corpo da requisição inválido (JSON esperado)." }, 400);
  }

  const messages = payload.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "Campo 'messages' ausente ou vazio." }, 400);
  }

  try {
    const upstream = await fetch(
      "https://api.deepseek.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages,
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      return json(
        { error: `DeepSeek respondeu HTTP ${upstream.status}`, detail },
        502,
      );
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return json({ content });
  } catch (e) {
    return json(
      { error: "Falha ao contatar a DeepSeek.", detail: String(e) },
      502,
    );
  }
});
