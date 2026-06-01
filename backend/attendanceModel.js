const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    employee_id: {
      type: String,
      required: [true, 'Employee ID is required'],
      trim: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Employee name is required'],
      trim: true
    },
    timestamp: {
      type: Date,
      required: [true, 'Attendance timestamp is required'],
      index: true
    },
    latitude: {
      type: Number,
      default: null
    },
    longitude: {
      type: Number,
      default: null
    },
    idempotency_key: {
      type: String,
      required: [true, 'Idempotency key is required to guarantee exact-once delivery'],
      unique: true,
      trim: true,
      index: true
    },
    synced_at: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true // adds createdAt and updatedAt fields
  }
);

// Add compound or individual indexes for fast querying
attendanceSchema.index({ timestamp: -1 });
attendanceSchema.index({ employee_id: 1, timestamp: -1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
