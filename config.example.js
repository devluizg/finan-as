/*
  =========================================
  CONFIGURAÇÃO DE CHAVES - FINCOPILOT AI
  =========================================

  Estas chaves do Supabase (URL + anon) são PÚBLICAS por design e podem ser
  versionadas no Git. A chave da IA (DeepSeek) NÃO vai aqui — ela fica como
  segredo na Edge Function do Supabase:

      supabase secrets set DEEPSEEK_API_KEY=sk-...
      supabase functions deploy chat --no-verify-jwt

  Para configurar: copie este arquivo para 'config.js' e preencha com os dados
  do seu projeto Supabase.
*/

// Supabase: https://supabase.com > Settings > API > Project URL + anon public key
window.SUPABASE_URL = "https://seu-projeto.supabase.co";
window.SUPABASE_ANON_KEY = "eyJ...";
