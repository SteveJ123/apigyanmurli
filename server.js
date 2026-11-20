require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

const app = express();
// app.use(cors());
const allowedOrigins = [
  "https://www.gyanmurli.younghappyandhealthy.com",
  "https://gyanmurli.younghappyandhealthy.com", // Include both with and without 'www'
  "http://localhost:3000", // For local development
  "http://localhost:5173", // Vite local port (if using Vite)
  "http://localhost:4200", // Angular local port
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like Postman, Curl, or mobile apps)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        console.error("CORS blocked origin:", origin);
        // Pass false instead of an Error object to prevent 500 crashes
        return callback(null, false);
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-language",
      "X-Language",
      "Accept",
      "*",
    ],
    AllowedOrigins: ["*"],
    ExposeHeaders: [],
    credentials: true,
    optionsSuccessStatus: 200, // Fixes issues with legacy browsers/proxies
  }),
);
app.use(express.json());

// MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// AWS S3 Client
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer in-memory storage for S3 streaming
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
});

const uploadFields = upload.fields([
  { name: 'textHtmlFile', maxCount: 1 },
  { name: 'textPdfFile', maxCount: 1 },
  { name: 'essenceHtmlFile', maxCount: 1 },
  { name: 'essencePdfFile', maxCount: 1 },
  { name: 'audioMp3File', maxCount: 1 },
  { name: 'audioMp4File', maxCount: 1 },
]);

// Helper: Upload single file buffer to S3 and return public S3 URL
async function uploadBufferToS3(file, folderPath) {
  if (!file) return null;
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${folderPath}/${Date.now()}-${safeName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// GET: Fetch all date rows by language and year
// app.get('/api/murli/:lang/:year', async (req, res) => {
//   try {
//     const lang = req.params.lang.toLowerCase();
//     const year = parseInt(req.params.year, 10);

//     if (!['telugu', 'hindi', 'english'].includes(lang) || Number.isNaN(year)) {
//       return res.status(400).json({ message: 'Invalid language or year' });
//     }

//     const [rows] = await pool.execute(
//       `SELECT id, language, year, murli_date,
//               text_html_url, text_pdf_url,
//               essence_html_url, essence_pdf_url,
//               audio_mp3_url, audio_mp4_url
//        FROM murli_entries
//        WHERE language = ? AND year = ?
//        ORDER BY id ASC`,
//       [lang, year]
//     );

//     res.json(rows);
//   } catch (err) {
//     console.error('Fetch error:', err);
//     res.status(500).json({ message: 'Failed to load Murli entries' });
//   }
// });

app.get('/api/murli/:lang/:year', async (req, res) => {
  try {
    const lang = req.params.lang.toLowerCase();
    const year = parseInt(req.params.year, 10);

    if (!['telugu', 'hindi', 'english'].includes(lang) || Number.isNaN(year)) {
      return res.status(400).json({ message: 'Invalid language or year' });
    }

    const [rows] = await pool.execute(
      `SELECT id, language, year, murli_date,
              text_html_url, text_pdf_url,
              essence_html_url, essence_pdf_url,
              audio_mp3_url, audio_mp4_url
       FROM murli_entries
       WHERE language = ? AND year = ?
       ORDER BY id ASC`,
      [lang, year]
    );

    res.json(rows);
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({
      message: 'Failed to load Murli entries',
      code: err?.code,
      sqlMessage: err?.sqlMessage || err?.message,
    });
  }
});

// POST: Upload files to S3 (or accept direct S3 URLs) + save row to MySQL
// app.post('/api/murli', uploadFields, async (req, res) => {
//   try {
//     const {
//       language,
//       year,
//       murli_date,
//       text_html_url,
//       text_pdf_url,
//       essence_html_url,
//       essence_pdf_url,
//       audio_mp3_url,
//       audio_mp4_url,
//     } = req.body;

//     const cleanLang = (language || '').toLowerCase().trim();
//     const parsedYear = parseInt(year, 10);
//     const cleanDate = (murli_date || '').trim();

//     if (!['telugu', 'hindi', 'english'].includes(cleanLang)) {
//       return res.status(400).json({ message: 'Language must be telugu, hindi, or english' });
//     }
//     if (!parsedYear || !cleanDate) {
//       return res.status(400).json({ message: 'Year and text date (e.g. 05.01.1969) are required' });
//     }

//     const folder = `murli/${cleanLang}/${parsedYear}`;
//     const files = req.files || {};

//     // Upload attached files to S3 if provided, otherwise keep manual S3 URL input
//     const finalTextHtml =
//       (await uploadBufferToS3(files.textHtmlFile?.[0], folder)) || text_html_url || null;
//     const finalTextPdf =
//       (await uploadBufferToS3(files.textPdfFile?.[0], folder)) || text_pdf_url || null;
//     const finalEssenceHtml =
//       (await uploadBufferToS3(files.essenceHtmlFile?.[0], folder)) || essence_html_url || null;
//     const finalEssencePdf =
//       (await uploadBufferToS3(files.essencePdfFile?.[0], folder)) || essence_pdf_url || null;
//     const finalAudioMp3 =
//       (await uploadBufferToS3(files.audioMp3File?.[0], folder)) || audio_mp3_url || null;
//     const finalAudioMp4 =
//       (await uploadBufferToS3(files.audioMp4File?.[0], folder)) || audio_mp4_url || null;

//     const [result] = await pool.execute(
//       `INSERT INTO murli_entries
//        (language, year, murli_date, text_html_url, text_pdf_url, essence_html_url, essence_pdf_url, audio_mp3_url, audio_mp4_url)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         cleanLang,
//         parsedYear,
//         cleanDate,
//         finalTextHtml,
//         finalTextPdf,
//         finalEssenceHtml,
//         finalEssencePdf,
//         finalAudioMp3,
//         finalAudioMp4,
//       ]
//     );

//     res.status(201).json({
//       message: 'Murli entry saved and uploaded to S3',
//       id: result.insertId,
//       data: {
//         id: result.insertId,
//         language: cleanLang,
//         year: parsedYear,
//         murli_date: cleanDate,
//         text_html_url: finalTextHtml,
//         text_pdf_url: finalTextPdf,
//         essence_html_url: finalEssenceHtml,
//         essence_pdf_url: finalEssencePdf,
//         audio_mp3_url: finalAudioMp3,
//         audio_mp4_url: finalAudioMp4,
//       },
//     });
//   } catch (err) {
//     console.error('Upload/Save error:', err);
//     res.status(500).json({ message: 'Failed to upload to S3 or save to database' });
//   }
// });

const normalizeUrl = (val) => {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
};

app.post('/api/murli', async (req, res) => {
  try {
    const {
      language,
      year,
      murli_date,
      text_html_url,
      text_pdf_url,
      essence_html_url,
      essence_pdf_url,
      audio_mp3_url,
      audio_mp4_url,
    } = req.body;

    const cleanLang = (language || '').toLowerCase().trim();
    const parsedYear = parseInt(year, 10);
    const cleanDate = (murli_date || '').trim();

    if (!['telugu', 'hindi', 'english'].includes(cleanLang)) {
      return res.status(400).json({ message: 'Language must be telugu, hindi, or english' });
    }
    if (!parsedYear || !cleanDate) {
      return res.status(400).json({ message: 'Year and text date (e.g. 05.01.1969) are required' });
    }

    const finalTextHtml = normalizeUrl(text_html_url);
    const finalTextPdf = normalizeUrl(text_pdf_url);
    const finalEssenceHtml = normalizeUrl(essence_html_url);
    const finalEssencePdf = normalizeUrl(essence_pdf_url);
    const finalAudioMp3 = normalizeUrl(audio_mp3_url);
    const finalAudioMp4 = normalizeUrl(audio_mp4_url);

    const [result] = await pool.execute(
      `INSERT INTO murli_entries
       (language, year, murli_date, text_html_url, text_pdf_url, essence_html_url, essence_pdf_url, audio_mp3_url, audio_mp4_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanLang,
        parsedYear,
        cleanDate,
        finalTextHtml,
        finalTextPdf,
        finalEssenceHtml,
        finalEssencePdf,
        finalAudioMp3,
        finalAudioMp4,
      ]
    );

    res.status(201).json({
      message: 'Murli entry saved successfully',
      id: result.insertId,
      data: {
        id: result.insertId,
        language: cleanLang,
        year: parsedYear,
        murli_date: cleanDate,
        text_html_url: finalTextHtml,
        text_pdf_url: finalTextPdf,
        essence_html_url: finalEssenceHtml,
        essence_pdf_url: finalEssencePdf,
        audio_mp3_url: finalAudioMp3,
        audio_mp4_url: finalAudioMp4,
      },
    });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ message: 'Failed to save Murli entry to database' });
  }
});

app.get('/api/test', (req, res) => {
  res.json({ ok: true, message: 'Murli API is running' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));