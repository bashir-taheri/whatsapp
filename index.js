const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const P = require("pino");
const http = require("http");
const Groq = require("groq-sdk");

// تنظیمات
const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = (process.env.OWNER_PHONE || "93745872028").replace(/[^0-9]/g, "");
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OWNER_NAME = process.env.OWNER_NAME || "User";

if (!GROQ_API_KEY) {
  console.error("GROQ_API_KEY not set");
  process.exit(1);
}

const groq = new Groq({ apiKey: GROQ_API_KEY });
const conversationHistory = new Map();
const userLastMessage = new Map();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot Running");
}).listen(PORT, () => {
  console.log("Server on port " + PORT);
});

async function getAIResponse(userMessage, userName, userId) {
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }

  const history = conversationHistory.get(userId);
  history.push({ role: "user", content: userName + ": " + userMessage });
  
  if (history.length > 15) {
    history.splice(0, history.length - 15);
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "شما دستیار هوشمند " + OWNER_NAME + " هستید. به فارسی صحبت کنید، صمیمی و کوتاه پاسخ دهید. بگویید صاحب اصلی در دسترس نیست و شما کمک می‌کنید. ایموجی استفاده کنید."
        },
        ...history.slice(-10)
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const aiResponse = completion.choices[0]?.message?.content || "ببخشید، الان نمیتونم جواب بدم 🙏";
    history.push({ role: "assistant", content: aiResponse });
    return aiResponse;
  } catch (error) {
    console.error("Groq Error:", error.message);
    return "مشکلی پیش اومد، لطفاً دوباره تلاش کنید ⚠️";
  }
}

function isSpam(userId) {
  const now = Date.now();
  const last = userLastMessage.get(userId) || 0;
  if (now - last < 2000) return true;
  userLastMessage.set(userId, now);
  return false;
}

async function startBot() {
  console.log("Starting bot...");
  
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.0"],
    markOnlineOnConnect: true
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "connecting") {
      console.log("Connecting...");
    }

    if (connection === "open") {
      console.log("Bot Connected!");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed");
      
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(() => startBot(), 5000);
      } else {
        console.log("Logged out, delete auth_info folder");
      }
    }
  });

  if (!state.creds.registered) {
    console.log("Generating pairing code...");
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    try {
      const code = await sock.requestPairingCode(PHONE_NUMBER);
      console.log("=================================");
      console.log("CODE: " + code);
      console.log("=================================");
    } catch (err) {
      console.error("Error:", err.message);
    }
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    if (msg.key.remoteJid === "status@broadcast") return;

    const jid = msg.key.remoteJid;
    const userId = jid.split("@")[0];

    if (isSpam(userId)) return;

    let text = msg.message.conversation || 
               msg.message.extendedTextMessage?.text || 
               msg.message.imageMessage?.caption || "";

    if (!text || text.trim().length === 0) return;

    const userName = msg.pushName || userId;
    console.log("Message from " + userName + ": " + text.substring(0, 50));

    try {
      await sock.sendPresenceUpdate("composing", jid);
      const response = await getAIResponse(text, userName, userId);
      await sock.sendMessage(jid, { text: response });
      await sock.sendPresenceUpdate("available", jid);
    } catch (error) {
      console.error("Send Error:", error.message);
      try {
        await sock.sendMessage(jid, { text: "ببخشید مشکلی پیش اومد 🙏" });
      } catch (e) {
        console.error(e.message);
      }
    }
  });
}

setInterval(() => {
  conversationHistory.clear();
  userLastMessage.clear();
}, 1800000);

console.log("Bot Starting...");
console.log("Owner: " + OWNER_NAME);
console.log("Phone: " + PHONE_NUMBER);

startBot().catch(err => {
  console.error("Fatal Error:", err.message);
  process.exit(1);
});
