import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';

// Fix __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const port = process.env.PORT || 3000;

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'studio.html'));
});

// WebSocket Logic
const clients = {
  guests: new Set(),
  studios: new Set()
};

wss.on('connection', (ws, req) => {
  console.log(`New connection from ${req.socket.remoteAddress}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'register') {
        const clientSet = msg.role === 'guest' ? clients.guests : clients.studios;
        clientSet.add(ws);
        console.log(`Registered: ${msg.role}`);
      }
      
      // Add other message handlers here
    } catch (err) {
      console.error('Message error:', err);
    }
  });

  ws.on('close', () => {
    // Clean up disconnected clients
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
