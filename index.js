// Impor pustaka yang kita perlukan
const express = require('express');
const { Octokit } = require("@octokit/rest");

// Inisialisasi server express
const app = express();
app.use(express.json({ limit: '1mb' })); // Batasi ukuran body

// Ambil semua rahasia dari Environment Variables
const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  FILE_PATH = "banned_users.json", // Default jika tidak di-set
  ROBLOX_SECRET
} = process.env;

// Validasi environment variables
if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO || !ROBLOX_SECRET) {
  console.error("❌ Environment variables tidak lengkap! Pastikan semua diset di Vercel.");
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Rate-limit sederhana (hindari spam)
const requestCounts = new Map();
const MAX_REQUESTS = 10;
const WINDOW_MS = 60 * 1000; // 1 menit

function isRateLimited(ip) {
  const now = Date.now();
  const requests = requestCounts.get(ip) || { count: 0, resetTime: now + WINDOW_MS };

  if (now > requests.resetTime) {
    requests.count = 0;
    requests.resetTime = now + WINDOW_MS;
  }

  if (requests.count >= MAX_REQUESTS) {
    return true;
  }

  requests.count++;
  requestCounts.set(ip, requests);
  return false;
}

// --- FUNGSI: Ambil file dari GitHub ---
async function getGithubFile() {
  try {
    const { data: fileData } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: FILE_PATH,
    });

    let fileContent = { banned_users: {} };
    if (fileData.content) {
      fileContent = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
    }
    return { fileContent, currentSha: fileData.sha };

  } catch (e) {
    if (e.status === 404) {
      console.log("📁 File tidak ditemukan di GitHub. Akan dibuat baru.");
      return { fileContent: { banned_users: {} }, currentSha: null };
    } else {
      console.error("💥 Gagal mengambil file dari GitHub:", e.message);
      throw e;
    }
  }
}

// --- FUNGSI: Simpan file ke GitHub ---
async function saveGithubFile(fileContent, currentSha, commitMessage) {
  const newContentBase64 = Buffer.from(JSON.stringify(fileContent, null, 2)).toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: FILE_PATH,
    message: commitMessage,
    content: newContentBase64,
    sha: currentSha,
  });
}

// --- MIDDLEWARE: Verifikasi dan rate-limit ---
function verifyRequest(req, res, next) {
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  if (isRateLimited(clientIP)) {
    return res.status(429).json({ status: "error", message: "Terlalu banyak permintaan. Coba lagi nanti." });
  }

  if (req.headers["x-roblox-secret"] !== ROBLOX_SECRET) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }

  next();
}

// =======================================================
// ==          ENDPOINT: BAN PLAYER                     ==
// =======================================================
app.post("/ban-player", verifyRequest, async (req, res) => {
  const { userId, username, displayName } = req.body;

  // ✅ Validasi: semua field wajib & tipe data benar
  if (!userId || !username || !displayName) {
    return res.status(400).json({
      status: "error",
      message: "Field 'userId', 'username', dan 'displayName' wajib diisi."
    });
  }

  // Konversi userId ke string (konsisten dengan Roblox & file JSON)
  const userIdStr = String(userId).trim();
  const cleanUsername = String(username).trim();
  const cleanDisplayName = String(displayName).trim();

  if (!userIdStr || !cleanUsername || !cleanDisplayName) {
    return res.status(400).json({ status: "error", message: "Data tidak valid (kosong)." });
  }

  console.log(`📥 BAN diminta: ${cleanDisplayName} (@${cleanUsername}) | ID: ${userIdStr}`);

  try {
    const { fileContent, currentSha } = await getGithubFile();

    // Jika sudah diblokir, kembalikan sukses tanpa ubah apa-apa
    if (fileContent.banned_users[userIdStr]) {
      console.log(`ℹ️ UserID ${userIdStr} sudah diblokir.`);
      return res.status(200).json({ status: "success", message: "Pemain sudah diblokir." });
    }

    // Tambahkan ke daftar
    fileContent.banned_users[userIdStr] = {
      username: cleanUsername,
      displayName: cleanDisplayName
    };

    await saveGithubFile(fileContent, currentSha, `[BAN] ${cleanDisplayName} (@${cleanUsername})`);
    console.log(`✅ Berhasil blokir: ${userIdStr}`);
    res.status(200).json({ status: "success", message: "Pemain berhasil diblokir." });

  } catch (error) {
    console.error("💥 Error saat BAN:", error.message);
    res.status(500).json({ status: "error", message: "Gagal memproses ban.", detail: error.message });
  }
});

// =======================================================
// ==          ENDPOINT: UNBAN PLAYER                   ==
// =======================================================
app.post("/unban-player", verifyRequest, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ status: "error", message: "Field 'userId' wajib diisi." });
  }

  const userIdStr = String(userId).trim();
  if (!userIdStr) {
    return res.status(400).json({ status: "error", message: "UserID tidak valid." });
  }

  console.log(`📤 UNBAN diminta untuk ID: ${userIdStr}`);

  try {
    const { fileContent, currentSha } = await getGithubFile();

    if (!fileContent.banned_users[userIdStr]) {
      console.log(`ℹ️ UserID ${userIdStr} tidak ditemukan di daftar ban.`);
      return res.status(200).json({ status: "success", message: "Pemain tidak dalam daftar ban." });
    }

    const userData = fileContent.banned_users[userIdStr];
    delete fileContent.banned_users[userIdStr];

    await saveGithubFile(fileContent, currentSha, `[UNBAN] ${userData.displayName} (@${userData.username})`);
    console.log(`✅ Berhasil unban: ${userIdStr}`);
    res.status(200).json({ status: "success", message: "Pemain berhasil di-unban." });

  } catch (error) {
    console.error("💥 Error saat UNBAN:", error.message);
    res.status(500).json({ status: "error", message: "Gagal memproses unban.", detail: error.message });
  }
});

// =======================================================
// ==          ENDPOINT: GET BAN LIST                   ==
// =======================================================
app.get("/ban-list", verifyRequest, async (req, res) => {
  console.log("📥 Permintaan daftar ban diterima.");

  try {
    const { fileContent } = await getGithubFile();
    res.status(200).json({
      status: "success",
      banned_users: fileContent.banned_users || {}
    });

  } catch (error) {
    console.error("💥 Error saat ambil daftar ban:", error.message);
    res.status(500).json({ status: "error", message: "Gagal mengambil daftar ban." });
  }
});

// =======================================================
// ==          ENDPOINT: CHECK BAN (Opsional)           ==
// =======================================================
app.post("/check-ban", verifyRequest, async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ status: "error", message: "Field 'userId' wajib diisi." });
  }

  const userIdStr = String(userId).trim();
  if (!userIdStr) {
    return res.status(400).json({ status: "error", message: "UserID tidak valid." });
  }

  try {
    const { fileContent } = await getGithubFile();
    const user = fileContent.banned_users[userIdStr];

    res.status(200).json({
      status: "success",
      userId: userIdStr,
      is_banned: !!user,
      user_data: user || null
    });

  } catch (error) {
    console.error("💥 Error saat cek ban:", error.message);
    res.status(500).json({ status: "error", message: "Gagal memeriksa status ban." });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ status: "error", message: "Endpoint tidak ditemukan." });
});

module.exports = app;
