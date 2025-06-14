const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const port = process.env.PORT || 3000;

// تقديم الملفات من مجلد public
app.use(express.static(path.join(__dirname, 'public')));

// إنشاء سيرفر HTTP
const server = http.createServer(app);

// إنشاء WebSocket سيرفر
const wss = new WebSocket.Server({ server });

const clients = {
  guest: null,
  studio: null
};

wss.on('connection', ws => {
  let role = null;

  ws.on('message', message => {
    const msg = JSON.parse(message);

    if (msg.type === 'register') {
      role = msg.role;
      clients[role] = ws;
      console.log(`Registered: ${role}`);
    }

    if (msg.type === 'signal' && clients[msg.target]) {
      clients[msg.target].send(JSON.stringify({
        type: 'signal',
        from: role,
        payload: msg.payload
      }));
    }
  });

  ws.on('close', () => {
    if (role && clients[role] === ws) {
      clients[role] = null;
      console.log(`Disconnected: ${role}`);
    }
  });
});

// بدء السيرفر
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
