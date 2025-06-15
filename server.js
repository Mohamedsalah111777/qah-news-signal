const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;

// تقديم ملفات static من مجلد public
app.use(express.static(path.join(__dirname, 'public')));

// routes (اختياري)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guest.html'));
});

// نظام الإشارات WebRTC
let guests = [];
let studios = [];

wss.on('connection', (ws) => {
  let role = null;

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    if (data.type === 'register') {
      role = data.role;
      if (role === 'guest') guests.push(ws);
      else if (role === 'studio') studios.push(ws);
      console.log(`Registered: ${role}`);
    } else if (data.type === 'signal') {
      const targetList = data.target === 'studio' ? studios : guests;
      targetList.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'signal',
            from: role,
            payload: data.payload
          }));
        }
      });
    }
  });

  ws.on('close', () => {
    if (role === 'guest') guests = guests.filter(client => client !== ws);
    else if (role === 'studio') studios = studios.filter(client => client !== ws);
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
