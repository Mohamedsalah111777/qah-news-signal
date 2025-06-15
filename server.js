import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import os from 'os';

// Fix __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const port = process.env.PORT || 3000;

// تحسينات الأمان
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// معدل الحد للطلبات (Rate Limiting)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100 // حد كل IP إلى 100 طلب لكل نافذة
});
app.use(limiter);

// تقديم ملفات static مع تحسينات Caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guest.html'));
});

// نظام الإشارات WebRTC مع تحسينات
const clients = {
  guests: new Set(),
  studios: new Set()
};

// تحسينات WebSocket
wss.on('connection', (ws, req) => {
  console.log(`New connection from ${req.socket.remoteAddress}`);
  let role = null;

  // Heartbeat لمراقبة الاتصال
  let isAlive = true;
  const heartbeatInterval = setInterval(() => {
    if (!isAlive) return ws.terminate();
    isAlive = false;
    ws.ping();
  }, 30000);

  ws.on('pong', () => { isAlive = true; });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'register') {
        role = msg.role;
        const clientSet = role === 'guest' ? clients.guests : clients.studios;
        clientSet.add(ws);
        console.log(`Registered: ${role} (Total: ${clientSet.size})`);
        
        // إرسال تأكيد التسجيل
        ws.send(JSON.stringify({ 
          type: 'registration-confirmed',
          role,
          timestamp: Date.now()
        }));
      } 
      else if (msg.type === 'signal') {
        const targetSet = msg.target === 'studio' ? clients.studios : clients.guests;
        
        targetSet.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'signal',
              from: role,
              payload: msg.payload
            }));
          }
        });
      }
    } catch (err) {
      console.error('Message parsing error:', err);
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeatInterval);
    if (role === 'guest') clients.guests.delete(ws);
    else if (role === 'studio') clients.studios.delete(ws);
    console.log(`${role || 'Unknown'} disconnected`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// معالجة الأخطاء
server.on('error', (err) => {
  console.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

// للحصول على عنوان IP المحلي
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Accessible at:
  - Local: http://localhost:${port}
  - Network: http://${getLocalIpAddress()}:${port}`);
});
