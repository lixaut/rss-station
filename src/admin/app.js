// ===== API 封装 =====
const API = {
  async get(url) {
    const resp = await fetch(url);
    return resp.json();
  },
  async post(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return resp.json();
  },
  async put(url, body) {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return resp.json();
  },
  async del(url) {
    const resp = await fetch(url, { method: 'DELETE' });
    return resp.json();
  },
};

// ===== Tab 切换 =====
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ===== 订阅管理 =====
const subTbody = document.getElementById('sub-tbody');
const subModal = document.getElementById('sub-modal');
const subForm = document.getElementById('sub-form');
const subIdInput = document.getElementById('sub-id');
const subNameInput = document.getElementById('sub-name');
const subUrlInput = document.getElementById('sub-url');
const subTypeSelect = document.getElementById('sub-type');
const subIntervalInput = document.getElementById('sub-interval');
const subModalTitle = document.getElementById('sub-modal-title');
const scrapeRulesSection = document.getElementById('scrape-rules-section');

// 类型切换：显示/隐藏抓取规则
subTypeSelect.addEventListener('change', () => {
  scrapeRulesSection.style.display = subTypeSelect.value === 'scrape' ? 'block' : 'none';
});

async function loadSubscriptions() {
  const { success, data } = await API.get('/api/subscriptions');
  if (!success) return;
  subTbody.innerHTML = '';
  if (data.length === 0) {
    subTbody.innerHTML = '<tr><td colspan="8" class="empty-msg">暂无订阅，点击右上角「添加订阅」</td></tr>';
    return;
  }
  data.forEach((sub) => {
    const tr = document.createElement('tr');
    const typeLabel = sub.type === 'scrape' ? '🔍 Scrape' : '📡 RSS';
    tr.innerHTML = `
      <td>${sub.id}</td>
      <td>${escapeHtml(sub.name)}</td>
      <td title="${escapeHtml(sub.url)}">${escapeHtml(truncate(sub.url, 40))}</td>
      <td>${typeLabel}</td>
      <td>${sub.interval}</td>
      <td><span class="status-badge ${sub.enabled ? 'enabled' : 'disabled'}">${sub.enabled ? '启用' : '禁用'}</span></td>
      <td>${sub.last_fetched_at || '-'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editSub(${sub.id})">编辑</button>
        <button class="btn btn-sm btn-secondary" onclick="toggleSub(${sub.id}, ${sub.enabled})">${sub.enabled ? '禁用' : '启用'}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSub(${sub.id})">删除</button>
      </td>
    `;
    subTbody.appendChild(tr);
  });
}

function editSub(id) {
  API.get(`/api/subscriptions/${id}`).then(({ success, data }) => {
    if (!success) return;
    subIdInput.value = data.id;
    subNameInput.value = data.name;
    subUrlInput.value = data.url;
    subTypeSelect.value = data.type;
    subIntervalInput.value = data.interval;
    subModalTitle.textContent = '编辑订阅';

    // 填充 scrape 规则
    if (data.type === 'scrape' && data.scrape_rules) {
      try {
        const rules = JSON.parse(data.scrape_rules);
        document.getElementById('scrape-list').value = rules.listSelector || '';
        document.getElementById('scrape-item').value = rules.itemSelector || '';
        document.getElementById('scrape-title').value = rules.titleSelector || '';
        document.getElementById('scrape-link').value = rules.linkSelector || '';
        document.getElementById('scrape-content').value = rules.contentSelector || '';
      } catch (e) {}
    }
    scrapeRulesSection.style.display = data.type === 'scrape' ? 'block' : 'none';
    subModal.style.display = 'flex';
  });
}

async function toggleSub(id, current) {
  await API.put(`/api/subscriptions/${id}`, { enabled: !current });
  loadSubscriptions();
}

async function deleteSub(id) {
  if (!confirm('确定要删除此订阅源？关联的文章也会被删除。')) return;
  await API.del(`/api/subscriptions/${id}`);
  loadSubscriptions();
}

document.getElementById('btn-add-sub').addEventListener('click', () => {
  subIdInput.value = '';
  subForm.reset();
  subTypeSelect.value = 'rss';
  subIntervalInput.value = 30;
  scrapeRulesSection.style.display = 'none';
  subModalTitle.textContent = '添加订阅';
  subModal.style.display = 'flex';
});

subForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = subIdInput.value;
  const type = subTypeSelect.value;

  const body = {
    name: subNameInput.value.trim(),
    url: subUrlInput.value.trim(),
    type: type,
    interval: parseInt(subIntervalInput.value) || 30,
  };

  if (type === 'scrape') {
    body.scrape_rules = {
      listSelector: document.getElementById('scrape-list').value.trim() || undefined,
      itemSelector: document.getElementById('scrape-item').value.trim(),
      titleSelector: document.getElementById('scrape-title').value.trim(),
      linkSelector: document.getElementById('scrape-link').value.trim(),
      contentSelector: document.getElementById('scrape-content').value.trim() || undefined,
    };
  }

  if (id) {
    const res = await API.put(`/api/subscriptions/${id}`, body);
    if (!res.success) {
      showToast('❌ ' + (res.message || '更新失败'), 'error');
      return;
    }
    showToast('✅ 订阅已更新');
  } else {
    const res = await API.post('/api/subscriptions', body);
    if (!res.success) {
      showToast('❌ ' + (res.message || '添加失败'), 'error');
      return;
    }
    showToast('✅ 订阅已添加');
  }
  subModal.style.display = 'none';
  loadSubscriptions();
});

// ===== Webhook 管理 =====
const webhookTbody = document.getElementById('webhook-tbody');
const webhookModal = document.getElementById('webhook-modal');
const webhookForm = document.getElementById('webhook-form');
const webhookIdInput = document.getElementById('webhook-id');
const webhookNameInput = document.getElementById('webhook-name');
const webhookUrlInput = document.getElementById('webhook-url');
const webhookTemplateSelect = document.getElementById('webhook-template');
const webhookModalTitle = document.getElementById('webhook-modal-title');

async function loadWebhooks() {
  const { success, data } = await API.get('/api/webhooks');
  if (!success) return;
  webhookTbody.innerHTML = '';
  if (data.length === 0) {
    webhookTbody.innerHTML = '<tr><td colspan="6" class="empty-msg">暂无 Webhook 配置</td></tr>';
    return;
  }
  data.forEach((wh) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${wh.id}</td>
      <td>${escapeHtml(wh.name)}</td>
      <td title="${escapeHtml(wh.url)}">${escapeHtml(truncate(wh.url, 40))}</td>
      <td>${wh.template}</td>
      <td><span class="status-badge ${wh.enabled ? 'enabled' : 'disabled'}">${wh.enabled ? '启用' : '禁用'}</span></td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editWebhook(${wh.id})">编辑</button>
        <button class="btn btn-sm btn-secondary" onclick="toggleWebhook(${wh.id}, ${wh.enabled})">${wh.enabled ? '禁用' : '启用'}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteWebhook(${wh.id})">删除</button>
      </td>
    `;
    webhookTbody.appendChild(tr);
  });
}

function editWebhook(id) {
  API.get(`/api/webhooks/${id}`).then(({ success, data }) => {
    if (!success) return;
    webhookIdInput.value = data.id;
    webhookNameInput.value = data.name;
    webhookUrlInput.value = data.url;
    webhookTemplateSelect.value = data.template;
    webhookModalTitle.textContent = '编辑 Webhook';
    webhookModal.style.display = 'flex';
  });
}

async function toggleWebhook(id, current) {
  await API.put(`/api/webhooks/${id}`, { enabled: !current });
  loadWebhooks();
}

async function deleteWebhook(id) {
  if (!confirm('确定要删除此 Webhook 配置？')) return;
  await API.del(`/api/webhooks/${id}`);
  loadWebhooks();
}

document.getElementById('btn-add-webhook').addEventListener('click', () => {
  webhookIdInput.value = '';
  webhookForm.reset();
  webhookTemplateSelect.value = 'markdown';
  webhookModalTitle.textContent = '添加 Webhook';
  webhookModal.style.display = 'flex';
});

webhookForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = webhookIdInput.value;
  const body = {
    name: webhookNameInput.value.trim(),
    url: webhookUrlInput.value.trim(),
    template: webhookTemplateSelect.value,
  };
  if (id) {
    await API.put(`/api/webhooks/${id}`, body);
  } else {
    await API.post('/api/webhooks', body);
  }
  webhookModal.style.display = 'none';
  loadWebhooks();
});

// ===== 推送日志 =====
const logTbody = document.getElementById('log-tbody');

async function loadLogs() {
  const { success, data } = await API.get('/api/logs?limit=50');
  if (!success) return;
  logTbody.innerHTML = '';
  if (data.length === 0) {
    logTbody.innerHTML = '<tr><td colspan="5" class="empty-msg">暂无推送记录</td></tr>';
    return;
  }
  data.forEach((log) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${log.created_at}</td>
      <td title="${escapeHtml(log.article_title || '-')}">${escapeHtml(truncate(log.article_title, 80))}</td>
      <td>${escapeHtml(log.webhook_name || '-')}</td>
      <td><span class="status-badge ${log.status === 'success' ? 'enabled' : 'disabled'}">${log.status === 'success' ? '成功' : '失败'}</span></td>
      <td title="${escapeHtml(log.response)}">${escapeHtml(truncate(log.response, 50))}</td>
    `;
    logTbody.appendChild(tr);
  });
}

// ===== 手动轮询 =====
document.getElementById('btn-trigger-poll').addEventListener('click', async () => {
  const btn = document.getElementById('btn-trigger-poll');
  btn.textContent = '⏳ 轮询中...';
  btn.disabled = true;
  await API.post('/api/trigger-poll');
  btn.textContent = '🔄 手动轮询';
  btn.disabled = false;
  loadSubscriptions();
  loadLogs();
});

// ===== 弹窗关闭 =====
document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.closest('.modal').style.display = 'none';
  });
});

document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
});

// ===== 工具函数 =====
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

/** 显示 Toast 通知 */
function showToast(message, type = 'success') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type}`;
  // 触发 reflow 让动画生效
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== 自动刷新（每 30 秒） =====
function refreshAll() {
  loadSubscriptions();
  loadWebhooks();
  loadLogs();
}

// 初始加载
refreshAll();
setInterval(refreshAll, 30_000);