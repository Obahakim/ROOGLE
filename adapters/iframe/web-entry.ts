/**
 * adapters/iframe/web-entry.ts
 *
 * ROOGLE Iframe Agent Entry Point (Phase 7)
 *
 * This is the main entry point for running ROOGLE as an embeddable iframe agent.
 * - Starts a simple HTTP server (no extra deps).
 * - Serves a minimal Tailwind-based chat UI.
 * - Initializes SphereClient early using env (SPHERE_MNEMONIC etc.) for REAL SDK mode.
 * - Exposes /chat API that calls the core handleUserMessage.
 * - Discovery tools will use real SDK when available (via shared SphereClient singleton).
 * - User messages are always clean; thoughts available via debug toggle.
 *
 * Run locally:
 *   npm run dev:iframe
 *   # or
 *   npx tsx adapters/iframe/web-entry.ts
 *
 * Then open http://localhost:3001 (or PORT env).
 * The page can be loaded inside an <iframe> in Sphere.
 *
 * For production iframe usage inside sphere.unicity.network, host this page publicly
 * and register the URL as an agent (see README).
 */

import 'dotenv/config';
import http from 'http';
import { handleUserMessage } from '../../src/agent/roogle';
import { getSphereClient } from '../../src/sphere/client';
import type { UserMessage } from '../../src/interfaces/message';

// --- Early real SDK initialization (critical for Phase 7) ---
const sphereClient = getSphereClient();
sphereClient.initialize().then(() => {
  const mode = sphereClient.isUsingRealSdk() ? 'REAL' : 'MOCK';
  console.log(`[Iframe Server] Sphere SDK mode at startup: ${mode}`);
  if (sphereClient.isUsingRealSdk()) {
    console.log('[Iframe Server] ✅ Real Sphere SDK active — discovery & handoff will use live network.');
  } else {
    console.log('[Iframe Server] ⚠️  Mock mode active. Set SPHERE_MNEMONIC in .env for real mode.');
  }
}).catch((e) => {
  console.error('[Iframe Server] Sphere init error (falling back):', e.message);
});

// --- Simple in-memory chat history (per process, for demo) ---
const chatHistory: (UserMessage | { role: 'assistant'; content: string })[] = [];

// --- Minimal HTTP Server ---
const PORT = parseInt(process.env.PORT || '3001', 10);

const server = http.createServer(async (req, res) => {
  // Basic CORS for local iframe/dev testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // === STATUS (used by UI on load) ===
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mode: sphereClient.isUsingRealSdk() ? 'REAL' : 'MOCK',
      realSdk: sphereClient.isUsingRealSdk(),
      agentId: process.env.SPHERE_AGENT_ID || 'roogle-main',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // === CHAT API ===
  if (req.method === 'POST' && url.pathname === '/chat') {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const userText: string = body.message || '';

      if (!userText.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Empty message' }));
        return;
      }

      const userMsg: UserMessage = { role: 'user', content: userText };
      chatHistory.push(userMsg);

      // Call the existing core orchestrator (Grok + tools + Sphere)
      const response = await handleUserMessage(userMsg, chatHistory as any);

      chatHistory.push({ role: 'assistant', content: response.message });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: response.message,
        thoughts: response.thoughts || null,
        handoff: response.handoff || null,
        requiresConfirmation: !!response.requiresConfirmation,
      }));
    } catch (err: any) {
      console.error('[Iframe Server] /chat error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error', details: err.message }));
    }
    return;
  }

  // === SERVE THE CHAT UI (single file for simplicity) ===
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getChatHtml());
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found. Try / or /chat (POST)');
});

server.listen(PORT, () => {
  console.log(`[Iframe Server] ROOGLE Iframe Agent running at http://localhost:${PORT}`);
  console.log(`[Iframe Server] Open in browser or load as <iframe src="http://localhost:${PORT}">`);
  console.log(`[Iframe Server] Use "npm run dev:iframe" to start.`);
});

// --- The UI (Tailwind via CDN + vanilla JS) ---
function getChatHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ROOGLE — Iframe Agent</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; }
    .chat-container { scrollbar-width: thin; }
    .message { max-width: 80%; padding: 0.75rem 1rem; border-radius: 1rem; margin: 0.25rem 0; }
    .user { background: #3b82f6; color: white; margin-left: auto; border-bottom-right-radius: 0.25rem; }
    .assistant { background: #f1f5f9; color: #0f172a; margin-right: auto; border-bottom-left-radius: 0.25rem; }
    .thoughts { font-size: 0.75rem; background: #fefce8; border: 1px solid #fde047; padding: 0.5rem; border-radius: 0.5rem; white-space: pre-wrap; }
  </style>
</head>
<body class="bg-slate-950 text-slate-200">
  <div class="max-w-3xl mx-auto h-screen flex flex-col">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
      <div class="flex items-center gap-x-3">
        <div class="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg">R</div>
        <div>
          <div class="font-semibold text-xl">ROOGLE</div>
          <div class="text-xs text-slate-400 -mt-1">Iframe Agent • Unicity Sphere</div>
        </div>
      </div>
      <div class="flex items-center gap-x-3 text-sm">
        <div id="mode-badge" 
             class="px-3 py-1 rounded-full text-xs font-medium flex items-center gap-x-1.5 bg-slate-800">
          <span class="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
          <span id="mode-text">Connecting...</span>
        </div>
        <label class="flex items-center gap-x-1.5 text-xs cursor-pointer select-none">
          <input type="checkbox" id="show-thoughts" class="accent-blue-600">
          <span>Show thoughts (debug)</span>
        </label>
      </div>
    </div>

    <!-- Chat -->
    <div id="messages" 
         class="chat-container flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900 text-sm">
      <!-- messages injected here -->
    </div>

    <!-- Input -->
    <div class="p-3 border-t border-slate-800 bg-slate-950">
      <form id="chat-form" class="flex gap-2">
        <input id="message-input" 
               type="text" 
               placeholder="Talk to ROOGLE in plain English..."
               class="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 placeholder:text-slate-500"
               autocomplete="off">
        <button type="submit"
                class="px-6 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-2xl text-sm font-medium transition-colors">
          Send
        </button>
      </form>
      <div class="mt-1.5 text-[10px] text-slate-500 px-1">
        Real Sphere SDK preferred when configured. All internal reasoning stays private.
      </div>
    </div>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('message-input');
    const showThoughtsCb = document.getElementById('show-thoughts');
    const modeText = document.getElementById('mode-text');
    const modeBadge = document.getElementById('mode-badge');

    let lastThoughts = null;

    // Load status
    async function loadStatus() {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        const isReal = data.realSdk || data.mode === 'REAL';
        modeText.textContent = isReal ? 'REAL Sphere SDK' : 'MOCK (fallback)';
        modeBadge.className = isReal 
          ? 'px-3 py-1 rounded-full text-xs font-medium flex items-center gap-x-1.5 bg-emerald-900 text-emerald-300'
          : 'px-3 py-1 rounded-full text-xs font-medium flex items-center gap-x-1.5 bg-amber-900 text-amber-300';
        if (isReal) {
          modeBadge.querySelector('span').className = 'w-2 h-2 bg-emerald-400 rounded-full';
        }
      } catch (e) {
        modeText.textContent = 'Offline';
      }
    }

    function addMessage(role, content, thoughts = null) {
      const div = document.createElement('div');
      div.className = 'flex ' + (role === 'user' ? 'justify-end' : 'justify-start');

      const bubble = document.createElement('div');
      bubble.className = 'message ' + (role === 'user' ? 'user' : 'assistant');
      bubble.textContent = content;

      div.appendChild(bubble);

      if (role === 'assistant' && thoughts) {
        const debug = document.createElement('div');
        debug.className = 'mt-1 ml-1 text-[10px]';
        debug.innerHTML = \`
          <button class="text-amber-400 hover:underline" onclick="toggleThoughts(this, \${JSON.stringify(thoughts).replace(/"/g, '&quot;')})">
            🔍 show thoughts
          </button>
          <div class="thoughts mt-1 hidden"></div>
        \`;
        div.appendChild(debug);
      }

      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    window.toggleThoughts = function(btn, thoughts) {
      const container = btn.parentElement.querySelector('.thoughts');
      if (container.classList.contains('hidden')) {
        container.textContent = thoughts;
        container.classList.remove('hidden');
        btn.textContent = '🔼 hide thoughts';
      } else {
        container.classList.add('hidden');
        btn.textContent = '🔍 show thoughts';
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      addMessage('user', text);
      input.value = '';
      input.disabled = true;

      // thinking indicator
      const thinking = document.createElement('div');
      thinking.className = 'flex justify-start';
      thinking.innerHTML = '<div class="message assistant italic opacity-70">ROOGLE is thinking...</div>';
      messagesEl.appendChild(thinking);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      try {
        const res = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();

        // remove thinking
        thinking.remove();

        addMessage('assistant', data.message, data.thoughts);

        // optional auto-show thoughts if checkbox checked
        if (showThoughtsCb.checked && data.thoughts) {
          // last added has the button
          const lastDebugBtn = messagesEl.lastElementChild.querySelector('button');
          if (lastDebugBtn) {
            lastDebugBtn.click();
          }
        }

        // show handoff hint in debug if present
        if (data.handoff) {
          console.log('%c[Handoff received]', 'color:#64748b', data.handoff);
        }
      } catch (err) {
        thinking.remove();
        addMessage('assistant', 'Sorry, something went wrong. Please try again.');
        console.error(err);
      } finally {
        input.disabled = false;
        input.focus();
      }
    });

    // Keyboard shortcut
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // form submit handles it
      }
    });

    // Initial status + welcome
    async function initUI() {
      await loadStatus();
      addMessage('assistant', "Hi! I'm ROOGLE, your friendly orchestrator in Unicity Sphere. How can I help you today?");
      input.focus();
    }

    // Global toggle listener
    showThoughtsCb.addEventListener('change', () => {
      // visual hint only — actual expansion happens per-message
      console.log('Thoughts visibility preference changed');
    });

    initUI();
  </script>
</body>
</html>`;
  }

