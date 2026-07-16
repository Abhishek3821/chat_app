import Product from '../models/Product.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Workspace from '../models/Workspace.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';
import { workspaceCan, PERMISSIONS } from '../utils/rbac.js';
import { cacheGetJSON, cacheSetJSON, cacheDel } from '../utils/cache.js';

// Catalog editing is a business-owner/admin capability.
const canManageCatalog = (user) => workspaceCan(user, PERMISSIONS.WORKSPACE_SETTINGS);

function publicProduct(p) {
  return {
    _id: p._id,
    workspace: p.workspace,
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    images: p.images || [],
    link: p.link,
    inStock: p.inStock,
    createdAt: p.createdAt,
  };
}

// A catalog is identical for every viewer, so it's safe to cache per workspace
// (Redis; no-op without REDIS_URL). Invalidated on every write below.
const catalogKey = (workspaceId) => `catalog:${workspaceId}`;

async function getCatalogProducts(workspaceId) {
  const key = catalogKey(workspaceId);
  const cached = await cacheGetJSON(key);
  if (cached) return cached;
  const products = (await Product.find({ workspace: workspaceId }).sort({ createdAt: -1 })).map(publicProduct);
  await cacheSetJSON(key, products, 120);
  return products;
}

// GET /api/catalog/mine — my workspace's catalog (+ whether I can edit it)
export const listMyCatalog = asyncHandler(async (req, res) => {
  if (!req.user.workspace) return res.json({ success: true, products: [], canManage: false });
  const products = await getCatalogProducts(req.user.workspace);
  res.json({ success: true, products, canManage: canManageCatalog(req.user) });
});

// GET /api/catalog/:workspaceId — browse any business's catalog (any signed-in user)
export const listCatalog = asyncHandler(async (req, res) => {
  const ws = await Workspace.findById(req.params.workspaceId).select('type name businessProfile');
  if (!ws) throw new ApiError(404, 'Business not found.');
  const products = await getCatalogProducts(ws._id);
  res.json({
    success: true,
    business: { _id: ws._id, name: ws.name, businessProfile: ws.businessProfile || {} },
    products,
  });
});

// POST /api/catalog  — add a product (manager)
export const createProduct = asyncHandler(async (req, res) => {
  if (!req.user.workspace) throw new ApiError(400, 'You are not in a workspace.');
  if (!canManageCatalog(req.user)) throw new ApiError(403, 'Only workspace owners/admins can edit the catalog.');
  const name = (req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'A product needs a name.');

  const images = Array.isArray(req.body.images)
    ? req.body.images.filter((u) => typeof u === 'string' && (u.startsWith('/uploads/') || /^https:\/\//i.test(u))).slice(0, 10)
    : [];

  const product = await Product.create({
    workspace: req.user.workspace,
    createdBy: req.user._id,
    name: name.slice(0, 120),
    description: (req.body.description || '').slice(0, 2000),
    price: Math.max(0, Number(req.body.price) || 0),
    currency: (req.body.currency || 'USD').slice(0, 8),
    images,
    link: (req.body.link || '').slice(0, 500),
    inStock: req.body.inStock !== false,
  });
  await cacheDel(catalogKey(req.user.workspace));
  res.status(201).json({ success: true, product: publicProduct(product) });
});

// PATCH /api/catalog/:id — edit a product (manager, own workspace only)
export const updateProduct = asyncHandler(async (req, res) => {
  if (!canManageCatalog(req.user)) throw new ApiError(403, 'Only workspace owners/admins can edit the catalog.');
  const product = await Product.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!product) throw new ApiError(404, 'Product not found.');

  if (typeof req.body.name === 'string' && req.body.name.trim()) product.name = req.body.name.trim().slice(0, 120);
  if (typeof req.body.description === 'string') product.description = req.body.description.slice(0, 2000);
  if (req.body.price !== undefined) product.price = Math.max(0, Number(req.body.price) || 0);
  if (typeof req.body.currency === 'string') product.currency = req.body.currency.slice(0, 8);
  if (typeof req.body.link === 'string') product.link = req.body.link.slice(0, 500);
  if (req.body.inStock !== undefined) product.inStock = Boolean(req.body.inStock);
  if (Array.isArray(req.body.images)) {
    product.images = req.body.images
      .filter((u) => typeof u === 'string' && (u.startsWith('/uploads/') || /^https:\/\//i.test(u)))
      .slice(0, 10);
  }
  await product.save();
  await cacheDel(catalogKey(req.user.workspace));
  res.json({ success: true, product: publicProduct(product) });
});

// DELETE /api/catalog/:id — remove a product (manager)
export const deleteProduct = asyncHandler(async (req, res) => {
  if (!canManageCatalog(req.user)) throw new ApiError(403, 'Only workspace owners/admins can edit the catalog.');
  const result = await Product.deleteOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!result.deletedCount) throw new ApiError(404, 'Product not found.');
  await cacheDel(catalogKey(req.user.workspace));
  res.json({ success: true });
});

// POST /api/catalog/:id/share  { chatId } — share a product into a chat as a message
export const shareProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');

  const chat = await Chat.findById(req.body.chatId);
  if (!chat) throw new ApiError(404, 'Chat not found.');
  if (!chat.participants.some((p) => String(p.user) === String(req.user._id))) {
    throw new ApiError(403, 'You are not a participant of this chat.');
  }

  const price = product.price ? `${product.currency} ${product.price}` : '';
  const expiresAt = chat.disappearingSeconds > 0 ? new Date(Date.now() + chat.disappearingSeconds * 1000) : undefined;
  let message = await Message.create({
    chat: chat._id,
    sender: req.user._id,
    type: 'product',
    content: `${product.name}${price ? ` — ${price}` : ''}`, // graceful fallback text
    product: {
      ref: product._id,
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency,
      image: (product.images || [])[0] || '',
      link: product.link,
    },
    expiresAt,
    deliveredTo: [req.user._id],
    readBy: [{ user: req.user._id, at: new Date() }],
  });

  chat.lastMessage = message._id;
  await chat.save();
  message = await Message.findById(message._id).populate('sender', 'name username avatar');
  for (const p of chat.participants) {
    emitToUser(String(p.user), 'receive-message', { chatId: String(chat._id), message });
    if (String(p.user) !== String(req.user._id)) emitToUser(String(p.user), 'chat-updated', { chatId: String(chat._id) });
  }
  res.status(201).json({ success: true, message });
});
