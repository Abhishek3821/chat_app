import mongoose from 'mongoose';

/**
 * A catalog Product is a storefront item owned by a (business) workspace —
 * WhatsApp-Business-style catalog. Any authenticated user can browse a
 * business's catalog; only workspace managers can create/edit items. A product
 * can be shared into a chat, which snapshots its fields onto the message.
 */
const productSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    price: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'USD', maxlength: 8 },
    images: [{ type: String }],
    link: { type: String, default: '', maxlength: 500 }, // external product/order URL
    inStock: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ workspace: 1, createdAt: -1 });

export default mongoose.model('Product', productSchema);
