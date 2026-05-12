const API = '';

let conversations = [];
let activeConversationId = null;
let activeParentMessageId = null;
let activeFrames = [];
let pendingSummary = null;

const renderer = new marked.Renderer();
marked.setOptions({ renderer });

// prevent marked from escaping $ signs
marked.use({
    extensions: [{
        name: 'math',
        level: 'inline',
        start(src) { return src.indexOf('$'); },
        tokenizer(src) {
            const match = src.match(/^\$\$[\s\S]+?\$\$/) || src.match(/^\$[^$]+?\$/);
            if (match) return { type: 'math', raw: match[0], text: match[0] };
        },
        renderer(token) { return token.text; }
    }]
});

// Fetch and render conversation list
async function loadConversations() {
  const res = await fetch(`${API}/conversations`);
  conversations = await res.json();
  renderSidebar();
}

function renderSidebar() {
  const list = document.getElementById('conversation-list');
  list.innerHTML = '';

  // separate roots and forks
  const roots = conversations.filter(c => !c.forkedFromMessageId);
  
  for (const root of roots) {
    const li = buildConvoItem(root);
    list.appendChild(li);
  }
}

function renderFrameIndicator() {
    const existing = document.getElementById('frame-indicator');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'frame-indicator';
    const depth = activeFrames.length;
    el.style.marginLeft = `${depth * 16}px`;

    el.innerHTML = `
        <div id="frame-bar">
            <span id="frame-depth">Frame ${depth}</span>
            <div id="frame-actions">
                <button onclick="exitFrame(false, false)">Exit void</button>
                <button onclick="exitFrame(true, false)">Exit with summary</button>
                <button onclick="exitFrame(true, true)">Exit with summary + continue</button>
                <button onclick="pushFrame(${activeParentMessageId})">Push frame</button>
            </div>
        </div>
    `;

    document.getElementById('messages').appendChild(el);
    document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
}

function renderPendingSummary() {
    const existing = document.getElementById('pending-summary');
    if (existing) existing.remove();
    if (!pendingSummary) return;

    const el = document.createElement('div');
    el.id = 'pending-summary';
    el.textContent = `Pending context update: "${pendingSummary}"`;
    document.getElementById('input-area').prepend(el);
}

async function exitFrame(withSummary, withContinue) {
    let summary = null;
    if (withSummary) {
        summary = prompt('Enter summary:');
        if (!summary) return;
    }

    await fetch(`${API}/conversations/${activeConversationId}/frames/active`, {
        method: 'DELETE'
    });
    activeFrames.pop();
    await loadMessages(activeConversationId);

    if (withSummary && !withContinue) {
        pendingSummary = summary;
        renderPendingSummary();
    }

    if (withSummary && withContinue) {
        await sendMessageContent(`[Context update: ${summary}]`);
    }
}

async function deleteConversation(id) {
  await fetch(`${API}/conversations/${id}`, { method: 'DELETE' });
  if (activeConversationId === id) {
    activeConversationId = null;
    activeParentMessageId = null;
    document.getElementById('messages').innerHTML = '';
  }
  await loadConversations();
}

function buildConvoItem(convo) {
  const li = document.createElement('li');
  li.className = 'convo-item';

  const label = document.createElement('div');
  label.className = 'convo-label' + (convo.id === activeConversationId ? ' active' : '');

  if (convo.forkedFromMessageId) {
    const preview = convo.forkedFromMessagePreview ?? '';
    const short = preview.length > 30 ? preview.slice(0, 30) + '...' : preview;
    
    label.innerHTML = `
      <span class="fork-indicator">↳</span>
      <span class="fork-label-text">
        <span class="fork-label-static">Fork from:</span>
        <em class="fork-preview" title="${preview}">${short}</em>
      </span>
      <button class="delete-btn" data-id="${convo.id}">✕</button>
    `;
    
    label.onclick = () => selectConversation(convo.id);
    
    label.querySelector('.fork-preview').onclick = (e) => {
      e.stopPropagation();
      selectConversation(convo.forkedFromConversationId);
    };

  } else {
    label.innerHTML = `
      <span class="convo-title">${convo.title}</span>
      <button class="delete-btn" data-id="${convo.id}">✕</button>
    `;
    label.onclick = () => selectConversation(convo.id);
  }

  label.querySelector('.delete-btn').onclick = (e) => {
    e.stopPropagation();
    deleteConversation(convo.id);
  };

  li.appendChild(label);

  const forks = conversations.filter(c => c.forkedFromConversationId === convo.id);
  if (forks.length > 0) {
    const children = document.createElement('ul');
    children.className = 'convo-children';
    for (const fork of forks) {
      children.appendChild(buildConvoItem(fork));
    }
    li.appendChild(children);
  }

  return li;
}

async function selectConversation(id) {
    activeConversationId = id;
    activeParentMessageId = null;

    const convo = conversations.find(c => c.id === id);
    if (convo?.forkedFromMessageId) {
        activeParentMessageId = convo.forkedFromMessageId;
    }

    const framesRes = await fetch(`${API}/conversations/${id}/frames`);
    activeFrames = await framesRes.json();

    renderSidebar();
    await loadMessages(id);
}

async function loadMessages(conversationId) {
    const res = await fetch(`${API}/conversations/${conversationId}/messages`);
    const messages = await res.json();

    const framesRes = await fetch(`${API}/conversations/${conversationId}/frames`);
    const frames = await framesRes.json();

    const container = document.getElementById('messages');
    container.innerHTML = '';

    for (const msg of messages) {
        // check if any frame starts at this message
        const frameStartingHere = frames.find(f => f.startMessageId === msg.id);
        const depth = frames.filter(f => f.startMessageId < msg.id).length;

        appendMessage(msg, depth);

        if (frameStartingHere) {
            const newDepth = frames.filter(f => f.startMessageId <= msg.id).length;
            const bar = document.createElement('div');
            bar.className = 'frame-bar';
            bar.style.marginLeft = `${newDepth * 16}px`;
            bar.innerHTML = `<span>Frame ${newDepth}</span>`;
            container.appendChild(bar);
        }
    }

    if (messages.length > 0) {
        activeParentMessageId = messages[messages.length - 1].id;
    }

    container.scrollTop = container.scrollHeight;
    renderFrameIndicator();
}

async function pushFrame(messageId) {
    const res = await fetch(`${API}/conversations/${activeConversationId}/frames`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startMessageId: messageId })
    });
    const frame = await res.json();
    activeFrames.push(frame);
    await loadMessages(activeConversationId);
}

function appendMessage(msg, depth = 0) {
  const container = document.getElementById('messages');

  const div = document.createElement('div');
  div.className = `message ${msg.role}`;
  div.dataset.messageId = msg.id;
  div.style.marginLeft = `${depth * 16}px`;

  const role = document.createElement('div');
  role.className = 'message-role';
  role.textContent = msg.role === 'user' ? 'You' : 'Assistant';

  const content = document.createElement('div');
  content.className = 'message-content';
  // content.textContent = msg.content;
  content.innerHTML = marked.parse(msg.content);
  renderMathInElement(content, {
      delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
      ]
  });

  div.appendChild(role);
  div.appendChild(content);

  if (msg.role === 'assistant') {
    const forkBtn = document.createElement('button');
    forkBtn.className = 'fork-btn';
    forkBtn.textContent = 'Fork from here';
    forkBtn.onclick = () => forkFromMessage(msg.id);

    div.appendChild(forkBtn);
  }

  container.appendChild(div);
  return content;
}

async function forkFromMessage(messageId) {
  const res = await fetch(`${API}/messages/${messageId}/fork`, { method: 'POST' });
  const data = await res.json();
  await loadConversations();
  await selectConversation(data.forkedConversationId);
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    let content = input.value.trim();
    if (!content || !activeConversationId) return;
    input.value = '';
    autoResize(input);

    if (pendingSummary) {
        content = `[Context update: ${pendingSummary}]\n\n${content}`;
        pendingSummary = null;
        renderPendingSummary();
    }

    await sendMessageContent(content);
}

async function sendMessageContent(content) {
    appendMessage({ role: 'user', content }, activeFrames.length);

    // assistant placeholder
    const assistantDiv = document.createElement('div');
    assistantDiv.className = 'message assistant';
    const role = document.createElement('div');
    role.className = 'message-role';
    role.textContent = 'Assistant';
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    assistantDiv.appendChild(role);
    assistantDiv.appendChild(contentEl);
    document.getElementById('messages').appendChild(assistantDiv);

    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;

    const res = await fetch(`${API}/conversations/${activeConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content,
            parentMessageId: activeParentMessageId,
            model: 'gpt-4o'
        })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const token = line.slice('data: '.length);
            contentEl.textContent += token;
            document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
        }
    }

    contentEl.innerHTML = marked.parse(contentEl.textContent);
    renderMathInElement(contentEl, {
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true }
        ]
    });

    sendBtn.disabled = false;
    await loadMessages(activeConversationId);
}

async function newChat() {
  const res = await fetch(`${API}/conversations`, { method: 'POST' });
  const convo = await res.json();
  conversations.unshift(convo);
  await selectConversation(convo.id);
  renderSidebar();
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

// Event listeners
document.getElementById('new-chat-btn').onclick = newChat;
document.getElementById('send-btn').onclick = sendMessage;
document.getElementById('message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
document.getElementById('message-input').addEventListener('input', (e) => {
  autoResize(e.target);
});

// Init
loadConversations();

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
}

window.visualViewport.addEventListener('resize', () => {
    document.getElementById('chat').style.height = `${window.visualViewport.height}px`;
});
