const STORAGE_KEYS = {
  apiUrl: "eaflow.pwa.apiUrl",
  cache: "eaflow.pwa.bootstrapCache",
  activeMemberId: "eaflow.pwa.activeMemberId"
};

const FIXED_SETTING_KEY = "ea.money.fixedExpenseCategories";
const RECURRING_SETTING_KEY = "ea.money.recurringPayments";
const DEFAULT_FIXED_CATEGORY_NAMES = ["дом и счета", "кредиты"];

const state = {
  apiUrl: localStorage.getItem(STORAGE_KEYS.apiUrl) || "",
  data: emptyData(),
  snapshot: null,
  tab: "money",
  loading: false,
  error: "",
  editingTransactionId: null,
  transactionType: "expense",
  search: "",
  filter: "all"
};

const dom = {};

document.addEventListener("DOMContentLoaded", () => {
  bindDom();
  bindEvents();
  registerServiceWorker();
  loadCachedData();
  render();
  if (state.apiUrl) {
    refreshData();
  } else {
    setTab("settings");
    setStatus("Добавьте Google Apps Script URL");
  }
});

function bindDom() {
  [
    "monthTitle",
    "statusLine",
    "syncButton",
    "safeCard",
    "safeAmount",
    "safeDetail",
    "incomeAmount",
    "expenseAmount",
    "variableLeftAmount",
    "reserveAmount",
    "recentList",
    "addFromMoneyButton",
    "addOperationButton",
    "quickGrid",
    "operationFilter",
    "operationSearch",
    "operationsList",
    "budgetSpent",
    "budgetProgress",
    "budgetCaption",
    "budgetInsights",
    "budgetLimits",
    "apiUrlInput",
    "saveSettingsButton",
    "clearCacheButton",
    "safeModal",
    "safeModalBody",
    "transactionModal",
    "transactionForm",
    "transactionModeLabel",
    "transactionTitle",
    "closeTransactionButton",
    "amountInput",
    "categorySelect",
    "memberSelect",
    "dateInput",
    "commentInput",
    "formError",
    "deleteTransactionButton",
    "saveTransactionButton"
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });

  dom.tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  dom.tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
  dom.typeSegments = Array.from(document.querySelectorAll(".segment"));
}

function bindEvents() {
  dom.syncButton.addEventListener("click", refreshData);
  dom.safeCard.addEventListener("click", openSafeModal);
  dom.addFromMoneyButton.addEventListener("click", () => openTransactionModal());
  dom.addOperationButton.addEventListener("click", () => openTransactionModal());
  dom.saveSettingsButton.addEventListener("click", saveSettings);
  dom.clearCacheButton.addEventListener("click", clearCache);
  dom.closeTransactionButton.addEventListener("click", closeTransactionModal);
  dom.deleteTransactionButton.addEventListener("click", deleteEditingTransaction);

  dom.tabButtons.forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  dom.operationFilter.addEventListener("change", () => {
    state.filter = dom.operationFilter.value;
    renderOperations();
  });

  dom.operationSearch.addEventListener("input", () => {
    state.search = dom.operationSearch.value.trim().toLowerCase();
    renderOperations();
  });

  dom.typeSegments.forEach((button) => {
    button.addEventListener("click", () => {
      const previousType = state.transactionType;
      state.transactionType = button.dataset.type;
      if (previousType !== state.transactionType) {
        dom.categorySelect.value = "";
        renderTypeSegments();
        renderCategoryOptions();
      }
    });
  });

  dom.transactionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveTransaction();
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function emptyData() {
  return {
    transactions: [],
    members: [],
    categories: [],
    budgetPlans: [],
    categoryBudgetLimits: [],
    settings: []
  };
}

function loadCachedData() {
  const cached = localStorage.getItem(STORAGE_KEYS.cache);
  if (!cached) {
    return;
  }

  try {
    state.data = normalizeBootstrap(JSON.parse(cached));
    state.snapshot = calculateSnapshot();
  } catch {
    localStorage.removeItem(STORAGE_KEYS.cache);
  }
}

function saveSettings() {
  const value = dom.apiUrlInput.value.trim();
  if (!value) {
    setStatus("URL не задан");
    return;
  }

  state.apiUrl = value;
  localStorage.setItem(STORAGE_KEYS.apiUrl, value);
  setStatus("URL сохранен");
  refreshData();
}

function clearCache() {
  localStorage.removeItem(STORAGE_KEYS.cache);
  state.data = emptyData();
  state.snapshot = calculateSnapshot();
  render();
  setStatus("Кэш очищен");
}

async function refreshData() {
  if (!state.apiUrl || state.loading) {
    return;
  }

  state.loading = true;
  state.error = "";
  setStatus("Синхронизация...");

  try {
    const data = await api("getBootstrapData");
    state.data = normalizeBootstrap(data);
    state.snapshot = calculateSnapshot();
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(state.data));
    setStatus("Синхронизировано");
  } catch (error) {
    state.error = error.message || String(error);
    setStatus("Ошибка синхронизации");
  } finally {
    state.loading = false;
    render();
  }
}

function api(action, payload = null, params = {}) {
  return new Promise((resolve, reject) => {
    if (!state.apiUrl) {
      reject(new Error("Google Apps Script URL не задан"));
      return;
    }

    const callbackName = `__eaFlow${Date.now()}${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Google Apps Script не ответил"));
    }, 25000);

    function cleanup() {
      window.clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (response) => {
      cleanup();
      if (!response || response.success !== true) {
        reject(new Error(response && response.error ? response.error : "Ошибка Google Apps Script"));
        return;
      }
      resolve(response.data);
    };

    try {
      const url = new URL(state.apiUrl);
      url.searchParams.set("action", action);
      url.searchParams.set("callback", callbackName);
      url.searchParams.set("_", String(Date.now()));
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      });
      if (payload !== null && payload !== undefined) {
        url.searchParams.set("payload", JSON.stringify(payload));
      }
      script.src = url.toString();
      script.onerror = () => {
        cleanup();
        reject(new Error("Не удалось подключиться к Google Apps Script"));
      };
      document.head.appendChild(script);
    } catch {
      cleanup();
      reject(new Error("Неверный URL Google Apps Script"));
    }
  });
}

function normalizeBootstrap(input) {
  const data = input || {};
  return {
    transactions: array(data.transactions).map(normalizeTransaction),
    members: array(data.members).map(normalizeMember).filter((item) => item.isActive),
    categories: array(data.categories).map(normalizeCategory).filter((item) => item.isActive),
    budgetPlans: array(data.budgetPlans || data.budget_plans).map(normalizeBudgetPlan),
    categoryBudgetLimits: array(data.categoryBudgetLimits || data.category_budget_limits).map(normalizeCategoryLimit),
    settings: array(data.settings).map(normalizeSetting)
  };
}

function normalizeTransaction(transaction) {
  return {
    id: String(transaction.id || crypto.randomUUID()),
    remoteId: stringOrNull(transaction.remoteId),
    date: normalizeDateString(transaction.date),
    type: transaction.type === "income" ? "income" : "expense",
    amount: positiveNumber(transaction.amount),
    categoryId: stringOrNull(transaction.categoryId),
    categoryName: String(transaction.categoryName || "Без категории"),
    memberId: stringOrNull(transaction.memberId),
    memberName: String(transaction.memberName || ""),
    accountName: stringOrNull(transaction.accountName),
    comment: stringOrNull(transaction.comment),
    createdAt: normalizeDateString(transaction.createdAt),
    updatedAt: stringOrNull(transaction.updatedAt),
    syncState: String(transaction.syncState || "synced")
  };
}

function normalizeMember(member) {
  const displayName = String(member.displayName || member.name || "Участник");
  return {
    id: String(member.id || crypto.randomUUID()),
    name: String(member.name || displayName),
    displayName,
    isActive: boolValue(member.isActive, true),
    createdAt: normalizeDateString(member.createdAt)
  };
}

function normalizeCategory(category) {
  return {
    id: String(category.id || crypto.randomUUID()),
    name: String(category.name || "Категория"),
    type: category.type === "income" ? "income" : "expense",
    icon: String(category.icon || ""),
    sortOrder: Number(category.sortOrder || 0),
    isActive: boolValue(category.isActive, true)
  };
}

function normalizeBudgetPlan(plan) {
  return {
    id: String(plan.id || crypto.randomUUID()),
    month: normalizeMonth(plan.month),
    plannedIncome: positiveNumber(plan.plannedIncome),
    plannedExpense: positiveNumber(plan.plannedExpense),
    fixedExpenseLimit: positiveNumber(plan.fixedExpenseLimit),
    variableExpenseLimit: positiveNumber(plan.variableExpenseLimit),
    createdAt: normalizeDateString(plan.createdAt),
    updatedAt: stringOrNull(plan.updatedAt)
  };
}

function normalizeCategoryLimit(limit) {
  return {
    id: String(limit.id || crypto.randomUUID()),
    month: normalizeMonth(limit.month),
    categoryId: String(limit.categoryId || ""),
    categoryName: String(limit.categoryName || "Категория"),
    limitAmount: positiveNumber(limit.limitAmount)
  };
}

function normalizeSetting(setting) {
  return {
    key: String(setting.key || ""),
    value: String(setting.value || ""),
    updatedAt: normalizeDateString(setting.updatedAt)
  };
}

function calculateSnapshot() {
  const now = new Date();
  const month = monthKey(now);
  const monthTransactions = state.data.transactions.filter((transaction) => monthKey(parseDate(transaction.date)) === month);
  const expenseTransactions = monthTransactions.filter((transaction) => transaction.type === "expense");
  const incomeTransactions = monthTransactions.filter((transaction) => transaction.type === "income");
  const todayExpenses = expenseTransactions.filter((transaction) => sameDay(parseDate(transaction.date), now));
  const fixedSelection = fixedCategorySelection();
  const budgetPlan = latestBudgetPlan(month);
  const categoryLimits = state.data.categoryBudgetLimits.filter((limit) => normalizeMonth(limit.month) === month);

  const income = sum(incomeTransactions, "amount");
  const spent = sum(expenseTransactions, "amount");
  const fixedSpent = expenseTransactions
    .filter((transaction) => isFixedTransaction(transaction, fixedSelection))
    .reduce((total, transaction) => total + transaction.amount, 0);
  const variableSpent = expenseTransactions
    .filter((transaction) => !isFixedTransaction(transaction, fixedSelection))
    .reduce((total, transaction) => total + transaction.amount, 0);
  const spentToday = sum(todayExpenses, "amount");
  const variableSpentToday = todayExpenses
    .filter((transaction) => !isFixedTransaction(transaction, fixedSelection))
    .reduce((total, transaction) => total + transaction.amount, 0);

  const hasBudgetPlan = Boolean(budgetPlan);
  const plannedIncome = budgetPlan ? budgetPlan.plannedIncome : income;
  const plannedExpense = budgetPlan ? budgetPlan.plannedExpense : Math.max(income, spent);
  const variableLimit = budgetPlan ? budgetPlan.variableExpenseLimit : Math.max(income - fixedSpent, 0);
  const remainingBudget = plannedExpense - spent;
  const remainingVariableBudget = budgetPlan ? Math.max(variableLimit - variableSpent, 0) : Math.max(income - spent, 0);
  const upcomingPayments = recurringPayments()
    .map((payment) => paymentToUpcoming(payment, monthTransactions, fixedSelection, now))
    .filter(Boolean)
    .sort((a, b) => a.dueDate - b.dueDate || b.amount - a.amount);
  const recurringReserveRemaining = upcomingPayments
    .filter((payment) => payment.affectsDailyLimit)
    .reduce((total, payment) => total + payment.amount, 0);
  const daysLeft = daysLeftInMonth(now);
  const safeToSpendToday = Math.max((remainingVariableBudget - recurringReserveRemaining) / Math.max(daysLeft, 1), 0);
  const budgetProgress = plannedExpense > 0 ? Math.max(spent / plannedExpense, 0) : (spent > 0 ? 1 : 0);
  const pace = paceSummary(variableSpent, variableLimit, now);

  return {
    month,
    income,
    spent,
    fixedSpent,
    variableSpent,
    spentToday,
    variableSpentToday,
    plannedIncome,
    plannedExpense,
    variableLimit,
    remainingBudget,
    remainingVariableBudget,
    recurringReserveRemaining,
    daysLeft,
    safeToSpendToday,
    budgetProgress,
    pace,
    closingBalance: hasBudgetPlan ? plannedExpense - spent : income - spent,
    hasBudgetPlan,
    categoryLimits,
    upcomingPayments,
    recentTransactions: [...monthTransactions].sort(sortByDateDesc).slice(0, 5),
    quickTemplates: quickTemplates(),
    budgetInsights: budgetInsights(categoryLimits, expenseTransactions, fixedSelection, now)
  };
}

function fixedCategorySelection() {
  const setting = state.data.settings.find((item) => item.key === FIXED_SETTING_KEY);
  if (!setting || !setting.value) {
    return { ids: new Set(), names: new Set(DEFAULT_FIXED_CATEGORY_NAMES) };
  }

  try {
    const payload = JSON.parse(setting.value);
    return {
      ids: new Set(array(payload.categoryIds).map((item) => String(item).trim()).filter(Boolean)),
      names: new Set(array(payload.categoryNames).map(normalizeName).filter(Boolean))
    };
  } catch {
    return { ids: new Set(), names: new Set(DEFAULT_FIXED_CATEGORY_NAMES) };
  }
}

function recurringPayments() {
  const setting = state.data.settings.find((item) => item.key === RECURRING_SETTING_KEY);
  if (!setting || !setting.value) {
    return [];
  }

  try {
    return array(JSON.parse(setting.value))
      .filter((payment) => boolValue(payment.isActive, true))
      .map((payment) => ({
        id: String(payment.id || crypto.randomUUID()),
        title: String(payment.title || payment.categoryName || "Платеж"),
        amount: positiveNumber(payment.amount),
        categoryId: stringOrNull(payment.categoryId),
        categoryName: String(payment.categoryName || ""),
        memberId: stringOrNull(payment.memberId),
        memberName: String(payment.memberName || ""),
        dayOfMonth: Math.max(1, Math.min(31, Number(payment.dayOfMonth || 1))),
        comment: stringOrNull(payment.comment),
        isActive: true
      }));
  } catch {
    return [];
  }
}

function paymentToUpcoming(payment, monthTransactions, fixedSelection, now) {
  if (!payment.amount || !payment.categoryName) {
    return null;
  }

  const dueDate = dueDateInMonth(payment.dayOfMonth, now);
  if (isRecurringPaymentSatisfied(payment, dueDate, monthTransactions)) {
    return null;
  }

  const affectsDailyLimit = !isFixedTransaction({
    type: "expense",
    categoryId: payment.categoryId,
    categoryName: payment.categoryName
  }, fixedSelection);

  return {
    ...payment,
    dueDate,
    dayOffset: Math.round((startOfDay(dueDate) - startOfDay(now)) / 86400000),
    affectsDailyLimit
  };
}

function isRecurringPaymentSatisfied(payment, dueDate, transactions) {
  return transactions.some((transaction) => {
    if (transaction.type !== "expense") {
      return false;
    }
    const dayDistance = Math.abs(Math.round((startOfDay(parseDate(transaction.date)) - startOfDay(dueDate)) / 86400000));
    if (dayDistance > 3) {
      return false;
    }
    const categoryMatches = transaction.categoryId === payment.categoryId ||
      normalizeName(transaction.categoryName) === normalizeName(payment.categoryName);
    if (!categoryMatches) {
      return false;
    }
    const tolerance = Math.max(payment.amount * 0.05, 50);
    return Math.abs(transaction.amount - payment.amount) <= tolerance;
  });
}

function latestBudgetPlan(month) {
  return state.data.budgetPlans
    .filter((plan) => normalizeMonth(plan.month) === month)
    .sort((a, b) => parseDate(b.updatedAt || b.createdAt) - parseDate(a.updatedAt || a.createdAt))[0] || null;
}

function isFixedTransaction(transaction, selection) {
  if (transaction.categoryId && selection.ids.has(String(transaction.categoryId).trim())) {
    return true;
  }
  return selection.names.has(normalizeName(transaction.categoryName));
}

function quickTemplates() {
  const groups = new Map();
  const transactions = [...state.data.transactions]
    .filter((transaction) => transaction.amount > 0 && transaction.categoryName)
    .sort(sortByDateDesc);

  transactions.forEach((transaction) => {
    const comment = normalizedComment(transaction.comment);
    const key = [
      transaction.type,
      transaction.categoryId || normalizeName(transaction.categoryName),
      comment || ""
    ].join("|");
    const group = groups.get(key) || { key, count: 0, lastDate: 0, sample: transaction };
    group.count += 1;
    const dateValue = parseDate(transaction.date).getTime();
    if (dateValue > group.lastDate) {
      group.lastDate = dateValue;
      group.sample = transaction;
    }
    groups.set(key, group);
  });

  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.lastDate - a.lastDate)
    .slice(0, 5)
    .map((group) => {
      const sample = group.sample;
      const comment = normalizedComment(sample.comment);
      return {
        id: group.key,
        title: comment || sample.categoryName,
        subtitle: `${sample.type === "income" ? "Доход" : "Расход"} · ${sample.categoryName}`,
        type: sample.type,
        categoryId: sample.categoryId,
        categoryName: sample.categoryName,
        memberId: sample.memberId,
        memberName: sample.memberName,
        comment
      };
    });
}

function budgetInsights(limits, expenseTransactions, fixedSelection, now) {
  const day = Math.max(now.getDate(), 1);
  const days = daysInMonth(now);
  return limits
    .filter((limit) => limit.limitAmount > 0)
    .filter((limit) => !isFixedTransaction({ type: "expense", categoryId: limit.categoryId, categoryName: limit.categoryName }, fixedSelection))
    .map((limit) => {
      const actual = expenseTransactions
        .filter((transaction) => transaction.categoryId === limit.categoryId || normalizeName(transaction.categoryName) === normalizeName(limit.categoryName))
        .reduce((total, transaction) => total + transaction.amount, 0);
      const expected = limit.limitAmount * day / days;
      const delta = actual - expected;
      const forecast = actual / day * days;
      return { limit, actual, expected, delta, forecast };
    })
    .filter((item) => item.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 4);
}

function paceSummary(variableSpent, variableLimit, now) {
  if (variableLimit <= 0) {
    return { title: "План переменных не задан", detail: "Ориентир идет по факту месяца", status: "attention" };
  }

  const expected = variableLimit * Math.max(now.getDate(), 1) / daysInMonth(now);
  const delta = variableSpent - expected;
  if (delta <= 0) {
    return { title: "Темп спокойный", detail: "Ниже дневного плана", status: "calm" };
  }
  if (delta <= variableLimit * 0.08) {
    return { title: "Чуть быстрее плана", detail: `Выше темпа на ${formatMoney(delta)}`, status: "attention" };
  }
  return { title: "Темп высокий", detail: `Выше темпа на ${formatMoney(delta)}`, status: "danger" };
}

function render() {
  dom.apiUrlInput.value = state.apiUrl;
  dom.monthTitle.textContent = monthTitle(new Date());
  renderTabs();
  renderMoney();
  renderOperations();
  renderBudget();
  renderSettingsState();
}

function renderTabs() {
  dom.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.tab);
  });
  dom.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${state.tab}`);
  });
}

function renderMoney() {
  const snapshot = state.snapshot || calculateSnapshot();
  dom.safeAmount.textContent = formatMoney(snapshot.safeToSpendToday);
  dom.safeDetail.textContent = snapshot.pace.detail;
  dom.incomeAmount.textContent = formatMoney(snapshot.income);
  dom.expenseAmount.textContent = formatMoney(snapshot.spent);
  dom.variableLeftAmount.textContent = formatMoney(snapshot.remainingVariableBudget);
  dom.reserveAmount.textContent = formatMoney(snapshot.recurringReserveRemaining);
  renderTransactionList(dom.recentList, snapshot.recentTransactions, { limit: 5 });
}

function renderOperations() {
  const snapshot = state.snapshot || calculateSnapshot();
  dom.operationFilter.value = state.filter;
  dom.operationSearch.value = state.search;

  dom.quickGrid.innerHTML = "";
  if (!snapshot.quickTemplates.length) {
    dom.quickGrid.innerHTML = `<div class="empty">Пока нет шаблонов</div>`;
  } else {
    snapshot.quickTemplates.forEach((template) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quick-button";
      button.innerHTML = `
        <strong>${escapeHtml(template.title)}</strong>
        <span>${escapeHtml(template.subtitle)}</span>
      `;
      button.addEventListener("click", () => openTransactionModal(null, template));
      dom.quickGrid.appendChild(button);
    });
  }

  let transactions = [...state.data.transactions].sort(sortByDateDesc);
  if (state.filter !== "all") {
    transactions = transactions.filter((transaction) => transaction.type === state.filter);
  }
  if (state.search) {
    transactions = transactions.filter((transaction) => [
      transaction.categoryName,
      transaction.memberName,
      transaction.comment,
      formatMoney(transaction.amount)
    ].some((value) => String(value || "").toLowerCase().includes(state.search)));
  }

  renderTransactionList(dom.operationsList, transactions, { limit: 60 });
}

function renderBudget() {
  const snapshot = state.snapshot || calculateSnapshot();
  const spentText = `${formatMoney(snapshot.spent)} / ${formatMoney(snapshot.plannedExpense)}`;
  dom.budgetSpent.textContent = spentText;
  dom.budgetProgress.style.width = `${Math.min(snapshot.budgetProgress * 100, 100)}%`;
  dom.budgetCaption.textContent = snapshot.hasBudgetPlan
    ? `${snapshot.pace.title}. Остаток переменных ${formatMoney(snapshot.remainingVariableBudget)}`
    : "План месяца не задан";

  dom.budgetInsights.innerHTML = "";
  if (!snapshot.budgetInsights.length) {
    dom.budgetInsights.innerHTML = `<div class="empty">Все переменные категории в темпе</div>`;
  } else {
    snapshot.budgetInsights.forEach((item) => {
      const row = document.createElement("div");
      row.className = "row";
      const detail = `Факт: ${formatMoney(item.actual)}. К сегодняшнему дню по равномерному темпу: ${formatMoney(item.expected)}. Прогноз до конца месяца: ${formatMoney(item.forecast)}. Лимит: ${formatMoney(item.limit.limitAmount)}.`;
      row.innerHTML = `
        <span>
          <span class="row-title">${escapeHtml(item.limit.categoryName)}</span>
          <span class="row-subtitle">Выше темпа на ${formatMoney(item.delta)} <button class="insight-action" type="button" aria-label="Информация">i</button></span>
        </span>
        <span class="amount expense">${formatMoney(item.forecast)}</span>
      `;
      row.querySelector("button").addEventListener("click", () => window.alert(detail));
      dom.budgetInsights.appendChild(row);
    });
  }

  dom.budgetLimits.innerHTML = "";
  const limits = [...snapshot.categoryLimits]
    .filter((limit) => limit.limitAmount > 0)
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName, "ru"));

  if (!limits.length) {
    dom.budgetLimits.innerHTML = `<div class="empty">Лимиты не заданы</div>`;
  } else {
    limits.forEach((limit) => {
      const actual = state.data.transactions
        .filter((transaction) => transaction.type === "expense")
        .filter((transaction) => monthKey(parseDate(transaction.date)) === snapshot.month)
        .filter((transaction) => transaction.categoryId === limit.categoryId || normalizeName(transaction.categoryName) === normalizeName(limit.categoryName))
        .reduce((total, transaction) => total + transaction.amount, 0);
      const progress = limit.limitAmount > 0 ? Math.min(actual / limit.limitAmount, 1) : 0;
      const row = document.createElement("div");
      row.className = "detail-card";
      row.innerHTML = `
        <span>${escapeHtml(limit.categoryName)}</span>
        <strong>${formatMoney(actual)} / ${formatMoney(limit.limitAmount)}</strong>
        <div class="progress-track"><div class="progress-fill" style="width: ${progress * 100}%"></div></div>
      `;
      dom.budgetLimits.appendChild(row);
    });
  }
}

function renderSettingsState() {
  if (state.error) {
    setStatus(state.error);
  }
}

function renderTransactionList(container, transactions, options = {}) {
  const limit = options.limit || transactions.length;
  container.innerHTML = "";
  const visible = transactions.slice(0, limit);

  if (!visible.length) {
    container.innerHTML = `<div class="empty">Операций нет</div>`;
    return;
  }

  visible.forEach((transaction) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-button";
    button.innerHTML = `
      <span>
        <span class="row-title">${escapeHtml(transaction.comment || transaction.categoryName)}</span>
        <span class="row-subtitle">${escapeHtml(transaction.categoryName)} · ${escapeHtml(transaction.memberName || "Без участника")} · ${formatDisplayDate(transaction.date)}</span>
      </span>
      <span class="amount ${transaction.type}">${transaction.type === "income" ? "+" : "-"}${formatMoney(transaction.amount)}</span>
    `;
    button.addEventListener("click", () => openTransactionModal(transaction));
    container.appendChild(button);
  });
}

function openSafeModal() {
  const snapshot = state.snapshot || calculateSnapshot();
  dom.safeModalBody.innerHTML = `
    <div class="detail-card">
      <span>Можно сегодня</span>
      <strong>${formatMoney(snapshot.safeToSpendToday)}</strong>
    </div>
    <div class="detail-card">
      <span>Сегодня потрачено</span>
      <strong>${formatMoney(snapshot.spentToday)}</strong>
    </div>
    <div class="detail-card">
      <span>Остаток переменных</span>
      <strong>${formatMoney(snapshot.remainingVariableBudget)}</strong>
    </div>
    <div class="detail-card">
      <span>Резерв до конца месяца</span>
      <strong>${formatMoney(snapshot.recurringReserveRemaining)}</strong>
    </div>
    <div class="detail-card">
      <span>Дней в расчете</span>
      <strong>${snapshot.daysLeft}</strong>
    </div>
    <div class="detail-card">
      <span>${escapeHtml(snapshot.pace.title)}</span>
      <strong>${escapeHtml(snapshot.pace.detail)}</strong>
    </div>
  `;
  dom.safeModal.showModal();
}

function openTransactionModal(transaction = null, template = null) {
  state.editingTransactionId = transaction ? transaction.id : null;
  state.transactionType = transaction ? transaction.type : (template ? template.type : "expense");
  dom.transactionModeLabel.textContent = transaction ? "Редактирование" : "Операция";
  dom.transactionTitle.textContent = transaction ? "Редактировать" : "Новая операция";
  dom.amountInput.value = transaction ? String(transaction.amount).replace(".", ",") : "";
  dom.dateInput.value = isoDateInput(transaction ? transaction.date : new Date());
  dom.commentInput.value = transaction ? (transaction.comment || "") : (template ? (template.comment || "") : "");
  dom.formError.textContent = "";
  dom.deleteTransactionButton.classList.toggle("hidden", !transaction);

  renderTypeSegments();
  renderCategoryOptions();
  renderMemberOptions();

  const selectedCategoryId = transaction ? transaction.categoryId : (template ? template.categoryId : "");
  const selectedMemberId = transaction ? transaction.memberId : (template ? template.memberId : localStorage.getItem(STORAGE_KEYS.activeMemberId));

  if (selectedCategoryId && [...dom.categorySelect.options].some((option) => option.value === selectedCategoryId)) {
    dom.categorySelect.value = selectedCategoryId;
  }
  if (selectedMemberId && [...dom.memberSelect.options].some((option) => option.value === selectedMemberId)) {
    dom.memberSelect.value = selectedMemberId;
  }

  dom.transactionModal.showModal();
  window.setTimeout(() => dom.amountInput.focus(), 120);
}

function closeTransactionModal() {
  dom.transactionModal.close();
}

function renderTypeSegments() {
  dom.typeSegments.forEach((button) => {
    button.classList.toggle("active", button.dataset.type === state.transactionType);
  });
}

function renderCategoryOptions() {
  const categories = state.data.categories
    .filter((category) => category.type === state.transactionType)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));

  dom.categorySelect.innerHTML = categories.map((category) => (
    `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`
  )).join("");
}

function renderMemberOptions() {
  const members = state.data.members.length ? state.data.members : [{ id: "", displayName: "Я" }];
  dom.memberSelect.innerHTML = members.map((member) => (
    `<option value="${escapeHtml(member.id)}">${escapeHtml(member.displayName)}</option>`
  )).join("");
}

async function saveTransaction() {
  dom.formError.textContent = "";
  const amount = decimalNumber(dom.amountInput.value);
  if (amount <= 0) {
    dom.formError.textContent = "Введите сумму";
    return;
  }

  const category = state.data.categories.find((item) => item.id === dom.categorySelect.value);
  if (!category) {
    dom.formError.textContent = "Выберите категорию";
    return;
  }

  const member = state.data.members.find((item) => item.id === dom.memberSelect.value) || { id: "", displayName: "" };
  const now = new Date().toISOString();
  const existing = state.data.transactions.find((item) => item.id === state.editingTransactionId);
  const id = existing ? existing.id : crypto.randomUUID();

  const payload = {
    id,
    remoteId: existing ? (existing.remoteId || id) : id,
    date: new Date(`${dom.dateInput.value}T12:00:00`).toISOString(),
    type: state.transactionType,
    amount: String(amount),
    categoryId: category.id,
    categoryName: category.name,
    memberId: member.id,
    memberName: member.displayName || member.name || "",
    accountName: existing ? existing.accountName || "" : "",
    comment: dom.commentInput.value.trim(),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    syncState: "synced"
  };

  try {
    dom.saveTransactionButton.disabled = true;
    setStatus("Сохраняю...");
    await api(existing ? "updateTransaction" : "addTransaction", payload);
    localStorage.setItem(STORAGE_KEYS.activeMemberId, member.id);
    closeTransactionModal();
    await refreshData();
  } catch (error) {
    dom.formError.textContent = error.message || String(error);
    setStatus("Не удалось сохранить");
  } finally {
    dom.saveTransactionButton.disabled = false;
  }
}

async function deleteEditingTransaction() {
  const transaction = state.data.transactions.find((item) => item.id === state.editingTransactionId);
  if (!transaction) {
    return;
  }

  if (!window.confirm("Удалить операцию?")) {
    return;
  }

  try {
    dom.deleteTransactionButton.disabled = true;
    setStatus("Удаляю...");
    await api("deleteTransaction", { id: transaction.id });
    closeTransactionModal();
    await refreshData();
  } catch (error) {
    dom.formError.textContent = error.message || String(error);
    setStatus("Не удалось удалить");
  } finally {
    dom.deleteTransactionButton.disabled = false;
  }
}

function setTab(tab) {
  state.tab = tab;
  renderTabs();
}

function setStatus(message) {
  dom.statusLine.textContent = message;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function boolValue(value, fallback) {
  if (value === true || value === "true" || value === "TRUE" || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === "FALSE" || value === 0 || value === "0") {
    return false;
  }
  return fallback;
}

function stringOrNull(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return text.trim() ? text : null;
}

function decimalNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const normalized = String(value || "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
}

function positiveNumber(value) {
  return Math.abs(decimalNumber(value));
}

function sum(items, key) {
  return items.reduce((total, item) => total + decimalNumber(item[key]), 0);
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeDateString(value) {
  return parseDate(value).toISOString();
}

function normalizeMonth(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{1,2})/);
  if (match) {
    return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
  }
  return monthKey(parseDate(text));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function daysLeftInMonth(date) {
  return Math.max(daysInMonth(date) - date.getDate() + 1, 1);
}

function dueDateInMonth(dayOfMonth, date) {
  const day = Math.max(1, Math.min(dayOfMonth, daysInMonth(date)));
  return new Date(date.getFullYear(), date.getMonth(), day);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function sameDay(left, right) {
  return startOfDay(left) === startOfDay(right);
}

function sortByDateDesc(left, right) {
  return parseDate(right.date) - parseDate(left.date);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizedComment(value) {
  const text = String(value || "").trim().replace(/•/g, " ");
  return text.length >= 3 ? text.slice(0, 28) : "";
}

function formatMoney(value) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(decimalNumber(value)))} р.`;
}

function monthTitle(date) {
  const title = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(date);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function formatDisplayDate(value) {
  const date = parseDate(value);
  if (sameDay(date, new Date())) {
    return "Сегодня";
  }
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
}

function isoDateInput(value) {
  const date = parseDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
