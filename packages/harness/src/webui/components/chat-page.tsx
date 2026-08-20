import { FC, PropsWithChildren } from 'hono/jsx';
import { MessageList } from './message-list.js';
import { InputForm } from './input-form.js';

interface ChatPageProps {
  session_id: number;
  io_host: string;
  io_port: number;
}

export const ChatPage: FC<ChatPageProps> = ({ session_id, io_host, io_port }) => {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Sage - Agent Chat</title>
        <style>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: #f5f5f5;
            color: #333;
            height: 100vh;
            display: flex;
          }

          #app {
            flex: 1;
            display: flex;
            flex-direction: column;
            width: 100%;
          }

          .q-chat-header {
            background: white;
            border-bottom: 1px solid #ddd;
            padding: 1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
          }

          .q-chat-header h1 {
            font-size: 1.5rem;
            font-weight: 600;
          }

          .q-status-indicator {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            font-size: 0.8rem;
            color: #888;
          }

          .q-status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ccc;
            transition: background 0.3s;
          }

          .q-status-dot.idle {
            background: #aaa;
          }

          .q-status-dot.working {
            background: #28a745;
            animation: pulse 1.2s ease-in-out infinite;
          }

          .q-status-dot.disconnected {
            background: #dc3545;
          }

          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }

          .q-messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 1rem;
          }

          .q-messages-list {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }

          .q-message {
            padding: 0.75rem 1rem;
            border-radius: 0.5rem;
            max-width: 70%;
            word-wrap: break-word;
            white-space: pre-wrap;
          }

          .q-message-user {
            align-self: flex-end;
            background: #007bff;
            color: white;
          }

          .q-message-assistant {
            align-self: flex-start;
            background: #e9ecef;
            color: #333;
          }

          .q-message-error {
            align-self: center;
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
          }

          .q-message-tool {
            align-self: flex-start;
            background: #eef2ff;
            color: #4338ca;
            font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
            font-size: 0.8rem;
            border-left: 3px solid #818cf8;
            max-width: 85%;
          }

          .q-message-system {
            align-self: center;
            color: #888;
            font-size: 0.8rem;
            font-style: italic;
            padding: 0.25rem 0.75rem;
            background: transparent;
          }

          .q-permission-prompt {
            align-self: center;
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 0.5rem;
            padding: 0.75rem 1rem;
            max-width: 80%;
            text-align: center;
          }

          .q-permission-prompt .q-permission-label {
            font-weight: 600;
            font-size: 0.85rem;
            margin-bottom: 0.25rem;
          }

          .q-permission-prompt .q-permission-tool {
            font-size: 0.8rem;
            color: #666;
            margin-bottom: 0.5rem;
          }

          .q-permission-buttons {
            display: flex;
            gap: 0.5rem;
            justify-content: center;
          }

          .q-permission-buttons button {
            padding: 0.35rem 1rem;
            border: none;
            border-radius: 0.25rem;
            font-weight: 600;
            font-size: 0.8rem;
            cursor: pointer;
            transition: background 0.2s;
          }

          .q-permission-allow {
            background: #28a745;
            color: white;
          }

          .q-permission-allow:hover {
            background: #218838;
          }

          .q-permission-deny {
            background: #dc3545;
            color: white;
          }

          .q-permission-deny:hover {
            background: #c82333;
          }

          .q-permission-content {
            max-height: 200px;
            overflow-y: auto;
            background: #fff8e1;
            border: 1px solid #ffe082;
            border-radius: 0.25rem;
            padding: 0.5rem;
            margin-bottom: 0.5rem;
            font-family: monospace;
            font-size: 0.75rem;
            text-align: left;
            white-space: pre-wrap;
            word-break: break-word;
          }

          .q-permission-feedback {
            width: 100%;
            padding: 0.5rem;
            border: 1px solid #ddd;
            border-radius: 0.25rem;
            font-family: inherit;
            font-size: 0.8rem;
            resize: vertical;
            margin-bottom: 0.5rem;
            min-height: 2.5rem;
          }

          .q-permission-feedback:focus {
            outline: none;
            border-color: #ffc107;
            box-shadow: 0 0 0 2px rgba(255, 193, 7, 0.25);
          }

          .q-permission-hint {
            font-size: 0.75rem;
            color: #999;
            margin-top: 0.2rem;
            margin-bottom: 0.3rem;
            font-style: italic;
          }

          .q-permission-resolved .q-permission-hint {
            display: none;
          }

          .q-permission-options {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
            margin-bottom: 0.5rem;
            justify-content: center;
          }

          .q-permission-option {
            padding: 0.3rem 0.75rem;
            border: 1px solid #ccc;
            border-radius: 1rem;
            background: white;
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
          }

          .q-permission-option:hover {
            background: #fff3cd;
            border-color: #ffc107;
          }

          .q-permission-resolved {
            opacity: 0.5;
          }

          .q-permission-resolved button,
          .q-permission-resolved .q-permission-feedback,
          .q-permission-resolved .q-permission-option {
            display: none;
          }

          .q-input-section {
            background: white;
            border-top: 1px solid #ddd;
            padding: 1rem;
          }

          .q-input-form {
            display: flex;
            gap: 0.5rem;
          }

          .q-input-textarea {
            flex: 1;
            padding: 0.75rem;
            border: 1px solid #ddd;
            border-radius: 0.25rem;
            font-family: inherit;
            font-size: inherit;
            resize: vertical;
          }

          .q-input-textarea:focus {
            outline: none;
            border-color: #007bff;
            box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.25);
          }

          .q-submit-button {
            padding: 0.75rem 1.5rem;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 0.25rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
          }

          .q-submit-button:hover {
            background: #0056b3;
          }

          .q-submit-button:active {
            background: #004085;
          }
        `}</style>
      </head>
      <body>
        <div id="app">
          <header class="q-chat-header">
            <h1>Sage</h1>
            <div class="q-status-indicator">
              <span id="status-dot" class="q-status-dot disconnected"></span>
              <span id="status-label">disconnected</span>
            </div>
          </header>

          <MessageList />

          <section class="q-input-section">
            <InputForm />
          </section>
        </div>

        <script dangerouslySetInnerHTML={{ __html: `
          // Session ID provided by server
          let currentSessionId = ${session_id};

          // Build WebSocket URL with session_id as query param
          const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = wsProtocol + '//' + '${io_host}' + ':' + '${io_port}' + '/ws?session_id=' + currentSessionId;

          const ws = new WebSocket(wsUrl);
          const messagesList = document.getElementById('messages-list');
          const messageForm = document.getElementById('message-form');
          const messageInput = document.getElementById('message-input');
          const statusDot = document.getElementById('status-dot');
          const statusLabel = document.getElementById('status-label');

          function setStatus(state) {
            statusDot.className = 'q-status-dot ' + state;
            statusLabel.textContent = state;
          }

          // Connection status
          ws.addEventListener('open', () => {
            console.log('Connected to Sage');
            setStatus('idle');
          });

          ws.addEventListener('close', () => {
            console.log('Disconnected from Sage');
            setStatus('disconnected');
          });

          ws.addEventListener('error', (event) => {
            console.error('WebSocket error:', event);
            setStatus('disconnected');
            appendMessage('Connection error', 'error');
          });

          // Format params for display (compact single-line JSON, truncated)
          function formatParams(params) {
            if (!params || Object.keys(params).length === 0) return '';
            const str = JSON.stringify(params);
            return str.length > 128 ? str.slice(0, 125) + '...' : str;
          }

          // Extract displayable text and CSS class from message blocks.
          // Returns { text, cssClass } or null if the block should not be displayed.
          function getDisplayInfo(block) {
            switch (block.type) {
              case 'text': return { text: block.text, cssClass: 'assistant' };
              case 'thinking': return { text: '💭 ' + block.text, cssClass: 'assistant' };
              case 'thinking_redacted': return { text: '💭 [redacted]', cssClass: 'assistant' };
              case 'tool_use_req': {
                const args = formatParams(block.params);
                return { text: '🔧 ' + block.tool + (args ? ' ' + args : ''), cssClass: 'tool' };
              }
              case 'tool_use_res': return null;
              case 'tool_use_err': return { text: '[Tool error: ' + (block.error?.map(e => e.text).join(' ') || 'unknown') + ']', cssClass: 'error' };
              case 'unsupported': return { text: '[Unsupported: ' + block.text + ']', cssClass: 'assistant' };
              default: throw new Error('Unknown block type: ' + block.type);
            }
          }

          // Handle incoming messages from agent
          ws.addEventListener('message', (event) => {
            try {
              const msg = JSON.parse(event.data);
              console.log('Received:', msg.role, msg);
              const block = msg.block;

              const info = getDisplayInfo(block);
              if (!info) return; // Skip non-displayable blocks

              if (msg.role === 'agent') {
                appendMessage(info.text, info.cssClass);
                // Reset to idle when response is complete
                setStatus('idle');
              } else if (msg.role === 'user') {
                appendMessage(info.text, 'user');
                // Set to working when user message is sent (waiting for agent response)
                setStatus('working');
              }

            } catch (err) {
              console.error('Failed to parse message:', err);
              appendMessage('Failed to parse message', 'error');
            }
          });

          function submitMessage() {
            const content = messageInput.value.trim();
            if (!content) return;

            // Send to server
            ws.send(JSON.stringify({
              role: 'user',
              block: { type: 'text', text: content },
            }));

            // Clear input
            messageInput.value = '';
            messageInput.focus();
          }

          // Handle form submission
          messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitMessage();
          });

          // Handle Cmd+Enter / Ctrl+Enter
          messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submitMessage();
            }
          });

          function appendMessage(content, type) {
            const li = document.createElement('li');
            li.className = 'q-message q-message-' + type;
            li.textContent = content;
            messagesList.appendChild(li);

            // Scroll to bottom
            const container = document.getElementById('messages-container');
            container.scrollTop = container.scrollHeight;
          }

        `}} />
      </body>
    </html>
  );
};
