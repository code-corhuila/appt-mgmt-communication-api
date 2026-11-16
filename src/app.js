const express = require('express');
const helmet = require('helmet');
const messagesRouter = require('./routes/messages');
const { getDatabaseStatus } = require('./config/database');

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));

app.get('/health/live', (req, res) => res.json({ status: 'alive' }));

app.get('/health/ready', (req, res) => {
    const database = getDatabaseStatus();
    const ready = database === 'connected';
    return res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'degraded',
        database
    });
});

app.use('/api/messages', messagesRouter);

app.use((req, res) => res.status(404).json({
    error: 'NOT_FOUND',
    message: 'Route not found'
}));

app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'INVALID_JSON', message: 'Request body must be valid JSON' });
    }
    if (error.type === 'entity.too.large') {
        return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 16kb' });
    }
    console.error('Unhandled communication API error:', error.message);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
});

module.exports = app;
