const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    senderId: { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    readAt: { type: Date, default: null }
}, { timestamps: { createdAt: true, updatedAt: false } });

messageSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });
messageSchema.index({ recipientId: 1, senderId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
