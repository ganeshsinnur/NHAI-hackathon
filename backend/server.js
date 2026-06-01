require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const Attendance = require('./attendanceModel');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/datalake';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // support bulk upload batches
app.use(morgan('dev'));

// Database Connection
console.log('🔄 Connecting to MongoDB at:', MONGO_URI);
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB Connection Established Successfully!');
  })
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  });

// Core API Endpoints

/**
 * @route   GET /health
 * @desc    Verify server status and connection health
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    timestamp: new Date(),
    uptime: process.uptime(),
    db_state: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

/**
 * @route   POST /api/v1/sync/attendance
 * @desc    Bulk upload offline-logged attendance records using idempotency keys
 */
app.post('/api/v1/sync/attendance', async (req, res) => {
  try {
    const { device_uuid, records } = req.body;

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid records payload. Must be an array of attendance records.'
      });
    }

    console.log(`📥 Received ${records.length} records from device: ${device_uuid || 'Unknown'}`);

    if (records.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No records to synchronize.',
        synced_count: 0,
        duplicate_count: 0
      });
    }

    // High performance bulk-write with idempotency key deduplication on MongoDB
    const operations = records.map((record) => {
      // Validate core parameters
      if (!record.employee_id || !record.name || !record.timestamp || !record.idempotency_key) {
        throw new Error('Malformed record: employee_id, name, timestamp, and idempotency_key are required.');
      }

      return {
        updateOne: {
          filter: { idempotency_key: record.idempotency_key },
          update: { $setOnInsert: record },
          upsert: true
        }
      };
    });

    // Run parallel bulkWrite
    const result = await Attendance.bulkWrite(operations, { ordered: false });

    // Calculate synced vs duplicate metrics
    const syncedCount = result.upsertedCount;
    // Modified count is 0 because of $setOnInsert, match count indicates duplicates already synced
    const duplicateCount = result.matchedCount;

    console.log(`✅ Sync Complete: ${syncedCount} new records saved, ${duplicateCount} duplicates skipped.`);

    return res.status(200).json({
      status: 'success',
      message: 'Synchronization successful.',
      synced_count: syncedCount,
      duplicate_count: duplicateCount
    });
  } catch (error) {
    console.error('❌ Sync Error:', error.message);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'An error occurred during synchronization.'
    });
  }
});

/**
 * @route   GET /api/v1/attendance
 * @desc    Retrieve all synced attendance logs sorted by timestamp descending
 */
app.get('/api/v1/attendance', async (req, res) => {
  try {
    const { limit = 100, page = 1, employee_id } = req.query;

    const query = {};
    if (employee_id) {
      query.employee_id = employee_id;
    }

    const parsedLimit = parseInt(limit);
    const parsedPage = parseInt(page);

    const logs = await Attendance.find(query)
      .sort({ timestamp: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit);

    const total = await Attendance.countDocuments(query);

    return res.status(200).json({
      status: 'success',
      count: logs.length,
      total,
      page: parsedPage,
      pages: Math.ceil(total / parsedLimit),
      data: logs
    });
  } catch (error) {
    console.error('❌ Fetch Error:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve attendance logs.'
    });
  }
});

/**
 * @route   DELETE /api/v1/attendance/purge
 * @desc    Purge all records (For testing/development purposes only)
 */
app.delete('/api/v1/attendance/purge', async (req, res) => {
  try {
    const result = await Attendance.deleteMany({});
    console.log(`🗑️ Database Purged. Removed ${result.deletedCount} documents.`);
    return res.status(200).json({
      status: 'success',
      message: `Database purged successfully. Removed ${result.deletedCount} records.`
    });
  } catch (error) {
    console.error('❌ Purge Error:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to purge database.'
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 DATALAKE 3.0 BACKEND IS RUNNING ONLINE!`);
  console.log(`🔌 Server Port:  ${PORT}`);
  console.log(`📡 API Endpoints: http://localhost:${PORT}/api/v1`);
  console.log(`==================================================`);
});
