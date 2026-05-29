-- =============================================
-- FINCOPILOT AI — Supabase Schema
-- Execute este SQL no SQL Editor do seu projeto
-- =============================================

-- Tabela: estado do plano financeiro (uma única linha)
CREATE TABLE IF NOT EXISTS app_state (
  id BIGSERIAL PRIMARY KEY,
  income DECIMAL(10,2) NOT NULL DEFAULT 0,
  savings_percent INTEGER NOT NULL DEFAULT 0,
  fixed_expenses JSONB NOT NULL DEFAULT '[]',
  categories JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabela: transações financeiras
CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT PRIMARY KEY,
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  category TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabela: histórico de mensagens do chat
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Remove RLS (app pessoal, sem autenticação)
ALTER TABLE app_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
