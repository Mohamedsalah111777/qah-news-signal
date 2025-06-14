const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });

let clients = {};

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.error('Invalid JSON:', message);
      return;
    }

    const { type, role, target, payload } = data;

    // تسجيل العميل حسب دوره
    if (type === 'register') {
      clients[role] = ws;
      console.log(`${role} connected`);
      return;
    }

    // إرسال الرسالة للطرف الآخر
    if (type === 'signal' && target && clients[target]) {
      clients[target].send(JSON.stringify({
        type: 'signal',
        from: role,
        payload
      }));
    }
  });

  ws.on('close', () => {
    for (let role in clients) {
      if (clients[role] === ws) {
        console.log(`${role} disconnected`);
        delete clients[role];
      }
    }
  });
});

console.log('Signaling server running on ws://localhost:3000');