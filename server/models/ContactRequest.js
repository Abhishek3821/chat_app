import mongoose from 'mongoose';

const contactRequestSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    message: { type: String, default: '' },
  },
  { timestamps: true }
);

contactRequestSchema.index({ from: 1, to: 1 }, { unique: true });

const ContactRequest = mongoose.model('ContactRequest', contactRequestSchema);
export default ContactRequest;
