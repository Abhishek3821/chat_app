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
// Support getRequests' two queries ({ to, status: 'pending' } / { from, status: 'pending' }) —
// the unique index above doesn't serve a `status` filter as a usable prefix.
contactRequestSchema.index({ to: 1, status: 1 });
contactRequestSchema.index({ from: 1, status: 1 });

const ContactRequest = mongoose.model('ContactRequest', contactRequestSchema);
export default ContactRequest;
