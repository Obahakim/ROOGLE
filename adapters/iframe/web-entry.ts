/**
 * adapters/iframe/web-entry.ts
 *
 * ROOGLE server entry point.
 *
 * This server does exactly two things:
 *   1. Serves the static client app (public/) — the bento dashboard that
 *      connects to a user's own wallet via Sphere Connect and performs all
 *      balance/send/swap actions in the browser, against their wallet.
 *   2. Exposes POST /api/parse — a small, stateless, LLM-free text parser
 *      for the free-text prompt box ("send 10 UCT to @hexz"). Pure regex,
 *      no network calls, no wallet access.
 *
 * There is intentionally no server-side Sphere SDK usage and no LLM call
 * anywhere in this file. Every action that touches value or identity
 * happens client-side, against the user's own connected wallet.
 */

import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../../config/index';
import {
  classifyPromptIntent,
  extractSendTokensArgs,
  extractSwapArgs,
  describeMissingSendTokensFields,
  describeMissingSwapFields,
} from '../../src/lib/extraction';

const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const parseRequestSchema = z.object({
  text: z.string().min(1).max(500),
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Parses a free-text prompt into a structured send or swap action.
 * Pure regex — see src/lib/extraction.ts. No LLM, no network call.
 */
function handleParse(text: string) {
  const intent = classifyPromptIntent(text);

  if (intent === 'send') {
    const args = extractSendTokensArgs(text);
    const missing = describeMissingSendTokensFields({ to: args.to, amount: args.amount });
    return { intent, args, missing };
  }

  if (intent === 'swap') {
    const args = extractSwapArgs(text);
    const missing = describeMissingSwapFields(args);
    return { intent, args, missing };
  }

  return {
    intent: 'unknown' as const,
    args: null,
    missing: "I can help with sending tokens or requesting a payment. Try something like \"send 10 UCT to @hexz\".",
  };
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  let reqPath = (req.url || '/').split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, reqPath);

  // Prevent path traversal outside the public dir.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-style fallback: unknown paths get index.html so client-side
      // routing (if any) can take over.
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackErr, fallbackData) => {
        if (fallbackErr) {
          res.writeHead(404);
          res.end('Not found. Run "npm run build:client" first.');
          return;
        }
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] });
        res.end(fallbackData);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  if (url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (url === '/api/parse' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000) req.destroy(); // guard against oversized bodies
    });
    req.on('end', () => {
      try {
        const parsed = parseRequestSchema.safeParse(JSON.parse(body || '{}'));
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Expected a non-empty "text" field.' });
          return;
        }
        sendJson(res, 200, handleParse(parsed.data.text));
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body.' });
      }
    });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(404);
  res.end('Not found.');
});

server.listen(config.port, () => {
  console.log(`[ROOGLE] Serving on http://localhost:${config.port}`);
  console.log('[ROOGLE] No server-side wallet, no LLM — every action runs against the user\'s own connected wallet in the browser.');
});