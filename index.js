const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const P = require("pino");
const http = require("http");
const Groq = require("groq-sdk");

const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = "93745872028";
const GROQ_API_KEY = "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"; // 👈 کلید API خودت رو بذار

// راه‌اندازی Groq
const groq = new Groq({ apiKey: GROQ_API_KEY });

// تاریخچه مکالمه (اختیاری - برای حافظه کوتاه‌مدت)
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
      console.log("Connection closed");

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

  // پاسخ خودکار با Groq AI
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];

    if (!msg.message || msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!text) return; // اگه پیام خالی بود، کاری نکن

    const userId = msg.key.remoteJid;
    
    // نشون دادن "در حال تایپ..."
    await sock.sendPresenceUpdate("composing", userId);

    try {
      // دریافت یا ایجاد تاریخچه برای این کاربر
      if (!conversations.has(userId)) {
        conversations.set(userId, []);
      }
      
      const history = conversations.get(userId);
      
      // اضافه کردن پیام کاربر به تاریخچه
      history.push({
        role: "user",
        content: text
      });

      // محدود کردن تاریخچه به 10 پیام آخر
      if (history.length > 10) {
        history.splice(0, history.length - 10);
      }

      // درخواست به Groq
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "تو یک دستیار مفید، دوستانه و فارسی‌زبان هستی. پاسخ‌ها رو مختصر، مفید و به زبان فارسی بده. از ایموجی‌های مناسب استفاده کن."
          },
          ...history
        ],
        model: "llama-3.3-70b-versatile", // یا mixtral-8x7b-32768
        temperature: 0.7,
        max_tokens: 1000,
      });

      const aiResponse = completion.choices[0]?.message?.content || "ببخشید، نتونستم جواب بدم 🤔";

      // ذخیره پاسخ در تاریخچه
      history.push({
        role: "assistant",
        content: aiResponse
      });

      // ارسال پاسخ
      await sock.sendMessage(userId, {
        text: aiResponse
      });

    } catch (error) {
      console.error("❌ خطا در Groq:", error);
      await sock.sendMessage(userId, {
        text: "⚠️ مشکلی پیش اومد. لطفاً دوباره تلاش کن."
      });
    } finally {
      // توقف "در حال تایپ..."
      await sock.sendPresenceUpdate("paused", userId);
    }
  });
}

startBot();
