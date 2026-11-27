require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

    if (!['telugu', 'hindi', 'english', 'tamil', 'kannada', 'gujarati'].includes(lang) || Number.isNaN(year)) {
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
  // adfadfa
});

function signToken(user) {
  return jwt.sign(
    { userId: user.id, mobile: user.mobile },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

const ALLOWED_LANGUAGES = new Set(['english', 'telugu', 'hindi']);

// POST /api/auth/register — Register with mobile number and password
// app.post('/api/auth/register', async (req, res) => {
//   try {
//     const mobile = String(req.body?.mobile || '').trim();
//     const password = String(req.body?.password || '');

//     if (!MOBILE_REGEX.test(mobile)) {
//       return res.status(400).json({
//         message: 'Please enter a valid 10-digit mobile number.',
//       });
//     }

//     if (password.length < 8) {
//       return res.status(400).json({
//         message: 'Password must be at least 8 characters long.',
//       });
//     }

//     const [existing] = await pool.execute(
//       'SELECT id FROM users WHERE mobile = ? LIMIT 1',
//       [mobile]
//     );

//     if (existing.length > 0) {
//       return res.status(409).json({
//         message: 'An account with this mobile number already exists.',
//       });
//     }

//     const passwordHash = await bcrypt.hash(password, 10);

//     const [result] = await pool.execute(
//       'INSERT INTO users (mobile, password_hash) VALUES (?, ?)',
//       [mobile, passwordHash]
//     );

//     const user = { id: result.insertId, mobile };
//     const token = signToken(user);

//     return res.status(201).json({
//       message: 'Registered successfully.',
//       token,
//       user,
//     });
//   } catch (err) {
//     if (err?.code === 'ER_DUP_ENTRY') {
//       return res.status(409).json({
//         message: 'An account with this mobile number already exists.',
//       });
//     }
//     console.error('Register error:', err);
//     return res.status(500).json({ message: 'Failed to register user.' });
//   }
// });

// POST /api/auth/login — Login with mobile number and password
// app.post('/api/auth/login', async (req, res) => {
//   try {
//     const mobile = String(req.body?.mobile || '').trim();
//     const password = String(req.body?.password || '');

//     if (!MOBILE_REGEX.test(mobile) || !password) {
//       return res.status(400).json({
//         message: 'Mobile number and password are required.',
//       });
//     }

//     const [rows] = await pool.execute(
//       'SELECT id, mobile, password_hash FROM users WHERE mobile = ? LIMIT 1',
//       [mobile]
//     );

//     if (rows.length === 0) {
//       return res.status(401).json({
//         message: 'Invalid mobile number or password.',
//       });
//     }

//     const dbUser = rows[0];
//     const isMatch = await bcrypt.compare(password, dbUser.password_hash);

//     if (!isMatch) {
//       return res.status(401).json({
//         message: 'Invalid mobile number or password.',
//       });
//     }

//     const user = { id: dbUser.id, mobile: dbUser.mobile };
//     const token = signToken(user);

//     return res.json({
//       message: 'Logged in successfully.',
//       token,
//       user,
//     });
//   } catch (err) {
//     console.error('Login error:', err);
//     return res.status(500).json({ message: 'Failed to log in.' });
//   }
// });

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const rawLanguage = String(req.body?.language || 'english')
      .trim()
      .toLowerCase();
    const mobile = String(req.body?.mobile || '').trim();
    const password = String(req.body?.password || '');

    // if (!name) {
    //   return res.status(400).json({
    //     message: 'Please enter your full name.',
    //   });
    // }

    if (!ALLOWED_LANGUAGES.has(rawLanguage)) {
      return res.status(400).json({
        message: 'Language must be english, telugu, or hindi.',
      });
    }

    if (!MOBILE_REGEX.test(mobile)) {
      return res.status(400).json({
        message: 'Please enter a valid 10-digit mobile number.',
      });
    }

    // if (password.length < 4) {
    //   return res.status(400).json({
    //     message: 'Password must be at least 8 characters long.',
    //   });
    // }

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE mobile = ? LIMIT 1',
      [mobile]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        message: 'An account with this mobile number already exists.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await pool.execute(
      'INSERT INTO users (name, language, mobile, password_hash) VALUES (?, ?, ?, ?)',
      [name, rawLanguage, mobile, passwordHash]
    );

    const user = {
      id: result.insertId,
      name,
      language: rawLanguage,
      mobile,
    };
    const token = signToken(user);

    return res.status(201).json({
      message: 'Registered successfully.',
      token,
      user,
    });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'An account with this mobile number already exists.',
      });
    }
    console.error('Register error:', err);
    return res.status(500).json({ message: 'Failed to register user.' });
  }
});

// POST /api/auth/login — Login with mobile number and password
app.post('/api/auth/login', async (req, res) => {
  try {
    const mobile = String(req.body?.mobile || '').trim();
    const password = String(req.body?.password || '');

    if (!MOBILE_REGEX.test(mobile) || !password) {
      return res.status(400).json({
        message: 'Mobile number and password are required.',
      });
    }

    const [rows] = await pool.execute(
      'SELECT id, name, language, mobile, password_hash FROM users WHERE mobile = ? LIMIT 1',
      [mobile]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        message: 'Invalid mobile number or password.',
      });
    }

    const dbUser = rows[0];
    const isMatch = await bcrypt.compare(password, dbUser.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        message: 'Invalid mobile number or password.',
      });
    }

    const user = {
      id: dbUser.id,
      name: dbUser.name,
      language: dbUser.language || 'english',
      mobile: dbUser.mobile,
    };
    const token = signToken(user);

    return res.json({
      message: 'Logged in successfully.',
      token,
      user,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Failed to log in.' });
  }
});

// Middleware to verify JWT token for protected write operations
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: Missing token' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
  }
}

// PUT: Update an existing Murli entry by ID
app.put('/api/murli/:id',  async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid Murli entry ID' });
    }

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
      return res.status(400).json({ message: 'Year and date are required' });
    }

    const finalTextHtml = normalizeUrl(text_html_url);
    const finalTextPdf = normalizeUrl(text_pdf_url);
    const finalEssenceHtml = normalizeUrl(essence_html_url);
    const finalEssencePdf = normalizeUrl(essence_pdf_url);
    const finalAudioMp3 = normalizeUrl(audio_mp3_url);
    const finalAudioMp4 = normalizeUrl(audio_mp4_url);

    const [result] = await pool.execute(
      `UPDATE murli_entries
       SET language = ?,
           year = ?,
           murli_date = ?,
           text_html_url = ?,
           text_pdf_url = ?,
           essence_html_url = ?,
           essence_pdf_url = ?,
           audio_mp3_url = ?,
           audio_mp4_url = ?
       WHERE id = ?`,
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
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Murli entry not found' });
    }

    return res.json({
      message: 'Murli entry updated successfully',
      data: {
        id,
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
    console.error('Update error:', err);
    return res.status(500).json({ message: 'Failed to update Murli entry' });
  }
});

// DELETE: Delete a Murli entry by ID
app.delete('/api/murli/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid Murli entry ID' });
    }

    const [result] = await pool.execute(
      'DELETE FROM murli_entries WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Murli entry not found' });
    }

    return res.json({
      message: 'Murli entry deleted successfully',
      id,
    });
  } catch (err) {
    console.error('Delete error:', err);
    return res.status(500).json({ message: 'Failed to delete Murli entry' });
  }
});


app.post('/api/murlilist', async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.entries) ? req.body.entries : [req.body];

    if (!rawItems.length) {
      return res.status(400).json({ message: 'No Murli entries provided' });
    }

    const validEntries = [];
    const skipped = [];

    for (const item of rawItems) {
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
      } = item || {};

      const cleanLang = (language || '').toLowerCase().trim();
      const parsedYear = parseInt(year, 10);
      const cleanDate = (murli_date || '').trim();

      if (!['telugu', 'hindi', 'english', 'tamil', 'kannada', 'gujarati'].includes(cleanLang)) {
        skipped.push({ murli_date: cleanDate, reason: 'Invalid language' });
        continue;
      }
      if (!parsedYear || !cleanDate) {
        skipped.push({ murli_date: cleanDate, reason: 'Missing year or murli_date' });
        continue;
      }

      validEntries.push([
        cleanLang,
        parsedYear,
        cleanDate,
        normalizeUrl(text_html_url),
        normalizeUrl(text_pdf_url),
        normalizeUrl(essence_html_url),
        normalizeUrl(essence_pdf_url),
        normalizeUrl(audio_mp3_url),
        normalizeUrl(audio_mp4_url),
      ]);
    }

    if (!validEntries.length) {
      return res.status(400).json({
        message: 'No valid Murli entries to save',
        skipped,
      });
    }

    const placeholders = validEntries.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flatValues = validEntries.flat();

    const [result] = await pool.execute(
      `INSERT INTO murli_entries
       (language, year, murli_date, text_html_url, text_pdf_url, essence_html_url, essence_pdf_url, audio_mp3_url, audio_mp4_url)
       VALUES ${placeholders}`,
      flatValues
    );

    res.status(201).json({
      message: `Saved ${validEntries.length} Murli entry/entries successfully`,
      insertedCount: validEntries.length,
      skippedCount: skipped.length,
      skipped,
      insertId: result.insertId,
    });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ message: 'Failed to save Murli entry to database' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));