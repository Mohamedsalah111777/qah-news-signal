const WebSocket = require('ws');

const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port });

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
      console.log(Disconnected: ${role});
    }
  });
});

console.log(WebSocket signaling server running on port ${port});
