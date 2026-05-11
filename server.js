const API_BASE_URL = 'http://localhost:5000';
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();

// ======================
// CONFIG
// ======================
const PORT = process.env.PORT || 5500;
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/road_condition_db';

const PUBLIC_FOLDER = path.join(__dirname, 'public');
const TEMPLATES_FOLDER = path.join(__dirname, 'templates');
const UPLOAD_FOLDER = path.join(__dirname, 'uploads');
const PYTHON_SCRIPT = path.join(__dirname, 'predict.py');
const MAX_FILE_SIZE = 16 * 1024 * 1024;

// ======================
// CREATE UPLOADS FOLDER
// ======================
if (!fs.existsSync(UPLOAD_FOLDER)) {
  fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
}

// ======================
// MIDDLEWARE
// ======================
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://127.0.0.1:5501', 'http://localhost:5501'],
  methods: ['GET', 'POST', 'DELETE', 'PUT'],
  credentials: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public/
app.use(express.static(PUBLIC_FOLDER));

// Serve uploaded files
app.use('/uploads', express.static(UPLOAD_FOLDER));

// ======================
// MONGODB
// ======================
mongoose.set('bufferCommands', false);

mongoose
  .connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000
  })
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.log('❌ MongoDB connection failed:', err.message));

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

// ======================
// SCHEMA
// ======================
const predictionSchema = new mongoose.Schema(
  {
    userId: { type: String, default: 'anonymous' },
    filename: String,
    filepath: String,
    location: String,
    predictedClass: String,
    confidence: Number,
    allPredictions: {
      good: Number,
      satisfactory: Number,
      poor: Number,
      very_poor: Number
    },
    timestamp: { type: Date, default: Date.now },
    imageBase64: String
  },
  { bufferCommands: false }
);

const Prediction = mongoose.model('Prediction', predictionSchema);

// ======================
// MULTER
// ======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_FOLDER);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/bmp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, JPEG, PNG and BMP files are allowed'));
    }
  }
});

// ======================
// PYTHON PREDICTION
// ======================
function getPythonExecutable() {
  const possiblePaths = [
    process.env.PYTHON_PATH,
    path.join(__dirname, '.venv', 'Scripts', 'python.exe'),
    path.join(__dirname, '.venv', 'bin', 'python'),
    'python',
    'python3'
  ].filter(Boolean);

  for (const item of possiblePaths) {
    if (item === 'python' || item === 'python3') return item;
    if (fs.existsSync(item)) return item;
  }

  return 'python';
}

function predictRoadCondition(imagePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PYTHON_SCRIPT)) {
      return reject(new Error('predict.py file not found in root folder'));
    }

    const pythonExecutable = getPythonExecutable();
    const py = spawn(pythonExecutable, [PYTHON_SCRIPT, imagePath]);

    let output = '';
    let error = '';

    py.stdout.on('data', (data) => {
      output += data.toString();
    });

    py.stderr.on('data', (data) => {
      error += data.toString();
      console.error('Python stderr:', data.toString());
    });

    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(error || `Python exited with code ${code}`));
      }

      try {
        const cleanedOutput = output.trim();
        const result = JSON.parse(cleanedOutput);
        resolve(result);
      } catch (err) {
        reject(new Error(`Invalid JSON from predict.py: ${output}`));
      }
    });

    py.on('error', (err) => {
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });
  });
}

// ======================
// FRONTEND ROUTE
// ======================
app.get('/', (req, res) => {
  res.sendFile(path.join(TEMPLATES_FOLDER, 'index.html'));
});

// ======================
// API ROUTES
// ======================
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Backend connected successfully',
    mongodb: isMongoConnected() ? 'connected' : 'disconnected'
  });
});

app.post('/api/predict', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file uploaded'
      });
    }

    const userId = req.body.userId || 'anonymous';
    const location = req.body.location || 'Unknown';

    const result = await predictRoadCondition(req.file.path);

    const imageBuffer = fs.readFileSync(req.file.path);
    const imageBase64 = imageBuffer.toString('base64');

    let savedPrediction = null;

    if (isMongoConnected()) {
      const prediction = new Prediction({
        userId,
        filename: req.file.filename,
        filepath: req.file.path,
        location,
        predictedClass: result.predicted_class,
        confidence: result.confidence,
        allPredictions: result.all_predictions,
        imageBase64
      });

      savedPrediction = await prediction.save();
    }

    res.json({
      success: true,
      predictionId: savedPrediction ? savedPrediction._id : null,
      data: {
        predictedClass: result.predicted_class,
        confidence: result.confidence,
        allPredictions: result.all_predictions,
        classInfo: result.class_info || {},
        image: `data:${req.file.mimetype};base64,${imageBase64}`
      }
    });
  } catch (error) {
    console.error('Prediction Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Prediction failed'
    });
  }
});

app.get('/api/predictions', async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({
        success: false,
        error: 'MongoDB not connected'
      });
    }

    const userId = req.query.userId;
    const query = userId ? { userId } : {};

    const predictions = await Prediction.find(query).sort({ timestamp: -1 });

    res.json({
      success: true,
      data: predictions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/predictions/:id', async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({
        success: false,
        error: 'MongoDB not connected'
      });
    }

    const prediction = await Prediction.findById(req.params.id);

    if (!prediction) {
      return res.status(404).json({
        success: false,
        error: 'Prediction not found'
      });
    }

    res.json({
      success: true,
      data: prediction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.delete('/api/predictions/:id', async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({
        success: false,
        error: 'MongoDB not connected'
      });
    }

    const prediction = await Prediction.findByIdAndDelete(req.params.id);

    if (!prediction) {
      return res.status(404).json({
        success: false,
        error: 'Prediction not found'
      });
    }

    res.json({
      success: true,
      message: 'Prediction deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({
        success: false,
        error: 'MongoDB not connected'
      });
    }

    const userId = req.query.userId;
    const matchQuery = userId ? { userId } : {};

    const totalPredictions = await Prediction.countDocuments(matchQuery);
    const predictions = await Prediction.find(matchQuery);

    const classDistribution = {
      good: 0,
      satisfactory: 0,
      poor: 0,
      very_poor: 0
    };

    let totalConfidence = 0;

    predictions.forEach((item) => {
      if (classDistribution[item.predictedClass] !== undefined) {
        classDistribution[item.predictedClass]++;
      }
      totalConfidence += item.confidence || 0;
    });

    const averageConfidence =
      predictions.length > 0
        ? Number(totalConfidence / predictions.length).toFixed(2)
        : 0;

    res.json({
      success: true,
      data: {
        totalPredictions,
        classDistribution,
        averageConfidence
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ======================
// ERROR HANDLER
// ======================
app.use((err, req, res, next) => {
  console.error('Server Error:', err);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }

  next();
});

// ======================
// START SERVER
// ======================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Public folder: ${PUBLIC_FOLDER}`);
  console.log(`📄 Templates folder: ${TEMPLATES_FOLDER}`);
  console.log(`📤 Upload folder: ${UPLOAD_FOLDER}`);
});