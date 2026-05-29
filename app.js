/* 
  =========================================
  FINCOPILOT AI — APPLICATION LOGIC
  Integrated NLP Engine & Web Speech API
  =========================================
*/

// --- State Management Object ---
const state = {
  income: 0,
  savingsPercent: 0,
  fixedExpenses: [],
  categories: {
    alimentacao: { name: "Alimentação", limit: 0, spent: 0 },
    lazer: { name: "Lazer", limit: 0, spent: 0 },
    transporte: { name: "Transporte", limit: 0, spent: 0 },
    outros: { name: "Outros", limit: 0, spent: 0 }
  },
  transactions: [],
  messages: [],
  voiceResponseEnabled: false,
  deepseekApiKey: ""
};

// --- Config and Constants ---
const STORAGE_KEY = "fincopilot_state_v1";
let supabase = null;
let syncTimer = null;

// Mapping category names to keys for robust NLP matching
const CATEGORY_MAP = {
  alimentacao: ["alimentacao", "comida", "supermercado", "mercado", "padaria", "janta", "jantar", "almoco", "restaurante", "comer", "feira", "lanche", "leite", "pao"],
  lazer: ["lazer", "festa", "cerveja", "bar", "cinema", "show", "viagem", "hobby", "hobbies", "balada", "restaurante caro", "shopping", "games", "jogo", "livro"],
  transporte: ["transporte", "uber", "taxi", "onibus", "metro", "gasolina", "combustivel", "pedagio", "estacionamento", "oficina"],
  outros: ["outros", "geral", "diversos", "farmacia", "saude", "roupa", "compras", "presente", "cortes"]
};

// --- Application Startup Init ---
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  loadState();
  checkMonthlyReset();
  registerSW();

  if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
    initSupabase();
    await syncFromSupabase();
  }

  initEventListeners();
  initSpeechRecognition();
  updateUI();

  if (state.messages.length === 0) {
    sendSofiaWelcomeMessage();
  } else {
    renderMessages();
  }
});

// --- Local Storage Hooks ---
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (supabase) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncToSupabase, 500);
  }
}

function loadState() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (data) {
    try {
      const parsed = JSON.parse(data);
      Object.assign(state, parsed);
    } catch (e) {
      console.error("Erro ao carregar o estado persistido:", e);
    }
  }

  if (window.DEEPSEEK_API_KEY) {
    state.deepseekApiKey = window.DEEPSEEK_API_KEY;
    console.log("🔑 DeepSeek key carregada do config.js");
  } else {
    console.log("⚠️ Nenhuma chave DeepSeek no config.js");
  }
  updateAIBadge();
}

function updateAIBadge() {
  const badge = document.getElementById("aiModeBadge");
  if (!badge) return;
  if (state.deepseekApiKey && state.deepseekApiKey.trim() !== "") {
    badge.textContent = "DeepSeek";
    badge.className = "ai-badge deepseek";
  } else {
    badge.textContent = "Local";
    badge.className = "ai-badge local";
  }
}

// --- SUPABASE CLOUD SYNC ---

function initSupabase() {
  if (typeof createClient !== "function") {
    console.warn("⚠️ Supabase JS não carregado");
    return;
  }
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.warn("⚠️ SUPABASE_URL ou SUPABASE_ANON_KEY não configurados em config.js");
    return;
  }
  try {
    supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    console.log("☁️ Supabase conectado:", window.SUPABASE_URL);
  } catch (e) {
    console.warn("⚠️ Erro ao conectar Supabase:", e.message);
  }
}

async function syncFromSupabase() {
  if (!supabase) return;
  try {
    const { data: sData } = await supabase
      .from("app_state").select("*").limit(1).maybeSingle();
    if (sData && sData.income > 0) {
      state.income = Number(sData.income) || 0;
      state.savingsPercent = sData.savings_percent || 0;
      state.fixedExpenses = Array.isArray(sData.fixed_expenses) ? sData.fixed_expenses : [];
      if (sData.categories && typeof sData.categories === "object") {
        for (const key of Object.keys(state.categories)) {
          if (sData.categories[key]) {
            state.categories[key].limit = Number(sData.categories[key].limit) || 0;
            state.categories[key].spent = Number(sData.categories[key].spent) || 0;
          }
        }
      }
    }

    const { data: txs } = await supabase
      .from("transactions").select("*").order("id", { ascending: false }).limit(500);
    if (txs && txs.length > 0) {
      state.transactions = txs;
    }

    const { data: msgs } = await supabase
      .from("messages").select("*").order("created_at", { ascending: false }).limit(100);
    if (msgs && msgs.length > 0) {
      state.messages = msgs.reverse();
    }

    saveState();
    console.log("☁️ Dados carregados do Supabase");
  } catch (e) {
    console.warn("⚠️ Erro ao carregar do Supabase (usando localStorage):", e.message);
  }
}

async function syncToSupabase() {
  if (!supabase) return;
  try {
    const record = {
      income: state.income,
      savings_percent: state.savingsPercent,
      fixed_expenses: state.fixedExpenses,
      categories: state.categories
    };
    const { data: existing } = await supabase
      .from("app_state").select("id").limit(1).maybeSingle();
    if (existing) {
      await supabase.from("app_state").update(record).eq("id", existing.id);
    } else {
      await supabase.from("app_state").insert(record);
    }

    if (state.transactions.length > 0) {
      await supabase.from("transactions").upsert(state.transactions, { onConflict: "id" });
    }
    if (state.messages.length > 0) {
      await supabase.from("messages").upsert(state.messages, { onConflict: "id" });
    }
  } catch (e) {
    console.warn("⚠️ Erro ao sincronizar com Supabase:", e.message);
  }
}

// --- Seed Sandbox Mock Data ---
function seedMockData() {
  state.income = 5500;
  state.savingsPercent = 15;
  state.fixedExpenses = [
    { name: "Aluguel & Condomínio", amount: 1600 },
    { name: "Contas de Consumo", amount: 450 },
    { name: "Assinaturas & Streamings", amount: 150 }
  ];
  state.categories.alimentacao.limit = 1000;
  state.categories.alimentacao.spent = 480;
  
  state.categories.lazer.limit = 600;
  state.categories.lazer.spent = 210;
  
  state.categories.transporte.limit = 400;
  state.categories.transporte.spent = 150;
  
  state.categories.outros.limit = 300;
  state.categories.outros.spent = 85;

  state.transactions = [
    { id: 1, description: "Supermercado Carrefour", amount: 320, category: "alimentacao", date: getMockDateString(-5) },
    { id: 2, description: "Combustível Posto Ipiranga", amount: 150, category: "transporte", date: getMockDateString(-4) },
    { id: 3, description: "Ingressos de Cinema", amount: 60, category: "lazer", date: getMockDateString(-3) },
    { id: 4, description: "Hambúrguer Gourmet + Cerveja", amount: 150, category: "lazer", date: getMockDateString(-2) },
    { id: 5, description: "Padaria e Café", amount: 160, category: "alimentacao", date: getMockDateString(-1) },
    { id: 6, description: "Remédios Farmácia", amount: 85, category: "outros", date: getMockDateString(0) }
  ];
}

function getMockDateString(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() + daysAgo);
  return date.toLocaleDateString("pt-BR") + " " + date.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
}

// --- Send Messages Helper ---
function addMessage(sender, text) {
  const msg = {
    id: Date.now() + Math.random().toString(36).substr(2, 5),
    sender: sender,
    text: text,
    timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  };
  state.messages.push(msg);
  saveState();
  renderMessages();
  
  // If voice responses are enabled and message is from Sofia, speak it out loud
  if (sender === "ai" && state.voiceResponseEnabled) {
    speakText(text);
  }
}

function sendSofiaWelcomeMessage() {
  if (state.income === 0) {
    const greeting = `Olá! Eu sou a **Sofia AI**, sua copiloto financeira pessoal. 🚀
    
Percebi que você ainda não tem um plano de gastos configurado. Não se preocupe, **vamos montar seu plano juntos conversando!** É muito mais prático e humano do que preencher formulários chatos.

Para começarmos a dar vida aos seus gráficos de margem, me diga por texto ou clicando no microfone 🎙️:
👉 **Qual é a sua renda líquida mensal** e **qual porcentagem dela você gostaria de guardar para investir** (ex: 15%)?`;
    addMessage("ai", greeting);
  } else {
    const greeting = `Olá! Eu sou a **Sofia AI**, seu copiloto financeiro proativo. 🚀

Em vez de apenas registrar o que já gastou, meu trabalho é te guiar **em tempo real**, garantindo que você gaste dentro de suas margens seguras.

**Como posso te ajudar agora?**
*   Diga que está no supermercado e pergunte quanto pode gastar: *"Tô no supermercado, posso gastar R$ 80?"*
*   Registre gastos de forma prática: *"Gastei R$ 45 com Uber"* ou *"Comi uma pizza no lazer por 60"*
*   Verifique compras passadas: *"Eu já comprei leite este mês?"*
*   Peça um relatório de ritmo: *"Como está meu desempenho?"*

*Dica: Você pode clicar no ícone do microfone para falar comigo por voz enquanto está na rua!* 🎙️`;
    addMessage("ai", greeting);
  }
}

// --- Render Messages UI ---
function renderMessages() {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  container.innerHTML = "";
  state.messages.forEach(msg => {
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrapper ${msg.sender}`;
    
    const senderSpan = document.createElement("span");
    senderSpan.className = "message-sender";
    senderSpan.textContent = msg.sender === "ai" ? "Sofia AI" : "Você";
    
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    // Convert basic markdown tags (** and *) to simple HTML tags safely
    bubble.innerHTML = parseMarkdown(msg.text);
    
    const timeSpan = document.createElement("span");
    timeSpan.className = "message-time";
    timeSpan.textContent = msg.timestamp;
    
    wrapper.appendChild(senderSpan);
    wrapper.appendChild(bubble);
    wrapper.appendChild(timeSpan);
    container.appendChild(wrapper);
  });
  
  // Auto-scroll to bottom of chat
  container.scrollTop = container.scrollHeight;
}

// Helper to render basic bold and list markdown safely
function parseMarkdown(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // Bold: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  
  // Bullets: * text
  const lines = html.split("\n");
  let inList = false;
  let resultLines = [];
  
  lines.forEach(line => {
    if (line.trim().startsWith("* ")) {
      if (!inList) {
        resultLines.push("<ul>");
        inList = true;
      }
      resultLines.push(`<li>${line.trim().substring(2)}</li>`);
    } else {
      if (inList) {
        resultLines.push("</ul>");
        inList = false;
      }
      resultLines.push(`<p>${line}</p>`);
    }
  });
  
  if (inList) {
    resultLines.push("</ul>");
  }
  
  return resultLines.join("");
}

// --- Update Dashboard Values & SVG Progress ---
function updateUI() {
  // 1. Calculate Totals
  const totalFixed = state.fixedExpenses.reduce((sum, item) => sum + item.amount, 0);
  const targetSavings = (state.income * state.savingsPercent) / 100;
  
  const totalFlexLimit = Object.values(state.categories).reduce((sum, cat) => sum + cat.limit, 0);
  const totalFlexSpent = Object.values(state.categories).reduce((sum, cat) => sum + cat.spent, 0);
  const totalFlexRemaining = Math.max(0, totalFlexLimit - totalFlexSpent);

  // Update Core Card
  document.getElementById("remainingTotalFlex").textContent = formatCurrency(totalFlexRemaining);
  document.getElementById("statMonthlyIncome").textContent = formatCurrency(state.income);
  document.getElementById("statFixedExpenses").textContent = formatCurrency(totalFixed);
  
  // Calculate exact savings rate dynamically
  document.getElementById("statSavingsRate").textContent = `${state.savingsPercent}%`;

  // 2. Orçamento Health Calculation
  const healthPercent = totalFlexLimit > 0 ? (totalFlexRemaining / totalFlexLimit) * 100 : 0;
  const healthBar = document.getElementById("healthBarFill");
  const healthLabel = document.getElementById("healthLabel");
  const healthPulse = document.getElementById("healthPulse");
  const healthPctText = document.getElementById("healthPercentageText");

  healthBar.style.width = `${healthPercent}%`;
  healthPctText.textContent = `${Math.round(healthPercent)}% livre`;

  // Color logic for overall health bar and status indicators
  if (healthPercent >= 60) {
    healthLabel.textContent = "Excelente";
    healthLabel.style.color = "var(--emerald)";
    healthBar.style.background = "linear-gradient(to right, var(--primary), var(--emerald))";
    healthPulse.className = "pulse-dot"; // emerald default
  } else if (healthPercent >= 30) {
    healthLabel.textContent = "Alerta Moderado";
    healthLabel.style.color = "var(--amber)";
    healthBar.style.background = "linear-gradient(to right, var(--primary), var(--amber))";
    healthPulse.className = "pulse-dot warning";
  } else {
    healthLabel.textContent = "Margem Crítica";
    healthLabel.style.color = "var(--rose)";
    healthBar.style.background = "linear-gradient(to right, var(--rose), #7f1d1d)";
    healthPulse.className = "pulse-dot danger";
  }

  // 3. Render Categories Rings and details
  Object.keys(state.categories).forEach(key => {
    const cat = state.categories[key];
    const card = document.getElementById(`cat-${key}`);
    const ring = document.getElementById(`ring-${key}`);
    const pctText = document.getElementById(`pct-${key}`);
    const marginText = document.getElementById(`margin-${key}`);
    const limitText = document.getElementById(`limit-${key}`);
    
    if (!card || !ring || !pctText || !marginText || !limitText) return;

    const remaining = Math.max(0, cat.limit - cat.spent);
    const spentPercent = cat.limit > 0 ? (cat.spent / cat.limit) * 100 : 0;
    const remainingPercent = Math.max(0, 100 - spentPercent);

    // Update Text
    pctText.textContent = `${Math.round(remainingPercent)}%`;
    marginText.textContent = formatCurrency(remaining);
    limitText.textContent = `Limite: ${formatCurrency(cat.limit)}`;

    // Update Progress Ring SVG
    const radius = 40;
    const circumference = 2 * Math.PI * radius; // 251.2
    const strokeOffset = circumference - (remainingPercent / 100) * circumference;
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${strokeOffset}`;

    // Category safety classes
    card.classList.remove("safe", "warning", "danger");
    const tag = card.querySelector(".category-tag");
    
    if (remainingPercent >= 40) {
      card.classList.add("safe");
      if (tag) tag.textContent = "Seguro";
    } else if (remainingPercent >= 15) {
      card.classList.add("warning");
      if (tag) tag.textContent = "Atenção";
    } else {
      card.classList.add("danger");
      if (tag) {
        tag.textContent = remaining === 0 ? "Esgotado" : "Perigo";
      }
    }
  });

  // 4. Render Transaction List
  renderTransactions();
}

function formatCurrency(value) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// --- Render Recent Transactions List ---
function renderTransactions() {
  const container = document.getElementById("transactionList");
  if (!container) return;

  if (state.transactions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="smile" style="width: 1.5rem; height: 1.5rem;"></i>
        <p>Nenhuma compra registrada ainda. Use o chat para começar a conversar!</p>
      </div>`;
    if (typeof lucide !== "undefined") lucide.createIcons();
    return;
  }

  container.innerHTML = "";
  // Show in reverse chronological order
  [...state.transactions].reverse().forEach(tx => {
    const item = document.createElement("div");
    item.className = "transaction-item";

    let color = "var(--primary)";
    if (tx.category === "alimentacao") color = "var(--emerald)";
    if (tx.category === "lazer") color = "var(--amber)";
    if (tx.category === "transporte") color = "rgba(99, 102, 241, 0.8)";
    if (tx.category === "outros") color = "rgba(163, 116, 255, 0.8)";

    item.innerHTML = `
      <div class="tx-info">
        <div class="tx-category-indicator" style="background-color: ${color};"></div>
        <div>
          <div class="tx-desc">${tx.description}</div>
          <div class="tx-meta">${state.categories[tx.category]?.name || "Outros"} • ${tx.date}</div>
        </div>
      </div>
      <div class="tx-amount">- ${formatCurrency(tx.amount)}</div>
    `;
    container.appendChild(item);
  });
}

// --- SETUP WIZARD & MODAL CONTROLLERS ---
function openSetupModal(isFirstTime = false) {
  const modal = document.getElementById("setupModal");
  if (!modal) return;

  // Initialize Input Values with State
  document.getElementById("incomeInput").value = state.income || "";
  document.getElementById("savingsPercentInput").value = state.savingsPercent || "";
  document.getElementById("limitAlimentacaoInput").value = state.categories.alimentacao.limit || "";
  document.getElementById("limitLazerInput").value = state.categories.lazer.limit || "";
  document.getElementById("limitTransporteInput").value = state.categories.transporte.limit || "";
  document.getElementById("limitOutrosInput").value = state.categories.outros.limit || "";
  document.getElementById("deepseekApiKeyInput").value = state.deepseekApiKey || "";

  // Render Fixed Expenses rows
  renderFixedExpensesRows();
  updateSuggestedFlexBudget();

  modal.classList.add("active");

  if (isFirstTime) {
    // Inject a helpful starter advice from Sofia in the chat background
    setTimeout(() => {
      if (state.messages.length === 0) {
        addMessage("ai", `Olá! Seja muito bem-vindo ao seu novo **FinCopilot AI**. 🌟

Como seu workspace está vazio, eu tomei a liberdade de carregar um **plano padrão simulado** para que você veja como tudo funciona.

Abri a gaveta de configurações para que você possa personalizar seu orçamento real agora. Se preferir apenas testar e brincar primeiro, clique em **Cancelar** para usar o plano simulado!`);
      }
    }, 500);
  }
}

function closeSetupModal() {
  const modal = document.getElementById("setupModal");
  if (modal) modal.classList.remove("active");
}

function renderFixedExpensesRows() {
  const container = document.getElementById("fixedExpensesContainer");
  if (!container) return;

  container.innerHTML = "";
  if (state.fixedExpenses.length === 0) {
    container.innerHTML = `<p style="font-size: 0.75rem; color: var(--text-muted); text-align: center; padding: 0.5rem 0;">Nenhum compromisso fixo cadastrado ainda.</p>`;
  }

  state.fixedExpenses.forEach((exp, idx) => {
    const row = document.createElement("div");
    row.className = "dynamic-row";
    row.innerHTML = `
      <input type="text" class="form-input exp-name-input" placeholder="ex: Aluguel" value="${exp.name}" style="flex: 2;" required>
      <input type="number" class="form-input exp-amount-input" placeholder="ex: 1500" value="${exp.amount}" style="flex: 1;" required>
      <button type="button" class="btn-remove-row" onclick="removeFixedExpenseRow(${idx})">
        <i data-lucide="trash-2" style="width: 0.95rem; height: 0.95rem;"></i>
      </button>
    `;
    container.appendChild(row);
  });

  if (typeof lucide !== "undefined") lucide.createIcons();
}

window.removeFixedExpenseRow = function(index) {
  state.fixedExpenses.splice(index, 1);
  renderFixedExpensesRows();
  updateSuggestedFlexBudget();
};

function addFixedExpenseRow() {
  state.fixedExpenses.push({ name: "", amount: "" });
  renderFixedExpensesRows();
}

// Calculate total leftover balance that can be distributed to flexible categories
function updateSuggestedFlexBudget() {
  const income = parseFloat(document.getElementById("incomeInput").value) || 0;
  const savingsPct = parseFloat(document.getElementById("savingsPercentInput").value) || 0;
  
  // Read dynamic inputs from DOM
  const nameInputs = document.querySelectorAll(".exp-name-input");
  const amountInputs = document.querySelectorAll(".exp-amount-input");
  let fixedSum = 0;
  
  amountInputs.forEach(input => {
    fixedSum += parseFloat(input.value) || 0;
  });

  const targetSavings = (income * savingsPct) / 100;
  const leftover = Math.max(0, income - fixedSum - targetSavings);

  document.getElementById("suggestedFlexText").textContent = formatCurrency(leftover);
}

// --- Save Setup Wizard Values ---
function saveSetupWizard() {
  const incomeVal = parseFloat(document.getElementById("incomeInput").value);
  const savingsPctVal = parseFloat(document.getElementById("savingsPercentInput").value);
  
  if (isNaN(incomeVal) || isNaN(savingsPctVal)) {
    alert("Por favor, preencha a Receita Mensal e a Taxa de Reserva!");
    return;
  }

  // Parse Fixed Expenses
  const rows = document.querySelectorAll(".dynamic-row");
  const parsedExpenses = [];
  
  rows.forEach(row => {
    const name = row.querySelector(".exp-name-input").value.trim();
    const amount = parseFloat(row.querySelector(".exp-amount-input").value);
    if (name && !isNaN(amount)) {
      parsedExpenses.push({ name, amount });
    }
  });

  // Assign Core Data
  state.income = incomeVal;
  state.savingsPercent = savingsPctVal;
  state.fixedExpenses = parsedExpenses;
  state.deepseekApiKey = document.getElementById("deepseekApiKeyInput").value.trim();
  updateAIBadge();

  // Set limits
  state.categories.alimentacao.limit = parseFloat(document.getElementById("limitAlimentacaoInput").value) || 0;
  state.categories.lazer.limit = parseFloat(document.getElementById("limitLazerInput").value) || 0;
  state.categories.transporte.limit = parseFloat(document.getElementById("limitTransporteInput").value) || 0;
  state.categories.outros.limit = parseFloat(document.getElementById("limitOutrosInput").value) || 0;

  // Adjust Spent defaults if larger than new limit (prevent bugs)
  Object.keys(state.categories).forEach(key => {
    const cat = state.categories[key];
    if (cat.spent > cat.limit) {
      // Scale transactions or cap it
      cat.spent = Math.min(cat.spent, cat.limit);
    }
  });

  saveState();
  updateUI();
  closeSetupModal();

  addMessage("ai", `Configuração ativada com sucesso! 🎯

O seu novo plano foi desenhado:
*   Sua renda total: **${formatCurrency(state.income)}**
*   Compromissos fixos: **${formatCurrency(state.fixedExpenses.reduce((s, e) => s + e.amount, 0))}**
*   Reserva de investimento segura (${state.savingsPercent}%): **${formatCurrency((state.income * state.savingsPercent) / 100)}**
*   Limite flexível distribuído: **${formatCurrency(Object.values(state.categories).reduce((s, c) => s + c.limit, 0))}**

Estou de prontidão! Pode me consultar a qualquer momento.`);
}

// --- INTERACTIVE EVENT HANDLERS ---
function initEventListeners() {
  // Setup Modal Triggers
  document.getElementById("editPlanBtn").addEventListener("click", () => openSetupModal(false));
  document.getElementById("closeModalBtn").addEventListener("click", closeSetupModal);
  document.getElementById("cancelSetupBtn").addEventListener("click", closeSetupModal);
  document.getElementById("saveSetupBtn").addEventListener("click", saveSetupWizard);
  document.getElementById("btnAddExpenseRow").addEventListener("click", addFixedExpenseRow);

  // Keep suggested flex balance calculations fresh in setup
  document.getElementById("incomeInput").addEventListener("input", updateSuggestedFlexBudget);
  document.getElementById("savingsPercentInput").addEventListener("input", updateSuggestedFlexBudget);
  document.body.addEventListener("input", (e) => {
    if (e.target.classList.contains("exp-amount-input")) {
      updateSuggestedFlexBudget();
    }
  });

  // Chat Submission
  const form = document.getElementById("chatForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    handleChatSubmit();
  });

  // Clear data trigger
  document.getElementById("clearTransactionsBtn").addEventListener("click", () => {
    const fullReset = confirm("Deseja fazer um RESET TOTAL?\n\nClique em [OK] para apagar TUDO (incluindo plano, despesas e chave API) para testar a criação conversacional com a Sofia.\n\nClique em [Cancelar] para apenas limpar as mensagens e manter seu plano atual.");
    if (fullReset) {
      localStorage.removeItem(STORAGE_KEY);
      state.income = 0;
      state.savingsPercent = 0;
      state.fixedExpenses = [];
      Object.keys(state.categories).forEach(k => {
        state.categories[k].limit = 0;
        state.categories[k].spent = 0;
      });
      state.transactions = [];
      state.messages = [];
      state.deepseekApiKey = "";
      if (window.DEEPSEEK_API_KEY) {
        state.deepseekApiKey = window.DEEPSEEK_API_KEY;
      }
      updateAIBadge();
      
      saveState();
      updateUI();
      sendSofiaWelcomeMessage();
    } else {
      if (confirm("Deseja limpar apenas o histórico de mensagens do chat e reiniciar os gastos para R$ 0,00?")) {
        state.transactions = [];
        state.messages = [];
        Object.keys(state.categories).forEach(k => state.categories[k].spent = 0);
        
        saveState();
        updateUI();
        sendSofiaWelcomeMessage();
      }
    }
  });

  // Chip Suggestions Triggers
  const suggestionsBox = document.getElementById("suggestionChips");
  suggestionsBox.addEventListener("click", (e) => {
    if (e.target.classList.contains("suggestion-chip")) {
      const query = e.target.textContent;
      addMessage("user", query);
      processSofiaAI(query);
    }
  });

  // Toggle Voice Response Synthesis
  const voiceToggleBtn = document.getElementById("toggleVoiceResponseBtn");
  voiceToggleBtn.addEventListener("click", () => {
    state.voiceResponseEnabled = !state.voiceResponseEnabled;
    saveState();

    if (state.voiceResponseEnabled) {
      voiceToggleBtn.innerHTML = `<i data-lucide="volume-2" style="width: 0.95rem; height: 0.95rem; color: var(--emerald);"></i> Voz Ativada`;
      // Speak a small test
      speakText("Voz ativada! Sofia falará com você.");
    } else {
      voiceToggleBtn.innerHTML = `<i data-lucide="volume-x" style="width: 0.95rem; height: 0.95rem;"></i> Voz Desativada`;
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    }
    if (typeof lucide !== "undefined") lucide.createIcons();
  });

  initTabNavigation();
  initCameraOCR();
}

function handleChatSubmit() {
  const input = document.getElementById("chatInput");
  const query = input.value.trim();
  if (!query) return;

  input.value = "";
  addMessage("user", query);
  
  // Typing state indicator simulation for elite feel
  setTimeout(() => {
    processSofiaAI(query);
  }, 350);
}

// --- SPEECH RECOGNITION (DITADO DE VOZ) ---
let recognition = null;
let isRecording = false;

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById("voiceBtn");
  const input = document.getElementById("chatInput");

  if (!SpeechRecognition) {
    // Hide microphone or disable it if unsupported
    micBtn.style.opacity = "0.5";
    micBtn.title = "Comando de voz indisponível neste navegador.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "pt-BR";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
    input.placeholder = "Ouvindo... Fale sua dúvida financeira...";
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
    input.placeholder = "Converse com a Sofia... ex: 'Posso gastar 50 no mercado?'";
  };

  recognition.onerror = (e) => {
    console.error("Erro na captura de áudio:", e.error);
    isRecording = false;
    micBtn.classList.remove("recording");
    input.placeholder = "Converse com a Sofia...";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (transcript) {
      input.value = transcript;
      // Auto-submit after transcription for maximum hands-free simplicity!
      setTimeout(() => {
        handleChatSubmit();
      }, 500);
    }
  };

  micBtn.addEventListener("click", () => {
    if (isRecording) {
      recognition.stop();
    } else {
      recognition.start();
    }
  });
}

// --- VOCAL SYNTHESIS READOUT (SOFIA SPEAKS) ---
function speakText(text) {
  if (!window.speechSynthesis) return;

  // Clean Markdown markup from speak text
  let cleanText = text
    .replace(/\*\*/g, "") // remove bold
    .replace(/\*/g, "")  // remove list stars
    .replace(/R\$/gi, "Reais") // replace R$ with Reais for speech syntax
    .replace(/%+/g, " por cento");

  // Cancel any active speak
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = "pt-BR";
  utterance.rate = 1.05; // Slightly faster for natural flow

  // Find a nice native voice in Portuguese
  const voices = window.speechSynthesis.getVoices();
  const ptVoice = voices.find(v => v.lang.includes("pt-BR"));
  if (ptVoice) {
    utterance.voice = ptVoice;
  }

  window.speechSynthesis.speak(utterance);
}

// --- DEEPSEEK REAL AI CLIENT ---
async function processDeepSeekAI(query) {
  // 1. Cria um indicador visual de "Sofia digitando/pensando"
  const typingMessageId = "typing-" + Date.now();
  const container = document.getElementById("chatMessages");
  if (container) {
    const wrapper = document.createElement("div");
    wrapper.id = typingMessageId;
    wrapper.className = "message-wrapper ai";
    wrapper.innerHTML = `
      <span class="message-sender">Sofia AI</span>
      <div class="message-bubble" style="opacity: 0.75; display: flex; align-items: center; gap: 0.5rem;">
        <span class="pulse-dot" style="display:inline-block; animation: pulse 1s infinite;"></span>
         Sofia está pensando...
      </div>
    `;
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
  }

  // 2. Prepara o prompt do sistema com o estado financeiro atual do usuário
  const totalFlexLimit = Object.values(state.categories).reduce((sum, cat) => sum + cat.limit, 0);
  const totalFlexSpent = Object.values(state.categories).reduce((sum, cat) => sum + cat.spent, 0);
  const totalFlexRemaining = Math.max(0, totalFlexLimit - totalFlexSpent);

  const systemPrompt = `Você é a Sofia, copiloto financeiro proativo de extrema inteligência e simpatia.
Seu objetivo é ajudar o usuário a controlar suas finanças proativamente a partir do seu plano financeiro mensal.

O usuário tem o seguinte plano e estado atual:
- Renda Mensal Líquida: R$ ${state.income}
- Reserva Financeira de Investimento (${state.savingsPercent}%): R$ ${(state.income * state.savingsPercent) / 100}
- Despesas Fixas Cadastradas: ${JSON.stringify(state.fixedExpenses)}
- Limites e Gastos de Categorias Flexíveis:
  * Alimentação: Limite R$ ${state.categories.alimentacao.limit}, Já gasto R$ ${state.categories.alimentacao.spent} (Margem Restante: R$ ${state.categories.alimentacao.limit - state.categories.alimentacao.spent})
  * Lazer: Limite R$ ${state.categories.lazer.limit}, Já gasto R$ ${state.categories.lazer.spent} (Margem Restante: R$ ${state.categories.lazer.limit - state.categories.lazer.spent})
  * Transporte: Limite R$ ${state.categories.transporte.limit}, Já gasto R$ ${state.categories.transporte.spent} (Margem Restante: R$ ${state.categories.transporte.limit - state.categories.transporte.spent})
  * Outros: Limite R$ ${state.categories.outros.limit}, Já gasto R$ ${state.categories.outros.spent} (Margem Restante: R$ ${state.categories.outros.limit - state.categories.outros.spent})
- Margem Total Flexível Restante: R$ ${totalFlexRemaining}
- Histórico Recente de Transações: ${JSON.stringify(state.transactions.slice(-12))}

Data Atual do Sistema: ${new Date().toLocaleDateString("pt-BR")}. O mês tem ${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()} dias.

INSTRUÇÕES CRÍTICAS DE RESPOSTA (JSON MODE):
Você deve responder ESTRITAMENTE em formato JSON. O JSON deve conter três chaves:
1. "reply": A mensagem textual formatada em português brasileiro. Use markdown básico para destacar valores importantes em negrito (**R$ 150,00**), use emojis, e dê conselhos amigáveis e proativos. Seja divertida, encorajadora e perspicaz.
2. "transaction": Caso a mensagem represente o REGISTRO REAL de uma nova despesa (ex: "gastei 50 no mercado", "comprei leite por 8 reais", "paguei 30 de uber"), preencha este objeto. Caso contrário, null.
3. "setup": Caso o usuário esteja em fase de parametrização inicial (quando a Renda Mensal Líquida é R$ 0) ou atualizando parâmetros de seu plano (como renda, reserva, despesas fixas ou limites de categorias) por conversa, você deve retornar um objeto com os valores extraídos para preencher o site dinamicamente. Se não houver alteração de plano, passe null.
   O objeto "setup" deve ter a seguinte estrutura opcional (preencha apenas o que foi conversado ou atualizado):
   {
     "income": 5000.00, // número
     "savingsPercent": 15, // número de 0 a 100
     "fixedExpenses": [ // array de compromissos fixos informados
       { "name": "Aluguel", "amount": 1600.00 }
     ],
     "categories": { // limites das categorias informadas
       "alimentacao": 1000.00,
       "lazer": 600.00,
       "transporte": 400.00,
       "outros": 300.00
     }
   }

CONVERSA DE PARAMETRIZAÇÃO / ONBOARDING (MUITO IMPORTANTE):
Se o usuário ainda não tiver plano (Renda = R$ 0), conduza uma conversa passo a passo amigável. Não tente preencher tudo de uma vez se ele não informou.
Passo 1: Peça a Renda e a Poupança. Assim que ele disser (ex: "ganho 5000 e quero guardar 10%"), salve esses valores no "setup" e pergunte sobre as despesas fixas (ex: aluguel, condomínio, luz).
Passo 2: À medida que ele disser as despesas fixas, monte a lista em "fixedExpenses" e pergunte como ele quer dividir o saldo flexível restante nas 4 categorias (Alimentação, Lazer, Transporte e Outros). Se ele falar de apenas uma (ex: "quero 800 de limite para comida"), salve no "setup" de categorias e continue guiando as outras.
Passo 3: Assim que os limites forem definidos, finalize parabenizando e encerre o onboarding.

Exemplo de saída de onboarding (usuário disse que ganha 5000 e quer poupar 15%):
{
  "reply": "Excelente! Registrei sua **renda de R$ 5.000,00** e sua meta de **reserva de 15% (R$ 750,00)**. Agora me diga: você tem despesas fixas mensais recorrentes (como aluguel, condomínio ou luz)? Se sim, quais os valores?",
  "transaction": null,
  "setup": {
    "income": 5000.00,
    "savingsPercent": 15
  }
}`;

  // Prepara o histórico da conversa (últimas 8 mensagens)
  const apiMessages = [
    { role: "system", content: systemPrompt }
  ];

  state.messages.slice(-8).forEach(msg => {
    apiMessages.push({
      role: msg.sender === "ai" ? "assistant" : "user",
      content: msg.text
    });
  });

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.deepseekApiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: apiMessages,
        response_format: { type: "json_object" },
        temperature: 0.3
      })
    });

    // Remove o indicador visual de digitação
    const typingNode = document.getElementById(typingMessageId);
    if (typingNode) typingNode.remove();

    if (!response.ok) {
      throw new Error(`Servidor respondeu com código HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data.choices[0].message.content.trim();
    const result = cleanAndParseJSON(rawContent);

    // 1. Se houver atualizações de configuração/onboarding (setup) enviadas pela IA
    if (result.setup && typeof result.setup === "object") {
      const setup = result.setup;
      let hasChanges = false;

      if (setup.income !== undefined && !isNaN(parseFloat(setup.income))) {
        state.income = parseFloat(setup.income);
        hasChanges = true;
      }
      if (setup.savingsPercent !== undefined && !isNaN(parseFloat(setup.savingsPercent))) {
        state.savingsPercent = Math.min(100, Math.max(0, parseFloat(setup.savingsPercent)));
        hasChanges = true;
      }
      if (setup.fixedExpenses && Array.isArray(setup.fixedExpenses)) {
        state.fixedExpenses = setup.fixedExpenses.map(e => ({
          name: e.name || "Compromisso",
          amount: parseFloat(e.amount) || 0
        }));
        hasChanges = true;
      }
      if (setup.categories && typeof setup.categories === "object") {
        Object.keys(setup.categories).forEach(key => {
          if (state.categories[key] && !isNaN(parseFloat(setup.categories[key]))) {
            state.categories[key].limit = parseFloat(setup.categories[key]);
            hasChanges = true;
          }
        });
      }

      if (hasChanges) {
        saveState();
        updateUI();
      }
    }

    // 2. Se houver transação real para registrar, executa a ação no dashboard!
    if (result.transaction && typeof result.transaction === "object") {
      const tx = result.transaction;
      if (tx.amount && tx.category && state.categories[tx.category]) {
        const newTx = {
          id: Date.now(),
          description: tx.description || "Gasto via AI",
          amount: parseFloat(tx.amount),
          category: tx.category,
          date: new Date().toLocaleDateString("pt-BR") + " " + new Date().toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })
        };
        state.transactions.push(newTx);
        state.categories[tx.category].spent += parseFloat(tx.amount);
        saveState();
        updateUI();
      }
    }

    // Exibe a resposta final da Sofia
    addMessage("ai", result.reply || "Desculpe, obtive uma resposta vazia.");

  } catch (error) {
    console.error("DeepSeek API Error:", error);
    // Remove o indicador visual de digitação
    const typingNode = document.getElementById(typingMessageId);
    if (typingNode) typingNode.remove();

    // Fallback amigável de contingência para NLP Local
    addMessage("ai", `*Aviso: Tivemos uma falha ao conectar com o DeepSeek (${error.message}). Carregando processamento local de contingência...*`);
    setTimeout(() => {
      // Bypassa temporariamente a chave API para forçar execução local
      const tempKey = state.deepseekApiKey;
      state.deepseekApiKey = "";
      processSofiaAI(query);
      state.deepseekApiKey = tempKey;
    }, 800);
  }
}

// Limpa formatação de blocos markdown que modelos podem adicionar ao redor de JSONs
function cleanAndParseJSON(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON parse error:", e, cleaned);
    // Cria uma resposta amigável estruturada se quebrar
    return {
      reply: text,
      transaction: null
    };
  }
}

// --- SOFIA AI NLP DECISION ENGINE ---
function processSofiaAI(query) {
  if (state.deepseekApiKey && state.deepseekApiKey.trim() !== "") {
    console.log("🤖 Usando DeepSeek AI para:", query);
    processDeepSeekAI(query);
    return;
  }
  console.log("💻 Usando NLP local para:", query);

  const text = query.toLowerCase().trim();
  
  // Extract number helper (support formats like R$ 120, 120.00, 120, 120,50)
  const numbers = text.match(/\b\d+(?:[\.,]\d+)?\b/);
  const amount = numbers ? parseFloat(numbers[0].replace(",", ".")) : null;

  // --- PARSE DE ONBOARDING LOCAL DE CONTINGÊNCIA ---
  if (state.income === 0) {
    if (amount && (text.includes("ganho") || text.includes("renda") || text.includes("receita") || text.includes("líquida") || text.includes("salário") || text.includes("ganhar") || text.includes("sair das dívida") || text.includes("divida") || text.includes("quitar") || /^[\d\s.,]+$/.test(text.replace(/reais|r\$|mil|cento/gi, "").trim()))) {
      state.income = amount;

      const pctMatches = text.match(/(\d+)\s*%/);
      if (pctMatches) {
        state.savingsPercent = parseInt(pctMatches[1]);
      } else if (text.includes("divida") || text.includes("sair") || text.includes("quitar")) {
        state.savingsPercent = 30;
      } else {
        state.savingsPercent = 15;
      }

      saveState();
      updateUI();

      let extraMsg = "";
      if (text.includes("divida") || text.includes("quitar")) {
        extraMsg = `\n\n**💡 Como você mencionou dívidas**, já configurei uma taxa de reserva de **${state.savingsPercent}%** para começar a quitar. Depois podemos ajustar juntos!`;
      }

      const reply = `Excelente! Registrei sua renda mensal de **${formatCurrency(state.income)}** e sua taxa de reserva de **${state.savingsPercent}%** (${formatCurrency((state.income * state.savingsPercent) / 100)}).${extraMsg}

Agora, me conte: quais são as suas **despesas fixas** recorrentes (como Aluguel, Luz, Condomínio) e os seus valores? Exemplo: *"aluguel de 1200 e internet de 100"* ou *"pago 1500 de aluguel"*.`;
      addMessage("ai", reply);
      return;
    }
    
    // Se informarem uma despesa fixa (como aluguel, condomínio, luz)
    if (amount && (text.includes("aluguel") || text.includes("condominio") || text.includes("luz") || text.includes("internet") || text.includes("água") || text.includes("academia") || text.includes("celular"))) {
      let expenseName = "Compromisso Fixo";
      if (text.includes("aluguel")) expenseName = "Aluguel";
      else if (text.includes("condominio") || text.includes("condomínio")) expenseName = "Condomínio";
      else if (text.includes("luz") || text.includes("energia")) expenseName = "Luz / Energia";
      else if (text.includes("internet")) expenseName = "Internet";
      else if (text.includes("academia")) expenseName = "Academia";
      else if (text.includes("celular") || text.includes("telefone")) expenseName = "Plano Celular";
      else if (text.includes("água") || text.includes("agua")) expenseName = "Água";
      
      state.fixedExpenses.push({ name: expenseName, amount: amount });
      saveState();
      updateUI();
      
      const reply = `Adicionei o compromisso fixo **${expenseName}** no valor de **${formatCurrency(amount)}** ao seu plano! ✅
      
Você tem mais algum compromisso fixo a registrar? Se não, diga: *"pronto, vamos definir os limites flexíveis"* e Sofia dividirá o saldo flexível restante para as suas categorias!`;
      addMessage("ai", reply);
      return;
    }
    
    // Finalização e divisão automática dos limites flexíveis
    if (text.includes("pronto") || text.includes("chega") || text.includes("limites") || text.includes("flexíveis") || text.includes("dividir")) {
      const totalFixed = state.fixedExpenses.reduce((sum, item) => sum + item.amount, 0);
      const targetSavings = (state.income * state.savingsPercent) / 100;
      const leftover = Math.max(0, state.income - totalFixed - targetSavings);
      
      const share = Math.round((leftover / 4) * 100) / 100;
      state.categories.alimentacao.limit = share;
      state.categories.lazer.limit = share;
      state.categories.transporte.limit = share;
      state.categories.outros.limit = share;
      
      saveState();
      updateUI();
      
      const reply = `Perfeito! Dividi o seu saldo flexível restante de **${formatCurrency(leftover)}** igualmente entre as 4 categorias principais:
*   🍔 Alimentação: **${formatCurrency(share)}**
*   🍺 Lazer: **${formatCurrency(share)}**
*   🚗 Transporte: **${formatCurrency(share)}**
*   💳 Outros: **${formatCurrency(share)}**

O seu plano financeiro está **totalmente configurado e ativo**! 🚀
Agora você já pode me perguntar se pode gastar na rua ou registrar seus custos do dia a dia!`;
      addMessage("ai", reply);
      return;
    }
    
    // Mensagem de instrução no onboarding local
    const promptGuide = `Oi! Percebi que você está sem plano ativo. Para começarmos localmente, me informe sua renda e a poupança desejada! 
    
Exemplo: *"Eu ganho 5500 e quero poupar 15%"*.`;
    addMessage("ai", promptGuide);
    return;
  }

  // Detect which category matches based on keywords in query
  let categoryKey = null;
  for (const catKey of Object.keys(CATEGORY_MAP)) {
    const keywords = CATEGORY_MAP[catKey];
    if (keywords.some(word => text.includes(word))) {
      categoryKey = catKey;
      break;
    }
  }

  // --- INTENT 1: Simulate Purchase / Can I buy? ---
  const isSimulationQuery = text.includes("posso gastar") || 
                            text.includes("posso comprar") || 
                            text.includes("simular") || 
                            text.includes("quanto posso gastar") || 
                            text.includes("margem");

  if (isSimulationQuery) {
    // If no category detected, but user just asks "quanto posso gastar?" or "qual minha margem?"
    if (!categoryKey && !amount) {
      const totalFlexRemaining = Object.values(state.categories).reduce((sum, cat) => sum + Math.max(0, cat.limit - cat.spent), 0);
      const advice = `Você tem **${formatCurrency(totalFlexRemaining)}** no total para despesas flexíveis este mês.

Aqui está suas margens ativas:
*   🍔 Alimentação: **${formatCurrency(state.categories.alimentacao.limit - state.categories.alimentacao.spent)}**
*   🍺 Lazer: **${formatCurrency(state.categories.lazer.limit - state.categories.lazer.spent)}**
*   🚗 Transporte: **${formatCurrency(state.categories.transporte.limit - state.categories.transporte.spent)}**
*   💳 Outros: **${formatCurrency(state.categories.outros.limit - state.categories.outros.spent)}**

Em qual delas você planeja gastar agora? 🔍`;
      addMessage("ai", advice);
      return;
    }

    if (categoryKey && !amount) {
      const cat = state.categories[categoryKey];
      const remaining = Math.max(0, cat.limit - cat.spent);
      const advice = `A sua margem em **${cat.name}** atualmente é de **${formatCurrency(remaining)}** (limite total de ${formatCurrency(cat.limit)}).
      
Se você quer planejar uma compra, me diga o valor! Exemplo: *"Posso gastar 50 em ${cat.name}?"*`;
      addMessage("ai", advice);
      return;
    }

    if (amount) {
      // Default to "outros" if no category is specified
      const activeKey = categoryKey || "outros";
      const cat = state.categories[activeKey];
      const remaining = Math.max(0, cat.limit - cat.spent);

      if (remaining >= amount) {
        const afterSpend = remaining - amount;
        const successSpeech = `Sim! **É totalmente seguro** gastar **${formatCurrency(amount)}** em **${cat.name}**. ✅

Sua margem atual é de ${formatCurrency(remaining)}. Com essa compra, sua margem residual será de **${formatCurrency(afterSpend)}**.

Deseja registrar essa despesa agora? É só dizer: *"Gastei ${amount} em ${cat.name}"*.`;
        addMessage("ai", successSpeech);
      } else {
        const deficit = amount - remaining;
        const warningSpeech = `⚠️ **Atenção!** Fazer essa compra de **${formatCurrency(amount)}** em **${cat.name}** vai exceder a sua margem em **${formatCurrency(deficit)}**.

Sua margem disponível nessa categoria é de apenas **${formatCurrency(remaining)}**.
Eu aconselho fortemente esperar o próximo ciclo, reajustar seus gastos ou pegar uma sobra de outra categoria se for urgente!`;
        addMessage("ai", warningSpeech);
      }
      return;
    }
  }

  // --- INTENT 2: Register Expense / I spent X ---
  const isRegisterQuery = text.includes("gastei") || 
                          text.includes("comprei") || 
                          text.includes("registra") || 
                          text.includes("paguei") || 
                          text.includes("adiciona");

  if (isRegisterQuery) {
    if (!amount) {
      addMessage("ai", "Entendi que você quer registrar um gasto, mas não consegui identificar o valor. Por favor, diga quanto gastou. Exemplo: *'gastei R$ 35'*.");
      return;
    }

    const activeKey = categoryKey || "outros";
    const cat = state.categories[activeKey];

    // Build description
    let desc = "Gasto Avulso";
    // Try to find a noun or details in query
    const cleanedTerms = text.replace(/gastei|comprei|registra|paguei|adiciona|reais|no|na|em|o|com|de|r\$/g, "").trim();
    const cleanDesc = cleanedTerms.replace(/\b\d+(?:[\.,]\d+)?\b/, "").trim();
    if (cleanDesc.length > 2) {
      desc = cleanDesc.charAt(0).toUpperCase() + cleanDesc.slice(1);
    } else {
      desc = `Compra em ${cat.name}`;
    }

    // Add transaction
    const newTx = {
      id: Date.now(),
      description: desc,
      amount: amount,
      category: activeKey,
      date: new Date().toLocaleDateString("pt-BR") + " " + new Date().toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })
    };

    state.transactions.push(newTx);
    cat.spent += amount;
    
    saveState();
    updateUI();

    const remaining = Math.max(0, cat.limit - cat.spent);
    const successMsg = `Perfeito! Registrei a despesa de **${formatCurrency(amount)}** em **${cat.name}** (descrição: *"${desc}"*). ✍️

Sua margem atualizada na categoria é **${formatCurrency(remaining)}**.`;
    addMessage("ai", successMsg);
    return;
  }

  // --- INTENT 3: Query Specific Item History (e.g. Milk/Leite) ---
  const isHistoryQuery = text.includes("comprei") && (text.includes("ja") || text.includes("leite") || text.includes("este mes"));
  if (isHistoryQuery || text.includes("leite") || text.includes("cafe")) {
    // Extract search word (e.g., "leite", "gasolina")
    let searchWord = "leite"; // default if they asked general
    if (text.includes("gasolina") || text.includes("uber")) {
      searchWord = text.includes("gasolina") ? "gasolina" : "uber";
    } else {
      // Find a noun
      const matches = text.match(/(?:comprei|leite|cafe|uber|cerveja|pao|jantar)/gi);
      if (matches && matches.length > 0) {
        searchWord = matches[matches.length - 1].toLowerCase();
      }
    }

    const matches = state.transactions.filter(t => t.description.toLowerCase().includes(searchWord));

    if (matches.length > 0) {
      const sum = matches.reduce((s, t) => s + t.amount, 0);
      let reply = `Sim! Encontrei **${matches.length}** registro(s) correspondente(s) a **"${searchWord}"** este mês: \n`;
      matches.forEach(m => {
        reply += `*   **${formatCurrency(m.amount)}** em ${m.date} (*"${m.description}"*)\n`;
      });
      reply += `\nTotal gasto com isso: **${formatCurrency(sum)}**.`;
      addMessage("ai", reply);
    } else {
      addMessage("ai", `Fiz uma busca rápida e **não encontrei** nenhuma despesa relacionada a **"${searchWord}"** este mês no histórico. Você está com a margem livre para isso!`);
    }
    return;
  }

  // --- INTENT 4: Performance Report Pacing Check ---
  const isPerformanceQuery = text.includes("desempenho") || 
                              text.includes("resumo") || 
                              text.includes("relatorio") || 
                              text.includes("desempenho") || 
                              text.includes("ritmo") || 
                              text.includes("como estou");

  if (isPerformanceQuery) {
    const today = new Date();
    const day = today.getDate();
    const totalDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const monthProgressPercent = (day / totalDays) * 100;

    const totalLimit = Object.values(state.categories).reduce((sum, c) => sum + c.limit, 0);
    const totalSpent = Object.values(state.categories).reduce((sum, c) => sum + c.spent, 0);
    const spentPercent = totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0;

    let paceReview = "";
    if (spentPercent <= monthProgressPercent - 10) {
      paceReview = "🏆 **Excelente ritmo de gastos!** Você está consumindo suas margens de forma mais lenta do que o tempo decorrido do mês. Se continuar assim, sobrará uma ótima margem no fim do mês para suas reservas!";
    } else if (spentPercent <= monthProgressPercent + 10) {
      paceReview = "⚖️ **Ritmo equilibrado.** Seu ritmo de gastos está perfeitamente alinhado com o progresso dos dias do mês. Continue monitorando suas margens ativas para não ultrapassar.";
    } else {
      paceReview = "🚨 **Ritmo acelerado!** Você já consumiu **" + Math.round(spentPercent) + "%** das suas margens flexíveis, mas estamos apenas no dia **" + day + "** do mês (" + Math.round(monthProgressPercent) + "% decorrido). Sugiro dar uma segurada no Lazer e Outros para não ficar esgotado antes do tempo.";
    }

    const report = `📊 **Relatório de Desempenho Proativo**

*   Progresso do Mês: **${day}/${totalDays} dias** (${Math.round(monthProgressPercent)}% decorrido)
*   Orçamento Utilizado: **${formatCurrency(totalSpent)}** de **${formatCurrency(totalLimit)}** (${Math.round(spentPercent)}% utilizado)
*   Margem Flexível Sobrando: **${formatCurrency(Math.max(0, totalLimit - totalSpent))}**

**Análise de Ritmo:**
${paceReview}`;
    addMessage("ai", report);
    return;
  }

  // --- FALLBACK RESPONSES ---
  const fallback = `Olá! Sou a Sofia, e ajudo você a gerenciar suas margens de gastos em tempo real. 🤖

Você pode me perguntar algo prático do tipo:
*   *"Gastei R$ 45 no supermercado"*
*   *"Tô no cinema, posso gastar R$ 50 no Lazer?"*
*   *"Como está meu ritmo de gastos este mês?"*

Como você gostaria de prosseguir?`;
  addMessage("ai", fallback);
}

// --- MONTHLY RESET ---
function checkMonthlyReset() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const stored = localStorage.getItem("fincopilot_month");

  if (state.income > 0 && stored && stored !== monthKey) {
    Object.keys(state.categories).forEach(k => {
      state.categories[k].spent = 0;
    });
    state.transactions = [];
    saveState();
    addMessage("ai", `🔄 **Novo mês detectado!** As margens de gastos foram reiniciadas para **${monthKey}**. Bora começar o mês com o pé direito! 🚀`);
  }

  localStorage.setItem("fincopilot_month", monthKey);
}

// --- SERVICE WORKER (PWA) ---
function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

// --- MOBILE TAB NAVIGATION ---
function initTabNavigation() {
  const tabs = document.querySelectorAll(".nav-tab");
  const container = document.querySelector(".app-container");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;
      if (tabName === "config") {
        openSetupModal(false);
        return;
      }
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      container.dataset.activeTab = tabName;
      if (tabName === "chat") {
        setTimeout(() => document.getElementById("chatInput")?.focus(), 300);
      }
    });
  });
}

// --- CAMERA / OCR (NOTA FISCAL) ---
function initCameraOCR() {
  const cameraBtn = document.getElementById("cameraBtn");
  const cameraInput = document.getElementById("cameraInput");
  if (!cameraBtn || !cameraInput) return;

  cameraBtn.addEventListener("click", () => cameraInput.click());

  cameraInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await processReceiptOCR(file);
    cameraInput.value = "";
  });
}

async function processReceiptOCR(file) {
  const overlay = document.createElement("div");
  overlay.className = "ocr-overlay active";
  overlay.innerHTML = `
    <div class="ocr-spinner"></div>
    <img class="ocr-preview" src="${URL.createObjectURL(file)}">
    <div class="ocr-status">Preparando leitura da nota...</div>
  `;
  document.body.appendChild(overlay);

  try {
    const Tesseract = await loadTesseractLibrary();
    const statusEl = overlay.querySelector(".ocr-status");

    statusEl.textContent = "Lendo texto da imagem...";
    const { data } = await Tesseract.recognize(file, "por", {
      logger: m => {
        if (m.status === "recognizing text") {
          const pct = Math.round(m.progress * 100);
          statusEl.textContent = `Reconhecendo... ${pct}%`;
        }
      }
    });

    const parsed = parseReceiptText(data.text);

    if (parsed.amount) {
      overlay.innerHTML = `
        <div class="ocr-result-box">
          <div class="ocr-result-category">${state.categories[parsed.category]?.name || parsed.category}</div>
          <div class="ocr-result-amount">${formatCurrency(parsed.amount)}</div>
          <div class="ocr-result-desc">${parsed.description}</div>
        </div>
        <div class="ocr-actions">
          <button class="ocr-confirm-btn" id="ocrConfirm">✓ Confirmar</button>
          <button class="ocr-cancel-btn" id="ocrCancel">Cancelar</button>
        </div>
      `;
      document.getElementById("ocrCancel").addEventListener("click", () => overlay.remove());
      document.getElementById("ocrConfirm").addEventListener("click", () => {
        overlay.remove();
        const msg = `gastei ${parsed.amount} com ${parsed.description}`;
        addMessage("user", msg);
        processSofiaAI(msg);
      });
    } else {
      overlay.innerHTML = `
        <div class="ocr-result-box">
          <div class="ocr-status">Nenhum valor identificado na imagem.</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.75rem;max-height:180px;overflow-y:auto;text-align:left;">
            <pre style="white-space:pre-wrap;font-size:0.65rem;line-height:1.3;">${data.text.slice(0, 600)}</pre>
          </div>
        </div>
        <div class="ocr-actions">
          <button class="ocr-cancel-btn" id="ocrCancel">Fechar</button>
        </div>
      `;
      document.getElementById("ocrCancel").addEventListener("click", () => overlay.remove());
    }
  } catch (err) {
    console.error("OCR Error:", err);
    overlay.innerHTML = `
      <div class="ocr-status" style="color:var(--rose);">Erro ao processar imagem. Tente novamente.</div>
      <button class="ocr-cancel-btn" id="ocrCancel" style="margin-top:1rem;">Fechar</button>
    `;
    document.getElementById("ocrCancel").addEventListener("click", () => overlay.remove());
  }
}

function loadTesseractLibrary() {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) {
      resolve(window.Tesseract);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error("Falha ao carregar OCR"));
    document.head.appendChild(script);
  });
}

function parseReceiptText(text) {
  const lines = text.split("\n").filter(l => l.trim());
  const lowerText = text.toLowerCase();

  let amount = null;
  const patterns = [
    /(?:total|valor|soma|total a pagar|total r\$)[:\s]*r?\$?\s*([\d.,]+)/i,
    /r?\$?\s*([\d.,]+)\s*(?:total|valor)/i,
    /\b(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\b/,
    /(?:^|\n)\s*r?\$?\s*([\d.,]+)\s*$/im
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = match[1].replace(/\./g, "").replace(",", ".");
      const val = parseFloat(raw);
      if (val > 0 && val < 100000) {
        amount = val;
        break;
      }
    }
  }

  if (!amount) {
    const allNums = text.match(/\b(\d+[.,]\d{2})\b/g);
    if (allNums) {
      const vals = allNums.map(n => parseFloat(n.replace(",", "."))).filter(n => n > 0 && n < 50000);
      if (vals.length > 0) amount = Math.max(...vals);
    }
  }

  const storeName = (lines[0] || "Nota Fiscal").replace(/[^a-zà-úA-ZÀ-Ú0-9\s]/g, "").trim().slice(0, 40) || "Nota Fiscal";

  let category = "outros";
  if (/supermercado|mercado|padaria|feira|hortifruti|carrefour|pão|açúcar|extra|atacadão|são paulo/i.test(lowerText)) {
    category = "alimentacao";
  } else if (/uber|taxi|99app|gasolina|posto|estacionamento|pedágio|combustível|oficina|iplace|auto/i.test(lowerText)) {
    category = "transporte";
  } else if (/cinema|bar|restaurante|cerveja|lanche|pizza|ifood|show|festa|hamburguer|dogão/i.test(lowerText)) {
    category = "lazer";
  }

  return { amount, description: storeName, category };
}
