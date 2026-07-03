import mongoose from 'mongoose';
import { API_SCOPES } from '../utils/apiKey.js';

/**
 * A developer API key for third-party integrations. It acts on behalf of its
 * owner user and is limited to its granted scopes. Only the hash is stored.
 */
const apiKeySchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, trim: true, maxlength: 80, default: 'API key' },
    hashedKey: { type: String, required: true, unique: true, index: true, select: false },
    prefix: { type: String, required: true }, // e.g. "cc_live_ab12" — safe to display
    scopes: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.every((s) => API_SCOPES.includes(s)),
        message: 'Contains an unknown scope.',
      },
    },
    active: { type: Boolean, default: true },
    lastUsedAt: { type: Date },
  },
  { timestamps: true }
);

const ApiKey = mongoose.model('ApiKey', apiKeySchema);
export default ApiKey;
