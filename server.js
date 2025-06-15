import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import fs from 'fs';

// Fix __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const port = process.env.PORT || 3000;

// قائمة النطاقات المسموح بها (اضف نطاقاتك هنا)
const allowedOrigins = [
  'https://qah-news-signal.onrender.com',
  'http://localhost:3000'
];

// Middlewares
app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Static Files with proper headers
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath);
    switch (ext) {
      case '.html':
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        break;
      case '.js':
        res.setHeader('Content-Type', 'application/javascript');
        break;
      case '.css':
        res.setHeader('Content-Type', 'text/css');
        break;
    }
  }
}));

// Enable CORS for WebSocket
server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Routes
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'studio.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('الصفحة الرئيسية غير متوفرة');
  }
});

app.get('/guest.html', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'guest.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('صفحة الضيف غير متوفرة');
  }
});

app.get('/studio.html', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'studio.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('صفحة الاستوديو غير متوفرة');
  }
});

// WebSocket Logic
const clients = {
  guests: new Set(),
  studios: new Set()
};

wss.on('connection', (ws, req) => {
  console.log(`New connection from ${req.socket.remoteAddress || req.headers['x-forwarded-for']}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'register') {
        const clientSet = msg.role === 'guest' ? clients.guests : clients.studios;
        clientSet.add(ws);
        console.log(`Registered: ${msg.role}`);
        
        // إرسال تأكيد التسجيل
        ws.send(JSON.stringify({
          type: 'registration-confirmed',
          role: msg.role,
          timestamp: Date.now()
        }));
      }
      
      // معالجة أنواع الرسائل الأخرى
      if (msg.type === 'signal') {
        const target = msg.target === 'guest' ? clients.guests : clients.studios;
        target.forEach(client => {
          if (client !== ws && client.readyState === ws.OPEN) {
            client.send(JSON.stringify(msg));
          }
        });
      }
      
    } catch (err) {
      console.error('Message error:', err);
    }
  });

  ws.on('close', () => {
    // تنظيف العملاء المتصلين
    clients.guests.delete(ws);
    clients.studios.delete(ws);
    console.log('Client disconnected');
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('حدث خطأ في الخادم');
});

// Debugging: قائمة الملفات في مجلد public
console.log('Available files in public directory:', 
  fs.readdirSync(path.join(__dirname, 'public')));

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`WebSocket server ready at ws://localhost:${port}`);
});
