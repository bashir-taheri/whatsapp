const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const P = require("pino");
const http = require("http");

const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = "93745872028";

// ============ GROQ AI CONFIGURATION ============
const GROQ_API_KEY = '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';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// تاریخچه مکالمه
const conversations = new Map();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("WhatsApp Bot Running");
}).listen(PORT);

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "connecting") {
      console.log("🔄 Connecting...");
    }

    if (connection === "open") {
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      }
    }
  });

  if (!state.creds.registered) {
    try {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const code = await sock.requestPairingCode(PHONE_NUMBER);

      console.log("===============================");
      console.log("PAIRING CODE:");
      console.log(code);
      console.log("===============================");
    } catch (err) {
      console.log(err);
    }
  }

  // تابع درخواست به Groq
  async function askGroq(userMessage, history = []) {
    const messages = [
      {
        role: "system",
        content: "تو یک دستیار مفید، دوستانه و فارسی‌زبان هستی. پاسخ‌ها رو مختصر، مفید و به زبان فارسی بده. از ایموجی‌های مناسب استفاده کن."
      },
      ...history,
      {
        role: "user",
        content: userMessage
      }
    ];

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    const data = await response.json();
    return data.choices[0]?.message?.content || "ببخشید، نتونستم جواب بدم 🤔";
  }

  // پاسخ با Groq
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!text) return;

    const userId = msg.key.remoteJid;
    
    await sock.sendPresenceUpdate("composing", userId);

    try {
      if (!conversations.has(userId)) {
        conversations.set(userId, []);
      }
      
      const history = conversations.get(userId);

      // گرفتن پاسخ از Groq
      const aiResponse = await askGroq(text, history);

      // ذخیره در تاریخچه
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: aiResponse });

      // محدود کردن تاریخچه به 10 پیام آخر
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }

      // ارسال پاسخ
      await sock.sendMessage(userId, {
        text: aiResponse
      });

    } catch (error) {
      console.error("❌ خطا:", error);
      await sock.sendMessage(userId, {
        text: "⚠️ مشکلی پیش اومد. لطفاً دوباره تلاش کن."
      });
    } finally {
      await sock.sendPresenceUpdate("paused", userId);
    }
  });
}

startBot();
