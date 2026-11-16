const express = require('express');
const mongoose = require('mongoose');
const Message = require('../models/Message');
const authenticate = require('../middleware/authenticate');

const router = express.Router();
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function serializeMessage(message) {
    return {
        id: String(message._id),
        senderId: message.senderId,
        recipientId: message.recipientId,
        content: message.content,
        createdAt: message.createdAt,
        readAt: message.readAt
    };
}

router.use(authenticate);

router.get('/', async (req, res) => {
    const withUser = req.query.withUser;
    if (typeof withUser !== 'string' || !withUser.trim()) {
        return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'withUser query parameter is required'
        });
    }
    if (withUser === req.userId) {
        return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'A conversation must be with another user'
        });
    }

    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? DEFAULT_PAGE_SIZE : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
        return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}`
        });
    }

    let cursor;
    if (req.query.before !== undefined) {
        try {
            const decoded = JSON.parse(Buffer.from(req.query.before, 'base64url').toString('utf8'));
            const createdAt = new Date(decoded.createdAt);
            if (
                Number.isNaN(createdAt.getTime())
                || !mongoose.isValidObjectId(decoded.id)
            ) {
                throw new Error('Invalid message cursor');
            }
            cursor = { createdAt, id: decoded.id };
        } catch (error) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: 'before must be a valid message cursor'
            });
        }
    }

    const filter = {
        $or: [
            { senderId: req.userId, recipientId: withUser },
            { senderId: withUser, recipientId: req.userId }
        ]
    };
    if (cursor) {
        filter.$and = [{
            $or: [
                { createdAt: { $lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
            ]
        }];
    }

    try {
        const results = await Message.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit)
            .lean();
        const ordered = results.reverse();
        const messages = ordered.map(serializeMessage);
        const oldest = ordered[0];
        const nextBefore = messages.length === limit
            ? Buffer.from(JSON.stringify({
                createdAt: oldest.createdAt,
                id: String(oldest._id)
            })).toString('base64url')
            : null;
        return res.json({ messages, nextBefore });
    } catch (error) {
        console.error('Message history lookup failed:', error.message);
        return res.status(503).json({
            error: 'COMMUNICATION_UNAVAILABLE',
            message: 'Message history is temporarily unavailable'
        });
    }
});

router.post('/', async (req, res) => {
    const body = req.body || {};
    const toUserId = typeof body.toUserId === 'string' ? body.toUserId.trim() : '';
    const content = typeof body.content === 'string' ? body.content.trim() : '';

    if (!toUserId || !content) {
        return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'toUserId and content are required'
        });
    }
    if (toUserId === req.userId) {
        return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'A message cannot be sent to yourself'
        });
    }
    if (content.length > 2000) {
        return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'content must not exceed 2000 characters'
        });
    }

    try {
        const message = await Message.create({
            senderId: req.userId,
            recipientId: toUserId,
            content
        });
        return res.status(201).json({ message: serializeMessage(message) });
    } catch (error) {
        console.error('Message creation failed:', error.message);
        return res.status(503).json({
            error: 'COMMUNICATION_UNAVAILABLE',
            message: 'Message could not be sent'
        });
    }
});

router.patch('/:id/read', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Message not found' });
    }

    try {
        const message = await Message.findOneAndUpdate(
            { _id: req.params.id, recipientId: req.userId },
            { $set: { readAt: new Date() } },
            { new: true, runValidators: true }
        ).lean();

        if (!message) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'Message not found' });
        }
        return res.json({ message: serializeMessage(message) });
    } catch (error) {
        console.error('Message read update failed:', error.message);
        return res.status(503).json({
            error: 'COMMUNICATION_UNAVAILABLE',
            message: 'Message could not be marked as read'
        });
    }
});

module.exports = router;
