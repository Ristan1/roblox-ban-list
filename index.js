// Impor pustaka yang kita perlukan
const express = require('express');
const { Octokit } = require("@octokit/rest");

// Inisialisasi server express
const app = express();
app.use(express.json()); // Agar bisa membaca data JSON dari Roblox

// Ambil semua rahasia kita dari Environment Variables
const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  FILE_PATH,
  ROBLOX_SECRET
} = process.env;

// Inisialisasi klien GitHub dengan Token (kunci) kita
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- FUNGSI UNTUK MENDAPATKAN FILE (Dipakai bersama) ---
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
    let currentSha = fileData.sha;
    return { fileContent, currentSha };

  } catch (e) {
    if (e.status === 404) {
      console.log("File tidak ditemukan, akan membuat baru.");
      return { fileContent: { banned_users: {} }, currentSha: null };
    } else {
      console.error("Error saat MENGAMBIL file dari GitHub:", e.message);
      throw new Error(`Gagal mengambil file: ${e.message}`);
    }
  }
}

// --- FUNGSI UNTUK MENYIMPAN FILE (Dipakai bersama) ---
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

// =======================================================
// ==          ENDPOINT 1: BAN PLAYER (TETAP SAMA)      ==
// =======================================================
app.post("/ban-player", async (req, res) => {
  // 1. Verifikasi Keamanan
  if (req.header("X-Roblox-Secret") !== ROBLOX_SECRET) {
    return res.status(401).send({ status: "error", message: "Unauthorized" });
  }

  // 2. Dapatkan Data
  const { userId, username } = req.body;
  if (!userId || !username) {
    return res.status(400).send({ status: "error", message: "userId atau username hilang" });
  }
  console.log(`Menerima permintaan BAN untuk: ${username} (ID: ${userId})`);

  // 3. Proses ke GitHub
  try {
    const { fileContent, currentSha } = await getGithubFile();

    // Tambahkan data ban
    fileContent.banned_users[String(userId)] = {
      username: username,
      banned_at: new Date().toISOString()
    };

    // Simpan file
    await saveGithubFile(fileContent, currentSha, `[BOT] Menambahkan blokir untuk ${username}`);

    console.log("Berhasil memperbarui file (BAN).");
    res.status(200).send({ status: "success", message: "Pemain berhasil diblokir." });

  } catch (error) {
    console.error("Kesalahan fatal saat BAN:", error);
    res.status(500).send({ status: "error", message: "Internal Server Error", detail: error.message });
  }
});

// =======================================================
// ==          ENDPOINT 2: UNBAN PLAYER (BARU)          ==
// =======================================================
app.post("/unban-player", async (req, res) => {
  // 1. Verifikasi Keamanan
  if (req.header("X-Roblox-Secret") !== ROBLOX_SECRET) {
    return res.status(401).send({ status: "error", message: "Unauthorized" });
  }

  // 2. Dapatkan Data
  const { userId, username } = req.body; 
  if (!userId) {
    return res.status(400).send({ status: "error", message: "userId hilang" });
  }
  console.log(`Menerima permintaan UNBAN untuk: ${username} (ID: ${userId})`);

  // 3. Proses ke GitHub
  try {
    const { fileContent, currentSha } = await getGithubFile();

    // Hapus data ban
    if (fileContent.banned_users[String(userId)]) {
      delete fileContent.banned_users[String(userId)];
      console.log("UserId ditemukan dan dihapus.");
    } else {
      console.log("UserId tidak ditemukan di daftar, tidak ada yang dihapus.");
    }

    // Simpan file
    await saveGithubFile(fileContent, currentSha, `[BOT] Menghapus blokir untuk ${username}`);

    console.log("Berhasil memperbarui file (UNBAN).");
    res.status(200).send({ status: "success", message: "Pemain berhasil di-unban." });

  } catch (error) {
    console.error("Kesalahan fatal saat UNBAN:", error);
    res.status(500).send({ status: "error", message: "Internal Server Error", detail: error.message });
  }
});

// Baris ini memberitahu Vercel cara menjalankan skrip
module.exports = app;
